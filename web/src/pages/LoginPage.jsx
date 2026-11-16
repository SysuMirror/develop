import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar, Skeleton } from '../ui.jsx';

function safeTarget(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export default function LoginPage() {
  const { user, loading, loginWithDev, loginUrl } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [identities, setIdentities] = useState(null);
  const [error, setError] = useState('');
  const target = safeTarget(params.get('redirect'));

  useEffect(() => {
    if (user) navigate(target, { replace: true });
  }, [user, target, navigate]);

  useEffect(() => {
    api
      .get('/auth/dev/identities')
      .then((data) => setIdentities(data.items ?? []))
      .catch(() => setIdentities([]));
  }, []);

  async function pick(developerId) {
    setError('');
    try {
      await loginWithDev(developerId);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Skeleton rows={4} />;

  return (
    <div style={{ maxWidth: 480, margin: '24px auto' }}>
      <h1 className="page-title">登录</h1>
      <p className="page-sub">使用 SSE 统一身份（UniSSO）登录。开发者身份由 SSO 的 sub 绑定，不需要额外注册。</p>

      <div className="panel" style={{ marginTop: 20 }}>
        <a className="btn btn-primary" href={loginUrl} style={{ width: '100%' }}>
          使用 SSE 统一身份登录
        </a>
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
        ) : (
          <p className="faint" style={{ marginTop: 14 }}>
            开发身份模拟未开启：请先在 server/.env 配置 SSO_CLIENT_ID / SSO_CLIENT_SECRET。
          </p>
        )}
        {error ? <div className="notice notice-error" style={{ marginTop: 12 }}>{error}</div> : null}
      </div>
    </div>
  );
}
