import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api, messageOf, qs } from '../api';
import { useAuth } from '../auth';
import { DEMAND_MAX_PAGES, DEMAND_PAGE_SIZE, sortByTimeDesc, useApi, useDemandFeed } from '../hooks';
import {
  APPLY_TYPE,
  DEMAND_STATUS,
  ROLE,
  Avatar,
  Badge,
  Empty,
  Skeleton,
  StatusBadge,
  TimeAgo,
  displayName,
  useToast,
} from '../ui';
import type { ApplyItem, DemandItem, Paged, ProjectSummary } from '../types';

function demandTime(demand: DemandItem): string | null {
  if (demand.status === 'completed') return demand.completedAt;
  if (demand.status === 'review') return demand.submittedAt;
  return demand.acceptedAt;
}

function DemandRow({ demand }: { demand: DemandItem }) {
  return (
    <div className="list__row">
      <div className="grow">
        <Link className="truncate" to={`/demands/${demand.id}`} style={{ fontWeight: 600 }}>
          {demand.title}
        </Link>
        <div className="faint truncate">
          <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
          {' · '}
          <TimeAgo value={demandTime(demand)} />
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <StatusBadge map={DEMAND_STATUS} value={demand.status} />
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const { push } = useToast();
  const inbox = useApi<{ items: ApplyItem[] }>('/applies/inbox');
  const projects = useApi<Paged<ProjectSummary>>(`/projects${qs({ filter: 'all', pageSize: 50 })}`);
  const feed = useDemandFeed();
  const [busy, setBusy] = useState(false);

  const myProjects = (projects.data?.items ?? []).filter((project) => project.myRole);
  const inboxItems = inbox.data?.items ?? [];
  const myDemands = feed.items.filter((demand) => demand.assignee?.id === user?.id);
  const ongoing = sortByTimeDesc(
    myDemands.filter((demand) => demand.status === 'accepted' || demand.status === 'review'),
    (demand) => demand.submittedAt ?? demand.acceptedAt ?? demand.createdAt,
  );
  const completed = sortByTimeDesc(
    myDemands.filter((demand) => demand.status === 'completed'),
    (demand) => demand.completedAt ?? demand.createdAt,
  );
  const feedHint = feed.truncated ? `（基于最近 ${DEMAND_MAX_PAGES * DEMAND_PAGE_SIZE} 条）` : '';

  async function act(path: string, method: 'POST' | 'DELETE', okMessage: string, after?: () => void) {
    setBusy(true);
    try {
      if (method === 'DELETE') await api.del(path);
      else await api.post(path);
      push(okMessage, 'success');
      inbox.reload();
      projects.reload();
      feed.reload();
      after?.();
    } catch (error) {
      push(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  let inboxBlock: ReactNode;
  if (inbox.loading) {
    inboxBlock = <Skeleton rows={2} />;
  } else if (inboxItems.length === 0) {
    inboxBlock = <Empty title="没有待审申请" hint="你领导的项目的加入申请会出现在这里。" />;
  } else {
    inboxBlock = (
      <div className="panel">
        <div className="list">
          {inboxItems.map((apply) => (
            <div className="list__row" key={apply.id}>
              <Avatar name={displayName(apply.user)} src={apply.user.avatar} />
              <div className="grow">
                <div className="truncate">
                  {displayName(apply.user)} → <Link to={`/projects/${apply.project.id}`}>{apply.project.title}</Link>{' '}
                  <StatusBadge map={APPLY_TYPE} value={apply.type} />
                  {apply.source === 'join' ? (
                    <>
                      {' '}
                      <Badge tone="blue">来自 join</Badge>
                    </>
                  ) : null}
                </div>
                <div className="faint">
                  {apply.note ? `${apply.note} · ` : ''}
                  <TimeAgo value={apply.createdAt} />
                  {apply.resumeUrl ? (
                    <>
                      {' · '}
                      <a className="btn-link" href={apply.resumeUrl} target="_blank" rel="noreferrer">
                        下载简历
                      </a>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="row list__row__actions" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => act(`/applies/${apply.id}/accept`, 'POST', '已通过申请')}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => act(`/applies/${apply.id}/reject`, 'POST', '已拒绝申请')}
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  let projectsBlock: ReactNode;
  if (projects.loading) {
    projectsBlock = <Skeleton rows={2} />;
  } else if (myProjects.length === 0) {
    projectsBlock = <Empty title="还没有参与项目" hint="浏览项目列表，申请加入或自己建一个。" />;
  } else {
    projectsBlock = (
      <div className="panel">
        <div className="list">
          {myProjects.map((project) => (
            <div className="list__row" key={project.id}>
              <div className="grow">
                <Link to={`/projects/${project.id}`}>{project.title}</Link>
                <div className="faint">
                  {project.memberCount} 位成员 · {project.waitingDemandCount} 个待接需求 ·{' '}
                  <TimeAgo value={project.updatedAt} />
                </div>
              </div>
              <StatusBadge map={ROLE} value={project.myRole} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  let demandsBlock: ReactNode;
  if (feed.loading) {
    demandsBlock = <Skeleton rows={2} />;
  } else if (feed.error) {
    demandsBlock = <div className="notice notice-error">{feed.error}</div>;
  } else if (myDemands.length === 0) {
    demandsBlock = <Empty title="还没有接下需求" hint="在需求页接单后，会出现在这里。" />;
  } else {
    demandsBlock = (
      <div className="panel">
        <div className="list">
          {ongoing.map((demand) => (
            <DemandRow key={demand.id} demand={demand} />
          ))}
          {completed.map((demand) => (
            <DemandRow key={demand.id} demand={demand} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">我的</h1>
          <p className="page-sub">等你审批的申请、你参与的项目，以及你接下的需求。</p>
        </div>
        <div className="row">
          <Avatar name={displayName(user)} src={user?.avatar} size="lg" />
          <div>
            <div style={{ fontWeight: 700 }}>{displayName(user)}</div>
            <div className="faint">{user?.email || '未提供邮箱'}</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm logout-mobile" onClick={() => logout()}>
            退出登录
          </button>
        </div>
      </div>

      <div className="section-head">
        <h2>待我审批</h2>
        <span className="faint">{inboxItems.length} 条</span>
      </div>
      {inboxBlock}

      <div className="section-head">
        <h2>我参与的项目</h2>
        <span className="faint">{myProjects.length} 个</span>
      </div>
      {projectsBlock}

      <div className="section-head">
        <h2>个人参与的需求</h2>
        <span className="faint">
          {feed.loading ? '—' : `进行中 ${ongoing.length} 个 · 已完成 ${completed.length} 个`}
          {feedHint}
        </span>
      </div>
      {demandsBlock}
    </div>
  );
}
