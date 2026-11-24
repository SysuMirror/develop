import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, messageOf } from '../api';
import { useApi } from '../hooks';
import { Field, Skeleton, useToast } from '../ui';
import type { ProjectDetail } from '../types';

export default function ApplyPage() {
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

  if (!data.permissions.canApply) {
    return (
      <div>
        <Link className="btn-link" to={`/projects/${data.id}`}>
          ← 返回项目
        </Link>
        <div className="notice notice-info" style={{ marginTop: 12 }}>
          {data.permissions.isMember ? '你已经是这个项目的成员了。' : '当前状态下该项目不接受申请。'}
        </div>
      </div>
    );
  }

  return <ApplyForm project={data} />;
}

function ApplyForm({ project }: { project: ProjectDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectPath = `/projects/${project.id}`;

  function leave() {
    if (note.trim() && !window.confirm('放弃这条还没提交的申请？')) return;
    navigate(projectPath);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/projects/${project.id}/applies`, { note: note.trim() || null });
      toast.push('申请已提交。', 'success');
      navigate(projectPath);
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
          <h1 className="page-title">申请加入</h1>
          <p className="page-sub">项目所有者或管理员会在项目页看到你的申请并做出决定；一条申请等待审批时不能重复提交。</p>
        </div>
        <div className="row page-actions">
          <button type="button" className="btn btn-ghost" onClick={leave} disabled={saving}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? '提交中…' : '提交申请'}
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className="faint" style={{ marginBottom: 14 }}>
        申请项目：{project.title}
      </div>

      <Field label="留言" hint="写点你能承担的部分，审批会更快；可以留空。">
        <textarea
          className="textarea textarea--md"
          value={note}
          placeholder="例如：我做过 React 表格与表单，可以先接手需求列表的筛选。"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
          }}
        />
      </Field>
    </div>
  );
}
