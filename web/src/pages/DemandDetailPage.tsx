import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, formatTime, messageOf } from '../api';
import { DemandActions } from '../demand-actions';
import { DemandRevisions } from '../demand-revisions';
import { useApi } from '../hooks';
import { MarkdownText } from '../markdown';
import { DEMAND_DIFFICULTY, DEMAND_STATUS, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { DemandItem } from '../types';

export default function DemandDetailPage() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi<DemandItem>(`/demands/${id}`);
  const navigate = useNavigate();

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

      <div className="page-head detail-head" style={{ marginTop: 10 }}>
        <div className="detail-head__main">
          <h1 className="page-title">{demand.title}</h1>
          <div className="detail-head__meta">
            <StatusBadge map={DEMAND_STATUS} value={demand.status} />
            {demand.difficulty ? <span className="tag">{DEMAND_DIFFICULTY[demand.difficulty].label}</span> : null}
            {demand.estimateHours ? <span className="tag">预计 {demand.estimateHours} 小时</span> : null}
            {demand.labels.map((label) => (
              <span className="tag" key={label}>
                {label}
              </span>
            ))}
            <span className="detail-head__sep" aria-hidden="true" />
            <span>发布 <TimeAgo value={demand.createdAt} /></span>
            {demand.revision > 0 ? <span>已修改 {demand.revision} 次</span> : null}
          </div>
        </div>
        <div className="page-actions">
          <DemandActions
            demand={demand}
            onChanged={reload}
            onEdit={() => navigate(`/demands/${demand.id}/edit`)}
            empty={null}
          />
        </div>
      </div>

      <div className="detail-facts">
        <span className="detail-facts__item">
          <span className="faint">项目</span>
          <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
        </span>
        <span className="detail-facts__item">
          <span className="faint">发布者</span>
          <span>{demand.creator ? displayName(demand.creator) : '未知用户'}</span>
        </span>
        <span className="detail-facts__item">
          <span className="faint">接单人</span>
          {demand.assignee ? (
            <span>
              {displayName(demand.assignee)}
              {demand.acceptedAt ? (
                <span className="faint">
                  {' '}
                  · 接单 <TimeAgo value={demand.acceptedAt} />
                </span>
              ) : null}
            </span>
          ) : (
            <span className="faint">等待接单</span>
          )}
        </span>
        {demand.deadline ? (
          <span className="detail-facts__item">
            <span className="faint">期望完成</span>
            <span>{formatTime(demand.deadline)}</span>
          </span>
        ) : null}
        {demand.submittedAt ? (
          <span className="detail-facts__item">
            <span className="faint">提交完成</span>
            <TimeAgo value={demand.submittedAt} />
          </span>
        ) : null}
        {demand.completedAt ? (
          <span className="detail-facts__item">
            <span className="faint">验收完成</span>
            <TimeAgo value={demand.completedAt} />
          </span>
        ) : null}
      </div>

      <div className="section-head">
        <h2>详情</h2>
      </div>
      <div className="panel">
        <MarkdownText source={demand.detail} empty="发布时没有填写详情。" />
      </div>

      {demand.acceptance && demand.acceptance.trim() ? (
        <>
          <div className="section-head">
            <h2>验收标准</h2>
            <span className="faint">提交与验收都以它为准</span>
          </div>
          <div className="panel">
            <MarkdownText source={demand.acceptance} />
          </div>
        </>
      ) : null}

      <DemandRevisions demandId={demand.id} revision={demand.revision} />
    </div>
  );
}
