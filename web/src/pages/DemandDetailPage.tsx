import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiError, api, messageOf } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { MarkdownText } from '../markdown';
import { DEMAND_STATUS, Skeleton, StatusBadge, TimeAgo, displayName, useToast } from '../ui';
import type { DemandItem } from '../types';

export default function DemandDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi<DemandItem>(`/demands/${id}`);
  const myId = user?.id;

  async function act(path: string, okMessage: string) {
    setBusy(true);
    try {
      await api.post(path);
      push(okMessage, 'success');
      reload();
    } catch (err) {
      push(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // 与需求列表页同规则：待接单可接（不能接自己发的），已接单可由接单人/发布者标记完成。
  function renderAction(demand: DemandItem): ReactNode {
    if (demand.status === 'waiting' && demand.creator?.id !== myId) {
      return (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => act(`/demands/${demand.id}/accept`, '已接单')}
        >
          接单
        </button>
      );
    }
    if (demand.status === 'accepted' && (demand.assignee?.id === myId || demand.creator?.id === myId)) {
      return (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => act(`/demands/${demand.id}/complete`, '已标记完成')}
        >
          标记完成
        </button>
      );
    }
    return null;
  }

  if (loading) {
    return (
      <div>
        <Skeleton rows={5} />
      </div>
    );
  }

  if (error || !data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <Link className="btn-link" to="/demands">
          ← 需求列表
        </Link>
        <div className={`notice ${missing ? 'notice-info' : 'notice-error'}`} style={{ marginTop: 12 }}>
          {missing ? '需求不存在或已被删除。' : messageOf(error)}
        </div>
      </div>
    );
  }

  const demand = data;

  return (
    <div>
      <Link className="btn-link" to={`/projects/${demand.project.id}`}>
        ← {demand.project.title}
      </Link>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1 className="page-title">{demand.title}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <StatusBadge map={DEMAND_STATUS} value={demand.status} />
            <span className="faint">
              发布 <TimeAgo value={demand.createdAt} />
            </span>
          </div>
        </div>
        <div className="row">{renderAction(demand)}</div>
      </div>

      <div className="panel">
        <dl className="kv">
          <dt>项目</dt>
          <dd>
            <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
          </dd>
          <dt>发布者</dt>
          <dd>
            {demand.creator ? (
              <Link to={`/users/${demand.creator.id}`}>{displayName(demand.creator)}</Link>
            ) : (
              <span className="faint">未知用户</span>
            )}
          </dd>
          <dt>接单人</dt>
          <dd>
            {demand.assignee ? (
              <>
                <Link to={`/users/${demand.assignee.id}`}>{displayName(demand.assignee)}</Link>
                {demand.acceptedAt ? (
                  <span className="faint">
                    {' '}
                    · 接单 <TimeAgo value={demand.acceptedAt} />
                  </span>
                ) : null}
              </>
            ) : (
              <span className="faint">等待接单</span>
            )}
          </dd>
          {demand.completedAt ? (
            <>
              <dt>完成</dt>
              <dd className="faint">
                <TimeAgo value={demand.completedAt} />
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="section-head">
        <h2>详情</h2>
      </div>
      <div className="panel">
        <MarkdownText source={demand.detail} empty="发布时没有填写详情。" />
      </div>
    </div>
  );
}
