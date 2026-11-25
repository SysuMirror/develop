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
      <div className="narrow-page">
        <h1 className="page-title">需要开发者资格</h1>
        <p className="page-sub">
          开发者平台面向学院开发者开放。用统一身份登录一次 SSE 集市即可获得资格，回到这里刷新就能使用。
        </p>
        <div className="panel">
          <div className="page-actions">
            <a className="btn btn-primary" href={JOIN_PROFILE_URL}>
              前往 SSE 集市
            </a>
            <button type="button" className="btn btn-secondary" onClick={recheck} disabled={checking}>
              {checking ? '检查中…' : '已完成，重新检查'}
            </button>
          </div>
          {error ? (
            <div className="notice notice-error narrow-notice">{error}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="narrow-page">
      <h1 className="page-title">暂时无法确认开发者资格</h1>
      <p className="page-sub">统一身份服务暂时不可用，请稍后再试。</p>

      <div className="panel">
        <div className="page-actions">
          <a className="btn btn-primary" href={JOIN_PROFILE_URL}>
            前往 SSE 集市
          </a>
          <button type="button" className="btn btn-secondary" onClick={recheck} disabled={checking}>
            {checking ? '检查中…' : '重新检查'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => logout()}>
            退出登录
          </button>
        </div>
        {error ? (
          <div className="notice notice-error narrow-notice">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
