import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Avatar, Skeleton } from '../ui';
import type { DevIdentity } from '../types';

function safeTarget(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export default function LoginPage() {
  const { user, loading, loginWithPassword, loginWithDev } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [identities, setIdentities] = useState<DevIdentity[] | null>(null);
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
      .get<{ items: DevIdentity[] }>('/auth/dev/identities')
      .then((data) => setIdentities(data.items ?? []))
      .catch(() => setIdentities([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await loginWithPassword(email.trim(), password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
        使用 SSE 统一身份邮箱与密码登录。已经在集市、iwiki、招聘等站点登录过的，直接进来即可。
      </p>

      <div className="panel" style={{ marginTop: 20 }}>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <label className="faint" htmlFor="login-email">邮箱</label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@mail2.sysu.edu.cn"
            required
          />
          <label className="faint" htmlFor="login-password">密码</label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 6 }}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
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
