// UniSSO 邮箱密码校验（无感登录）。
//
// 和授权码流程不同，这条链路不需要浏览器跳转：后端拿应用凭证直接调
// POST /api/oauth/password/verify，成功后由本平台自己签发会话。
// 应用必须在 UniSSO 侧是 internal 且开启 m2m_enabled，或被加入
// UNISSO_PASSWORD_VERIFY_CLIENTS，否则会返回 403 password_verify_forbidden。
import { ssoCredentials } from './sso-config.ts';

const REQUEST_TIMEOUT_MS = 10_000;

/** password/verify 返回的 user 字段。 */
export interface PasswordVerifyUser {
  sub: string;
  username: string | null;
  name: string | null;
  email: string | null;
  picture: string | null;
  developer: boolean;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizeUser(raw: unknown): PasswordVerifyUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const sub = String(source.sub ?? '').trim();
  if (!sub) return null;
  return {
    sub,
    username: str(source.preferred_username),
    name: str(source.name),
    email: str(source.email),
    picture: str(source.picture),
    // developer 只认严格布尔 true；字段缺失一律视为无资格。
    developer: source.developer === true,
  };
}

export interface PasswordVerifyResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  user: PasswordVerifyUser | null;
}

// 返回 { ok, status, data, user }。网络错误/超时直接抛，由调用方统一映射成 502。
export async function verifyPassword(email: string, password: string): Promise<PasswordVerifyResult> {
  const { issuer, clientId, clientSecret } = ssoCredentials();
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('未配置 SSO_ISSUER / SSO_CLIENT_ID / SSO_CLIENT_SECRET');
  }
  const base = issuer.replace(/\/+$/, '');
  const response = await fetch(`${base}/api/oauth/password/verify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({
      email,
      password,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      data = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      data = { error_description: text.slice(0, 200) };
    }
  }
  return {
    ok: response.ok && data.ok !== false,
    status: response.status,
    data,
    user: normalizeUser(data.user),
  };
}
