import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api';
import { useAuth } from '../auth';
import { latest, useApi, useDemandFeed } from '../hooks';
import { APPLY_TYPE, DEMAND_STATUS, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { ActivityItem, ApplyItem, DemandItem, Paged, ProjectSummary } from '../types';

const PREVIEW = 5;
const PAGE_SIZE = 100;

interface PreviewPanelProps {
  title: string;
  count: ReactNode;
  moreTo?: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}

function PreviewPanel({ title, count, moreTo, loading, error, empty, emptyText, children }: PreviewPanelProps) {
  let body: ReactNode;
  if (loading) body = <Skeleton rows={3} />;
  else if (error) body = <div className="notice notice-error">{error}</div>;
  else if (empty) body = <div className="home-panel__empty">{emptyText}</div>;
  else body = <div className="list">{children}</div>;

  return (
    <section className="panel home-panel">
      <div className="panel__head">
        <h3>{title}</h3>
        <div className="home-panel__meta">
          <span className="faint">{count}</span>
          {moreTo ? (
            <Link className="btn-link" to={moreTo}>
              查看全部
            </Link>
          ) : null}
        </div>
      </div>
      {body}
    </section>
  );
}

function DemandRow({ demand, time, extra }: { demand: DemandItem; time: string | null; extra?: ReactNode }) {
  return (
    <div className="list__row">
      <div className="grow">
        <Link className="home-panel__title truncate" to={`/demands/${demand.id}`}>
          {demand.title}
        </Link>
        <div className="faint truncate">
          <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
          {extra}
          {' · '}
          <TimeAgo value={time} />
        </div>
      </div>
      <StatusBadge map={DEMAND_STATUS} value={demand.status} />
    </div>
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
            <h2>与我有关</h2>
            <span className="faint">需要你处理或你正在推进的</span>
          </div>

          <PreviewPanel
            title="待我审批的申请"
            count={`${inboxItems.length} 条`}
            moreTo="/me"
            loading={inbox.loading}
            error={inbox.error ? inbox.error.message : null}
            empty={inboxItems.length === 0}
            emptyText="没有等你审批的申请。"
          >
            {inboxItems.slice(0, PREVIEW).map((apply) => (
              <div className="list__row" key={apply.id}>
                <div className="grow">
                  <Link className="home-panel__title truncate" to={`/projects/${apply.project.id}`}>
                    {apply.project.title}
                  </Link>
                  <div className="faint truncate">
                    {displayName(apply.user)} · {APPLY_TYPE[apply.type].label} ·{' '}
                    <TimeAgo value={apply.createdAt} />
                  </div>
                </div>
                <Link className="btn-link" to={`/projects/${apply.project.id}`}>
                  去审批
                </Link>
              </div>
            ))}
          </PreviewPanel>

          <PreviewPanel
            title="我接下的进行中需求"
            count={`${myDemands.length} 条`}
            loading={feed.loading}
            error={feed.error}
            empty={myDemands.length === 0}
            emptyText="还没有你接下的需求，去需求页看看。"
          >
            {ongoing.map((demand) => (
              <DemandRow
                key={demand.id}
                demand={demand}
                time={demand.acceptedAt ?? demand.createdAt}
                extra={demand.creator ? ` · 发布者 ${displayName(demand.creator)}` : null}
              />
            ))}
          </PreviewPanel>

          <PreviewPanel
            title="我负责的项目"
            count={`${myProjects.data?.total ?? 0} 个`}
            moreTo="/projects?filter=mine-owner"
            loading={myProjects.loading}
            error={myProjects.error ? myProjects.error.message : null}
            empty={leading.length === 0}
            emptyText="你还没有负责的项目。"
          >
            {leading.slice(0, PREVIEW).map((project) => (
              <div className="list__row" key={project.id}>
                <div className="grow">
                  <Link className="home-panel__title truncate" to={`/projects/${project.id}`}>
                    {project.title}
                  </Link>
                  <div className="faint truncate">
                    {project.memberCount} 位成员 · {project.waitingDemandCount} 个待接需求 ·{' '}
                    {project.pendingApplyCount} 条待审批 · <TimeAgo value={project.createdAt} />
                  </div>
                </div>
              </div>
            ))}
          </PreviewPanel>
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
