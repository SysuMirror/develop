export class ApiError extends Error {
  constructor(message, { status = 0, code = 'ERROR' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// 与 server/src/auth.js 的错误码保持一致，给用户可操作的文案。
const ERROR_TEXT = {
  NOT_DEVELOPER: '尚未获得开发者资格',
  SSO_SESSION_EXPIRED: '登录已过期，请重新登录',
  SSO_TOKEN_REJECTED: '登录已过期，请重新登录',
  SSO_UNAVAILABLE: '身份服务暂时不可用，请稍后重试',
  SSO_USERINFO_FAILED: '身份服务暂时不可用，请稍后重试',
};

export function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('网络异常，请检查连接后重试', { code: 'NETWORK' });
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const code = data?.error?.code || 'HTTP_' + res.status;
    throw new ApiError(ERROR_TEXT[code] || data?.error?.message || `请求失败（HTTP ${res.status}）`, {
      status: res.status,
      code,
    });
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  patch: (path, body) => request(path, { method: 'PATCH', body: body ?? {} }),
  del: (path) => request(path, { method: 'DELETE' }),
};

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = Date.now();
  const diff = (now - date.getTime()) / 1000;
  if (diff >= 0 && diff < 60) return '刚刚';
  if (diff >= 60 && diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff >= 3600 && diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff >= 86400 && diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
