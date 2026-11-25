import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, messageOf } from '../api';
import { useApi } from '../hooks';
import { MarkdownEditor } from '../markdown-editor';
import { DEMAND_DIFFICULTY, Field, Skeleton, useToast } from '../ui';
import type { DemandDifficulty, ProjectDetail } from '../types';

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
  const [form, setForm] = useState({
    title: '',
    detail: '',
    acceptance: '',
    labels: '',
    deadline: '',
    difficulty: '',
    estimate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectPath = `/projects/${project.id}`;
  const dirty =
    form.title.trim() !== '' ||
    form.detail.trim() !== '' ||
    form.acceptance.trim() !== '' ||
    form.labels.trim() !== '' ||
    form.deadline !== '' ||
    form.difficulty !== '' ||
    form.estimate !== '';

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
        acceptance: form.acceptance.trim() || null,
        labels: form.labels.split(',').map((item) => item.trim()).filter(Boolean),
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        difficulty: form.difficulty || null,
        estimateHours: form.estimate ? Number(form.estimate) : null,
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

      <DemandTemplatePicker onPick={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />

      <Field label="需求标题" hint={`${form.title.trim().length} / 128`}>
        <input
          className="input"
          value={form.title}
          maxLength={128}
          placeholder="例如：需求列表增加按状态筛选"
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </Field>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Field label="标签" hint="逗号分隔，例如：前端, 文档">
          <input
            className="input"
            value={form.labels}
            placeholder="前端, 后端, 文档"
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

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Field label="难度" hint="新手任务请标 starter，方便新人认领">
          <select
            className="input"
            value={form.difficulty}
            onChange={(event) => setForm({ ...form, difficulty: event.target.value as DemandDifficulty | '' })}
          >
            <option value="">未标注</option>
            {Object.entries(DEMAND_DIFFICULTY).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="预计工时（小时）" hint="1-999，估不准取上限">
          <input
            className="input"
            type="number"
            min={1}
            max={999}
            value={form.estimate}
            onChange={(event) => setForm({ ...form, estimate: event.target.value })}
          />
        </Field>
      </div>

      <div className="faint" style={{ marginBottom: 14 }}>
        所属项目：{project.title}
      </div>

      <MarkdownEditor
        id="demand-new-detail"
        label="需求细节（Markdown）"
        value={form.detail}
        onChange={(detail) => setForm({ ...form, detail })}
        placeholder={'# 背景\n…\n\n# 期望效果\n…'}
        previewEmpty="在左侧写需求细节，这里会实时渲染。"
        onSubmitShortcut={() => void save()}
      />

      <MarkdownEditor
        id="demand-new-acceptance"
        label="验收标准（Markdown）"
        value={form.acceptance}
        onChange={(acceptance) => setForm({ ...form, acceptance })}
        placeholder={'- [ ] 列表能按状态筛选\n- [ ] 刷新后筛选条件保留'}
        previewEmpty="写清楚怎样算完成，提交与验收都以它为准。"
        onSubmitShortcut={() => void save()}
      />
    </div>
  );
}

interface DemandTemplate {
  label: string;
  detail: string;
  acceptance: string;
  labels: string;
}

const DEMAND_TEMPLATES: DemandTemplate[] = [
  {
    label: '功能开发',
    detail: '## 背景\n\n（为什么要做）\n\n## 期望效果\n\n（用户能看到/用到什么）\n\n## 涉及范围\n\n- 页面：\n- 接口：',
    acceptance: '- [ ] 功能可用，路径：\n- [ ] 有基础错误处理\n- [ ] 不破坏现有功能',
    labels: '前端, 后端',
  },
  {
    label: '缺陷修复',
    detail: '## 复现步骤\n\n1. \n2. \n\n## 实际表现\n\n\n## 期望表现\n\n',
    acceptance: '- [ ] 按复现步骤不再出现\n- [ ] 补充回归用例或说明',
    labels: '缺陷',
  },
  {
    label: '文档 / 整理',
    detail: '## 范围\n\n\n## 交付物\n\n- [ ] 文档路径：',
    acceptance: '- [ ] 内容准确、可执行\n- [ ] 链接可用',
    labels: '文档',
  },
];

function DemandTemplatePicker({ onPick }: { onPick: (patch: Partial<DemandTemplate>) => void }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="faint">从模板开始：</span>
        {DEMAND_TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              onPick({ detail: template.detail, acceptance: template.acceptance, labels: template.labels })
            }
          >
            {template.label}
          </button>
        ))}
        <span className="faint">会覆盖细节、验收标准与标签</span>
      </div>
    </div>
  );
}
