import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, messageOf } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import {
  APPLY_TYPE,
  DEMAND_STATUS,
  ROLE,
  Avatar,
  Badge,
  Empty,
  Field,
  Modal,
  Skeleton,
  StatusBadge,
  TimeAgo,
  displayName,
  useToast,
} from '../ui';
import type { ApplyItem, ProjectDetail } from '../types';

type DialogKind = 'apply' | 'edit' | 'demand' | 'quit' | 'delete' | 'kick';

interface DialogState {
  kind: DialogKind;
  userId?: string;
  name?: string;
}

interface EditForm {
  title: string;
  misc: string;
}

interface DemandForm {
  title: string;
  detail: string | null;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { push } = useToast();
  const project = useApi<ProjectDetail>(`/projects/${id}`);
  const inbox = useApi<{ items: ApplyItem[] }>('/applies/inbox');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const data = project.data;
  const applyItems = (inbox.data?.items ?? []).filter((item) => String(item.project.id) === String(id));

  const run = async (fn: () => Promise<unknown>, okMessage?: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      if (okMessage) push(okMessage, 'success');
      setDialog(null);
      // 项目被删除后详情已不存在，只跳走，不再 reload。
      if (after) after();
      else {
        project.reload();
        inbox.reload();
      }
    } catch (error) {
      push(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (project.loading) {
    return (
      <div>
        <Skeleton rows={6} />
      </div>
    );
  }
  if (project.error) {
    return (
      <div className="notice notice-error">
        {project.error.message} · <Link to="/projects">返回项目列表</Link>
      </div>
    );
  }
  if (!data) return null;

  const permissions = data.permissions;
  const leader = data.leader;
  const isLeader = permissions.isLeader;
  const isMember = permissions.isMember;
  const canAcceptApply = isLeader;
  const myId = user?.id;

  return (
    <div>
      <Link className="btn-link" to="/projects">
        ← 项目列表
      </Link>

      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1 className="page-title">{data.title}</h1>
          <p className="page-sub">{data.misc || '暂无项目说明。'}</p>
          <div className="row" style={{ marginTop: 8 }}>
            <Badge tone="gray">{data.memberCount} 位成员</Badge>
            <Badge tone={data.waitingDemandCount ? 'amber' : 'gray'}>{data.waitingDemandCount} 个待接需求</Badge>
            {isLeader ? <Badge tone="blue">{applyItems.length} 条待审申请</Badge> : null}
            {data.myRole ? <StatusBadge map={ROLE} value={data.myRole} /> : null}
          </div>
        </div>
        <div className="row">
          {permissions.canApply ? (
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'apply' })}>
              申请加入
            </button>
          ) : null}
          {isMember ? (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'demand' })}>
              发布需求
            </button>
          ) : null}
          {isLeader ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'edit' })}>
                编辑
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setDialog({ kind: 'delete' })}>
                删除项目
              </button>
            </>
          ) : null}
          {isMember && !isLeader ? (
            <button type="button" className="btn btn-danger" onClick={() => setDialog({ kind: 'quit' })}>
              退出项目
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <dl className="kv">
          <dt>Leader</dt>
          <dd>
            {leader ? (
              <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                <Avatar name={displayName(leader)} src={leader.avatar} />
                {displayName(leader)}
              </span>
            ) : (
              <span className="faint">—</span>
            )}
          </dd>
          <dt>创建时间</dt>
          <dd>
            <TimeAgo value={data.createdAt} />
          </dd>
          <dt>我的角色</dt>
          <dd>{data.myRole ? <StatusBadge map={ROLE} value={data.myRole} /> : <span className="faint">非成员</span>}</dd>
        </dl>
      </div>

      <div className="section-head">
        <h2>成员</h2>
        <span className="faint">{data.members.length} 人</span>
      </div>
      <div className="panel">
        <div className="list">
          {data.members.map((member) => (
            <div className="list__row" key={member.userId}>
              <Avatar name={displayName(member)} src={member.avatar} />
              <div className="grow">
                <span>{displayName(member)}</span>
                <div className="faint">
                  加入于 <TimeAgo value={member.joinedAt} />
                </div>
              </div>
              <StatusBadge map={ROLE} value={member.role} />
              {isLeader && member.userId !== myId ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => setDialog({ kind: 'kick', userId: member.userId, name: displayName(member) })}
                >
                  移出
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {canAcceptApply ? (
        <>
          <div className="section-head">
            <h2>申请箱</h2>
            <span className="faint">{applyItems.length} 条待处理</span>
          </div>
          {applyItems.length === 0 ? (
            <Empty title="没有待处理的申请" hint="该项目的加入申请处理完就会清空。" />
          ) : (
            <div className="panel">
              <div className="list">
                {applyItems.map((apply) => (
                  <div className="list__row" key={apply.id}>
                    <Avatar name={displayName(apply.user)} src={apply.user.avatar} />
                    <div className="grow">
                      <div className="truncate">
                        <span>{displayName(apply.user)}</span>{' '}
                        <StatusBadge map={APPLY_TYPE} value={apply.type} />
                        {apply.source === 'join' ? (
                          <>
                            {' '}
                            <Badge tone="blue">来自 join</Badge>
                          </>
                        ) : null}
                      </div>
                      <div className="faint">
                        {apply.note ? `${apply.note} · ` : ''}
                        <TimeAgo value={apply.createdAt} />
                        {apply.resumeUrl ? (
                          <>
                            {' · '}
                            <a className="btn-link" href={apply.resumeUrl} target="_blank" rel="noreferrer">
                              下载简历
                            </a>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => run(() => api.post(`/applies/${apply.id}/accept`), '已通过申请')}
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => run(() => api.post(`/applies/${apply.id}/reject`), '已拒绝申请')}
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      <div className="section-head">
        <h2>需求</h2>
        <span className="faint">
          {data.demands.length} 条 · 接单与标记完成在需求页或需求详情里操作
        </span>
      </div>
      {data.demands.length === 0 ? (
        <Empty title="还没有需求" hint={isMember ? '用右上角「发布需求」发起第一个任务。' : '成员可以发布需求。'} />
      ) : (
        <div className="panel">
          <div className="list">
            {data.demands.map((demand) => (
              <div className="list__row" key={demand.id}>
                <div className="grow">
                  <div className="truncate">
                    <Link to={`/demands/${demand.id}`}>{demand.title}</Link>
                  </div>
                  <div className="faint">
                    <StatusBadge map={DEMAND_STATUS} value={demand.status} />
                    {demand.assignee ? ` · 由 ${displayName(demand.assignee)} 接单` : ' · 等待接单'} · <TimeAgo value={demand.createdAt} />
                  </div>
                </div>

              </div>
            ))}
          </div>
        </div>
      )}

      <ApplyDialog
        open={dialog?.kind === 'apply'}
        onClose={() => setDialog(null)}
        busy={busy}
        onSubmit={(form) => run(() => api.post(`/projects/${id}/applies`, form), '申请已提交')}
      />

      <EditDialog
        open={dialog?.kind === 'edit'}
        onClose={() => setDialog(null)}
        initial={{ title: data.title, misc: data.misc || '' }}
        busy={busy}
        onSubmit={(form) => run(() => api.patch(`/projects/${id}`, form), '已保存')}
      />

      <DemandDialog
        open={dialog?.kind === 'demand'}
        onClose={() => setDialog(null)}
        busy={busy}
        onSubmit={(form) => run(() => api.post(`/projects/${id}/demands`, form), '需求已发布')}
      />

      <Modal
        open={dialog?.kind === 'quit'}
        title="退出项目"
        sub="退出后如需重新加入，需要再次提交申请。"
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(() => api.del(`/projects/${id}/members/me`), '已退出项目')}
            >
              确认退出
            </button>
          </>
        }
      />

      <KickMemberDialog
        open={dialog?.kind === 'kick'}
        name={dialog?.name ?? ''}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          const userId = dialog?.userId;
          if (userId) run(() => api.del(`/projects/${id}/members/${userId}`), '已移出成员');
        }}
      />

      <DeleteProjectDialog
        open={dialog?.kind === 'delete'}
        title={data.title}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => run(() => api.del(`/projects/${id}`), '已删除项目', () => navigate('/projects'))}
      />
    </div>
  );
}

interface ApplyDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { note: string | null }) => void;
  busy: boolean;
}

function ApplyDialog({ open, onClose, onSubmit, busy }: ApplyDialogProps) {
  const [note, setNote] = useState('');
  return (
    <Modal
      open={open}
      title="申请加入"
      sub="Leader 会在项目页看到你的申请并做出决定。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onSubmit({ note: note.trim() || null })}
          >
            提交申请
          </button>
        </>
      }
    >
      <Field label="留言" hint="写点你能承担的部分，审批会更快。">
        <textarea className="textarea" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Modal>
  );
}

interface KickMemberDialogProps {
  open: boolean;
  name: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function KickMemberDialog({ open, name, busy, onClose, onConfirm }: KickMemberDialogProps) {
  return (
    <Modal
      open={open}
      title="移出成员"
      sub={`${name || '该成员'} 将立即失去项目成员身份，需要重新申请才能加入。`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>
            确认移出
          </button>
        </>
      }
    >
      <p className="faint" style={{ margin: 0 }}>
        已接下的需求不会被取消，对方仍可在需求详情里标记完成。
      </p>
    </Modal>
  );
}

interface DeleteProjectDialogProps {
  open: boolean;
  title: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteProjectDialog({ open, title, busy, onClose, onConfirm }: DeleteProjectDialogProps) {
  const [typed, setTyped] = useState('');
  const matched = typed.trim() === title;
  return (
    <Modal
      open={open}
      title="删除项目"
      sub="项目、成员、申请与需求都会被永久删除，无法恢复。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-danger" disabled={busy || !matched} onClick={onConfirm}>
            确认删除
          </button>
        </>
      }
    >
      <Field label="项目名称" hint={`输入「${title}」以确认删除。`}>
        <input className="input" value={typed} onChange={(event) => setTyped(event.target.value)} />
      </Field>
    </Modal>
  );
}

interface EditDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: EditForm) => void;
  busy: boolean;
  initial: EditForm;
}

function EditDialog({ open, onClose, onSubmit, busy, initial }: EditDialogProps) {
  const [form, setForm] = useState(initial);
  return (
    <Modal
      open={open}
      title="编辑项目"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSubmit(form)}>
            保存
          </button>
        </>
      }
    >
      <Field label="项目名称">
        <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </Field>
      <Field label="项目说明">
        <textarea className="textarea" value={form.misc} onChange={(event) => setForm({ ...form, misc: event.target.value })} />
      </Field>
    </Modal>
  );
}

interface DemandDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: DemandForm) => void;
  busy: boolean;
}

function DemandDialog({ open, onClose, onSubmit, busy }: DemandDialogProps) {
  const [form, setForm] = useState({ title: '', detail: '' });
  return (
    <Modal
      open={open}
      title="发布需求"
      sub="需求对平台上的所有用户开放，接单后即可开始。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onSubmit({ title: form.title.trim(), detail: form.detail.trim() || null })}
          >
            发布
          </button>
        </>
      }
    >
      <Field label="需求标题">
        <input
          className="input"
          value={form.title}
          maxLength={128}
          placeholder="例如：需求列表增加按状态筛选"
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
      </Field>
      <Field label="需求细节" hint="支持 Markdown：标题、粗体、列表、代码块、表格、链接。">
        <textarea className="textarea textarea--md" value={form.detail} onChange={(event) => setForm({ ...form, detail: event.target.value })} />
      </Field>
    </Modal>
  );
}
