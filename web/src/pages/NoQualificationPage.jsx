import { useState } from 'react';
import { useAuth } from '../auth.jsx';

const JOIN_URL = 'https://join.ssemarket.cn';

export default function NoQualificationPage() {
  const { user, refresh, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const unknown = user?.qualification === 'unknown';

  async function recheck() {
    setChecking(true);
    setError('');
    try {
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '24px auto' }}>
      <h1 className="page-title">{unknown ? '暂时无法确认开发者资格' : '尚未获得开发者资格'}</h1>
      <p className="page-sub">
        {unknown
          ? '平台暂时连不上 SSE 统一身份服务，等你完成集市认证后可以再检查一次。'
          : '先到 SSE 集市完成开发者认证，审核通过后就能使用项目、申请和需求功能。'}
      </p>

      <div className="panel" style={{ marginTop: 20 }}>
        <p style={{ marginTop: 0 }}>
          {unknown
            ? '认证流程不受影响：先在集市提交认证，回到这里点“重新检查”。'
            : '认证入口在 SSE 集市（join.ssemarket.cn），用同一个统一身份登录后提交开发者认证。'}
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {!unknown ? (
            <a className="btn btn-primary" href={JOIN_URL} target="_blank" rel="noreferrer">
              前往集市认证
            </a>
          ) : null}
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
