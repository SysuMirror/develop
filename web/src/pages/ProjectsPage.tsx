import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import { APPLY_STATUS, ROLE, Badge, Empty, Pager, Skeleton, StatusBadge, TimeAgo } from '../ui';
import type { Paged, ProjectSummary } from '../types';

interface FilterItem {
  key: string;
  label: string;
}

const FILTERS: FilterItem[] = [
  { key: 'all', label: '全部' },
  { key: 'mine-leader', label: '我领导的' },
  { key: 'mine-member', label: '我参与的' },
  { key: 'recruiting', label: '招募中' },
];

function statusCell(project: ProjectSummary) {
  if (project.myRole) return <StatusBadge map={ROLE} value={project.myRole} />;
  if (project.myApplyStatus) return <StatusBadge map={APPLY_STATUS} value={project.myApplyStatus} />;
  return <span className="faint">—</span>;
}

export default function ProjectsPage() {
  const [filter, setFilter] = useState('all');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(term);
  const navigate = useNavigate();

  const pageSize = 12;
  const { data, loading, error } = useApi<Paged<ProjectSummary>>(`/projects${qs({ filter, q, page, pageSize })}`);
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
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>项目</th>
              <th>Leader</th>
              <th className="right">成员</th>
              <th className="right">待接需求</th>
              <th>我的状态</th>
              <th className="right">更新</th>
            </tr>
          </thead>
          <tbody>
            {items.map((project) => (
              <tr key={project.id} onClick={() => navigate(`/projects/${project.id}`)} style={{ cursor: 'pointer' }}>
                <td>
                  <div className="cell-title">{project.title}</div>
                  <div className="faint truncate" style={{ maxWidth: 420 }}>
                    {project.misc || '暂无说明'}
                  </div>
                </td>
                <td>{project.leader ? project.leader.name : <span className="faint">—</span>}</td>
                <td className="right">{project.memberCount}</td>
                <td className="right">
                  {project.waitingDemandCount > 0 ? (
                    <Badge tone="amber">{project.waitingDemandCount}</Badge>
                  ) : (
                    <span className="faint">0</span>
                  )}
                </td>
                <td>{statusCell(project)}</td>
                <td className="right">
                  <TimeAgo value={project.updatedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">项目</h1>
          <p className="page-sub">每个项目有一个 leader 与若干成员；leader 负责审批加入申请与发布需求。</p>
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

      {content}

      <Pager page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} total={data?.total ?? 0} onPage={setPage} />

    </div>
  );
}
