import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Avatar, Field, Skeleton } from '../ui';
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
    <div className="narrow-page">
      <h1 className="page-title">登录</h1>
      <p className="page-sub">使用学院统一身份账号登录，继续参与项目开发与需求协作。</p>

      <div className="panel auth-panel">
        <form className="auth-form" onSubmit={submit}>
          <Field label="邮箱" htmlFor="login-email">
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
          </Field>
          <Field label="密码" htmlFor="login-password">
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
          <p className="faint auth-note">账号由 SSE 统一身份提供；忘记密码或账号异常，请联系平台管理员。</p>
        </form>
        {error ? <div className="notice notice-error auth-error">{error}</div> : null}

        {identities && identities.length > 0 ? (
          <>
            <div className="section-head auth-dev-head">
              <h2>开发身份模拟</h2>
              <span className="faint">仅开发环境可用</span>
            </div>
            <div className="list">
              {identities.map((item) => (
                <button type="button" key={item.id} className="dev-identity" onClick={() => pick(item.id)}>
                  <Avatar name={item.name} />
                  <span className="grow">{item.name}</span>
                  <span className="faint">#{item.id}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
