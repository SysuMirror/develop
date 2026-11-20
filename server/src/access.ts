import { one } from './db.ts';
import { forbidden, notFound } from './http.ts';
import type { MembershipRow, ProjectRow, Role, SessionUser } from './types.ts';

export async function loadProject(projectId: unknown): Promise<ProjectRow> {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) throw notFound('项目不存在');
  const project = await one<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) throw notFound('项目不存在');
  return project;
}

export async function loadMembership(projectId: unknown, userId: unknown): Promise<MembershipRow | null> {
  return one<MembershipRow>('SELECT * FROM project_member WHERE project_id = ? AND user_id = ?', [projectId, userId]);
}

export async function requireLeader(project: Pick<ProjectRow, 'leader_id'>, user: SessionUser): Promise<void> {
  if (project.leader_id !== user.id) throw forbidden('NOT_LEADER', '只有项目 leader 可以执行该操作');
}

// 项目恰好一个 leader，审批权也只属于他。
export async function requireApplyDecider(
  project: Pick<ProjectRow, 'leader_id'>,
  user: SessionUser,
): Promise<void> {
  if (project.leader_id === user.id) return;
  throw forbidden('NOT_LEADER', '只有项目 leader 可以审批该申请');
}

export async function requireMember(projectId: unknown, user: SessionUser): Promise<MembershipRow> {
  const membership = await loadMembership(projectId, user.id);
  if (!membership) throw forbidden('NOT_MEMBER', '只有项目成员可以执行该操作');
  return membership;
}

export type { Role };
