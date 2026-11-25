import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api';
import { useAuth } from '../auth';
import { latest, useApi, useDemandFeed } from '../hooks';
import { DEMAND_STATUS, ROLE, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { ActivityItem, ApplyItem, Paged, ProjectSummary } from '../types';

const PREVIEW = 5;
const PAGE_SIZE = 100;

const CHECKLIST_KEY = 'develop:newcomer-checklist:hidden';

/** 新人引导：没有加入任何项目时显示，可手动关闭。 */
function NewcomerChecklist({ show }: { show: boolean }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(CHECKLIST_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!show || hidden) return null;
  const steps = [
    { label: '读《环境与账号》', to: '/guide' },
    { label: '逛项目，申请加入一个', to: '/projects' },
    { label: '接一个新手任务', to: '/demands?difficulty=starter' },
    { label: '读《需求流程》', to: '/guide' },
  ];
  return (
    <section className="panel newcomer">
      <div className="panel__head">
        <h3>第一次来？按这四步开始</h3>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setHidden(true);
            try {
              window.localStorage.setItem(CHECKLIST_KEY, '1');
            } catch {
              /* 无痕模式忽略 */
            }
          }}
        >
          知道了
        </button>
      </div>
      <ol className="newcomer__steps">
        {steps.map((step) => (
          <li key={step.label}>
            <Link to={step.to}>{step.label}</Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const inbox = useApi<{ items: ApplyItem[] }>('/applies/inbox');
  const myProjects = useApi<Paged<ProjectSummary>>(`/projects${qs({ filter: 'mine-owner', pageSize: PAGE_SIZE })}`);
  const memberProjects = useApi<Paged<ProjectSummary>>(`/projects${qs({ filter: 'mine-member', pageSize: PAGE_SIZE })}`);
  const activity = useApi<{ items: ActivityItem[] }>('/activity?limit=15');
  const feed = useDemandFeed();

  const inboxItems = inbox.data?.items ?? [];
  const myDemands = feed.items.filter((item) => item.status === 'accepted' && item.assignee?.id === myId);
  const ongoing = latest(myDemands, (item) => item.acceptedAt ?? item.createdAt, PREVIEW);
  const leading = myProjects.data?.items ?? [];
  // 所有者/管理员与成员互斥，两个 total 相加即「我加入的全部项目」。
  const joinedCount = (myProjects.data?.total ?? 0) + (memberProjects.data?.total ?? 0);
  const joinedLoading = myProjects.loading || memberProjects.loading;

  const reviewDemands = feed.items.filter((demand) => demand.creator?.id === myId && demand.status === 'review');
  const myProjectItems = [...leading, ...(memberProjects.data?.items ?? [])].filter(
    (project, index, list) => list.findIndex((item) => item.id === project.id) === index,
  );
  const todoCount = inboxItems.length + ongoing.length + reviewDemands.length;
  const todoLoading = inbox.loading || feed.loading;

  const stats = [
    {
      to: '/me',
      label: '待我审批',
      value: inbox.loading ? '—' : inboxItems.length,
      hint: '等你处理的加入申请',
    },
    {
      to: '/demands?status=accepted',
      label: '进行中的需求',
      value: feed.loading ? '—' : myDemands.length,
      hint: '你接手且尚未完成',
    },
    {
      to: '/me',
      label: '我参与的项目',
      value: joinedLoading ? '—' : joinedCount,
      hint: '你是所有者、管理员或成员的项目',
    },
    {
      to: '/projects?filter=mine-owner',
      label: '我负责的项目',
      value: myProjects.loading ? '—' : (myProjects.data?.total ?? 0),
      hint: '你是所有者或管理员的项目',
    },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">概览</h1>
          <p className="page-sub">先看与你有关的，再看平台上最近发生了什么。</p>
        </div>
      </div>

      <NewcomerChecklist show={!joinedLoading && joinedCount === 0} />

      <div className="stat-grid">
        {stats.map((stat) => (
          <Link className="stat-card" key={stat.to} to={stat.to}>
            <span className="stat-card__label">{stat.label}</span>
            <span className="stat-card__value">{stat.value}</span>
            <span className="stat-card__hint">{stat.hint}</span>
          </Link>
        ))}
      </div>

      <div className="home-columns">
        <div>
          <div className="section-head">
            <h2>待我处理</h2>
            <span className="faint">审批、进行中的需求、待你验收</span>
          </div>
          <section className="panel home-panel">
            <div className="panel__head">
              <h3>待办</h3>
              <div className="home-panel__meta">
                <span className="faint">{todoCount} 项</span>
                <Link className="btn-link" to="/me">
                  全部
                </Link>
              </div>
            </div>
            {todoLoading ? (
              <Skeleton rows={3} />
            ) : todoCount === 0 ? (
              <div className="home-panel__empty">没有需要你处理的事。</div>
            ) : (
              <div className="list">
                {inboxItems.slice(0, PREVIEW).map((apply) => (
                  <div className="list__row" key={`apply-${apply.id}`}>
                    <div className="grow">
                      <Link className="home-panel__title truncate" to={`/projects/${apply.project.id}`}>
                        {apply.project.title}
                      </Link>
                      <div className="faint truncate">
                        加入申请 · {displayName(apply.user)} · <TimeAgo value={apply.createdAt} />
                      </div>
                    </div>
                    <Link className="btn-link" to={`/projects/${apply.project.id}`}>
                      去审批
                    </Link>
                  </div>
                ))}
                {ongoing.map((demand) => (
                  <div className="list__row" key={`ongoing-${demand.id}`}>
                    <div className="grow">
                      <Link className="home-panel__title truncate" to={`/demands/${demand.id}`}>
                        {demand.title}
                      </Link>
                      <div className="faint truncate">
                        我接的需求 · {demand.project.title} ·{' '}
                        <TimeAgo value={demand.acceptedAt ?? demand.createdAt} />
                      </div>
                    </div>
                    <StatusBadge map={DEMAND_STATUS} value={demand.status} />
                  </div>
                ))}
                {reviewDemands.map((demand) => (
                  <div className="list__row" key={`review-${demand.id}`}>
                    <div className="grow">
                      <Link className="home-panel__title truncate" to={`/demands/${demand.id}`}>
                        {demand.title}
                      </Link>
                      <div className="faint truncate">
                        待你验收 · {demand.project.title} ·{' '}
                        <TimeAgo value={demand.submittedAt ?? demand.createdAt} />
                      </div>
                    </div>
                    <Link className="btn-link" to={`/demands/${demand.id}`}>
                      去验收
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="section-head">
            <h2>我的项目</h2>
            <span className="faint">{myProjectItems.length} 个</span>
          </div>
          <section className="panel home-panel">
            {myProjects.loading ? (
              <Skeleton rows={3} />
            ) : myProjectItems.length === 0 ? (
              <div className="home-panel__empty">还没有参与项目，去项目列表看看。</div>
            ) : (
              <div className="list">
                {myProjectItems.slice(0, 8).map((project) => (
                  <div className="list__row" key={project.id}>
                    <div className="grow">
                      <Link className="home-panel__title truncate" to={`/projects/${project.id}`}>
                        {project.title}
                      </Link>
                      <div className="faint truncate">
                        {project.memberCount} 位成员 · {project.waitingDemandCount} 个待接需求 ·{' '}
                        <TimeAgo value={project.updatedAt} />
                      </div>
                    </div>
                    {project.myRole ? <StatusBadge map={ROLE} value={project.myRole} /> : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div>
          <div className="section-head">
            <h2>平台动态</h2>
            <span className="faint">最近新建的项目、发布与完成的需求</span>
          </div>

          <section className="panel home-panel">
            <div className="panel__head">
              <h3>最近发生</h3>
              <div className="home-panel__meta">
                <span className="faint">{activity.data?.items.length ?? 0} 条</span>
              </div>
            </div>
            {activity.loading ? (
              <Skeleton rows={3} />
            ) : activity.error ? (
              <div className="notice notice-error">{activity.error.message}</div>
            ) : (activity.data?.items.length ?? 0) === 0 ? (
              <div className="home-panel__empty">还没有动态。</div>
            ) : (
              <div className="list">
                {(activity.data?.items ?? []).map((event) => (
                  <div className="list__row" key={`${event.kind}-${event.id}-${event.at}`}>
                    <div className="grow">
                      <Link
                        className="home-panel__title truncate"
                        to={event.kind === 'project' ? `/projects/${event.id}` : `/demands/${event.id}`}
                      >
                        {event.title}
                      </Link>
                      <div className="faint truncate">
                        {event.kind === 'project'
                          ? '新建项目'
                          : event.kind === 'demand_done'
                            ? '完成需求'
                            : '发布需求'}
                        {event.project && event.kind !== 'project' ? (
                          <>
                            {' · '}
                            <Link to={`/projects/${event.project.id}`}>{event.project.title}</Link>
                          </>
                        ) : null}
                        {event.actor ? ` · ${displayName(event.actor)}` : ''}
                        {' · '}
                        <TimeAgo value={event.at} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
