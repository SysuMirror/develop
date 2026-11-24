// 用户资料目录。
//
// 用户实体只存在于 UniSSO 的 users 表里，本平台不保存用户表，因此展示名字、头像、邮箱时
// 只能向 UniSSO 要：POST /api/oauth/users/list（M2M，返回全量用户，没有分页也没有按 id 查）。
//
// 缓存策略是惰性的：启动时不预取、不做定时刷新，只有某个请求确实需要资料时才拉一次，
// 之后在 SSO_DIRECTORY_TTL_SECONDS 内复用同一份结果。拉取失败时沿用上一次成功的结果，
// 从未成功过就把名字留空（前端显示「未知用户」），不让页面 500。
import { query } from './db.ts';
import { demoDirectory } from './demo-users.ts';
import { devLoginEnabled, ssoConfigured, ssoCredentials } from './sso-config.ts';
import type { DirectoryUser, UserRef } from './types.ts';

const REQUEST_TIMEOUT_MS = 5000;

interface DirectoryCache {
  users: Map<string, DirectoryUser>;
  fetchedAt: number;
}

interface ProfileRow {
  user_id: string;
  name: string | null;
  avatar: string | null;
  email: string | null;
}

/** userinfo / users/list 里的一条原始记录。 */
interface RawUser {
  sub?: unknown;
  preferred_username?: unknown;
  name?: unknown;
  picture?: unknown;
  email?: unknown;
  developer?: unknown;
  active?: unknown;
}

let cached: DirectoryCache | null = null;
let inflight: Promise<Map<string, DirectoryUser>> | null = null;
let loggedFailure = false;
// 失败也要记时间：否则目录不可用时每个请求都会重新打一次外部 SSO（实测每次 350ms+）。
let failedAt = 0;

function retryMs(): number {
  const seconds = Number(process.env.SSO_DIRECTORY_RETRY_SECONDS ?? 30);
  if (!Number.isFinite(seconds) || seconds < 0) return 30_000;
  return seconds * 1000;
}

function ttlMs(): number {
  const seconds = Number(process.env.SSO_DIRECTORY_TTL_SECONDS ?? 60);
  if (!Number.isFinite(seconds) || seconds < 0) return 60_000;
  return seconds * 1000;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalize(raw: RawUser): DirectoryUser {
  return {
    id: String(raw.sub ?? ''),
    username: str(raw.preferred_username),
    name: str(raw.name),
    avatar: str(raw.picture),
    email: str(raw.email),
    developer: raw.developer === true,
    active: raw.active !== false,
  };
}

// 落库的展示缓存：登录回调抄下来的 userinfo 快照。目录里查不到的人用它兜底，
// developer 未知就是 null，交给前端显示「资格未知」。
function fromProfileRow(row: ProfileRow): DirectoryUser {
  return {
    id: String(row.user_id),
    username: null,
    name: str(row.name),
    avatar: str(row.avatar),
    email: str(row.email),
    developer: null,
    active: true,
    cached: true,
  };
}

async function readProfiles(ids: unknown[]): Promise<Map<string, DirectoryUser>> {
  const wanted = [...new Set((ids || []).filter(Boolean).map(String))];
  if (wanted.length === 0) return new Map();
  const rows = await query<ProfileRow>(
    `SELECT user_id, name, avatar, email FROM user_profile
      WHERE user_id IN (${wanted.map(() => '?').join(',')})`,
    wanted,
  );
  return new Map(rows.map((row) => [String(row.user_id), fromProfileRow(row)]));
}

async function saveProfile(user: DirectoryUser): Promise<void> {
  try {
    await query(
      `INSERT INTO user_profile (user_id, name, avatar, email) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), avatar = VALUES(avatar), email = VALUES(email)`,
      [user.id, user.name, user.avatar, user.email],
    );
  } catch (error) {
    console.error('[directory] user_profile 写入失败：', messageOfError(error));
  }
}

async function fetchDirectory(): Promise<Map<string, DirectoryUser>> {
  const { issuer, clientId, clientSecret } = ssoCredentials();
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('未配置 SSO_ISSUER / SSO_CLIENT_ID / SSO_CLIENT_SECRET');
  }
  const authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  const response = await fetch(`${issuer}/api/oauth/users/list`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`users/list 返回 ${response.status} ${text.slice(0, 200)}`.trim());
  }
  const body = (await response.json().catch(() => null)) as { users?: unknown } | null;
  if (!body || !Array.isArray(body.users)) throw new Error('users/list 响应缺少 users 数组');
  const users = new Map<string, DirectoryUser>();
  for (const raw of body.users as RawUser[]) {
    const user = normalize(raw);
    if (user.id) users.set(user.id, user);
  }
  return users;
}

