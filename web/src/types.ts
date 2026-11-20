// 与 server 端 JSON 响应对齐的类型；后端改了字段，这里要同步。

export type ApplyStatus = 'waiting' | 'accepted' | 'rejected';
export type DemandStatus = 'waiting' | 'accepted' | 'review' | 'completed' | 'suspended';
export type Role = 'leader' | 'participant';
export type ApplyType = 'leader' | 'participant';
export type ApplySource = 'web' | 'join';
export type Qualification = 'ok' | 'none' | 'unknown';

// 接口里引用某个用户时的统一形状；目录查不到时 name/username/avatar 为 null。
export interface UserRef {
  id: string | null;
  name: string | null;
  username: string | null;
  avatar: string | null;
}

// GET /api/auth/me
export interface Me {
  id: string;
  name: string | null;
  avatar: string | null;
  email: string | null;
  ssoSub: string;
  developer: boolean;
  qualification: Qualification;
  devLogin: boolean;
}

export interface DevIdentity {
  id: string;
  name: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectSummary {
  id: number;
  title: string;
  misc: string | null;
  createdAt: string;
  updatedAt: string;
  leader: UserRef | null;
  memberCount: number;
  waitingDemandCount: number;
  pendingApplyCount: number;
  myRole: Role | null;
  myApplyStatus: ApplyStatus | null;
}

export interface ProjectMember {
  userId: string;
  name: string | null;
  avatar: string | null;
  role: Role;
  joinedAt: string;
}

export interface ProjectDemand {
  id: number;
  title: string;
  detail: string | null;
  status: DemandStatus;
  createdAt: string;
  assignee: UserRef | null;
}

export interface ProjectPermissions {
  isMember: boolean;
  isLeader: boolean;
  canApply: boolean;
  canManage: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  members: ProjectMember[];
  demands: ProjectDemand[];
  permissions: ProjectPermissions;
}

// 服务端按当前登录者算好的动作开关，前端不再自己推断权限。
export interface DemandPermissions {
  canEdit: boolean;
  canAccept: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canSuspend: boolean;
  canResume: boolean;
}

export interface DemandItem {
  id: number;
  title: string;
  detail: string | null;
  status: DemandStatus;
  createdAt: string;
  acceptedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  project: { id: number; title: string };
  creator: UserRef;
  assignee: UserRef | null;
  permissions: DemandPermissions;
}

export interface ApplyItem {
  id: number;
  type: ApplyType;
  status: ApplyStatus;
  note: string | null;
  resumeUrl: string | null;
  source: ApplySource;
  createdAt: string;
  decidedAt: string | null;
  project: { id: number; title: string };
  user: UserRef;
}
