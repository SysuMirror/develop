import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar, Field, Skeleton } from '../ui.jsx';

function safeTarget(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export default function LoginPage() {
  const { user, loading, loginWithDev, loginWithPassword, loginUrl } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [identities, setIdentities] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
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

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await loginWithPassword(email.trim(), password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pick(userId) {
    setError('');
    try {
      await loginWithDev(userId);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Skeleton rows={4} />;

  return (
    <div style={{ maxWidth: 480, margin: '24px auto' }}>
      <h1 className="page-title">登录</h1>
      <p className="page-sub">
        使用 SSE 统一身份的邮箱和密码登录；也可以走授权跳转。平台不保存用户资料，身份就是 SSO 的用户 id。
      </p>

      <div className="panel" style={{ marginTop: 20 }}>
        <form onSubmit={submit}>
          <Field label="邮箱">
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              autoFocus
            />
          </Field>
          <Field label="密码">
            <input
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="UniSSO 密码"
              required
            />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
        {error ? <div className="notice notice-error" style={{ marginTop: 12 }}>{error}</div> : null}

        <div className="faint" style={{ textAlign: 'center', margin: '18px 0 10px' }}>
          或
        </div>
        <a className="btn btn-secondary" href={loginUrl} style={{ width: '100%' }}>
          使用 SSE 统一身份授权登录
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
      </div>
    </div>
  );
}
