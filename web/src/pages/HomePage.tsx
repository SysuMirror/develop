import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api';
import { useAuth } from '../auth';
import { latest, useApi, useDemandFeed } from '../hooks';
import { DEMAND_STATUS, ROLE, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { ActivityItem, ApplyItem, Paged, ProjectSummary } from '../types';

const PREVIEW = 6;
const ACTIVITY_LIMIT = 8;
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

interface TodoItem {
  key: string;
  kind: string;
  title: string;
  to: string;
  meta: string;
  action: string;
  status?: string;
}

/** 区块外壳：标题、数量与右侧链接合成一行，避免「分区标题 + 面板标题」两层重复。 */
function HomeSection({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="panel home-section">
      <header className="home-section__head">
        <h2>{title}</h2>
        {hint ? <span className="faint">{hint}</span> : null}
        {action ? (
          <Link className="btn-link home-section__action" to={action.to}>
            {action.label}
          </Link>
        ) : null}
      </header>
      {children}
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

  const todos: TodoItem[] = [
    ...inboxItems.map((apply) => ({
      key: `apply-${apply.id}`,
      kind: '加入申请',
      title: apply.project.title,
      to: `/projects/${apply.project.id}`,
      meta: `${displayName(apply.user)} · ${apply.note ? '有留言' : '未留言'}`,
      action: '去审批',
    })),
    ...ongoing.map((demand) => ({
      key: `ongoing-${demand.id}`,
      kind: '我接的需求',
      title: demand.title,
      to: `/demands/${demand.id}`,
      meta: demand.project.title,
      action: '继续做',
      status: demand.status,
    })),
    ...reviewDemands.map((demand) => ({
      key: `review-${demand.id}`,
      kind: '待你验收',
      title: demand.title,
      to: `/demands/${demand.id}`,
      meta: demand.project.title,
      action: '去验收',
      status: demand.status,
    })),
  ].slice(0, PREVIEW);

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

  const events = (activity.data?.items ?? []).slice(0, ACTIVITY_LIMIT);

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

      <HomeSection
        title="待我处理"
        hint={todoCount > 0 ? `${todoCount} 项` : undefined}
        action={todoCount > 0 ? { to: '/me', label: '全部' } : undefined}
      >
        {todoLoading ? (
          <Skeleton rows={2} />
        ) : todos.length === 0 ? (
          <div className="home-empty">
            <span>当前没有需要你处理的事。</span>
            <Link className="btn btn-secondary btn-sm" to="/demands?difficulty=starter">
              接一个新手任务
            </Link>
          </div>
        ) : (
          <div className="todo-grid">
            {todos.map((todo) => (
              <Link className="todo-card" key={todo.key} to={todo.to}>
                <span className="todo-card__top">
                  <span className="todo-card__kind">{todo.kind}</span>
                  {todo.status ? <StatusBadge map={DEMAND_STATUS} value={todo.status} /> : null}
                </span>
                <span className="todo-card__title">{todo.title}</span>
                <span className="todo-card__meta">{todo.meta}</span>
                <span className="todo-card__action">{todo.action}</span>
              </Link>
            ))}
          </div>
        )}
      </HomeSection>

      <HomeSection
        title="我的项目"
        hint={joinedLoading ? undefined : `${myProjectItems.length} 个`}
        action={{ to: '/projects?filter=mine-owner', label: '全部项目' }}
      >
        {myProjects.loading || memberProjects.loading ? (
          <Skeleton rows={2} />
        ) : myProjectItems.length === 0 ? (
          <div className="home-empty">
            <span>还没有参与项目，去项目列表看看。</span>
            <Link className="btn btn-secondary btn-sm" to="/projects">
              浏览项目
            </Link>
          </div>
        ) : (
          <div className="mini-grid">
            {myProjectItems.slice(0, 6).map((project) => (
              <Link className="mini-project" key={project.id} to={`/projects/${project.id}`}>
                <span className="mini-project__top">
                  <span className="mini-project__title">{project.title}</span>
                  {project.myRole ? <StatusBadge map={ROLE} value={project.myRole} /> : null}
                </span>
                <span className="mini-project__meta">
                  {project.memberCount} 位成员
                  <span aria-hidden="true">·</span>
                  {project.waitingDemandCount} 个需求待接
                  <span aria-hidden="true">·</span>
                  <TimeAgo value={project.updatedAt} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </HomeSection>

      <HomeSection title="平台动态" hint={events.length > 0 ? '最近的项目与需求' : undefined}>
        {activity.loading ? (
          <Skeleton rows={2} />
        ) : activity.error ? (
          <div className="notice notice-error">{activity.error.message}</div>
        ) : events.length === 0 ? (
          <div className="home-empty">
            <span>平台上还没有动态。</span>
          </div>
        ) : (
          <div className="activity-grid">
            {events.map((event) => (
              <Link
                className="activity-item"
                key={`${event.kind}-${event.id}-${event.at}`}
                to={event.kind === 'project' ? `/projects/${event.id}` : `/demands/${event.id}`}
              >
                <span className={`activity-item__dot activity-item__dot--${event.kind}`} aria-hidden="true" />
                <span className="activity-item__body">
                  <span className="activity-item__title">{event.title}</span>
                  <span className="activity-item__meta">
                    {event.kind === 'project'
                      ? '新建项目'
                      : event.kind === 'demand_done'
                        ? '完成需求'
                        : '发布需求'}
                    {event.project && event.kind !== 'project' ? <> · {event.project.title}</> : null}
                    {event.actor ? <> · {displayName(event.actor)}</> : null}
                  </span>
                </span>
                <TimeAgo value={event.at} />
              </Link>
            ))}
          </div>
        )}
      </HomeSection>
    </div>
  );
}
