import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, messageOf } from '../api';
import { useApi } from '../hooks';
import { MarkdownEditor } from '../markdown-editor';
import { Field, PROJECT_DIFFICULTY, PROJECT_STATUS, Skeleton, useToast } from '../ui';
import type { ProjectDetail, ProjectDifficulty, ProjectStatus } from '../types';

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
  const [form, setForm] = useState({
    title: '',
    misc: '',
    repoUrls: [''],
    devNotes: '',
    status: 'active' as ProjectStatus,
    difficulty: 'standard' as ProjectDifficulty,
    techText: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    form.title.trim() !== '' ||
    form.misc.trim() !== '' ||
    form.repoUrls.some((url) => url.trim() !== '') ||
    form.devNotes.trim() !== '' ||
    form.techText.trim() !== '';

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
      const created = await api.post<{ id: number }>('/projects', {
        title,
        misc: form.misc.trim() || null,
        repoUrls: form.repoUrls.map((url) => url.trim()).filter(Boolean),
        devNotes: form.devNotes.trim() || null,
        status: form.status,
        difficulty: form.difficulty,
        techStack: form.techText.split(',').map((item) => item.trim()).filter(Boolean),
      });
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
          <p className="page-sub">创建后你将成为该项目的所有者，可以审批成员申请并发布需求。</p>
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

      <ProjectTemplatePicker onPick={(template) => setForm((prev) => ({ ...prev, ...template }))} />

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
          只有项目所有者或管理员可以编辑项目。
        </div>
      </div>
    );
  }

  return <ProjectEditFields project={data} />;
}

