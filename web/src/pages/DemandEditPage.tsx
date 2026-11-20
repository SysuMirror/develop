import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, messageOf } from '../api';
import { useApi } from '../hooks';
import { MarkdownText } from '../markdown';
import { Field, Skeleton, useToast } from '../ui';
import type { DemandItem } from '../types';

export default function DemandEditPage() {
  const { id } = useParams();
  const { data, loading, error } = useApi<DemandItem>(`/demands/${id}`);

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
        <Link className="btn-link" to={`/demands/${id}`}>
          ← 返回需求
        </Link>
        <div className={`notice ${missing ? 'notice-info' : 'notice-error'}`} style={{ marginTop: 12 }}>
          {missing ? '需求不存在或已被删除。' : messageOf(error)}
        </div>
      </div>
    );
  }

  if (!data.permissions.canEdit) {
    return (
      <div>
        <Link className="btn-link" to={`/demands/${data.id}`}>
          ← 返回需求
        </Link>
        <div className="notice notice-info" style={{ marginTop: 12 }}>
          只有发布者可以在开始验收前编辑需求；当前状态下需求已锁定。
        </div>
      </div>
    );
  }

  // 数据到位后再挂表单，标题与正文的初始值直接取接口返回值，不需要额外同步。
  return <DemandEditForm demand={data} />;
}

function DemandEditForm({ demand }: { demand: DemandItem }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ title: demand.title, detail: demand.detail ?? '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailPath = `/demands/${demand.id}`;
  const dirty = form.title !== demand.title || form.detail !== (demand.detail ?? '');

  function back() {
    navigate(detailPath);
  }

  function leave() {
    if (dirty && !window.confirm('放弃未保存的修改？')) return;
    back();
  }

  async function save() {
    const title = form.title.trim();
    if (!title || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/demands/${demand.id}`, { title, detail: form.detail });
      toast.push('需求已保存。', 'success');
      back();
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-link" onClick={leave}>
        ← 返回需求
      </button>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1 className="page-title">编辑需求</h1>
          <p className="page-sub">左侧写 Markdown，右侧实时预览；开始验收之后需求会锁定，不能再改。</p>
        </div>
        <div className="row">
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

      <Field label="标题" hint={`${form.title.trim().length} 字`}>
        <input
          className="input"
          value={form.title}
          maxLength={200}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </Field>

      <div className="faint" style={{ marginBottom: 14 }}>
        所属项目：{demand.project.title}
      </div>

      <div className="editor">
        <div className="editor__pane">
          <label className="editor__label" htmlFor="demand-detail">
            内容（Markdown）
          </label>
          <textarea
            id="demand-detail"
            className="textarea editor__textarea"
            value={form.detail}
            spellCheck={false}
            onChange={(event) => setForm({ ...form, detail: event.target.value })}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
            placeholder={'# 背景\n…\n\n# 验收标准\n…'}
          />
          <p className="faint">Ctrl / ⌘ + Enter 保存；正文支持 Markdown（代码块、表格、链接）。</p>
        </div>
        <div className="editor__pane">
          <span className="editor__label">预览</span>
          <div className="panel editor__preview">
            <MarkdownText source={form.detail} empty="在左侧写点什么，这里会实时渲染。" />
          </div>
        </div>
      </div>
    </div>
  );
}
