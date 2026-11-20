import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, messageOf, qs } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { APPLY_TYPE, DEMAND_STATUS, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { ApplyItem, DemandItem, Paged, ProjectSummary } from '../types';

const PREVIEW = 5;
const PAGE_SIZE = 100;
// /api/demands 的 pageSize 上限是 100，且排序按状态而非时间；
// 首页最多翻 5 页，超出部分不拉，避免一次打开首页发出无界请求。
const MAX_PAGES = 5;

function timeOf(value: string | null | undefined): number {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function latest<T>(items: T[], at: (item: T) => string | null | undefined, limit = PREVIEW): T[] {
  return [...items].sort((a, b) => timeOf(at(b)) - timeOf(at(a))).slice(0, limit);
}

interface DemandFeedState {
  items: DemandItem[];
  total: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

interface DemandFeed extends DemandFeedState {
  reload: () => void;
}

// 需求列表没有「按接单人」「按完成时间」的筛选参数，只能分页拉回来在前端切。
function useDemandFeed(): DemandFeed {
  const [state, setState] = useState<DemandFeedState>({
    items: [],
    total: 0,
    truncated: false,
    loading: true,
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    (async () => {
      const collected: DemandItem[] = [];
      let total = 0;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const data = await api.get<Paged<DemandItem>>(`/demands${qs({ page, pageSize: PAGE_SIZE })}`);
        total = data.total;
        collected.push(...data.items);
        if (data.items.length === 0 || collected.length >= total) break;
      }
      if (alive) {
        setState({
          items: collected,
          total,
          truncated: collected.length < total,
          loading: false,
          error: null,
        });
      }
    })().catch((error: unknown) => {
      if (alive) {
        setState({ items: [], total: 0, truncated: false, loading: false, error: messageOf(error) });
      }
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  return { ...state, reload: () => setTick((value) => value + 1) };
}

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
  const myProjects = useApi<Paged<ProjectSummary>>(`/projects${qs({ filter: 'mine-leader', pageSize: PAGE_SIZE })}`);
  const allProjects = useApi<Paged<ProjectSummary>>(`/projects${qs({ pageSize: PAGE_SIZE })}`);
  const feed = useDemandFeed();

  const inboxItems = inbox.data?.items ?? [];
  const myDemands = feed.items.filter((item) => item.status === 'accepted' && item.assignee?.id === myId);
  const ongoing = latest(myDemands, (item) => item.acceptedAt ?? item.createdAt);
  const published = latest(feed.items, (item) => item.createdAt);
  const completed = feed.items.filter((item) => item.status === 'completed');
  const resolved = latest(completed, (item) => item.completedAt ?? item.createdAt);
  const leading = myProjects.data?.items ?? [];
  const createdProjects = latest(allProjects.data?.items ?? [], (item) => item.createdAt);

  const feedHint = feed.truncated ? `（基于最近 ${MAX_PAGES * PAGE_SIZE} 条）` : '';

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
      to: '/projects?filter=mine-leader',
      label: '我负责的项目',
      value: myProjects.loading ? '—' : (myProjects.data?.total ?? 0),
      hint: '你是 leader 的项目',
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
            moreTo="/projects?filter=mine-leader"
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
            <h2>与我无关</h2>
            <span className="faint">平台上最近发生的事</span>
          </div>

          <PreviewPanel
            title="最近发布的需求"
            count={`共 ${feed.total} 条${feedHint}`}
            moreTo="/demands"
            loading={feed.loading}
            error={feed.error}
            empty={published.length === 0}
            emptyText="还没有需求发布。"
          >
            {published.map((demand) => (
              <DemandRow key={demand.id} demand={demand} time={demand.createdAt} />
            ))}
          </PreviewPanel>

          <PreviewPanel
            title="最近被解决的需求"
            count={`${completed.length} 条${feedHint}`}
            moreTo="/demands?status=completed"
            loading={feed.loading}
            error={feed.error}
            empty={resolved.length === 0}
            emptyText="还没有已完成的需求。"
          >
            {resolved.map((demand) => (
              <DemandRow
                key={demand.id}
                demand={demand}
                time={demand.completedAt ?? demand.createdAt}
                extra={demand.assignee ? ` · 接单人 ${displayName(demand.assignee)}` : null}
              />
            ))}
          </PreviewPanel>

          <PreviewPanel
            title="最近新建的项目"
            count={`共 ${allProjects.data?.total ?? 0} 个`}
            moreTo="/projects"
            loading={allProjects.loading}
            error={allProjects.error ? allProjects.error.message : null}
            empty={createdProjects.length === 0}
            emptyText="还没有项目，去建一个。"
          >
            {createdProjects.map((project) => (
              <div className="list__row" key={project.id}>
                <div className="grow">
                  <Link className="home-panel__title truncate" to={`/projects/${project.id}`}>
                    {project.title}
                  </Link>
                  <div className="faint truncate">
                    Leader {displayName(project.leader)} · {project.memberCount} 位成员 ·{' '}
                    <TimeAgo value={project.createdAt} />
                  </div>
                </div>
              </div>
            ))}
          </PreviewPanel>
        </div>
      </div>
    </div>
  );
}
