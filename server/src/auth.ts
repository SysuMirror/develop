import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { one, query } from './db.ts';
import { DEMO_USERS } from './demo-users.ts';
import { getUser, remember } from './directory.ts';
import { devLoginEnabled, ssoConfigured } from './sso-config.ts';
import { passwordVerify, sessionRevoke, sessionVerify } from './unisso-sso.ts';
import type { SsoUser } from './unisso-sso.ts';
import { ApiError, badRequest, clearCookieHeader, cookieHeader, forbidden, safeReturnPath, unauthorized } from './http.ts';
import type { SessionRow, SessionUser } from './types.ts';

// 登录方式：邮箱密码（UniSSO M2M 校验）+ 共享 Cookie 静默登录。没有跳转、没有同意页。

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SSO_COOKIE_NAMES = ['unisso_sid', 'sse_sso'];
const SSO_COOKIE_DOMAIN = process.env.SSO_COOKIE_DOMAIN || '.ssemarket.cn';

export { devLoginEnabled, ssoConfigured };

interface QualificationCacheEntry {
  developer: boolean;
  expiresAt: number;
}

// 资格校验缓存：同一 session 在 TTL 内不重复打 UniSSO；撤销延迟上限即该 TTL。
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

function isSecure(req: Request): boolean {
  return (req.get('x-forwarded-proto') || req.protocol) === 'https';
}

function toMysqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export interface CreateSessionOptions {
  authMethod?: 'sso' | 'dev';
  developer?: boolean | null;
  /** 共享 Cookie 里的 UniSSO 会话 id；静默登录时保存，后续资格校验与单点登出用。 */
  ssoSession?: string | null;
}

export interface CreatedSession {
  id: string;
  expires: Date;
}

// 会话只记 sub（= UniSSO users.id）；昵称头像不落库，展示时再向目录要。
export async function createSession(
  userId: string,
  { authMethod = 'sso', developer = null, ssoSession = null }: CreateSessionOptions = {},
): Promise<CreatedSession> {
  const id = b64url(crypto.randomBytes(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query(
    `INSERT INTO sessions (id, user_id, auth_method, developer, sso_session, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, authMethod, developer === null ? null : developer ? 1 : 0, ssoSession, toMysqlDate(expires)],
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

/** 把 UniSSO 返回的父域会话原样种给浏览器；没有返回值（开发登录）时跳过。 */
function plantSsoCookie(
  res: Response,
  session: string | null,
  meta: { name?: string | null; domain?: string | null; maxAge?: number | null } = {},
): void {
  if (!session) return;
  const name = meta.name || SSO_COOKIE_NAMES[0];
  const domain = meta.domain || SSO_COOKIE_DOMAIN;
  const maxAge = meta.maxAge && meta.maxAge > 0 ? meta.maxAge : 604800;
  res.append(
    'Set-Cookie',
    `${name}=${session}; Domain=${domain}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
  );
}

function clearSsoCookies(res: Response, extraName?: string | null): void {
  const names = new Set<string>(SSO_COOKIE_NAMES);
  if (extraName) names.add(extraName);
  for (const name of names) {
    res.append(
      'Set-Cookie',
      `${name}=; Domain=${SSO_COOKIE_DOMAIN}; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
  }
}

function readSsoCookie(req: Request): { name: string; value: string } | null {
  for (const name of SSO_COOKIE_NAMES) {
    const value = String(req.cookies?.[name] || '').trim();
    if (value) return { name, value };
  }
  return null;
}

export const attachSession = (req: Request, _res: Response, next: NextFunction): void => {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) {
    req.user = null;
    return next();
  }
  one<SessionRow>(
    `SELECT id AS session_id, user_id, auth_method, developer, sso_session, expires_at
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
        ssoSession: row.sso_session || null,
      };
    })
    .then(() => next())
    .catch(next);
};

export const requireUser = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.user) next();
  else next(unauthorized());
};

function rememberFromSso(u: SsoUser | null): Promise<void> {
  const sub = String(u?.sub || u?.sso_sub || '');
  if (!sub) return Promise.resolve();
  return remember({
    sub,
    preferred_username: u?.preferred_username,
    name: u?.name,
    picture: u?.picture,
    email: u?.email,
    developer: u?.developer === true,
  });
}

/**
 * 跳转式授权已废弃：老书签/旧链接一律回登录页，由邮箱密码或静默 SSO 接手。
 */
export const login = (req: Request, res: Response): void => {
  const returnTo = safeReturnPath(req.query.redirect, '/');
  res.setHeader('Location', `/login?redirect=${encodeURIComponent(returnTo)}`);
  res.statusCode = 302;
  res.end();
};

