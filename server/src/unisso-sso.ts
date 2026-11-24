// UniSSO 无感登录客户端（内部 M2M）。
//
// 只使用三个服务端到服务端接口：
//   POST /api/oauth/password/verify  邮箱+密码 → 身份 + 父域 SSO 会话
//   POST /api/oauth/session/verify   共享 Cookie 里的会话 → 身份（含 developer）
//   POST /api/oauth/session/revoke   单点登出
//
// 本平台不保存 access token / refresh token：两个读取接口都直接返回资格。

import { ssoCredentials } from './sso-config.ts';

const TIMEOUT_MS = 8000;

export interface SsoUser {
  sub?: string;
  sso_sub?: string;
  sse_sub?: string | null;
  internal?: boolean;
  developer?: boolean;
  is_admin?: boolean;
  is_super_admin?: boolean;
  preferred_username?: string;
  name?: string;
  email?: string;
  picture?: string;
  student_id?: string;
}

export interface SsoVerifyResult {
  status: number;
  ok: boolean;
  user: SsoUser | null;
  ssoSession: string | null;
  cookieName: string | null;
  cookieDomain: string | null;
  maxAge: number | null;
  error: string | null;
  message: string | null;
}

function basicAuth(): string | null {
  const { clientId, clientSecret } = ssoCredentials();
  if (!clientId || !clientSecret) return null;
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

async function post(path: string, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const authorization = basicAuth();
  if (!authorization) throw new Error('未配置 UniSSO 客户端凭据');
  const { issuer } = ssoCredentials();
  const resp = await fetch(`${issuer}${path}`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: resp.status, json };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toResult(status: number, json: Record<string, unknown>): SsoVerifyResult {
  const userRaw = json.user && typeof json.user === 'object' ? (json.user as SsoUser) : null;
  const sub = str(userRaw?.sub) ?? str(userRaw?.sso_sub);
  return {
    status,
    ok: status === 200 && Boolean(sub) && json.ok !== false,
    user: userRaw,
    ssoSession: str(json.sso_session),
    cookieName: str(json.sso_cookie_name),
    cookieDomain: str(json.sso_cookie_domain),
    maxAge: num(json.sso_max_age),
    error: str(json.error),
    message: str(json.message) ?? str(json.error_description),
  };
}

/** 邮箱密码校验：成功时同时拿到父域 SSO 会话，可直接种 Cookie。 */
export async function passwordVerify(email: string, password: string): Promise<SsoVerifyResult> {
  const { status, json } = await post('/api/oauth/password/verify', { email, password });
  return toResult(status, json);
}

/** 校验共享 SSO 会话（Cookie 值只是指针，身份以本接口为准）。 */
export async function sessionVerify(session: string): Promise<SsoVerifyResult> {
  const { status, json } = await post('/api/oauth/session/verify', { session });
  return toResult(status, json);
}

/** 单点登出：失败不影响本地登出。 */
export async function sessionRevoke(session: string): Promise<void> {
  try {
    await post('/api/oauth/session/revoke', { session });
  } catch {
    /* 网络失败照常清本地 */
  }
}
