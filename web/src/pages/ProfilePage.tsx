import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api, messageOf, qs } from '../api';
import { useAuth } from '../auth';
import { DEMAND_MAX_PAGES, DEMAND_PAGE_SIZE, sortByTimeDesc, useApi, useDemandFeed } from '../hooks';
import {
  APPLY_TYPE,
  DEMAND_STATUS,
  ROLE,
  Avatar,
  Badge,
  Empty,
  Field,
  Skeleton,
  StatusBadge,
  TimeAgo,
  displayName,
  useToast,
} from '../ui';
import type { ApplyItem, DemandItem, MyProfile, Paged, ProjectSummary } from '../types';

function demandTime(demand: DemandItem): string | null {
  if (demand.status === 'completed') return demand.completedAt;
  if (demand.status === 'review') return demand.submittedAt;
  return demand.acceptedAt;
}

function DemandRow({ demand }: { demand: DemandItem }) {
  return (
    <div className="list__row">
      <div className="grow">
        <Link className="truncate" to={`/demands/${demand.id}`} style={{ fontWeight: 600 }}>
          {demand.title}
        </Link>
        <div className="faint truncate">
          <Link to={`/projects/${demand.project.id}`}>{demand.project.title}</Link>
          {' · '}
          <TimeAgo value={demandTime(demand)} />
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <StatusBadge map={DEMAND_STATUS} value={demand.status} />
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const { push } = useToast();
  const inbox = useApi<{ items: ApplyItem[] }>('/applies/inbox');
  const projects = useApi<Paged<ProjectSummary>>(`/projects${qs({ filter: 'all', pageSize: 50 })}`);
  const feed = useDemandFeed();
  const profile = useApi<MyProfile>('/me/profile');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ skills: '', github: '', grade: '', bio: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  function startEdit() {
    const current = profile.data;
    setProfileForm({
      skills: (current?.skills ?? []).join(', '),
      github: current?.github ?? '',
      grade: current?.grade ?? '',
      bio: current?.bio ?? '',
    });
    setEditing(true);
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await api.patch('/me/profile', {
        skills: profileForm.skills.split(',').map((item) => item.trim()).filter(Boolean),
        github: profileForm.github.trim() || null,
        grade: profileForm.grade.trim() || null,
        bio: profileForm.bio.trim() || null,
      });
      push('档案已保存', 'success');
      setEditing(false);
      profile.reload();
    } catch (error) {
      push(messageOf(error), 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  const myProjects = (projects.data?.items ?? []).filter((project) => project.myRole);
  const managedProjects = myProjects.filter((project) => project.myRole === 'owner' || project.myRole === 'admin');
  const joinedProjects = myProjects.filter((project) => project.myRole === 'member');
  const inboxItems = inbox.data?.items ?? [];
  const myDemands = feed.items.filter((demand) => demand.assignee?.id === user?.id);
  const ongoing = sortByTimeDesc(
    myDemands.filter((demand) => demand.status === 'accepted' || demand.status === 'review'),
    (demand) => demand.submittedAt ?? demand.acceptedAt ?? demand.createdAt,
  );
  const completed = sortByTimeDesc(
    myDemands.filter((demand) => demand.status === 'completed'),
    (demand) => demand.completedAt ?? demand.createdAt,
  );
  const feedHint = feed.truncated ? `（基于最近 ${DEMAND_MAX_PAGES * DEMAND_PAGE_SIZE} 条）` : '';

  async function act(path: string, method: 'POST' | 'DELETE', okMessage: string, after?: () => void) {
    setBusy(true);
    try {
      if (method === 'DELETE') await api.del(path);
      else await api.post(path);
      push(okMessage, 'success');
      inbox.reload();
      projects.reload();
      feed.reload();
      after?.();
    } catch (error) {
      push(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  let inboxBlock: ReactNode;
  if (inbox.loading) {
    inboxBlock = <Skeleton rows={2} />;
  } else if (inboxItems.length === 0) {
    inboxBlock = <Empty title="没有待审申请" hint="你领导的项目的加入申请会出现在这里。" />;
  } else {
    inboxBlock = (
      <div className="panel">
        <div className="list">
          {inboxItems.map((apply) => (
            <div className="list__row" key={apply.id}>
              <Avatar name={displayName(apply.user)} src={apply.user.avatar} />
              <div className="grow">
                <div className="truncate">
                  {displayName(apply.user)} → <Link to={`/projects/${apply.project.id}`}>{apply.project.title}</Link>{' '}
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
                  onClick={() => act(`/applies/${apply.id}/accept`, 'POST', '已通过申请')}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => act(`/applies/${apply.id}/reject`, 'POST', '已拒绝申请')}
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const projectList = (list: ProjectSummary[], emptyTitle: string, emptyHint: string): ReactNode => {
    if (projects.loading) return <Skeleton rows={2} />;
    if (list.length === 0) return <Empty title={emptyTitle} hint={emptyHint} />;
    return (
      <div className="panel">
        <div className="list">
          {list.map((project) => (
            <div className="list__row" key={project.id}>
              <div className="grow">
                <Link to={`/projects/${project.id}`}>{project.title}</Link>
                <div className="faint">
                  {project.memberCount} 位成员 · {project.waitingDemandCount} 个待接需求 ·{' '}
                  <TimeAgo value={project.updatedAt} />
                </div>
              </div>
              <StatusBadge map={ROLE} value={project.myRole} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const managedBlock = projectList(managedProjects, '还没有负责的项目', '浏览项目列表，申请加入或自己建一个。');
  const joinedBlock = projectList(joinedProjects, '还没有参与的项目', '申请加入项目后，会出现在这里。');

  let demandsBlock: ReactNode;
  if (feed.loading) {
    demandsBlock = <Skeleton rows={2} />;
  } else if (feed.error) {
    demandsBlock = <div className="notice notice-error">{feed.error}</div>;
  } else if (myDemands.length === 0) {
    demandsBlock = <Empty title="还没有接下需求" hint="在需求页接单后，会出现在这里。" />;
  } else {
    demandsBlock = (
      <div className="panel">
        <div className="list">
          {ongoing.map((demand) => (
            <DemandRow key={demand.id} demand={demand} />
          ))}
          {completed.map((demand) => (
            <DemandRow key={demand.id} demand={demand} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">我的</h1>
          <p className="page-sub">等你审批的申请、你参与的项目，以及你接下的需求。</p>
        </div>
        <div className="row">
          <Avatar name={displayName(user)} src={user?.avatar} size="lg" />
          <div>
            <div style={{ fontWeight: 700 }}>{displayName(user)}</div>
            <div className="faint">{user?.email || '未提供邮箱'}</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm logout-mobile" onClick={() => logout()}>
            退出登录
          </button>
        </div>
      </div>

      <div className="section-head">
        <h2>开发者档案</h2>
        <span className="faint">展示给同学看：技能、年级、GitHub、自我介绍</span>
      </div>
      <div className="panel">
        {editing ? (
          <>
            <Field label="技能标签" hint="逗号分隔，最多 8 个，例如：React, TypeScript">
              <input
                className="input"
                value={profileForm.skills}
                onChange={(event) => setProfileForm({ ...profileForm, skills: event.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <Field label="年级" hint="例如：大三 / 研一">
                <input
                  className="input"
                  value={profileForm.grade}
                  onChange={(event) => setProfileForm({ ...profileForm, grade: event.target.value })}
                />
              </Field>
              <Field label="GitHub" hint="用户名或主页链接">
                <input
                  className="input"
                  value={profileForm.github}
                  onChange={(event) => setProfileForm({ ...profileForm, github: event.target.value })}
                />
              </Field>
            </div>
            <Field label="自我介绍" hint="不超过 2000 字">
              <textarea
                className="input"
                rows={4}
                value={profileForm.bio}
                onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={savingProfile} onClick={() => void saveProfile()}>
                {savingProfile ? '保存中…' : '保存档案'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {profile.data?.grade ? <Badge tone="blue">{profile.data.grade}</Badge> : null}
              {(profile.data?.skills ?? []).map((skill) => (
                <Badge key={skill} tone="gray">
                  {skill}
                </Badge>
              ))}
              {profile.data?.github ? (
                <a className="btn-link" href={/^https?:/i.test(profile.data.github) ? profile.data.github : `https://github.com/${profile.data.github}`} target="_blank" rel="noreferrer">
                  GitHub
                </a>
              ) : null}
              <button type="button" className="btn btn-secondary btn-sm" onClick={startEdit}>
                编辑档案
              </button>
            </div>
            <p className="faint" style={{ margin: '10px 0 0' }}>
              {profile.data?.bio || '还没有自我介绍。写一句你擅长什么、想学什么。'}
            </p>
          </>
        )}
      </div>

      <div className="section-head">
        <h2>待我审批</h2>
        <span className="faint">{inboxItems.length} 条</span>
      </div>
      {inboxBlock}

      <div className="section-head">
        <h2>我负责的</h2>
        <span className="faint">{managedProjects.length} 个</span>
      </div>
      {managedBlock}

      <div className="section-head">
        <h2>我参与的</h2>
        <span className="faint">{joinedProjects.length} 个</span>
      </div>
      {joinedBlock}

      <div className="section-head">
        <h2>个人参与的需求</h2>
        <span className="faint">
          {feed.loading ? '—' : `进行中 ${ongoing.length} 个 · 已完成 ${completed.length} 个`}
          {feedHint}
        </span>
      </div>
      {demandsBlock}
    </div>
  );
}
