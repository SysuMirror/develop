import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useApi } from '../hooks';
import { Badge, Empty, ROLE, Skeleton, StatusBadge, APPLY_STATUS, DEMAND_STATUS, TimeAgo, Avatar, displayName } from '../ui';
import type { ApplyItem, DemandItem, Paged, ProjectSummary } from '../types';

interface StatProps {
  label: string;
  value?: ReactNode;
  hint?: ReactNode;
}

function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value ?? '—'}</div>
      <div className="stat-card__hint">{hint}</div>
    </div>
  );
}

export default function HomePage() {
  const projects = useApi<Paged<ProjectSummary>>('/projects?pageSize=6');
  const inbox = useApi<{ items: ApplyItem[] }>('/applies/inbox');
  const waitingDemands = useApi<Paged<DemandItem>>('/demands?status=waiting&pageSize=1');

  const inboxItems = inbox.data?.items ?? [];
  const recent = projects.data?.items ?? [];

  let recentBlock: ReactNode;
  if (projects.loading) {
    recentBlock = <Skeleton rows={3} />;
  } else if (recent.length === 0) {
    recentBlock = <Empty title="还没有项目" hint="新建一个项目，成为第一任 leader。" />;
  } else {
    recentBlock = (
      <div className="project-cards">
        {recent.map((project) => (
          <Link className="project-card" key={project.id} to={`/projects/${project.id}`}>
            <div className="spread">
              <h3 className="project-card__title">{project.title}</h3>
              {project.myRole ? <StatusBadge map={ROLE} value={project.myRole} /> : null}
            </div>
            <p className="project-card__misc">{project.misc || '暂无项目说明'}</p>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 6 }}>
                {project.leader ? <Avatar name={displayName(project.leader)} src={project.leader.avatar} /> : null}
                <span className="muted">{project.leader ? displayName(project.leader) : '—'}</span>
              </span>
              <span className="faint">
                {project.memberCount} 人 · {project.waitingDemandCount} 个待接需求
              </span>
            </div>
          </Link>
        ))}
      </div>
    );
  }

  let inboxBlock: ReactNode;
  if (inbox.loading) {
    inboxBlock = <Skeleton rows={2} />;
  } else if (inboxItems.length === 0) {
    inboxBlock = <Empty title="暂时没有待审申请" hint="你领导的项目的加入申请会出现在这里。" />;
  } else {
    inboxBlock = (
      <div className="panel">
        <div className="list">
          {inboxItems.slice(0, 5).map((apply) => (
            <div className="list__row" key={apply.id}>
              <Avatar name={displayName(apply.user)} src={apply.user.avatar} />
              <div className="grow">
                <div className="truncate">
                  {displayName(apply.user)} 申请加入 <strong>{apply.project.title}</strong>
                </div>
                <div className="faint">
                  {apply.type === 'leader' ? '申请成为 leader' : '申请成为成员'} · <TimeAgo value={apply.createdAt} />
                </div>
              </div>
              <Link className="btn btn-secondary btn-sm" to={`/projects/${apply.project.id}`}>
                去审批
              </Link>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">概览</h1>
          <p className="page-sub">项目、申请与需求的统一入口。先看今天要处理什么，再决定加入哪一个项目。</p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary" to="/projects">
            浏览项目
          </Link>
          <Link className="btn btn-primary" to="/demands">
            找需求
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="项目" value={projects.data?.total} hint="含招募中与进行中" />
        <Stat label="待审申请" value={inbox.data ? inboxItems.length : '—'} hint="等我决策的加入申请" />
        <Stat label="待接需求" value={waitingDemands.data?.total} hint="可立即接单的任务" />
      </div>

      <div className="section-head">
        <h2>最近项目</h2>
        <Link className="btn-link" to="/projects">
          全部项目 →
        </Link>
      </div>
      {recentBlock}

      <div className="section-head">
        <h2>待我处理</h2>
        <Link className="btn-link" to="/me">
          我的工作台 →
        </Link>
      </div>
      {inboxBlock}

      <div className="section-head">
        <h2>需求风向</h2>
        <Link className="btn-link" to="/demands">
          需求列表 →
        </Link>
      </div>
      <div className="panel">
        <div className="row" style={{ gap: 10 }}>
          <Badge tone="amber">
            {waitingDemands.data?.total ?? '—'} 个待接单
          </Badge>
          <span className="muted">
            等待接单的需求对所有用户开放，接单后项目成员与发布者都能跟踪进度。
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <StatusBadge map={DEMAND_STATUS} value="waiting" />
          <StatusBadge map={DEMAND_STATUS} value="accepted" />
          <StatusBadge map={DEMAND_STATUS} value="completed" />
          <StatusBadge map={APPLY_STATUS} value="waiting" />
        </div>
      </div>
    </div>
  );
}
