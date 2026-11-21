import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, messageOf } from '../api';
import { useApi } from '../hooks';
import { MarkdownEditor } from '../markdown-editor';
import { Field, Skeleton, useToast } from '../ui';
import type { ProjectDetail } from '../types';

/**
 * 新建与编辑项目共用一个页面组件：没有 :id 是新建，有 :id 是编辑。
 * 两者字段完全一致，只有标题、提交方法与权限判断不同。
 */
export default function ProjectFormPage() {
  const { id } = useParams();
  if (id === undefined) return <ProjectCreateForm />;
  return <ProjectEditForm id={id} />;
}

function ProjectCreateForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ title: '', misc: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = form.title.trim() !== '' || form.misc.trim() !== '';

  function leave() {
    if (dirty && !window.confirm('放弃尚未创建的项目？')) return;
    navigate('/projects');
  }

  async function save() {
    const title = form.title.trim();
    if (!title || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<{ id: number }>('/projects', { title, misc: form.misc.trim() || null });
      toast.push('项目已创建。', 'success');
      navigate(`/projects/${created.id}`);
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-link" onClick={leave}>
        ← 项目列表
      </button>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1 className="page-title">新建项目</h1>
          <p className="page-sub">创建后你将成为该项目的 leader，可以审批成员申请并发布需求。</p>
        </div>
        <div className="row page-actions">
          <button type="button" className="btn btn-ghost" onClick={leave} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !form.title.trim()}
          >
            {saving ? '创建中…' : '创建项目'}
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <ProjectFields form={form} onChange={setForm} onSubmitShortcut={() => void save()} />
    </div>
  );
}

function ProjectEditForm({ id }: { id: string }) {
  const { data, loading, error } = useApi<ProjectDetail>(`/projects/${id}`);

  if (loading) {
    return (
      <div>
        <Skeleton rows={5} />
      </div>
    );
  }

  if (error || !data) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <Link className="btn-link" to={`/projects/${id}`}>
          ← 返回项目
        </Link>
        <div className={`notice ${missing ? 'notice-info' : 'notice-error'}`} style={{ marginTop: 12 }}>
          {missing ? '项目不存在或已被删除。' : messageOf(error)}
        </div>
      </div>
    );
  }

  if (!data.permissions.canManage) {
    return (
      <div>
        <Link className="btn-link" to={`/projects/${data.id}`}>
          ← 返回项目
        </Link>
        <div className="notice notice-info" style={{ marginTop: 12 }}>
          只有项目 leader 可以编辑项目。
        </div>
      </div>
    );
  }

  return <ProjectEditFields project={data} />;
}

function ProjectEditFields({ project }: { project: ProjectDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ title: project.title, misc: project.misc ?? '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailPath = `/projects/${project.id}`;
  const dirty = form.title !== project.title || form.misc !== (project.misc ?? '');

  function leave() {
    if (dirty && !window.confirm('放弃未保存的修改？')) return;
    navigate(detailPath);
  }

  async function save() {
    const title = form.title.trim();
    if (!title || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/projects/${project.id}`, { title, misc: form.misc.trim() || null });
      toast.push('项目已保存。', 'success');
      navigate(detailPath);
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-link" onClick={leave}>
        ← 返回项目
      </button>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1 className="page-title">编辑项目</h1>
          <p className="page-sub">左侧写 Markdown，右侧实时预览；列表里只显示纯文本摘要。</p>
        </div>
        <div className="row page-actions">
          <button type="button" className="btn btn-ghost" onClick={leave} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !form.title.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <ProjectFields form={form} onChange={setForm} onSubmitShortcut={() => void save()} />
    </div>
  );
}

interface ProjectFieldsProps {
  form: { title: string; misc: string };
  onChange: (form: { title: string; misc: string }) => void;
  onSubmitShortcut: () => void;
}

function ProjectFields({ form, onChange, onSubmitShortcut }: ProjectFieldsProps) {
  return (
    <>
      <Field label="项目名称" hint={`${form.title.trim().length} 字`}>
        <input
          className="input"
          value={form.title}
          maxLength={128}
          placeholder="例如：课程项目归档系统"
          onChange={(event) => onChange({ ...form, title: event.target.value })}
        />
      </Field>

      <MarkdownEditor
        id="project-misc"
        label="项目说明（Markdown）"
        value={form.misc}
        onChange={(misc) => onChange({ ...form, misc })}
        placeholder={'这个项目要解决什么问题？技术栈与协作方式是什么？'}
        previewEmpty="在左侧写项目说明，这里会实时渲染。"
        hint="支持 Markdown；列表里只显示纯文本摘要，Ctrl / ⌘ + Enter 保存。"
        onSubmitShortcut={onSubmitShortcut}
      />
    </>
  );
}
