import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { one, query } from './db.ts';
import { DEMO_USERS } from './demo-users.ts';
import { getUser, lookup, remember } from './directory.ts';
import { devLoginEnabled, ssoConfigured, ssoCredentials } from './sso-config.ts';
import { verifyPassword } from './unisso-password.ts';
import {
  ApiError,
  badRequest,
  clearCookieHeader,
  cookieHeader,
  forbidden,
  openCookieValue,
  redirectSafe,
  sealCookieValue,
  safeReturnPath,
  unauthorized,
} from './http.ts';
import type { AuthMethod, SessionRow, SessionUser } from './types.ts';

const { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } = ssoCredentials();
const SCOPE = process.env.SSO_SCOPE || 'openid profile:username profile:name profile:avatar email';
const SESSION_COOKIE = 'sid';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const TX_COOKIE = 'oauth_tx';
const TX_MAX_AGE = 600;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_LENGTH = 1024;

export { devLoginEnabled, ssoConfigured };

interface QualificationCacheEntry {
  developer: boolean;
  expiresAt: number;
}

// 资格校验缓存：同一 session 在 TTL 内不重复请求 userinfo，撤销延迟上限即该 TTL。
// TTL 为 0 表示每次请求都校验。
const qualificationCache = new Map<string, QualificationCacheEntry>();
const qualificationInFlight = new Map<string, Promise<boolean>>();

function developerTtlMs(): number {
  const seconds = Number(process.env.SSO_DEVELOPER_TTL_SECONDS ?? 60);
  if (!Number.isFinite(seconds) || seconds < 0) return 60_000;
  return seconds * 1000;
}

function forgetQualification(sessionId: string): void {
  qualificationCache.delete(sessionId);
  qualificationInFlight.delete(sessionId);
}

