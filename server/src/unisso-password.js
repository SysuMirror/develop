// UniSSO 邮箱密码校验（无感登录）。
//
// 和授权码流程不同，这条链路不需要浏览器跳转：后端拿应用凭证直接调
// POST /api/oauth/password/verify，成功后由本平台自己签发会话。
// 应用必须在 UniSSO 侧是 internal 且开启 m2m_enabled，或被加入
// UNISSO_PASSWORD_VERIFY_CLIENTS，否则会返回 403 password_verify_forbidden。
import { ssoCredentials } from './sso-config.js';

const REQUEST_TIMEOUT_MS = 10_000;

function normalizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sub = String(raw.sub ?? '').trim();
  if (!sub) return null;
  return {
    sub,
    username: raw.preferred_username || null,
    name: raw.name || null,
    email: raw.email || null,
    picture: raw.picture || null,
    // developer 只认严格布尔 true；字段缺失一律视为无资格。
    developer: raw.developer === true,
  };
}

// 返回 { ok, status, data, user }。网络错误/超时直接抛，由调用方统一映射成 502。
export async function verifyPassword(email, password) {
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
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error_description: text.slice(0, 200) };
    }
  }
  return {
    ok: response.ok && data?.ok !== false,
    status: response.status,
    data: data && typeof data === 'object' ? data : {},
    user: normalizeUser(data?.user),
  };
}
