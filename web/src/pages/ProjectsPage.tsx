import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { qs } from '../api';
import { useApi, useDebounced } from '../hooks';
import {
  FilterBar,
  FilterField,
  FilterToggle,
  MobileFilters,
  SearchField,
  Segmented,
  SelectField,
  useMediaQuery,
} from '../filters';
import { PROJECT_DIFFICULTY, PROJECT_STATUS, Pager, ROLE, StatusBadge, TimeAgo, displayName } from '../ui';
import type { Option } from '../filters';
import type { Paged, ProjectDifficulty, ProjectStatus, ProjectSummary } from '../types';

const SCOPES: Option[] = [
  { value: 'all', label: '全部' },
  { value: 'mine-owner', label: '我负责的' },
  { value: 'mine-member', label: '我参与的' },
  { value: 'recruiting', label: '招募中' },
];

const STATUS_OPTIONS: Option[] = [
  { value: '', label: '全部状态' },
  ...(Object.entries(PROJECT_STATUS) as [ProjectStatus, { label: string }][]).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
];

const DIFFICULTY_OPTIONS: Option[] = [
  { value: '', label: '全部难度' },
  ...(Object.entries(PROJECT_DIFFICULTY) as [ProjectDifficulty, { label: string }][]).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
];

/** 把 Markdown 说明压成纯文本摘要，让列表自带上下文。 */
function excerptOf(text: string | null): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export default function ProjectsPage() {
  // 概览页会带着 ?filter= / ?status= 跳过来，首屏要按链接里的条件渲染；
  // 之后改筛选再把条件写回地址栏，刷新和分享都能还原。
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState(() => params.get('filter') || 'all');
  const [status, setStatus] = useState(() => params.get('status') || '');
  const [difficulty, setDifficulty] = useState(() => params.get('difficulty') || '');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState(false);
  const q = useDebounced(term);
  const narrow = useMediaQuery('(max-width: 720px)');
  const navigate = useNavigate();

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    const entries: [string, string][] = [
      ['filter', scope === 'all' ? '' : scope],
      ['status', status],
      ['difficulty', difficulty],
    ];
    for (const [key, value] of entries) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (next.toString() !== window.location.search.replace(/^\?/, '')) {
      setParams(next, { replace: true });
    }
  }, [scope, status, difficulty, setParams]);

  const pageSize = 12;
  const { data, loading, error } = useApi<Paged<ProjectSummary>>(
    `/projects${qs({ filter: scope, status, difficulty, q, page, pageSize })}`,
  );
  const items = data?.items ?? [];
  const extraFilters = (status ? 1 : 0) + (difficulty ? 1 : 0);

  function resetExtra() {
    setStatus('');
    setDifficulty('');
    setPage(1);
  }

  const statusSelect = (
    <SelectField
      label="按状态筛选"
      value={status}
      options={STATUS_OPTIONS}
      onChange={(value) => {
        setStatus(value);
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
    content = (
      <div className="project-list">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="project-row project-row--skeleton" key={index}>
            <div className="skeleton-row" />
          </div>
        ))}
      </div>
    );
  } else if (error) {
    content = <div className="notice notice-error">{error.message}</div>;
  } else if (items.length === 0) {
    content = (
      <div className="empty">
        <strong>{term ? '没有匹配的项目' : '这里还没有项目'}</strong>
        {term ? '换个关键词，或清空筛选再看。' : '第一个项目可以从你的想法开始。'}
      </div>
    );
  } else {
    content = (
      <ul className="project-list">
        {items.map((project) => {
          const desc = excerptOf(project.misc);
          const href = `/projects/${project.id}`;
          return (
            <li className="project-row" key={project.id}>
              <div className="project-row__body">
                <div className="project-row__head">
                  <Link className="project-row__title stretched" to={href}>
                    {project.title}
                  </Link>
                  <StatusBadge map={PROJECT_STATUS} value={project.status} />
                  {project.myRole ? <StatusBadge map={ROLE} value={project.myRole} /> : null}
                  <span className="tag">{PROJECT_DIFFICULTY[project.difficulty].label}</span>
                </div>
                <p className="project-row__desc">{desc || '这个项目还没有写说明。'}</p>
                <div className="project-row__foot">
                  {project.techStack.length > 0 ? (
                    <span className="project-row__tech">
                      {project.techStack.slice(0, 5).map((tech) => (
                        <span className="tag" key={tech}>
                          {tech}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="project-row__meta">
                    <span>{displayName(project.owner)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{project.memberCount} 人</span>
                    {project.waitingDemandCount > 0 ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="project-row__hot">{project.waitingDemandCount} 个需求待接</span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <TimeAgo value={project.updatedAt} />
                  </span>
                </div>
              </div>

              <div className="project-row__action">
                {!project.myRole && project.myApplyStatus === 'waiting' ? (
                  <span className="faint">申请审核中</span>
                ) : !project.myRole ? (
                  <Link className="btn btn-secondary btn-sm" to={`${href}/apply`}>
                    申请加入
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">项目</h1>
          <p className="page-sub">每个项目有所有者、管理员与成员；所有者与管理员审批加入申请、邀请成员、发布需求。</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/projects/new')}>
            新建项目
          </button>
        </div>
      </div>

      {narrow ? (
        <>
          <div className="filterbar filterbar--narrow">
            <SearchField
              value={term}
              label="搜索项目"
              placeholder="搜索项目、说明或技术栈"
              onChange={(value) => {
                setTerm(value);
                setPage(1);
              }}
            />
            <FilterToggle count={extraFilters} onClick={() => setSheet(true)} />
          </div>
          <div className="scroller">
            <Segmented
              label="项目范围"
              value={scope}
              options={SCOPES}
              onChange={(value) => {
                setScope(value);
                setPage(1);
              }}
            />
          </div>
          <MobileFilters open={sheet} onClose={() => setSheet(false)} onReset={resetExtra} activeCount={extraFilters}>
            <FilterField label="状态">{statusSelect}</FilterField>
            <FilterField label="难度">{difficultySelect}</FilterField>
          </MobileFilters>
        </>
      ) : (
        <FilterBar summary={data ? `共 ${data.total} 个项目` : null}>
          <Segmented
            label="项目范围"
            value={scope}
            options={SCOPES}
            onChange={(value) => {
              setScope(value);
              setPage(1);
            }}
          />
          <span className="filterbar__spacer" />
          {statusSelect}
          {difficultySelect}
          <SearchField
            value={term}
            label="搜索项目"
            placeholder="搜索项目、说明或技术栈"
            onChange={(value) => {
              setTerm(value);
              setPage(1);
            }}
          />
        </FilterBar>
      )}

      {content}
      <Pager
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? pageSize}
        total={data?.total ?? 0}
        onPage={setPage}
      />
    </div>
  );
}