/** 邮箱 + 密码：服务端调 UniSSO M2M 校验，Cookie 让用户本人无感。 */
export const passwordLogin = async (req: Request, res: Response): Promise<void> => {
  if (!ssoConfigured()) throw new ApiError(503, 'SSO_NOT_CONFIGURED', '未配置统一身份凭证');
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!email || !password) throw badRequest('BAD_REQUEST', '请输入邮箱和密码');

  let result;
  try {
    result = await passwordVerify(email, password);
  } catch {
    throw new ApiError(503, 'SSO_UNAVAILABLE', '身份服务暂时不可用，请稍后重试');
  }
  if (result.status === 401) throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
  if (result.status === 403) {
    throw new ApiError(403, 'SSO_FORBIDDEN', '统一身份未对本应用开启无感登录，请联系管理员');
  }
  if (result.status === 429) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '尝试过于频繁，15 分钟后再试');
  if (!result.ok || !result.user) {
    throw new ApiError(502, 'SSO_UNAVAILABLE', result.message || '身份服务暂时不可用，请稍后重试');
  }

  const sub = String(result.user.sub || result.user.sso_sub || '');
  if (!sub) throw new ApiError(502, 'SSO_BAD_PROFILE', '统一身份未返回用户标识');
  await rememberFromSso(result.user);
  const session = await createSession(sub, {
    developer: result.user.developer === true,
    ssoSession: result.ssoSession,
  });
  res.append('Set-Cookie', sessionCookie(req, session.id, session.expires));
  plantSsoCookie(res, result.ssoSession, {
    name: result.cookieName,
    domain: result.cookieDomain,
    maxAge: result.maxAge,
  });
  res.json({ ok: true, developer: result.user.developer === true });
};

// 静默探测限流：同一 IP 每分钟 10 次（每次页面加载都会打一次）。
const ssoProbeBuckets = new Map<string, number[]>();

function allowSsoProbe(ip: string): boolean {
  const now = Date.now();
  const recent = (ssoProbeBuckets.get(ip) || []).filter((at) => now - at < 60_000);
  if (recent.length >= 10) return false;
  recent.push(now);
  ssoProbeBuckets.set(ip, recent);
  return true;
}

/**
 * 静默 SSO：浏览器带着 .ssemarket.cn 下的共享 Cookie 来，后端向 UniSSO 换身份。
 * 用户在任一平台登录过，这里就直接进站，不再要求输入密码。
 */
export const ssoTry = async (req: Request, res: Response): Promise<void> => {
  if (!ssoConfigured()) throw new ApiError(503, 'SSO_NOT_CONFIGURED', '未配置统一身份凭证');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  if (!allowSsoProbe(ip)) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '尝试过于频繁，请稍后再试');

  const cookie = readSsoCookie(req);
  if (!cookie) throw new ApiError(401, 'NO_SSO', '没有统一登录会话');

  let result;
  try {
    result = await sessionVerify(cookie.value);
  } catch {
    // UniSSO 不可达：不当作登录失效，前端保留本地会话。
    throw new ApiError(503, 'SSO_UNAVAILABLE', '身份服务暂时不可用，请稍后重试');
  }
  if (result.status === 401) throw new ApiError(401, 'INVALID_SSO', '统一登录会话已失效');
  if (!result.ok || !result.user) {
    throw new ApiError(503, 'SSO_UNAVAILABLE', result.message || '身份服务暂时不可用，请稍后重试');
  }

  const sub = String(result.user.sub || result.user.sso_sub || '');
  if (!sub) throw new ApiError(502, 'SSO_BAD_PROFILE', '统一身份未返回用户标识');
  await rememberFromSso(result.user);
  const session = await createSession(sub, {
    developer: result.user.developer === true,
    ssoSession: cookie.value,
  });
  res.append('Set-Cookie', sessionCookie(req, session.id, session.expires));
  res.json({ ok: true, developer: result.user.developer === true });
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
    // SSO 暂时不可用时仍返回身份，让页面显示「稍后重试」而不是整体 503。
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
  const user = req.user;
  if (user?.ssoSession) await sessionRevoke(user.ssoSession);
  await destroySession(user?.sessionId);
  res.setHeader('Set-Cookie', clearSessionCookie());
  clearSsoCookies(res);
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

// developer 只认严格布尔 true；资格变化的生效延迟上限 = SSO_DEVELOPER_TTL_SECONDS。
export async function checkQualification(user: SessionUser | null | undefined): Promise<boolean> {
  if (!user) throw unauthorized();
  // DEV_LOGIN 造的会话没有 SSO 会话，仅本地联调放行。
  if (!user.ssoSession) return devLoginEnabled();

  const ttl = developerTtlMs();
  if (ttl > 0) {
    const hit = qualificationCache.get(user.sessionId);
    if (hit && hit.expiresAt > Date.now()) return hit.developer;
    if (hit) qualificationCache.delete(user.sessionId);
  }
  const pending = qualificationInFlight.get(user.sessionId);
  if (pending) return pending;

  const promise = (async () => {
    let result;
    try {
      result = await sessionVerify(user.ssoSession as string);
    } catch {
      throw new ApiError(503, 'SSO_UNAVAILABLE', '身份服务暂时不可用，请稍后重试');
    }
    if (result.status === 401) {
      await destroySession(user.sessionId);
      throw new ApiError(401, 'SSO_SESSION_EXPIRED', '登录已过期，请重新登录');
    }
    if (!result.ok || !result.user) {
      throw new ApiError(503, 'SSO_UNAVAILABLE', '身份服务暂时不可用，请稍后重试');
    }
    const developer = result.user.developer === true;
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
    if (qualificationInFlight.get(user.sessionId) === promise) qualificationInFlight.delete(user.sessionId);
  }
}

export const requireDeveloper = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const developer = await checkQualification(req.user);
  if (!developer) throw forbidden('NOT_DEVELOPER', '尚未获得开发者资格');
  next();
};
