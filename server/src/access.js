import { one } from './db.js';
import { forbidden, notFound } from './http.js';

export async function loadProject(projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) throw notFound('项目不存在');
  const project = await one('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) throw notFound('项目不存在');
  return project;
}

export async function loadMembership(projectId, developerId) {
  return one('SELECT * FROM project_member WHERE project_id = ? AND developer_id = ?', [projectId, developerId]);
}

export async function requireLeader(project, user) {
  if (project.leader_id !== user.id) throw forbidden('NOT_LEADER', '只有项目 leader 可以执行该操作');
}

// leader 缺位的项目没有可授权的人，按先到先得处理：任何登录开发者都能处理 leader 型申请。
export async function requireApplyDecider(project, user, applyType) {
  if (project.leader_id === user.id) return;
  if (applyType === 'leader' && project.leader_id === null) return;
  throw forbidden('NOT_LEADER', '只有项目 leader 可以审批该申请');
}

export async function requireMember(projectId, user) {
  const membership = await loadMembership(projectId, user.id);
  if (!membership) throw forbidden('NOT_MEMBER', '只有项目成员可以执行该操作');
  return membership;
}
