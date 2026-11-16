import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, useDebounced } from '../hooks.js';
import { DEMAND_STATUS, Empty, Pager, Skeleton, StatusBadge, TimeAgo, useToast } from '../ui.jsx';

const TABS = [
  { key: '', label: '全部' },
  { key: 'waiting', label: '待接单' },
  { key: 'accepted', label: '进行中' },
  { key: 'completed', label: '已完成' },
];

export default function DemandsPage() {
  const { user } = useAuth();
  const { push } = useToast();
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(term);
  const pageSize = 15;
  const { data, loading, error, reload } = useApi(`/demands${qs({ status, q, page, pageSize })}`);
  const items = data?.items ?? [];

  async function act(path, okMessage) {
    setBusy(true);
    try {
      await api.post(path);
      push(okMessage, 'success');
      reload();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  let content;
  if (loading) {
    content = <Skeleton rows={5} />;
  } else if (error) {
    content = <div className="notice notice-error">{error.message}</div>;
  } else if (items.length === 0) {
    content = <Empty title="没有匹配的需求" hint="需求由项目成员发布，换个状态筛选看看。" />;
  } else {
    content = (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>需求</th>
              <th>项目</th>
              <th>发布者</th>
              <th>接单人</th>
              <th>状态</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((demand) => (
              <tr key={demand.id}>
                <td>
                  <div className="cell-title">{demand.title}</div>
                  {demand.detail ? (
                    <div className="faint truncate" style={{ maxWidth: 380 }}>
                      {demand.detail}
                    </div>
                  ) : null}
                </td>
                <td>
                  <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
                </td>
                <td>{demand.creator?.name || <span className="faint">—</span>}</td>
                <td>{demand.assignee ? demand.assignee.name : <span className="faint">—</span>}</td>
                <td>
                  <StatusBadge map={DEMAND_STATUS} value={demand.status} />
                  <div className="faint">
                    <TimeAgo value={demand.createdAt} />
                  </div>
                </td>
                <td className="right">
                  {demand.status === 'waiting' && demand.creator?.id !== user.id ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => act(`/demands/${demand.id}/accept`, '已接单')}
                    >
                      接单
                    </button>
                  ) : demand.status === 'accepted' &&
                    (demand.assignee?.id === user.id || demand.creator?.id === user.id) ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => act(`/demands/${demand.id}/complete`, '已标记完成')}
                    >
                      完成
                    </button>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">需求</h1>
          <p className="page-sub">项目成员发布的任务。接单即代表你负责推进，完成后由发布者或接单人标记。</p>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.key || 'all'}
            className={status === tab.key ? 'tab active' : 'tab'}
            onClick={() => {
              setStatus(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            placeholder="搜索需求标题"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {content}
      <Pager page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
