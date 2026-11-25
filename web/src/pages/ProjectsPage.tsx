import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import { APPLY_STATUS, PROJECT_DIFFICULTY, PROJECT_STATUS, ROLE, Badge, Empty, Pager, Skeleton, StatusBadge, TimeAgo } from '../ui';
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
      {items.slice(0, 4).map((tech) => (
        <Badge key={tech} tone="gray">
          {tech}
        </Badge>
      ))}
    </span>
  );
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
      <>
        <div className="table-wrap only-desktop">
          <table className="table">
            <thead>
              <tr>
                <th>项目</th>
                <th>所有者</th>
                <th className="right">成员</th>
                <th className="right">待接需求</th>
                <th>状态</th>
                <th className="right">更新</th>
              </tr>
            </thead>
            <tbody>
              {items.map((project) => (
                <tr key={project.id} onClick={() => navigate(`/projects/${project.id}`)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <span className="cell-title">{project.title}</span>
                      {project.myRole ? <StatusBadge map={ROLE} value={project.myRole} /> : null}
                    </div>
                    {project.techStack.length > 0 ? (
                      <div style={{ marginTop: 4 }}>
                        <TechChips items={project.techStack} />
                      </div>
                    ) : null}
                  </td>
                  <td>{project.owner ? project.owner.name : <span className="faint">—</span>}</td>
                  <td className="right">{project.memberCount}</td>
                  <td className="right">
                    {project.waitingDemandCount > 0 ? (
                      <Badge tone="amber">{project.waitingDemandCount}</Badge>
                    ) : (
                      <span className="faint">0</span>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      <StatusBadge map={PROJECT_STATUS} value={project.status} />
                      <StatusBadge map={PROJECT_DIFFICULTY} value={project.difficulty} />
                      {!project.myRole && project.myApplyStatus ? (
                        <StatusBadge map={APPLY_STATUS} value={project.myApplyStatus} />
                      ) : null}
                    </div>
                  </td>
                  <td className="right">
                    <TimeAgo value={project.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="card-list only-mobile">
          {items.map((project) => (
            <li key={project.id}>
              <Link className="list-card" to={`/projects/${project.id}`}>
                <div className="list-card__top">
                  <span className="list-card__title">{project.title}</span>
                  <span className="row" style={{ gap: 4 }}>
                    <StatusBadge map={PROJECT_STATUS} value={project.status} />
                    <StatusBadge map={PROJECT_DIFFICULTY} value={project.difficulty} />
                  </span>
                </div>
                {project.techStack.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    <TechChips items={project.techStack} />
                  </div>
                ) : null}
                <div className="list-card__meta">
                  <span>所有者 {project.owner ? project.owner.name : '—'}</span>
                  <span>{project.memberCount} 位成员</span>
                  <span>
                    {project.waitingDemandCount > 0 ? `${project.waitingDemandCount} 个待接需求` : '暂无待接需求'}
                  </span>
                  <span>
                    <TimeAgo value={project.updatedAt} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </>
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
