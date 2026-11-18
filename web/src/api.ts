export interface ApiErrorOptions {
  status?: number;
  code?: string;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, { status = 0, code = 'ERROR' }: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// 与 server/src/auth.ts 的错误码保持一致，给用户可操作的文案。
const ERROR_TEXT: Record<string, string> = {
  NOT_DEVELOPER: '尚未获得开发者资格',
  SSO_NOT_CONFIGURED: '未配置统一身份凭证',
  SSO_SESSION_EXPIRED: '登录已过期，请重新登录',
  SSO_TOKEN_REJECTED: '登录已过期，请重新登录',
  SSO_CODE_INVALID: '授权码已失效，请重新登录',
  SSO_CLIENT_REJECTED: '身份服务未接受本应用凭证，请联系管理员',
  SSO_UNAVAILABLE: '身份服务暂时不可用，请稍后重试',
  SSO_TOKEN_FAILED: '换取登录凭证失败，请重试',
  SSO_USERINFO_FAILED: '身份服务暂时不可用，请稍后重试',
  SSO_BAD_PROFILE: '统一身份返回的用户信息不完整',
};

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function qs(params: QueryParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  let res: Response;
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
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const payload = data as ErrorBody | null;
    const code = payload?.error?.code || `HTTP_${res.status}`;
    throw new ApiError(ERROR_TEXT[code] || payload?.error?.message || `请求失败（HTTP ${res.status}）`, {
      status: res.status,
      code,
    });
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T = { ok: boolean }>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T = { ok: boolean }>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  del: <T = { ok: boolean }>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export function formatTime(value: string | null | undefined): string {
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
