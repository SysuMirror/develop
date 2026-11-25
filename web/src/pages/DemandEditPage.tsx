import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, messageOf } from '../api';
import { useApi } from '../hooks';
import { MarkdownEditor } from '../markdown-editor';
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

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function DemandEditForm({ demand }: { demand: DemandItem }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    title: demand.title,
    detail: demand.detail ?? '',
    acceptance: demand.acceptance ?? '',
    labels: demand.labels.join(', '),
    deadline: toLocalInput(demand.deadline),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailPath = `/demands/${demand.id}`;
  const dirty =
    form.title !== demand.title ||
    form.detail !== (demand.detail ?? '') ||
    form.acceptance !== (demand.acceptance ?? '') ||
    form.labels !== demand.labels.join(', ') ||
    form.deadline !== toLocalInput(demand.deadline);

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
      await api.patch(`/demands/${demand.id}`, {
        title,
        detail: form.detail,
        acceptance: form.acceptance.trim() || null,
        labels: form.labels.split(',').map((item) => item.trim()).filter(Boolean),
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
      });
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

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Field label="标签" hint="逗号分隔">
          <input
            className="input"
            value={form.labels}
            placeholder="前端, 文档"
            onChange={(event) => setForm({ ...form, labels: event.target.value })}
          />
        </Field>
        <Field label="期望完成时间" hint="留空表示不限期">
          <input
            className="input"
            type="datetime-local"
            value={form.deadline}
            onChange={(event) => setForm({ ...form, deadline: event.target.value })}
          />
        </Field>
      </div>

      <MarkdownEditor
        id="demand-detail"
        value={form.detail}
        onChange={(detail) => setForm({ ...form, detail })}
        placeholder={'# 背景\n…\n\n# 期望效果\n…'}
        onSubmitShortcut={() => void save()}
      />

      <MarkdownEditor
        id="demand-acceptance"
        label="验收标准（Markdown）"
        value={form.acceptance}
        onChange={(acceptance) => setForm({ ...form, acceptance })}
        placeholder={'- [ ] 验收项一\n- [ ] 验收项二'}
        previewEmpty="写清楚怎样算完成。"
        onSubmitShortcut={() => void save()}
      />
    </div>
  );
}