function ProjectEditFields({ project }: { project: ProjectDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    title: project.title,
    misc: project.misc ?? '',
    repoUrls: project.repoUrls.length > 0 ? project.repoUrls : [''],
    devNotes: project.devNotes ?? '',
    status: project.status,
    difficulty: project.difficulty,
    techText: project.techStack.join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailPath = `/projects/${project.id}`;
  const cleanUrls = (list: string[]) => JSON.stringify(list.map((url) => url.trim()).filter(Boolean));
  const cleanTech = (text: string) => JSON.stringify(text.split(',').map((item) => item.trim()).filter(Boolean));
  const dirty =
    form.title !== project.title ||
    form.misc !== (project.misc ?? '') ||
    cleanUrls(form.repoUrls) !== cleanUrls(project.repoUrls) ||
    form.devNotes !== (project.devNotes ?? '') ||
    form.status !== project.status ||
    form.difficulty !== project.difficulty ||
    cleanTech(form.techText) !== cleanTech(project.techStack.join(','));

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
      await api.patch(`/projects/${project.id}`, {
        title,
        misc: form.misc.trim() || null,
        repoUrls: form.repoUrls.map((url) => url.trim()).filter(Boolean),
        devNotes: form.devNotes.trim() || null,
        status: form.status,
        difficulty: form.difficulty,
        techStack: form.techText.split(',').map((item) => item.trim()).filter(Boolean),
      });
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
          <p className="page-sub">改动会立即体现在项目页；说明与仓库对所有开发者可见，开发说明仅成员可见。</p>
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

interface ProjectFormState {
  title: string;
  misc: string;
  repoUrls: string[];
  devNotes: string;
  status: ProjectStatus;
  difficulty: ProjectDifficulty;
  techText: string;
}

interface ProjectFieldsProps {
  form: ProjectFormState;
  onChange: (form: ProjectFormState) => void;
  onSubmitShortcut: () => void;
}

function ProjectFields({ form, onChange, onSubmitShortcut }: ProjectFieldsProps) {
  return (
    <>
      <div className="form-section">
        <h3>基本信息</h3>
        <Field label="项目名称" hint={`${form.title.trim().length} 字`}>
          <input
            className="input"
            value={form.title}
            maxLength={128}
            placeholder="例如：课程项目归档系统"
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </Field>

        <div className="form-row-3">
          <Field label="项目状态" hint="招募中会出现在「招募中」筛选里">
            <select
              className="input"
              value={form.status}
              onChange={(event) => onChange({ ...form, status: event.target.value as ProjectStatus })}
            >
              {Object.entries(PROJECT_STATUS).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="难度" hint="入门友好的项目更容易被新人认领">
            <select
              className="input"
              value={form.difficulty}
              onChange={(event) => onChange({ ...form, difficulty: event.target.value as ProjectDifficulty })}
            >
              {Object.entries(PROJECT_DIFFICULTY).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="技术栈" hint="逗号分隔，例如 React, TypeScript">
            <input
              className="input"
              value={form.techText}
              placeholder="React, Node.js, MySQL"
              onChange={(event) => onChange({ ...form, techText: event.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="form-section">
        <h3>对外展示</h3>
        <MarkdownEditor
          id="project-misc"
          label="项目说明（Markdown）"
          value={form.misc}
          onChange={(misc) => onChange({ ...form, misc })}
          placeholder={'这个项目要解决什么问题？技术栈与协作方式是什么？'}
          previewEmpty="在左侧写项目说明，这里会实时渲染。"
          hint="对外可见；项目卡片会显示这段说明的摘要，Ctrl / ⌘ + Enter 保存。"
          onSubmitShortcut={onSubmitShortcut}
          compact
        />

        <Field label="仓库地址（可多个，对外可见）" hint="http(s) 链接；留空则不展示，最多 10 个">
          <div className="stack" style={{ gap: 8 }}>
            {form.repoUrls.map((url, index) => (
              <div className="row" key={index} style={{ gap: 8 }}>
                <input
                  className="input grow"
                  type="url"
                  value={url}
                  maxLength={512}
                  placeholder="https://github.com/owner/repo"
                  onChange={(event) => {
                    const next = [...form.repoUrls];
                    next[index] = event.target.value;
                    onChange({ ...form, repoUrls: next });
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={form.repoUrls.length <= 1}
                  onClick={() => onChange({ ...form, repoUrls: form.repoUrls.filter((_, i) => i !== index) })}
                >
                  移除
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={form.repoUrls.length >= 10}
                onClick={() => onChange({ ...form, repoUrls: [...form.repoUrls, ''] })}
              >
                添加仓库
              </button>
            </div>
          </div>
        </Field>
      </div>

      <div className="form-section">
        <h3>开发资源（仅项目成员）</h3>
        <MarkdownEditor
          id="project-dev-notes"
          label="开发说明（Markdown）"
          value={form.devNotes}
          onChange={(devNotes) => onChange({ ...form, devNotes })}
          placeholder={'本地怎么跑？环境变量、分支约定、发布流程、注意事项……'}
          previewEmpty="这里写只给成员看的开发说明，非成员看不到。"
          hint="对内可见：只有项目成员（含所有者/管理员）能看；附件在项目页的「开发说明」里上传。"
          onSubmitShortcut={onSubmitShortcut}
          compact
        />
      </div>
    </>
  );
}

interface ProjectTemplate {
  label: string;
  hint: string;
  patch: Partial<{
    misc: string;
    devNotes: string;
    techText: string;
    status: ProjectStatus;
    difficulty: ProjectDifficulty;
  }>;
}

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    label: 'Web 应用',
    hint: '有页面、有接口的前端项目',
    patch: {
      misc: '## 要解决什么问题\n\n（一句话说明用户是谁、痛点是什么）\n\n## 技术栈\n\n- 前端：React + Vite + TypeScript\n- 后端：Node.js / 其他\n\n## 协作方式\n\n- 分支：main 保护，功能走 PR\n- 评审：至少一位成员通过',
      devNotes: '## 本地启动\n\n```bash\nnpm install\nnpm run dev\n```\n\n## 约定\n\n- 环境变量放 `.env.local`，不进仓库\n- 提交前跑 lint 与 typecheck',
      techText: 'React, TypeScript, Vite',
      status: 'recruiting',
      difficulty: 'starter',
    },
  },
  {
    label: '后端服务',
    hint: '接口、任务、数据处理',
    patch: {
      misc: '## 服务职责\n\n（对外提供什么能力）\n\n## 接口约定\n\n- 鉴权方式：\n- 错误码：\n\n## 部署\n\n- 测试环境：\n- 生产发布：需要 owner 审批',
      devNotes: '## 本地环境\n\n- 数据库：\n- 依赖服务：\n\n## 运行\n\n```bash\nnpm install\nnpm run dev\n```',
      techText: 'Node.js, MySQL',
      status: 'recruiting',
      difficulty: 'standard',
    },
  },
  {
    label: '算法 / 数据',
    hint: '模型、脚本、离线任务',
    patch: {
      misc: '## 目标\n\n（要回答的问题或要产出的结果）\n\n## 数据来源\n\n- \n\n## 验收\n\n- 指标：\n- 交付物：代码 + 说明文档',
      devNotes: '## 环境\n\n- Python 版本：\n- 依赖：requirements.txt\n\n## 目录约定\n\n- `data/` 只放样例，大数据走对象存储\n- `notebooks/` 用于探索，正式逻辑进 `src/`',
      techText: 'Python, Pandas',
      status: 'recruiting',
      difficulty: 'standard',
    },
  },
  {
    label: '课程 / 工具',
    hint: '小工具、课程项目、一次性脚本',
    patch: {
      misc: '## 背景\n\n（课程要求或个人想法）\n\n## 交付\n\n- 可运行的代码\n- 使用说明',
      devNotes: '## 运行方式\n\n```bash\n# 写清楚怎么跑起来\n```\n\n## 注意事项\n\n- ',
      techText: 'TypeScript',
      status: 'active',
      difficulty: 'starter',
    },
  },
];

function ProjectTemplatePicker({ onPick }: { onPick: (patch: ProjectTemplate['patch']) => void }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="faint">从模板开始：</span>
        {PROJECT_TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            className="btn btn-secondary btn-sm"
            title={template.hint}
            onClick={() => onPick(template.patch)}
          >
            {template.label}
          </button>
        ))}
        <span className="faint">会覆盖说明、开发说明与技术栈</span>
      </div>
    </div>
  );
}
