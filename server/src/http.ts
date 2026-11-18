import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = (message = '请先登录') => new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (message = '资源不存在') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => unknown;

/** Express 4 不会捕获 async 处理器的 rejection，统一包一层把它交给错误中间件。 */
export const wrap =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function sendJson(res: Response, status: number, payload: unknown): void {
  res.status(status).json(payload);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
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

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
}

export function cookieHeader(name: string, value: string, options: CookieOptions = {}): string {
  const { maxAge, path = '/', httpOnly = true, sameSite = 'Lax', secure = false } = options;
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function clearCookieHeader(name: string, path = '/'): string {
  return cookieHeader(name, '', { maxAge: 0, path });
}

export function appOrigin(req: Request): string {
  const configured = (process.env.APP_ORIGIN || '').replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

// 跳转安全阀：目标只能是本站内部路径，或 allowedOrigins 白名单内的绝对地址。
// 任何其他值（含 //evil.com、https://evil.com）一律降级到本站首页，避免开放重定向。
export function redirectSafe(
  req: Request,
  res: Response,
  target: unknown,
  { allowedOrigins = [] }: { allowedOrigins?: string[] } = {},
): void {
  const origin = appOrigin(req);
  let url: URL;
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
  const finalUrl = allow.has(url.origin) ? `${url.origin}${url.pathname}${url.search}${url.hash}` : `${origin}/`;
  res.status(302);
  res.setHeader('Location', finalUrl);
  res.end();
}

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('base64url');

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function sealCookieValue(obj: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function openCookieValue(value: unknown): Record<string, unknown> | null {
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
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function safeReturnPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

export interface Paging {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePaging(req: Request): Paging {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? ''), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? ''), 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function likeTerm(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
