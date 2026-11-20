import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, messageOf } from '../api';
import { DemandActions } from '../demand-actions';
import { DemandEditDialog } from '../demand-edit-dialog';
import { useApi } from '../hooks';
import { MarkdownText } from '../markdown';
import { DEMAND_STATUS, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { DemandItem } from '../types';

export default function DemandDetailPage() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi<DemandItem>(`/demands/${id}`);
  const [editing, setEditing] = useState(false);

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
        <div className="row">
          <DemandActions demand={demand} onChanged={reload} onEdit={() => setEditing(true)} empty={null} />
        </div>
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
              <span>{displayName(demand.creator)}</span>
            ) : (
              <span className="faint">未知用户</span>
            )}
          </dd>
          <dt>接单人</dt>
          <dd>
            {demand.assignee ? (
              <>
                <span>{displayName(demand.assignee)}</span>
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
          {demand.submittedAt ? (
            <>
              <dt>提交完成</dt>
              <dd className="faint">
                <TimeAgo value={demand.submittedAt} />
              </dd>
            </>
          ) : null}
          {demand.completedAt ? (
            <>
              <dt>验收完成</dt>
              <dd className="faint">
                <TimeAgo value={demand.completedAt} />
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      {editing ? <DemandEditDialog demand={demand} onClose={() => setEditing(false)} onSaved={reload} /> : null}

      <div className="section-head">
        <h2>详情</h2>
      </div>
      <div className="panel">
        <MarkdownText source={demand.detail} empty="发布时没有填写详情。" />
      </div>
    </div>
  );
}
