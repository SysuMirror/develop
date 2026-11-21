import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, messageOf } from '../api';
import { useApi } from '../hooks';
import { MarkdownEditor } from '../markdown-editor';
import { Field, Skeleton, useToast } from '../ui';
import type { ProjectDetail } from '../types';

export default function DemandNewPage() {
  const { id } = useParams();
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

  if (!data.permissions.isMember) {
    return (
      <div>
        <Link className="btn-link" to={`/projects/${data.id}`}>
          ← 返回项目
        </Link>
        <div className="notice notice-info" style={{ marginTop: 12 }}>
          只有项目成员可以发布需求；先提交申请并通过审批。
        </div>
      </div>
    );
  }

  return <DemandNewForm project={data} />;
}

function DemandNewForm({ project }: { project: ProjectDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ title: '', detail: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectPath = `/projects/${project.id}`;
  const dirty = form.title.trim() !== '' || form.detail.trim() !== '';

  function leave() {
    if (dirty && !window.confirm('放弃尚未发布的需求？')) return;
    navigate(projectPath);
  }

  async function save() {
    const title = form.title.trim();
    if (!title || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<{ id: number }>(`/projects/${project.id}/demands`, {
        title,
        detail: form.detail.trim() || null,
      });
      toast.push('需求已发布。', 'success');
      navigate(`/demands/${created.id}`);
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-link" onClick={leave}>
        ← {project.title}
      </button>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1 className="page-title">发布需求</h1>
          <p className="page-sub">需求对平台上的所有用户开放，接单后即可开始；同项目内标题不能重复。</p>
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
            {saving ? '发布中…' : '发布需求'}
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <Field label="需求标题" hint={`${form.title.trim().length} / 128`}>
        <input
          className="input"
          value={form.title}
          maxLength={128}
          placeholder="例如：需求列表增加按状态筛选"
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </Field>

      <div className="faint" style={{ marginBottom: 14 }}>
        所属项目：{project.title}
      </div>

      <MarkdownEditor
        id="demand-new-detail"
        label="需求细节（Markdown）"
        value={form.detail}
        onChange={(detail) => setForm({ ...form, detail })}
        placeholder={'# 背景\n…\n\n# 验收标准\n…'}
        previewEmpty="在左侧写需求细节，这里会实时渲染。"
        onSubmitShortcut={() => void save()}
      />
    </div>
  );
}
