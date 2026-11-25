import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { formatTime, qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import { DEMAND_DIFFICULTY, DEMAND_STATUS, Badge, Empty, Pager, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { DemandItem, Paged } from '../types';

interface TabItem {
  key: string;
  label: string;
}

const TABS: TabItem[] = [
  { key: '', label: '全部' },
  { key: 'waiting', label: '待接单' },
  { key: 'accepted', label: '进行中' },
  { key: 'review', label: '待确认' },
  { key: 'completed', label: '已完成' },
  { key: 'suspended', label: '挂起' },
];

const SCOPES: TabItem[] = [
  { key: '', label: '全部需求' },
  { key: 'created', label: '我发布的' },
  { key: 'assigned', label: '我接的' },
];

export default function DemandsPage() {
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState('');
  const [label, setLabel] = useState('');
  const [starterOnly, setStarterOnly] = useState(false);
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(term);
  const labelQ = useDebounced(label);
  const pageSize = 15;
  const { data, loading, error } = useApi<Paged<DemandItem>>(
    `/demands${qs({ status, scope, label: labelQ, difficulty: starterOnly ? 'starter' : '', q, page, pageSize })}`,
  );
  const items = data?.items ?? [];

  let content: ReactNode;
  if (loading) {
    content = <Skeleton rows={5} />;
  } else if (error) {
    content = <div className="notice notice-error">{error.message}</div>;
  } else if (items.length === 0) {
    content = <Empty title="没有匹配的需求" hint="需求由项目成员发布，换个状态筛选看看。" />;
  } else {
    content = (
      <>
        <div className="table-wrap only-desktop">
          <table className="table">
            <thead>
              <tr>
                <th>需求</th>
                <th>项目</th>
                <th>发布者</th>
                <th>接单人</th>
                <th>截止</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((demand) => (
                <tr key={demand.id}>
                  <td>
                    <Link className="cell-title" to={`/demands/${demand.id}`}>
                      {demand.title}
                    </Link>
                    {demand.labels.length > 0 ? (
                      <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {demand.difficulty ? (
                          <StatusBadge map={DEMAND_DIFFICULTY} value={demand.difficulty} />
                        ) : null}
                        {demand.estimateHours ? <Badge tone="gray">{demand.estimateHours} 小时</Badge> : null}
                        {demand.labels.map((item) => (
                          <Badge key={item} tone="gray">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    ) : demand.difficulty || demand.estimateHours ? (
                      <div className="row" style={{ gap: 4, marginTop: 4 }}>
                        {demand.difficulty ? (
                          <StatusBadge map={DEMAND_DIFFICULTY} value={demand.difficulty} />
                        ) : null}
                        {demand.estimateHours ? <Badge tone="gray">{demand.estimateHours} 小时</Badge> : null}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
                  </td>
                  <td>{demand.creator?.name || <span className="faint">—</span>}</td>
                  <td>{demand.assignee ? displayName(demand.assignee) : <span className="faint">—</span>}</td>
                  <td>
                    {demand.deadline ? (
                      <span className="faint">{formatTime(demand.deadline)}</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge map={DEMAND_STATUS} value={demand.status} />
                    <div className="faint">
                      <TimeAgo value={demand.createdAt} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="card-list only-mobile">
          {items.map((demand) => (
            <li key={demand.id}>
              <Link className="list-card" to={`/demands/${demand.id}`}>
                <div className="list-card__top">
                  <span className="list-card__title">{demand.title}</span>
                  <StatusBadge map={DEMAND_STATUS} value={demand.status} />
                </div>
                {demand.labels.length > 0 || demand.difficulty || demand.estimateHours ? (
                  <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {demand.difficulty ? (
                      <StatusBadge map={DEMAND_DIFFICULTY} value={demand.difficulty} />
                    ) : null}
                    {demand.estimateHours ? <Badge tone="gray">{demand.estimateHours} 小时</Badge> : null}
                    {demand.labels.map((item) => (
                      <Badge key={item} tone="gray">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <div className="list-card__meta">
                  <span>{demand.project.title}</span>
                  <span>发布者 {demand.creator?.name || '—'}</span>
                  <span>{demand.assignee ? `接单 ${displayName(demand.assignee)}` : '待认领'}</span>
                  {demand.deadline ? <span>截止 {formatTime(demand.deadline)}</span> : null}
                  <span>
                    <TimeAgo value={demand.createdAt} />
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
          <h1 className="page-title">需求</h1>
          <p className="page-sub">
            项目成员发布的任务。接单人推进完后提交完成，由发布者或项目所有者/管理员验收才算完成；发布者也可以挂起需求。
          </p>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.key || 'all'}
            className={status === tab.key ? 'tab active' : 'tab'}
            onClick={() => {
              setStatus(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="filter-chips">
          {SCOPES.map((item) => (
            <button
              type="button"
              key={item.key || 'all'}
              className={scope === item.key ? 'chip active' : 'chip'}
              onClick={() => {
                setScope(item.key);
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
            placeholder="搜索需求标题"
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
          <button
            type="button"
            className={starterOnly ? 'chip active' : 'chip'}
            onClick={() => {
              setStarterOnly(!starterOnly);
              setPage(1);
            }}
          >
            只看新手任务
          </button>
          <span className="faint">按标签筛选</span>
        </div>
        <div className="search">
          <input
            className="input"
            placeholder="例如：前端 / 后端 / 文档"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
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
