import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import {
  APPLY_STATUS,
  APPLY_TYPE,
  ROLE,
  Avatar,
  Badge,
  Empty,
  Skeleton,
  StatusBadge,
  TimeAgo,
  displayName,
  useToast,
} from '../ui.jsx';

export default function ProfilePage() {
  const { user } = useAuth();
  const { push } = useToast();
  const mine = useApi('/applies/mine');
  const inbox = useApi('/applies/inbox');
  const projects = useApi(`/projects${qs({ filter: 'all', pageSize: 50 })}`);
  const [busy, setBusy] = useState(false);

  const myProjects = (projects.data?.items ?? []).filter((project) => project.myRole);
  const inboxItems = inbox.data?.items ?? [];
  const myApplies = mine.data?.items ?? [];

  async function act(path, method, okMessage) {
    setBusy(true);
    try {
      if (method === 'DELETE') await api.del(path);
      else await api.post(path);
      push(okMessage, 'success');
      mine.reload();
      inbox.reload();
      projects.reload();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  let inboxBlock;
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
              <div className="row" style={{ gap: 6 }}>
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

  let mineBlock;
  if (mine.loading) {
    mineBlock = <Skeleton rows={2} />;
  } else if (myApplies.length === 0) {
    mineBlock = <Empty title="还没有申请" hint="在项目页点「申请加入」即可提交。" />;
  } else {
    mineBlock = (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>项目</th>
              <th>类型</th>
              <th>状态</th>
              <th className="right">时间</th>
              <th className="right">操作</th>
            </tr>
          </thead>
          <tbody>
            {myApplies.map((apply) => (
              <tr key={apply.id}>
                <td>
                  <Link to={`/projects/${apply.project.id}`}>{apply.project.title}</Link>
                </td>
                <td>
                  <StatusBadge map={APPLY_TYPE} value={apply.type} />
                </td>
                <td>
                  <StatusBadge map={APPLY_STATUS} value={apply.status} />
                </td>
                <td className="right">
                  <TimeAgo value={apply.createdAt} />
                </td>
                <td className="right">
                  {apply.status === 'waiting' ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => act(`/applies/${apply.id}`, 'DELETE', '已撤回申请')}
                    >
                      撤回
                    </button>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  let projectsBlock;
  if (projects.loading) {
    projectsBlock = <Skeleton rows={2} />;
  } else if (myProjects.length === 0) {
    projectsBlock = <Empty title="还没有参与项目" hint="浏览项目列表，申请加入或自己建一个。" />;
  } else {
    projectsBlock = (
      <div className="panel">
        <div className="list">
          {myProjects.map((project) => (
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
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">我的</h1>
          <p className="page-sub">你发出的申请、等你审批的申请，以及你参与的项目。</p>
        </div>
        <div className="row">
          <Avatar name={user.name} src={user.avatar} size="lg" />
          <div>
            <div style={{ fontWeight: 700 }}>{user.name}</div>
            <div className="faint">{user.email || '未提供邮箱'}</div>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>待我审批</h2>
        <span className="faint">{inboxItems.length} 条</span>
      </div>
      {inboxBlock}

      <div className="section-head">
        <h2>我发出的申请</h2>
        <span className="faint">{myApplies.length} 条</span>
      </div>
      {mineBlock}

      <div className="section-head">
        <h2>我参与的项目</h2>
        <span className="faint">{myProjects.length} 个</span>
      </div>
      {projectsBlock}
    </div>
  );
}
