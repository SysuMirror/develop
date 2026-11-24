// UniSSO 资格写入（Join 侧）。契约见 SysuMirror/unisso 的
// docs/integration/join-develop.md 与 docs/api/qualification.openapi.yaml。

const ISSUER = (process.env.SSO_ISSUER || 'https://sso.ssemarket.cn').replace(/\/+$/, '');
const CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const TIMEOUT_MS = Number(process.env.SSO_WRITE_TIMEOUT_MS || 5000);

export function qualificationWriteEnabled(): boolean {
  // 全局开发者资格由 join 独占写入（UniSSO 的写白名单只放行 join 的 client_id）。
  // 本平台只读资格，不再尝试回写，避免两边规则互相覆盖。
  return false;
}

export interface QualificationErrorOptions {
  retryable?: boolean;
  status?: number;
  retryAfterMs?: number;
}

export class QualificationError extends Error {
  retryable: boolean;
  status: number;
  retryAfterMs: number;

  constructor(message: string, { retryable = true, status = 0, retryAfterMs = 0 }: QualificationErrorOptions = {}) {
    super(message);
    this.name = 'QualificationError';
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface QualificationWriteResult {
  developer: boolean;
  status: number;
}

// 目标值写入可重复调用；成功返回写入后重新读取的 developer。
export async function updateDeveloperQualification(ssoSub: string, isDeveloper: boolean): Promise<QualificationWriteResult> {
  if (!qualificationWriteEnabled()) {
    throw new QualificationError('SSO 凭证未配置', { retryable: false });
  }
  const authorization = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  let resp: Response;
  try {
    resp = await fetch(`${ISSUER}/api/oauth/developer/update`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${authorization}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ user_id: ssoSub, is_developer: isDeveloper }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new QualificationError(`network: ${message}`, { retryable: true });
  }

  const data = (await resp.json().catch(() => ({}))) as { ok?: unknown; developer?: unknown; error?: string };
  if (resp.ok && data.ok) {
    return { developer: data.developer === true, status: resp.status };
  }
  // 429/5xx 与网络超时可重试；400/401/403/404 是配置或账号问题，重试不会变好。
  const retryable = resp.status === 429 || resp.status >= 500;
  const retryAfter = Number(resp.headers.get('retry-after'));
  throw new QualificationError(data.error || `http_${resp.status}`, {
    retryable,
    status: resp.status,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0,
  });
}
