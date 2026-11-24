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

/** 权限判断只需要这两个字段，申请/需求的行也能直接传进来。 */
type ProjectRef = Pick<ProjectRow, 'id' | 'leader_id'>;

/**
 * 当前用户在该项目里的角色：
 * owner（所有者，可多个）＞ admin（管理员，可管理整个项目）＞ member（成员）。
 * 建项时写入的 projects.leader_id 是“首任 owner”，始终按 owner 处理。
 */
export async function roleOf(project: ProjectRef, userId: string): Promise<Role | null> {
  if (project.leader_id === userId) return 'owner';
  const membership = await loadMembership(project.id, userId);
  return membership ? membership.role : null;
}

/** 所有者与管理员都能管理项目（编辑、审批申请、邀请/移出成员、验收需求）。 */
export async function requireManager(project: ProjectRef, user: SessionUser): Promise<void> {
  const role = await roleOf(project, user.id);
  if (role === 'owner' || role === 'admin') return;
  throw forbidden('NOT_MANAGER', '只有项目所有者或管理员可以执行该操作');
}

/** 只有所有者能删除项目、任免所有者。 */
export async function requireOwner(project: ProjectRef, user: SessionUser): Promise<void> {
  if ((await roleOf(project, user.id)) === 'owner') return;
  throw forbidden('NOT_OWNER', '只有项目所有者可以执行该操作');
}

export async function requireApplyDecider(project: ProjectRef, user: SessionUser): Promise<void> {
  await requireManager(project, user);
}

export async function requireMember(projectId: unknown, user: SessionUser): Promise<MembershipRow> {
  const membership = await loadMembership(projectId, user.id);
  if (!membership) throw forbidden('NOT_MEMBER', '只有项目成员可以执行该操作');
  return membership;
}

export type { Role };
