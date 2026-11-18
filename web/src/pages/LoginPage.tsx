import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Avatar, Skeleton } from '../ui';
import type { DevIdentity } from '../types';

function safeTarget(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

// 回调失败时后端把错误码放在 /login?error=…；这里翻成人话。
const CALLBACK_ERRORS: Record<string, string> = {
  access_denied: '你在授权页取消了授权',
  state_mismatch: '登录状态校验失败，请重新发起登录',
  missing_code: '统一身份没有带回授权码，请重试',
  SSO_CODE_INVALID: '授权码已失效，请重新登录',
  SSO_CLIENT_REJECTED: '身份服务未接受本应用凭证，请联系管理员',
  SSO_TOKEN_FAILED: '换取登录凭证失败，请重试',
  SSO_UNAVAILABLE: '身份服务暂时不可用，请稍后重试',
  SSO_BAD_PROFILE: '统一身份返回的用户信息不完整',
};

export default function LoginPage() {
  const { user, loading, loginWithDev, loginUrl } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [identities, setIdentities] = useState<DevIdentity[] | null>(null);
  const [error, setError] = useState(() => {
    const code = params.get('error');
    if (!code) return '';
    return CALLBACK_ERRORS[code] || `登录失败（${code}）`;
  });
  const target = safeTarget(params.get('redirect'));

  useEffect(() => {
    if (user) navigate(target, { replace: true });
  }, [user, target, navigate]);

  useEffect(() => {
    api
      .get<{ items: DevIdentity[] }>('/auth/dev/identities')
      .then((data) => setIdentities(data.items ?? []))
      .catch(() => setIdentities([]));
  }, []);

  async function pick(userId: string) {
    setError('');
    try {
      await loginWithDev(userId);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <Skeleton rows={4} />;

  return (
    <div style={{ maxWidth: 480, margin: '24px auto' }}>
      <h1 className="page-title">登录</h1>
      <p className="page-sub">
        使用 SSE 统一身份授权登录。平台不保存用户资料，身份就是 SSO 的用户 id。
      </p>

      <div className="panel" style={{ marginTop: 20 }}>
        <a className="btn btn-primary" href={loginUrl} style={{ width: '100%' }}>
          使用 SSE 统一身份授权登录
        </a>
        {error ? <div className="notice notice-error" style={{ marginTop: 12 }}>{error}</div> : null}

        {identities && identities.length > 0 ? (
          <>
            <div className="section-head" style={{ margin: '20px 0 8px' }}>
              <h2>开发身份模拟</h2>
              <span className="faint">DEV_LOGIN 开启时可用</span>
            </div>
            {identities.map((item) => (
              <button
                type="button"
                key={item.id}
                className="list__row"
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                onClick={() => pick(item.id)}
              >
                <Avatar name={item.name} />
                <span className="grow">{item.name}</span>
                <span className="faint">#{item.id}</span>
              </button>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
