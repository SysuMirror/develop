import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { formatTime, qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import {
  FilterBar,
  FilterField,
  FilterToggle,
  MobileFilters,
  SearchField,
  SelectField,
  useMediaQuery,
} from '../filters';
import { DEMAND_DIFFICULTY, DEMAND_STATUS, Empty, Pager, Skeleton, StatusBadge, TimeAgo, displayName } from '../ui';
import type { Option } from '../filters';
import type { DemandDifficulty, DemandItem, Paged } from '../types';

const TABS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'waiting', label: '待接单' },
  { value: 'accepted', label: '进行中' },
  { value: 'review', label: '待确认' },
  { value: 'completed', label: '已完成' },
  { value: 'suspended', label: '挂起' },
];

const SCOPE_OPTIONS: Option[] = [
  { value: '', label: '全部需求' },
  { value: 'created', label: '我发布的' },
  { value: 'assigned', label: '我接的' },
];

const DIFFICULTY_OPTIONS: Option[] = [
  { value: '', label: '全部难度' },
  ...(Object.entries(DEMAND_DIFFICULTY) as [DemandDifficulty, { label: string }][]).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
];

/** 难度、标签与工时：同一条灰色的次要信息，跟在标题下面。 */
function Marks({ demand }: { demand: DemandItem }) {
  if (!demand.difficulty && !demand.estimateHours && demand.labels.length === 0) return null;
  return (
    <div className="cell-marks">
      {demand.difficulty ? <StatusBadge map={DEMAND_DIFFICULTY} value={demand.difficulty} /> : null}
      {demand.estimateHours ? <span className="tag">{demand.estimateHours} 小时</span> : null}
      {demand.labels.map((label) => (
        <span className="tag" key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

export default function DemandsPage() {
  // 概览页的「进行中的需求」「新手任务」都带查询参数跳过来，首屏按参数渲染。
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(() => params.get('status') || '');
  const [scope, setScope] = useState(() => params.get('scope') || '');
  const [difficulty, setDifficulty] = useState(() => params.get('difficulty') || '');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of [
      ['status', status],
      ['scope', scope],
      ['difficulty', difficulty],
    ] as const) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (next.toString() !== window.location.search.replace(/^\?/, '')) {
      setParams(next, { replace: true });
    }
  }, [status, scope, difficulty, setParams]);

  const q = useDebounced(term);
  const narrow = useMediaQuery('(max-width: 720px)');
  const pageSize = 15;
  const { data, loading, error } = useApi<Paged<DemandItem>>(
    `/demands${qs({ status, scope, difficulty, q, page, pageSize })}`,
  );
  const items = data?.items ?? [];
  const extraFilters = (scope ? 1 : 0) + (difficulty ? 1 : 0);
  const activeTab = TABS.find((tab) => tab.value === status)?.label ?? '全部';

  const scopeSelect = (
    <SelectField
      label="需求范围"
      value={scope}
      options={SCOPE_OPTIONS}
      onChange={(value) => {
        setScope(value);
        setPage(1);
      }}
    />
  );
  const difficultySelect = (
    <SelectField
      label="按难度筛选"
      value={difficulty}
      options={DIFFICULTY_OPTIONS}
      onChange={(value) => {
        setDifficulty(value);
        setPage(1);
      }}
    />
  );

  let content: ReactNode;
  if (loading) {
    content = <Skeleton rows={5} />;
  } else if (error) {
    content = <div className="notice notice-error">{error.message}</div>;
  } else if (items.length === 0) {
    content = <Empty title="没有匹配的需求" hint="需求由项目成员发布，换个状态或关键词看看。" />;
  } else {
    content = (
      <>
        <div className="table-wrap only-desktop">
          <table className="table table--demands">
            <thead>
              <tr>
                <th>需求</th>
                <th>项目</th>
                <th className="only-wide">发布者</th>
                <th>接单人</th>
                <th>截止</th>
                <th className="right">状态</th>
              </tr>
            </thead>
            <tbody>
              {items.map((demand) => (
                <tr key={demand.id}>
                  <td className="cell-main">
                    <Link className="cell-title" to={`/demands/${demand.id}`}>
                      {demand.title}
                    </Link>
                    <Marks demand={demand} />
                  </td>
                  <td>
                    <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
                  </td>
                  <td className="only-wide">{displayName(demand.creator)}</td>
                  <td className="nowrap">{demand.assignee ? displayName(demand.assignee) : <span className="faint">未认领</span>}</td>
                  <td className="nowrap">
                    {demand.deadline ? <span className="faint">{formatTime(demand.deadline)}</span> : <span className="faint">—</span>}
                  </td>
                  <td className="right">
                    <StatusBadge map={DEMAND_STATUS} value={demand.status} />
                    <div className="faint nowrap">
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
                <Marks demand={demand} />
                <div className="list-card__meta">
                  <span>{demand.project.title}</span>
                  <span>{demand.assignee ? `接单 ${displayName(demand.assignee)}` : '待认领'}</span>
                  {demand.deadline ? <span>截止 {formatTime(demand.deadline)}</span> : null}
                  <TimeAgo value={demand.createdAt} />
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
          <p className="page-sub">各项目公开的任务。挑一个能上手的接下来，交付后由发布者验收。</p>
        </div>
      </div>

      <div className="tabs" aria-label="按状态查看需求">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.value || 'all'}
            className={status === tab.value ? 'tab active' : 'tab'}
            aria-pressed={status === tab.value}
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {narrow ? (
        <>
          <div className="filterbar filterbar--narrow">
            <SearchField
              value={term}
              label="搜索需求"
              placeholder="搜索需求、详情或标签"
              onChange={(value) => {
                setTerm(value);
                setPage(1);
              }}
            />
            <FilterToggle count={extraFilters} onClick={() => setSheet(true)} />
          </div>
          <MobileFilters
            open={sheet}
            onClose={() => setSheet(false)}
            onReset={() => {
              setScope('');
              setDifficulty('');
              setPage(1);
            }}
            activeCount={extraFilters}
          >
            <FilterField label="范围">{scopeSelect}</FilterField>
            <FilterField label="难度">{difficultySelect}</FilterField>
          </MobileFilters>
        </>
      ) : (
        <FilterBar
          summary={
            data ? `${activeTab === '全部' ? '全部' : activeTab} · 共 ${data.total} 条` : null
          }
        >
          {scopeSelect}
          {difficultySelect}
          <span className="filterbar__spacer" />
          <SearchField
            value={term}
            label="搜索需求"
            placeholder="搜索需求、详情或标签"
            onChange={(value) => {
              setTerm(value);
              setPage(1);
            }}
          />
        </FilterBar>
      )}

      {content}
      <Pager page={data?.page ?? page} pageSize={data?.pageSize ?? pageSize} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
