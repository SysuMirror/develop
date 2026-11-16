import crypto from 'node:crypto';
import { one, query } from './db.js';
import {
  ApiError,
  badRequest,
  clearCookieHeader,
  cookieHeader,
  openCookieValue,
  redirectSafe,
  sealCookieValue,
  safeReturnPath,
  unauthorized,
} from './http.js';

const ISSUER = (process.env.SSO_ISSUER || 'https://sso.ssemarket.cn').replace(/\/+$/, '');
const CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const SCOPE = process.env.SSO_SCOPE || 'openid profile:username profile:name profile:avatar email';
const SESSION_COOKIE = 'sid';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const TX_COOKIE = 'oauth_tx';
const TX_MAX_AGE = 600;

export const ssoConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);
export const devLoginEnabled = () => process.env.DEV_LOGIN !== '0' && (!ssoConfigured() || process.env.DEV_LOGIN === '1');

const b64url = (buf) => buf.toString('base64url');

function redirectUri(req) {
  if (process.env.SSO_REDIRECT_URI) return process.env.SSO_REDIRECT_URI;
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  return `${proto}://${req.get('host')}/api/auth/callback`;
}

function isSecure(req) {
  return (req.get('x-forwarded-proto') || req.protocol) === 'https';
}

async function upsertDeveloper(profile) {
  const sub = profile.sso_sub || profile.sub;
  if (!sub) throw new ApiError(502, 'SSO_BAD_PROFILE', 'SSO 未返回 sub');
  const name = profile.name || profile.preferred_username || profile.email || '开发者';
  const existing = await one('SELECT id, name FROM developers WHERE sso_sub = ?', [sub]);
  if (existing) {
    if (existing.name !== name) {
      await query('UPDATE developers SET name = ? WHERE id = ?', [name, existing.id]);
    }
    return existing.id;
  }
  const result = await query(
    'INSERT INTO developers (sso_sub, name, avatar, email) VALUES (?, ?, ?, ?)',
    [sub, name, profile.picture || null, profile.email || null],
  );
  return result.insertId;
}

export async function createSession(developerId) {
  const id = b64url(crypto.randomBytes(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query('INSERT INTO sessions (id, developer_id, expires_at) VALUES (?, ?, ?)', [
    id,
    developerId,
    expires.toISOString().slice(0, 19).replace('T', ' '),
  ]);
  return { id, expires };
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
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
    `SELECT s.id AS session_id, s.expires_at, d.id, d.name, d.avatar, d.email, d.sso_sub
       FROM sessions s JOIN developers d ON d.id = s.developer_id
      WHERE s.id = ? AND s.expires_at > NOW()`,
    [raw],
  )
    .then((row) => {
      if (!row) {
        req.user = null;
        return next();
      }
      req.user = {
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        email: row.email,
        ssoSub: row.sso_sub,
        sessionId: row.session_id,
      };
      next();
    })
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
  if (!resp.ok) throw new ApiError(502, 'SSO_USERINFO_FAILED', data.error || '获取用户信息失败');
  return data;
}

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
    const developerId = await upsertDeveloper(profile);
    const session = await createSession(developerId);
    res.append('Set-Cookie', sessionCookie(req, session.id, session.expires));
    return redirectSafe(req, res, returnTo);
  } catch (err) {
    return backToLogin(err instanceof ApiError ? err.code : 'SSO_ERROR');
  }
};

export const me = (req, res) => {
  if (!req.user) throw unauthorized();
  res.json({
    id: req.user.id,
    name: req.user.name,
    avatar: req.user.avatar,
    email: req.user.email,
    ssoSub: req.user.ssoSub,
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
  const rows = await query('SELECT id, name FROM developers ORDER BY id LIMIT 50');
  res.json({ items: rows });
};

export const devLogin = async (req, res) => {
  if (!devLoginEnabled()) throw new ApiError(404, 'NOT_FOUND', '开发登录未开启');
  const id = Number(req.body?.developerId);
  if (!id) throw badRequest('BAD_REQUEST', '缺少 developerId');
  const row = await one('SELECT id FROM developers WHERE id = ?', [id]);
  if (!row) throw new ApiError(404, 'NOT_FOUND', '开发者不存在');
  const session = await createSession(row.id);
  res.setHeader('Set-Cookie', sessionCookie(req, session.id, session.expires));
  res.json({ ok: true });
};
