import crypto from 'node:crypto';
import { one, query } from './db.js';
import { DEMO_USERS } from './demo-users.js';
import { getUser, remember } from './directory.js';
import { devLoginEnabled, ssoConfigured, ssoCredentials } from './sso-config.js';
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
} from './http.js';

const { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } = ssoCredentials();
const SCOPE = process.env.SSO_SCOPE || 'openid profile:username profile:name profile:avatar email';
const SESSION_COOKIE = 'sid';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const TX_COOKIE = 'oauth_tx';
const TX_MAX_AGE = 600;

export { devLoginEnabled, ssoConfigured };

// 资格校验缓存：同一 session 在 TTL 内不重复请求 userinfo，撤销延迟上限即该 TTL。
// TTL 为 0 表示每次请求都校验。
const qualificationCache = new Map();
const qualificationInFlight = new Map();

function developerTtlMs() {
  const seconds = Number(process.env.SSO_DEVELOPER_TTL_SECONDS ?? 60);
  if (!Number.isFinite(seconds) || seconds < 0) return 60_000;
  return seconds * 1000;
}

function forgetQualification(sessionId) {
  qualificationCache.delete(sessionId);
  qualificationInFlight.delete(sessionId);
}

function pruneQualificationCache() {
  if (qualificationCache.size <= 5000) return;
  const now = Date.now();
  for (const [key, value] of qualificationCache) {
    if (value.expiresAt <= now) qualificationCache.delete(key);
  }
}

const b64url = (buf) => buf.toString('base64url');

function redirectUri(req) {
  if (process.env.SSO_REDIRECT_URI) return process.env.SSO_REDIRECT_URI;
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  return `${proto}://${req.get('host')}/api/auth/callback`;
}

function isSecure(req) {
  return (req.get('x-forwarded-proto') || req.protocol) === 'https';
}

function toMysqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// 会话只记 sub（= UniSSO users.id）；昵称头像不落库，展示时再向目录要。
export async function createSession(userId, { accessToken = null, expiresIn = 0 } = {}) {
  const id = b64url(crypto.randomBytes(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const tokenExpiresAt = accessToken && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
  await query(
    `INSERT INTO sessions (id, user_id, access_token, access_token_expires_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, accessToken, tokenExpiresAt ? toMysqlDate(tokenExpiresAt) : null, toMysqlDate(expires)],
  );
  return { id, expires };
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  forgetQualification(sessionId);
  await query('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export function sessionCookie(req, sessionId, expires) {
  return cookieHeader(SESSION_COOKIE, sessionId, {
    maxAge: Math.floor((expires.getTime() - Date.now()) / 1000),
    secure: isSecure(req),
  });
}

export function clearSessionCookie() {
  return clearCookieHeader(SESSION_COOKIE);
}

export const attachSession = (req, _res, next) => {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) {
    req.user = null;
    return next();
  }
  one(
    `SELECT id AS session_id, user_id, expires_at, access_token, access_token_expires_at
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
        accessToken: row.access_token || null,
        accessTokenExpiresAt: row.access_token_expires_at || null,
      };
    })
    .then(() => next())
    .catch(next);
};

export const requireUser = (req, _res, next) => (req.user ? next() : next(unauthorized()));

export const login = (req, res) => {
  const returnTo = safeReturnPath(req.query.redirect, '/');
  if (!ssoConfigured()) {
    if (devLoginEnabled()) {
      return redirectSafe(req, res, `/login?redirect=${encodeURIComponent(returnTo)}`);
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

async function exchangeCode(code, verifier, uri) {
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
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new ApiError(502, 'SSO_TOKEN_FAILED', data.error_description || data.error || '换取 token 失败');
  }
  return data;
}

async function fetchUserinfo(accessToken) {
  const resp = await fetch(`${ISSUER}/api/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new ApiError(401, 'SSO_TOKEN_REJECTED', 'access token 已失效');
  if (!resp.ok) throw new ApiError(502, 'SSO_USERINFO_FAILED', data.error || '获取用户信息失败');
  return data;
}

// developer 只认严格布尔 true；字段缺失（线上 SSO 未部署新版本）一律视为无资格。
export async function checkQualification(user) {
  if (!user) throw unauthorized();
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
    let profile;
    try {
      profile = await fetchUserinfo(user.accessToken);
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
      qualificationCache.set(user.sessionId, {
        developer,
        expiresAt: Math.min(Date.now() + ttl, cap),
      });
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

export const requireDeveloper = async (req, _res, next) => {
  const developer = await checkQualification(req.user);
  if (!developer) throw forbidden('NOT_DEVELOPER', '尚未获得开发者资格');
  next();
};

export const callback = async (req, res) => {
  const tx = openCookieValue(req.cookies?.[TX_COOKIE]);
  res.append('Set-Cookie', clearCookieHeader(TX_COOKIE, '/api/auth'));
  const returnTo = safeReturnPath(tx?.returnTo, '/');
  const backToLogin = (error) =>
    redirectSafe(req, res, `/login?error=${encodeURIComponent(error)}&redirect=${encodeURIComponent(returnTo)}`);
  if (req.query.error) {
    return backToLogin(String(req.query.error));
  }
  if (!tx || req.query.state !== tx.state) {
    return backToLogin('state_mismatch');
  }
  const code = String(req.query.code || '');
  if (!code) return backToLogin('missing_code');

  try {
    const token = await exchangeCode(code, tx.verifier, tx.uri);
    const profile = await fetchUserinfo(token.access_token);
    const userId = profile.sso_sub || profile.sub;
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
      accessToken: token.access_token,
      expiresIn: Number(token.expires_in) || 3600,
    });
    res.append('Set-Cookie', sessionCookie(req, session.id, session.expires));
    return redirectSafe(req, res, returnTo);
  } catch (err) {
    return backToLogin(err instanceof ApiError ? err.code : 'SSO_ERROR');
  }
};

export const me = async (req, res) => {
  if (!req.user) throw unauthorized();
  let developer = false;
  let qualification = 'none';
  try {
    developer = await checkQualification(req.user);
    qualification = developer ? 'ok' : 'none';
  } catch (error) {
    // SSO 暂时不可用时仍返回身份，让页面能显示「稍后重试」而不是整体 503。
    if (!(error instanceof ApiError) || error.status !== 503) throw error;
    qualification = 'unknown';
  }
  res.json({
    id: req.user.id,
    name: req.user.name,
    avatar: req.user.avatar,
    email: req.user.email,
    ssoSub: req.user.id,
    developer,
    qualification,
    devLogin: devLoginEnabled(),
  });
};

export const logout = async (req, res) => {
  await destroySession(req.user?.sessionId);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
};
export const devIdentities = async (_req, res) => {
  if (!devLoginEnabled()) throw new ApiError(404, 'NOT_FOUND', '开发登录未开启');
  res.json({ items: DEMO_USERS.map(({ id, name }) => ({ id, name })) });
};

export const devLogin = async (req, res) => {
  if (!devLoginEnabled()) throw new ApiError(404, 'NOT_FOUND', '开发登录未开启');
  const userId = String(req.body?.userId ?? req.body?.developerId ?? '').trim();
  if (!userId) throw badRequest('BAD_REQUEST', '缺少 userId');
  if (!DEMO_USERS.some((user) => user.id === userId)) throw new ApiError(404, 'NOT_FOUND', '开发者不存在');
  const session = await createSession(userId);
  res.setHeader('Set-Cookie', sessionCookie(req, session.id, session.expires));
  res.json({ ok: true });
};
