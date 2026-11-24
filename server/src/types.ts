// 服务端共享类型：数据库行的形状、目录里的人、会话用户。
// 约定：DB 行用 snake_case（与 SELECT 出来的列一致），对外 JSON 的映射函数负责转 camelCase。

export type Role = 'owner' | 'admin' | 'member';
export type ApplyType = 'leader' | 'participant';
export type ApplyStatus = 'waiting' | 'accepted' | 'rejected';
export type ApplySource = 'web' | 'join';
export type DemandStatus = 'waiting' | 'accepted' | 'review' | 'completed' | 'suspended';
export type DemandSuspendFrom = 'waiting' | 'accepted' | 'review';
export type AuthMethod = 'sso' | 'dev';

/** attachSession 解析出来的会话用户；名字头像来自 UniSSO 目录，取不到时为 null。 */
export interface SessionUser {
  id: string;
  name: string | null;
  avatar: string | null;
  email: string | null;
  sessionId: string;
  authMethod: AuthMethod;
  developer: boolean | null;
  /** 共享 Cookie 里的 UniSSO 会话 id；开发登录的会话为 null。 */
  ssoSession: string | null;
}

/** 目录 / user_profile 里的一个人。developer 为 null 表示「资格未知」。 */
export interface DirectoryUser {
  id: string;
  username: string | null;
  name: string | null;
  avatar: string | null;
  email: string | null;
  developer: boolean | null;
  active: boolean;
  cached?: boolean;
}

/** 接口里引用某个用户时的统一形状。 */
export interface UserRef {
  id: string | null;
  name: string | null;
  username: string | null;
  avatar: string | null;
}

export interface ProjectRow {
  id: number;
  title: string;
  misc: string | null;
  /** 仓库地址（可多个）：所有能进平台的人都能看到。 */
  repo_url: string | null;
  repo_urls: unknown;
  /** 开发说明：只给项目成员看。 */
  dev_notes: string | null;
  leader_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MembershipRow {
  id: number;
  project_id: number;
  user_id: string;
  role: Role;
  created_at: Date;
}

/** PROJECT_SUMMARY 的查询结果。 */
export interface ProjectSummaryRow extends ProjectRow {
  member_count: number | string;
  waiting_demand_count: number | string;
  pending_apply_count: number | string;
  my_role: Role | null;
  my_apply_status: ApplyStatus | null;
}

export interface ApplyRow {
  id: number;
  project_id: number;
  user_id: string;
  type: ApplyType;
  status: ApplyStatus;
  note: string | null;
  resume_url: string | null;
  source: ApplySource;
  created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
}

/** APPLY_SELECT 的查询结果：多带上了项目标题与 leader。 */
export interface ApplyJoinedRow extends ApplyRow {
  project_title: string;
  leader_id: string | null;
}

export interface DemandRow {
  id: number;
  project_id: number;
  title: string;
  detail: string | null;
  status: DemandStatus;
  created_by: string;
  user_id: string | null;
  created_at: Date;
  accepted_at: Date | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  status_before_suspend: DemandSuspendFrom | null;
  /** 当前版本号，等于被修改的次数。 */
  revision: number;
}

export interface DemandJoinedRow extends DemandRow {
  project_title: string;
  leader_id: string | null;
}

/** demand_revision 快照行：revision 0 是发布时的原文。 */
export interface DemandRevisionRow {
  id: number;
  demand_id: number;
  revision: number;
  title: string;
  detail: string | null;
  editor_id: string | null;
  created_at: Date;
}

export interface SessionRow {
  session_id: string;
  user_id: string;
  auth_method: AuthMethod | null;
  developer: number | boolean | null;
  sso_session: string | null;
  expires_at: Date;
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: Date | null;
}
