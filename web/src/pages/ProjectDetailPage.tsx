import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, messageOf, qs } from '../api';
import { useAuth } from '../auth';
import { useApi } from '../hooks';
import { MarkdownText } from '../markdown';
import { ProjectFilesSection } from '../project-files';
import {
  APPLY_TYPE,
  DEMAND_STATUS,
  PROJECT_DIFFICULTY,
  PROJECT_STATUS,
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
import type { ApplyItem, DirectoryPerson, ProjectDetail } from '../types';

type DialogKind = 'quit' | 'delete' | 'kick';

interface DialogState {
  kind: DialogKind;
  userId?: string;
  name?: string;
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
  const [inviteOpen, setInviteOpen] = useState(false);

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

  /** 所有者调整成员角色：成员 / 管理员 / 所有者（首任所有者不可改）。 */
  async function changeRole(userId: string, role: string) {
    try {
      await api.patch(`/projects/${id}/members/${userId}`, { role });
      push('角色已更新', 'success');
      project.reload();
    } catch (error) {
      push(messageOf(error), 'error');
    }
  }

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
  const isOwner = permissions.isOwner;
  const isPrimaryOwner = permissions.isPrimaryOwner;
  const isAdmin = permissions.isAdmin;
  const isMember = permissions.isMember;
  const canAcceptApply = isAdmin;
  const myId = user?.id;

  return (
    <div>
      <Link className="btn-link" to="/projects">
        ← 项目列表
      </Link>

      <div className="page-head detail-head" style={{ marginTop: 10 }}>
        <div className="detail-head__main">
          <h1 className="page-title">{data.title}</h1>
          <div className="detail-head__meta">
            <StatusBadge map={PROJECT_STATUS} value={data.status} />
            {data.myRole ? <StatusBadge map={ROLE} value={data.myRole} /> : null}
            <span className="tag">{PROJECT_DIFFICULTY[data.difficulty].label}</span>
            <span className="detail-head__sep" aria-hidden="true" />
            <span className="detail-head__counts">
              <span>{data.memberCount} 位成员</span>
              <span aria-hidden="true">·</span>
              <span>{data.waitingDemandCount} 个需求待接</span>
              {isAdmin && applyItems.length > 0 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{applyItems.length} 条待审申请</span>
                </>
              ) : null}
            </span>
          </div>
          {data.techStack.length > 0 ? (
            <div className="detail-head__tech">
              {data.techStack.map((tech) => (
                <span className="tag" key={tech}>
                  {tech}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="page-actions">
          {permissions.canApply ? (
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/projects/${id}/apply`)}>
              申请加入
            </button>
          ) : null}
          {isMember ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/projects/${id}/demands/new`)}
            >
              发布需求
            </button>
          ) : null}
          {isAdmin ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/projects/${id}/edit`)}>
                编辑
              </button>
              {isOwner ? (
                <button type="button" className="btn btn-ghost btn-danger" onClick={() => setDialog({ kind: 'delete' })}>
                  删除
                </button>
              ) : null}
            </>
          ) : null}
          {isMember && !isOwner ? (
            <button type="button" className="btn btn-ghost btn-danger" onClick={() => setDialog({ kind: 'quit' })}>
              退出项目
            </button>
          ) : null}
        </div>
      </div>

      <div className="detail-facts">
        <span className="detail-facts__item">
          <span className="faint">所有者</span>
          {data.owners.length > 0 ? (
            data.owners.map((owner) => (
              <span className="detail-facts__person" key={owner.userId}>
                <Avatar name={displayName(owner)} src={owner.avatar} size="sm" />
                {displayName(owner)}
              </span>
            ))
          ) : (
            <span className="faint">—</span>
          )}
        </span>
        <span className="detail-facts__item">
          <span className="faint">创建</span>
          <TimeAgo value={data.createdAt} />
        </span>
        <span className="detail-facts__item">
          <span className="faint">更新</span>
          <TimeAgo value={data.updatedAt} />
        </span>
      </div>

      {data.repoUrls.length > 0 ? (
        <>
          <div className="section-head">
            <h2>快速开始</h2>
            <span className="faint">克隆到本地开始开发</span>
          </div>
          <div className="panel">
            <div className="list">
              {data.repoUrls.map((url) => (
                <div className="list__row" key={url}>
                  <div className="grow">
                    <a className="cell-title" href={url} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                    <div className="faint truncate">git clone {url}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(`git clone ${url}`)
                        .then(() => push('克隆命令已复制', 'success'))
                        .catch(() => push('复制失败，请手动选择命令', 'error'));
                    }}
                  >
                    复制命令
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {data.misc && data.misc.trim() ? (
        <>
          <div className="section-head">
            <h2>项目说明</h2>
          </div>
          <div className="panel">
            <MarkdownText source={data.misc} />
          </div>
        </>
      ) : null}

      {isMember ? (
        <>
          <div className="section-head">
            <h2>开发说明</h2>
            <span className="faint">仅项目成员可见</span>
          </div>
          <div className="panel">
            {data.devNotes && data.devNotes.trim() ? <MarkdownText source={data.devNotes} /> : null}
            <div style={{ marginTop: data.devNotes && data.devNotes.trim() ? 16 : 0 }}>
              <ProjectFilesSection
                projectId={data.id}
                canDelete={(file) => isAdmin || (file.uploadedBy.id != null && file.uploadedBy.id === myId)}
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="section-head">
        <h2>成员</h2>
        <span className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="faint">{data.members.length} 人</span>
          {isAdmin ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setInviteOpen(true)}>
              邀请成员
            </button>
          ) : null}
        </span>
      </div>
      <div className="panel">
        <div className="list">
          {data.members.map((member) => (
            <div className="list__row" key={member.userId}>
              <Avatar name={displayName(member)} src={member.avatar} />
              <div className="grow">
                <span>{displayName(member)}</span>
                {member.skills.length > 0 ? (
                  <span className="row" style={{ gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                    {member.skills.slice(0, 4).map((skill) => (
                      <Badge key={skill} tone="gray">
                        {skill}
                      </Badge>
                    ))}
                  </span>
                ) : null}
                <div className="faint">
                  加入于 <TimeAgo value={member.joinedAt} />
                </div>
              </div>
              {member.isPrimary ? <Badge tone="blue">首任</Badge> : null}
              {isOwner &&
              !member.isPrimary &&
              member.userId !== myId &&
              (member.role !== 'owner' || isPrimaryOwner) ? (
                <select
                  className="input"
                  style={{ width: 110, padding: '4px 8px' }}
                  value={member.role}
                  onChange={(event) => void changeRole(member.userId, event.target.value)}
                >
                  <option value="owner">所有者</option>
                  <option value="admin">管理员</option>
                  <option value="member">成员</option>
                </select>
              ) : (
                <StatusBadge map={ROLE} value={member.role} />
              )}
              {isAdmin &&
              !member.isPrimary &&
              member.userId !== myId &&
              (isOwner ? member.role !== 'owner' || isPrimaryOwner : member.role === 'member') ? (
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
                    <div className="row list__row__actions" style={{ gap: 6 }}>
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
          {data.demands.length} 条 · 接单、提交与验收在需求页或需求详情里操作
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

      <InviteMemberDialog
        open={inviteOpen}
        projectId={data.id}
        canGrantAdmin={isOwner}
        onClose={() => setInviteOpen(false)}
        onInvited={() => project.reload()}
        notify={(message) => push(message, 'success')}
      />
    </div>
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
        已接下的需求不会被取消，对方仍可在需求详情里提交完成。
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

interface InviteMemberDialogProps {
  open: boolean;
  projectId: number;
  /** 只有所有者能把新成员直接设为管理员。 */
  canGrantAdmin: boolean;
  onClose: () => void;
  onInvited: () => void;
  notify: (message: string) => void;
}

/** 所有者/管理员直接拉人：按 sub / 用户名 / 姓名 / 邮箱搜统一身份目录，选中即入组。 */
function InviteMemberDialog({ open, projectId, canGrantAdmin, onClose, onInvited, notify }: InviteMemberDialogProps) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');

  useEffect(() => {
    if (open) return;
    setTerm('');
    setItems([]);
    setError('');
    setLoading(false);
    setAdding('');
    setInviteRole('member');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (!q) {
      setItems([]);
      setLoading(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      api
        .get<{ items: DirectoryPerson[] }>(`/directory/search${qs({ q, projectId })}`)
        .then((data) => {
          if (alive) setItems(data.items);
        })
        .catch((err) => {
          if (alive) setError(messageOf(err));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term, open, projectId]);

  async function invite(person: DirectoryPerson) {
    if (adding) return;
    setAdding(person.id);
    setError('');
    try {
      await api.post(`/projects/${projectId}/members`, { userId: person.id, role: inviteRole });
      notify(`已把 ${displayName(person)} 加入项目`);
      setItems((prev) => prev.map((item) => (item.id === person.id ? { ...item, isMember: true } : item)));
      onInvited();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setAdding('');
    }
  }

  return (
    <Modal
      open={open}
      title="邀请成员"
      sub="输入统一身份的名字、用户名、邮箱或 ID，选中后直接加入项目。"
      onClose={onClose}
      wide
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          完成
        </button>
      }
    >
      <Field label="搜索成员" hint={loading ? '搜索中…' : '支持姓名、用户名、邮箱、用户 ID'}>
        <input
          className="input"
          autoFocus
          value={term}
          placeholder="例如：常应常静 / sse_278 / 2215020897@qq.com"
          onChange={(event) => setTerm(event.target.value)}
        />
      </Field>
      {canGrantAdmin ? (
        <Field label="加入身份" hint="管理员可以管理整个项目（审批申请、邀请/移出成员、编辑项目）。">
          <select
            className="input"
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value === 'admin' ? 'admin' : 'member')}
          >
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select>
        </Field>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}
      {term.trim() && !loading && items.length === 0 && !error ? (
        <p className="faint" style={{ margin: '8px 0 0' }}>
          没有找到匹配的人。
        </p>
      ) : null}
      <div className="list" style={{ marginTop: items.length ? 8 : 0 }}>
        {items.map((person) => (
          <div className="list__row" key={person.id}>
            <Avatar name={displayName(person)} src={person.avatar} />
            <div className="grow">
              <span>{displayName(person)}</span>
              {person.developer ? null : (
                <>
                  {' '}
                  <Badge tone="amber">未开通开发者</Badge>
                </>
              )}
              <div className="faint truncate">
                {person.username ? `@${person.username}` : person.id}
                {person.email ? ` · ${person.email}` : ''}
              </div>
            </div>
            {person.isMember ? (
              <Badge tone="gray">已在项目</Badge>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={Boolean(adding)}
                onClick={() => void invite(person)}
              >
                {adding === person.id ? '加入中…' : '加入项目'}
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
