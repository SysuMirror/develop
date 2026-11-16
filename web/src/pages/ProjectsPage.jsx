import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApi, useDebounced } from '../hooks.js';
import { APPLY_STATUS, ROLE, Badge, Empty, Field, Modal, Pager, Skeleton, StatusBadge, TimeAgo, useToast } from '../ui.jsx';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'mine-leader', label: '我领导的' },
  { key: 'mine-member', label: '我参与的' },
  { key: 'recruiting', label: '招募中' },
];

function statusCell(project) {
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
  const { push } = useToast();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', misc: '' });
  const [submitting, setSubmitting] = useState(false);

  const pageSize = 12;
  const { data, loading, error } = useApi(`/projects${qs({ filter, q, page, pageSize })}`);
  const items = data?.items ?? [];

  async function submitCreate() {
    if (!form.title.trim()) {
      push('请填写项目名称', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post('/projects', { title: form.title.trim(), misc: form.misc.trim() || null });
      push('项目已创建', 'success');
      setCreating(false);
      navigate(`/projects/${created.id}`);
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  let content;
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
                <td>{project.leader ? project.leader.name : <span className="faint">招募中</span>}</td>
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
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
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

      <Modal
        open={creating}
        title="新建项目"
        sub="创建后你将成为该项目的 leader，可以审批成员申请并发布需求。"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={submitCreate}>
              {submitting ? '创建中…' : '创建项目'}
            </button>
          </>
        }
      >
        <Field label="项目名称">
          <input
            className="input"
            value={form.title}
            maxLength={128}
            placeholder="例如：课程项目归档系统"
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="项目说明" hint="一两句话说明目标、技术栈与协作方式。">
          <textarea
            className="textarea"
            value={form.misc}
            placeholder="这个项目要解决什么问题？"
            onChange={(event) => setForm({ ...form, misc: event.target.value })}
          />
        </Field>
      </Modal>
    </div>
  );
}