async function load(): Promise<Map<string, DirectoryUser>> {
  if (!ssoConfigured()) {
    // 没有真实目录可查：DEV_LOGIN 的演示身份由 withDemo() 合并，否则让 snapshot() 走降级。
    if (devLoginEnabled()) return new Map();
    throw new Error('未配置 SSO_ISSUER / SSO_CLIENT_ID / SSO_CLIENT_SECRET');
  }
  if (cached && Date.now() - cached.fetchedAt < ttlMs()) return cached.users;
  if (inflight) return inflight;
  // 失败窗口内直接抛，不再打外部请求；这段窗口里调用方走缓存 / user_profile 降级。
  if (failedAt && Date.now() - failedAt < retryMs()) throw new Error('用户目录暂不可用，稍后重试');
  inflight = fetchDirectory()
    .then((users) => {
      cached = { users, fetchedAt: Date.now() };
      loggedFailure = false;
      failedAt = 0;
      return users;
    })
    .catch((error: unknown) => {
      failedAt = Date.now();
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// DEV_LOGIN 只叠加演示身份；配置了 SSO 时仍然拉真实目录，密码登录的资格刷新依赖它。
function withDemo(users: Map<string, DirectoryUser>): Map<string, DirectoryUser> {
  if (!devLoginEnabled()) return users;
  const merged = new Map(demoDirectory().map((user) => [user.id, user]));
  for (const [id, user] of users) merged.set(id, user);
  return merged;
}

export interface Snapshot {
  users: Map<string, DirectoryUser>;
  stale: boolean;
}

// 后台刷新目录：请求路径不等待外部 SSO，重试节奏由 load() 的失败窗口控制。
export function warm(): void {
  load().catch((error: unknown) => {
    // 连续失败只在第一次打日志，否则每个请求都会刷一行。
    if (!loggedFailure) {
      loggedFailure = true;
      console.error('[directory] 用户目录拉取失败，展示降级为「未知用户」：', messageOfError(error));
    }
  });
}

// 取目录快照，永不抛错、也不阻塞在外部请求上：用已有缓存，同时后台刷新。
// stale=true 表示缓存过期或尚未取到，调用方按「目录不可用」降级。
export async function snapshot(): Promise<Snapshot> {
  warm();
  const current = cached;
  if (!current) return { users: withDemo(new Map()), stale: true };
  return { users: withDemo(current.users), stale: Date.now() - current.fetchedAt >= ttlMs() };
}

function messageOfError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// 登录回调已经拿到了权威的 userinfo：先塞进缓存。这样即使 users/list 不可用，
// 当前用户自己也总有名字可显示（别人仍然可能是「未知用户」）。
export async function remember(raw: RawUser | null | undefined): Promise<void> {
  const user = normalize(raw ?? {});
  if (!user.id) return;
  const users = new Map(cached?.users ?? []);
  const previous = users.get(user.id);
  users.set(user.id, {
    ...previous,
    ...user,
    username: user.username ?? previous?.username ?? null,
    name: user.name ?? previous?.name ?? null,
    avatar: user.avatar ?? previous?.avatar ?? null,
    email: user.email ?? previous?.email ?? null,
  });
  cached = { users, fetchedAt: cached?.fetchedAt ?? 0 };
  const stored = users.get(user.id);
  if (stored) await saveProfile(stored);
}

export async function getUser(id: unknown): Promise<DirectoryUser | null> {
  if (!id) return null;
  const users = await getUsers([id]);
  return users.get(String(id)) ?? null;
}

// 目录优先，user_profile 补缺；两者都没有就是查无此人。
// 只读本地（内存缓存 + 一次 user_profile 查询），绝不为「补名字」而阻塞外部 SSO。
export async function getUsersLocal(ids: unknown[]): Promise<Map<string, DirectoryUser>> {
  const wanted = [...new Set((ids || []).filter(Boolean).map(String))];
  const found = new Map<string, DirectoryUser>();
  if (wanted.length === 0) return found;
  const directory = withDemo(cached?.users ?? new Map());
  const missing: string[] = [];
  for (const id of wanted) {
    const user = directory.get(id);
    if (user) found.set(id, user);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const profiles = await readProfiles(missing);
    for (const [id, user] of profiles) found.set(id, user);
  }
  return found;
}

export async function getUsers(ids: unknown[]): Promise<Map<string, DirectoryUser>> {
  warm();
  return getUsersLocal(ids);
}

export interface LookupResult {
  /** true 明确存在；false 明确不存在；null 目录不可用、不做判断。 */
  known: boolean | null;
  user: DirectoryUser | null;
}

// join 平台可能替还没登录过的人提交申请：known=true/false 是明确结论，null 表示目录不可用、不做判断。
export async function lookup(id: unknown): Promise<LookupResult> {
  const key = String(id ?? '').trim();
  if (!key) return { known: false, user: null };
  const { users: directory, stale } = await snapshot();
  const user = directory.get(key) ?? (await readProfiles([key])).get(key) ?? null;
  if (user) return { known: true, user };
  return { known: stale ? null : false, user: null };
}

/**
 * 按 sub / 用户名 / 姓名 / 邮箱模糊找人，用于 leader 邀请成员。
 * 目录不可用时只搜本地缓存与 user_profile，不阻塞；返回按相关度排序。
 */
export async function searchUsers(term: unknown, limit = 12): Promise<DirectoryUser[]> {
  const q = String(term ?? '').trim().toLowerCase();
  if (q.length < 1) return [];
  const { users } = await snapshot();
  const exact: DirectoryUser[] = [];
  const prefix: DirectoryUser[] = [];
  const partial: DirectoryUser[] = [];
  for (const user of users.values()) {
    const id = user.id.toLowerCase();
    const username = (user.username ?? '').toLowerCase();
    const name = (user.name ?? '').toLowerCase();
    const email = (user.email ?? '').toLowerCase();
    if (id === q) exact.push(user);
    else if (username.startsWith(q) || name.startsWith(q)) prefix.push(user);
    else if (id.includes(q) || username.includes(q) || name.includes(q) || email.includes(q)) partial.push(user);
  }
  return [...exact, ...prefix, ...partial].slice(0, limit);
}

// 接口里引用某个用户时的统一形状；user 缺失说明目录里没有或目录不可用，前端显示「未知用户」。
export function userRef(id: unknown, user: DirectoryUser | null | undefined): UserRef {
  return {
    id: id == null ? null : String(id),
    name: user?.name ?? null,
    username: user?.username ?? null,
    avatar: user?.avatar ?? null,
  };
}
