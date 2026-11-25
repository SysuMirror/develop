import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import {
  PROJECT_DIFFICULTY,
  PROJECT_STATUS,
  ROLE,
  Avatar,
  Badge,
  Empty,
  Pager,
  Skeleton,
  StatusBadge,
  TimeAgo,
} from '../ui';
import type { Paged, ProjectSummary } from '../types';

interface FilterItem {
  key: string;
  label: string;
}

const FILTERS: FilterItem[] = [
  { key: 'all', label: '全部' },
  { key: 'mine-owner', label: '我负责的' },
  { key: 'mine-member', label: '我参与的' },
  { key: 'recruiting', label: '招募中' },
];

const STATUS_FILTERS: FilterItem[] = [
  { key: '', label: '全部状态' },
  { key: 'recruiting', label: '招募中' },
  { key: 'active', label: '进行中' },
  { key: 'paused', label: '暂停' },
  { key: 'archived', label: '已归档' },
];

function TechChips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {items.slice(0, 5).map((tech) => (
        <Badge key={tech} tone="gray">
          {tech}
        </Badge>
      ))}
    </span>
  );
}

/** 把 Markdown 说明压成一行纯文本摘要，让列表自带上下文。 */
function excerptOf(text: string | null): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export default function ProjectsPage() {
  const [filter, setFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [tech, setTech] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(term);
  const techQ = useDebounced(tech);
  const navigate = useNavigate();

  const pageSize = 12;
  const { data, loading, error } = useApi<Paged<ProjectSummary>>(
    `/projects${qs({ filter, status: statusFilter, tech: techQ, q, page, pageSize })}`,
  );
  const items = data?.items ?? [];

  let content: ReactNode;
  if (loading) {
    content = <Skeleton rows={5} />;
  } else if (error) {
    content = <div className="notice notice-error">{error.message}</div>;
  } else if (items.length === 0) {
    content = <Empty title="没有匹配的项目" hint="换个筛选条件，或者自己建一个。" />;
  } else {
    content = (
      <div className="project-grid">
        {items.map((project) => {
          const desc = excerptOf(project.misc);
          const canApply = !project.myRole;
          const waitingApply = canApply && project.myApplyStatus === 'waiting';
          return (
            <div className="project-card" key={project.id}>
              <div className="project-card__top">
                <Link className="project-card__title stretched truncate" to={`/projects/${project.id}`}>
                  {project.title}
                </Link>
                <span className="row" style={{ gap: 4, flexShrink: 0 }}>
                  {project.myRole ? <StatusBadge map={ROLE} value={project.myRole} /> : null}
                  <StatusBadge map={PROJECT_STATUS} value={project.status} />
                  <StatusBadge map={PROJECT_DIFFICULTY} value={project.difficulty} />
                </span>
              </div>

              <p className="project-card__desc">{desc || '这个项目还没有写说明。'}</p>

              <div className="project-card__foot">
                <TechChips items={project.techStack} />
                <span className="project-card__meta">
                  <Avatar name={project.owner?.name ?? undefined} src={project.owner?.avatar ?? undefined} size="sm" />
                  {project.owner?.name ?? '—'} · {project.memberCount} 人
                  {project.waitingDemandCount > 0 ? (
                    <Badge tone="amber">{project.waitingDemandCount} 个待接</Badge>
                  ) : null}
                  <span className="faint">
                    <TimeAgo value={project.updatedAt} />
                  </span>
                </span>
                {waitingApply ? (
                  <span className="project-card__action">
                    <Badge tone="blue">申请等待审批</Badge>
                  </span>
                ) : canApply ? (
                  <Link className="btn btn-primary btn-sm project-card__action" to={`/projects/${project.id}/apply`}>
                    申请加入
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">项目</h1>
          <p className="page-sub">每个项目有若干所有者、管理员与成员；所有者与管理员负责审批加入申请、邀请成员与发布需求。</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/projects/new')}>
          新建项目
        </button>
      </div>

      <div className="toolbar">
        <div className="filter-chips">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={filter === item.key ? 'chip active' : 'chip'}
              onClick={() => {
                setFilter(item.key);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="search">
          <input
            className="input"
            placeholder="搜索项目名称"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: -6 }}>
        <div className="filter-chips">
          {STATUS_FILTERS.map((item) => (
            <button
              type="button"
              key={item.key || 'any'}
              className={statusFilter === item.key ? 'chip active' : 'chip'}
              onClick={() => {
                setStatusFilter(item.key);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="search">
          <input
            className="input"
            placeholder="按技术栈筛选，例如 React"
            value={tech}
            onChange={(event) => {
              setTech(event.target.value);
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
