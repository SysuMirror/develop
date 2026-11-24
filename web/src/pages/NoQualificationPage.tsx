import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { messageOf } from '../api';

// 没有开发者资格时不在 develop 里拦人：统一身份登录 join 时会自动开通开发者资格，
// 所以直接把人送到 join 的个人资料页（/me），在那儿完成资料后回来即可。
const JOIN_PROFILE_URL = 'https://join.ssemarket.cn/me?from=develop';

export default function NoQualificationPage() {
  const { user, refresh, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const unknown = user?.qualification === 'unknown';

  useEffect(() => {
    if (unknown) return;
    const timer = window.setTimeout(() => {
      window.location.replace(JOIN_PROFILE_URL);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [unknown]);

  async function recheck() {
    setChecking(true);
    setError('');
    try {
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setChecking(false);
    }
  }

  if (!unknown) {
    return (
      <div style={{ maxWidth: 560, margin: '24px auto' }}>
        <h1 className="page-title">正在前往 SSE 集市完成开发者认证</h1>
        <p className="page-sub">
          用同一个统一身份登录集市后会自动开通开发者资格；回来刷新一下就都能用了。
        </p>
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={JOIN_PROFILE_URL}>
              前往集市（个人资料）
            </a>
            <button type="button" className="btn" onClick={recheck} disabled={checking}>
              {checking ? '检查中…' : '我已经完成了，重新检查'}
            </button>
          </div>
          {error ? (
            <div className="notice notice-error" style={{ marginTop: 12 }}>
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '24px auto' }}>
      <h1 className="page-title">暂时无法确认开发者资格</h1>
      <p className="page-sub">平台暂时连不上 SSE 统一身份服务，稍后可以再检查一次。</p>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn-primary" href={JOIN_PROFILE_URL}>
            前往集市（个人资料）
          </a>
          <button type="button" className="btn" onClick={recheck} disabled={checking}>
            {checking ? '检查中…' : '重新检查'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => logout()}>
            退出登录
          </button>
        </div>
        {error ? (
          <div className="notice notice-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
