import crypto from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new ApiError(400, code, message);
export const unauthorized = (message = '请先登录') => new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (code, message) => new ApiError(403, code, message);
export const notFound = (message = '资源不存在') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code, message) => new ApiError(409, code, message);

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

export async function readJson(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function cookieHeader(name, value, { maxAge, path = '/', httpOnly = true, sameSite = 'Lax', secure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function clearCookieHeader(name, path = '/') {
  return cookieHeader(name, '', { maxAge: 0, path });
}

export function appOrigin(req) {
  const configured = (process.env.APP_ORIGIN || '').replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

// 跳转安全阀：目标只能是本站内部路径，或 allowedOrigins 白名单内的绝对地址。
// 任何其他值（含 //evil.com、https://evil.com）一律降级到本站首页，避免开放重定向。
export function redirectSafe(req, res, target, { allowedOrigins = [] } = {}) {
  const origin = appOrigin(req);
  let url;
  try {
    url = new URL(String(target ?? '/'), origin);
  } catch {
    url = new URL('/', origin);
  }
  const allow = new Set([new URL(origin).origin]);
  for (const item of allowedOrigins) {
    try {
      allow.add(new URL(item).origin);
    } catch {
      /* 忽略非法配置项 */
    }
  }
  // 校验后只重新拼 origin + path + query，避免把未经检查的整串直接传出。
  const finalUrl = allow.has(url.origin) ? `${origin}${url.pathname}${url.search}${url.hash}` : `${origin}/`;
  res.status(302);
  res.setHeader('Location', finalUrl);
  res.end();
}

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('base64url');

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function sealCookieValue(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function openCookieValue(value) {
  if (typeof value !== 'string') return null;
  const idx = value.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = value.slice(0, idx);
  const mac = value.slice(idx + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function safeReturnPath(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

export function parsePaging(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function likeTerm(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