function pruneQualificationCache(): void {
  if (qualificationCache.size <= 5000) return;
  const now = Date.now();
  for (const [key, value] of qualificationCache) {
    if (value.expiresAt <= now) qualificationCache.delete(key);
  }
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

function redirectUri(req: Request): string {
  if (process.env.SSO_REDIRECT_URI) return process.env.SSO_REDIRECT_URI;
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  return `${proto}://${req.get('host')}/api/auth/callback`;
}

function isSecure(req: Request): boolean {
  return (req.get('x-forwarded-proto') || req.protocol) === 'https';
}

function toMysqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** UniSSO userinfo（含 users/list 的一条）里我们用到的字段。 */
interface UserinfoProfile {
  sub?: unknown;
  sso_sub?: unknown;
  preferred_username?: unknown;
  name?: unknown;
  picture?: unknown;
  email?: unknown;
  developer?: unknown;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

export interface CreateSessionOptions {
  accessToken?: string | null;
  expiresIn?: number;
  authMethod?: AuthMethod;
  developer?: boolean | null;
}

export interface CreatedSession {
  id: string;
  expires: Date;
}

// 会话只记 sub（= UniSSO users.id）；昵称头像不落库，展示时再向目录要。
// auth_method 区分 sso / password / dev，checkQualification 据此选择资格来源。
export async function createSession(
  userId: string,
  { accessToken = null, expiresIn = 0, authMethod = 'sso', developer = null }: CreateSessionOptions = {},
): Promise<CreatedSession> {
  const id = b64url(crypto.randomBytes(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const tokenExpiresAt = accessToken && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
  await query(
    `INSERT INTO sessions (id, user_id, auth_method, developer, access_token, access_token_expires_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      authMethod,
      developer === null ? null : developer ? 1 : 0,
      accessToken,
      tokenExpiresAt ? toMysqlDate(tokenExpiresAt) : null,
      toMysqlDate(expires),
    ],
  );
  return { id, expires };
}

export async function destroySession(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  forgetQualification(sessionId);
  await query('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export function sessionCookie(req: Request, sessionId: string, expires: Date): string {
  return cookieHeader(SESSION_COOKIE, sessionId, {
    maxAge: Math.floor((expires.getTime() - Date.now()) / 1000),
    secure: isSecure(req),
  });
}

export function clearSessionCookie(): string {
  return clearCookieHeader(SESSION_COOKIE);
}

export const attachSession = (req: Request, _res: Response, next: NextFunction): void => {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) {
    req.user = null;
    return next();
  }
  one<SessionRow>(
    `SELECT id AS session_id, user_id, auth_method, developer, expires_at, access_token, access_token_expires_at
       FROM sessions
      WHERE id = ? AND expires_at > NOW()`,
    [raw],
  )
    .then(async (row) => {
      if (!row) {
        req.user = null;
        return;
      }
      // 名字、头像、邮箱来自 UniSSO 目录；目录取不到时为 null，前端显示「未知用户」。
      const profile = await getUser(row.user_id);
      req.user = {
        id: row.user_id,
        name: profile?.name ?? null,
        avatar: profile?.avatar ?? null,
        email: profile?.email ?? null,
        sessionId: row.session_id,
        authMethod: row.auth_method || 'sso',
        developer: row.developer === null || row.developer === undefined ? null : Boolean(row.developer),
        accessToken: row.access_token || null,
        accessTokenExpiresAt: row.access_token_expires_at || null,
      };
    })
    .then(() => next())
    .catch(next);
};

export const requireUser = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.user) next();
  else next(unauthorized());
};

export const login = (req: Request, res: Response): void => {
  const returnTo = safeReturnPath(req.query.redirect, '/');
  if (!ssoConfigured()) {
    if (devLoginEnabled()) {
      redirectSafe(req, res, `/login?redirect=${encodeURIComponent(returnTo)}`);
      return;
    }
    throw new ApiError(503, 'SSO_NOT_CONFIGURED', '未配置 UniSSO 凭证，且开发登录已关闭');
  }
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const uri = redirectUri(req);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: uri,
    response_type: 'code',
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  res.setHeader(
    'Set-Cookie',
    cookieHeader(TX_COOKIE, sealCookieValue({ state, verifier, returnTo, uri }), {
      maxAge: TX_MAX_AGE,
      path: '/api/auth',
      secure: isSecure(req),
    }),
  );
  redirectSafe(req, res, `${ISSUER}/authorize?${params.toString()}`, { allowedOrigins: [ISSUER] });
};

// 邮箱密码登录：不跳 UniSSO，后端直接校验并签发本地会话。
export const passwordLogin = async (req: Request, res: Response): Promise<void> => {
  const email = String(req.body?.email ?? '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_RE.test(email)) throw badRequest('BAD_REQUEST', '请输入有效的邮箱地址');
  if (!password) throw badRequest('BAD_REQUEST', '请输入密码');
  if (password.length > MAX_PASSWORD_LENGTH) throw badRequest('BAD_REQUEST', '密码过长');
  if (!ssoConfigured()) {
    throw new ApiError(503, 'SSO_NOT_CONFIGURED', '未配置 UniSSO 凭证，无法使用邮箱密码登录');
  }

  let result;
  try {
    result = await verifyPassword(email, password);
  } catch (error) {
    console.error('[auth] password/verify 请求失败：', error instanceof Error ? error.message : String(error));
    throw new ApiError(502, 'SSO_UNAVAILABLE', '身份服务暂时不可用，请稍后重试');
  }

  if (!result.ok || !result.user) {
    const code = String(result.data.error || '');
    const detail = String(result.data.error_description || result.data.message || '');
    if (result.status === 401 || code === 'invalid_credentials') {
      throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
    }
    if (result.status === 403 || code === 'password_verify_forbidden') {
      throw new ApiError(403, 'PASSWORD_LOGIN_FORBIDDEN', '该应用未开启邮箱密码登录');
    }
    if (result.status === 429 || code === 'rate_limited' || code === 'too_many_attempts') {
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '尝试过于频繁，请稍后再试');
    }
    if (result.status === 400) {
      throw new ApiError(400, 'BAD_REQUEST', detail || '登录信息有误');
    }
    console.error('[auth] password/verify 返回异常：', result.status, code, detail);
    throw new ApiError(502, 'SSO_UNAVAILABLE', '身份服务暂时不可用，请稍后重试');
  }

  const user = result.user;
  // 展示资料先写缓存；即使 users/list 不可用，当前用户也总有名字可显示。
  await remember({
    sub: user.sub,
    preferred_username: user.username,
    name: user.name,
    picture: user.picture,
    email: user.email,
    developer: user.developer,
  });
  const session = await createSession(user.sub, {
    authMethod: 'password',
    developer: user.developer,
  });
  res.setHeader('Set-Cookie', sessionCookie(req, session.id, session.expires));
  res.json({ ok: true });
};

async function exchangeCode(code: string, verifier: string, uri: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: uri,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: verifier,
  });
  const resp = await fetch(`${ISSUER}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const data = (await resp.json().catch(() => ({}))) as TokenResponse;
  if (!resp.ok || !data.access_token) {
    throw new ApiError(502, 'SSO_TOKEN_FAILED', data.error_description || data.error || '换取 token 失败');
  }
  return data;
}

async function fetchUserinfo(accessToken: string): Promise<UserinfoProfile> {
  const resp = await fetch(`${ISSUER}/api/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  const data = (await resp.json().catch(() => ({}))) as UserinfoProfile & { error?: string };
  if (resp.status === 401) throw new ApiError(401, 'SSO_TOKEN_REJECTED', 'access token 已失效');
  if (!resp.ok) throw new ApiError(502, 'SSO_USERINFO_FAILED', data.error || '获取用户信息失败');
  return data;
}

// 密码会话没有 access token：登录时先记 developer 快照，之后用 users/list 刷新。
// 目录不可用（known === null）或只有 user_profile 快照时，回落到登录时的值。
async function resolvePasswordQualification(user: SessionUser): Promise<boolean> {
  const { known, user: fresh } = await lookup(user.id);
  if (known === false) return false;
  if (known === true && typeof fresh?.developer === 'boolean') return fresh.developer;
  return user.developer === true;
}

async function checkPasswordQualification(user: SessionUser, ttl: number): Promise<boolean> {
  if (ttl > 0) {
    const hit = qualificationCache.get(user.sessionId);
    if (hit && hit.expiresAt > Date.now()) return hit.developer;
    if (hit) qualificationCache.delete(user.sessionId);
  }
  const pending = qualificationInFlight.get(user.sessionId);
  if (pending) return pending;

  const promise = (async () => {
    const developer = await resolvePasswordQualification(user);
    if (developer !== user.developer) {
      user.developer = developer;
      try {
        await query('UPDATE sessions SET developer = ? WHERE id = ?', [developer ? 1 : 0, user.sessionId]);
      } catch (error) {
        console.error('[auth] 更新会话开发者资格失败：', error instanceof Error ? error.message : String(error));
      }
    }
    if (ttl > 0) {
      qualificationCache.set(user.sessionId, { developer, expiresAt: Date.now() + ttl });
      pruneQualificationCache();
    }
    return developer;
  })();

  qualificationInFlight.set(user.sessionId, promise);
  try {
    return await promise;
  } finally {
    if (qualificationInFlight.get(user.sessionId) === promise) {
      qualificationInFlight.delete(user.sessionId);
    }
  }
}

// developer 只认严格布尔 true；字段缺失（线上 SSO 未部署新版本）一律视为无资格。
export async function checkQualification(user: SessionUser | null | undefined): Promise<boolean> {
  if (!user) throw unauthorized();
  // 密码会话没有 access token，资格来自登录快照 + users/list 定期刷新。
  if (user.authMethod === 'password') return checkPasswordQualification(user, developerTtlMs());
  // DEV_LOGIN 造的会话没有 SSO token，仅本地联调放行。
  if (!user.accessToken) return devLoginEnabled();

  const ttl = developerTtlMs();
  if (ttl > 0) {
    const hit = qualificationCache.get(user.sessionId);
    if (hit && hit.expiresAt > Date.now()) return hit.developer;
    if (hit) qualificationCache.delete(user.sessionId);
  }
  const pending = qualificationInFlight.get(user.sessionId);
  if (pending) return pending;

  const promise = (async () => {
    const expiresAt = user.accessTokenExpiresAt ? new Date(user.accessTokenExpiresAt).getTime() : 0;
    if (expiresAt && expiresAt <= Date.now()) {
      await destroySession(user.sessionId);
      throw new ApiError(401, 'SSO_SESSION_EXPIRED', '登录已过期，请重新登录');
    }
    let profile: UserinfoProfile;
    try {
      profile = await fetchUserinfo(user.accessToken as string);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await destroySession(user.sessionId);
        throw new ApiError(401, 'SSO_SESSION_EXPIRED', '登录已过期，请重新登录');
      }
      throw new ApiError(503, 'SSO_UNAVAILABLE', '身份服务暂时不可用，请稍后重试');
    }
    const developer = profile.developer === true;
    if (ttl > 0) {
      const cap = expiresAt || Number.MAX_SAFE_INTEGER;
      qualificationCache.set(user.sessionId, { developer, expiresAt: Math.min(Date.now() + ttl, cap) });
      pruneQualificationCache();
    }
    return developer;
  })();

  qualificationInFlight.set(user.sessionId, promise);
  try {
    return await promise;
  } finally {
    if (qualificationInFlight.get(user.sessionId) === promise) qualificationInFlight.delete(user.sessionId);
  }
}

export const requireDeveloper = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const developer = await checkQualification(req.user);
  if (!developer) throw forbidden('NOT_DEVELOPER', '尚未获得开发者资格');
  next();
};

/** oauth_tx cookie 里的内容。 */
interface OauthTx {
  state: string;
  verifier: string;
  uri: string;
  returnTo: string;
}

function readTx(req: Request): OauthTx | null {
  const raw = openCookieValue(req.cookies?.[TX_COOKIE]);
  if (!raw) return null;
  const { state, verifier, uri, returnTo } = raw;
  if (typeof state !== 'string' || typeof verifier !== 'string' || typeof uri !== 'string') return null;
  return { state, verifier, uri, returnTo: safeReturnPath(returnTo, '/') };
}

export const callback = async (req: Request, res: Response): Promise<void> => {
  const tx = readTx(req);
  res.append('Set-Cookie', clearCookieHeader(TX_COOKIE, '/api/auth'));
  const returnTo = safeReturnPath(tx?.returnTo, '/');
  const backToLogin = (error: string): void =>
    redirectSafe(req, res, `/login?error=${encodeURIComponent(error)}&redirect=${encodeURIComponent(returnTo)}`);
  if (req.query.error) {
    return backToLogin(String(req.query.error));
  }
  if (!tx || String(req.query.state ?? '') !== tx.state) {
    return backToLogin('state_mismatch');
  }
  const code = String(req.query.code || '');
  if (!code) return backToLogin('missing_code');

  try {
    const token = await exchangeCode(code, tx.verifier, tx.uri);
    const profile = await fetchUserinfo(token.access_token as string);
    const userId = String(profile.sso_sub || profile.sub || '');
    if (!userId) throw new ApiError(502, 'SSO_BAD_PROFILE', 'SSO 未返回 sub');
    // userinfo 是当前用户最新的资料：内存缓存 + 落库快照，users/list 不可用时靠它显示名字。
    await remember({
      sub: userId,
      preferred_username: profile.preferred_username,
      name: profile.name,
      picture: profile.picture,
      email: profile.email,
      developer: profile.developer === true,
    });
    const session = await createSession(userId, {
      accessToken: token.access_token as string,
      expiresIn: Number(token.expires_in) || 3600,
    });
    res.append('Set-Cookie', sessionCookie(req, session.id, session.expires));
    return redirectSafe(req, res, returnTo);
  } catch (err) {
    return backToLogin(err instanceof ApiError ? err.code : 'SSO_ERROR');
  }
};

export const me = async (req: Request, res: Response): Promise<void> => {
  const user = req.user;
  if (!user) throw unauthorized();
  let developer = false;
  let qualification: 'ok' | 'none' | 'unknown' = 'none';
  try {
    developer = await checkQualification(user);
    qualification = developer ? 'ok' : 'none';
  } catch (error) {
    // SSO 暂时不可用时仍返回身份，让页面能显示「稍后重试」而不是整体 503。
    if (!(error instanceof ApiError) || error.status !== 503) throw error;
    qualification = 'unknown';
  }
  res.json({
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    email: user.email,
    ssoSub: user.id,
    developer,
    qualification,
    devLogin: devLoginEnabled(),
  });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  await destroySession(req.user?.sessionId);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
};

export const devIdentities = async (_req: Request, res: Response): Promise<void> => {
  if (!devLoginEnabled()) throw new ApiError(404, 'NOT_FOUND', '开发登录未开启');
  res.json({ items: DEMO_USERS.map(({ id, name }) => ({ id, name })) });
};

export const devLogin = async (req: Request, res: Response): Promise<void> => {
  if (!devLoginEnabled()) throw new ApiError(404, 'NOT_FOUND', '开发登录未开启');
  const userId = String(req.body?.userId ?? req.body?.developerId ?? '').trim();
  if (!userId) throw badRequest('BAD_REQUEST', '缺少 userId');
  if (!DEMO_USERS.some((user) => user.id === userId)) throw new ApiError(404, 'NOT_FOUND', '开发者不存在');
  const session = await createSession(userId, { authMethod: 'dev' });
  res.setHeader('Set-Cookie', sessionCookie(req, session.id, session.expires));
  res.json({ ok: true });
};
