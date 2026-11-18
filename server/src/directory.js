// 用户资料目录。
//
// 用户实体只存在于 UniSSO 的 users 表里，本平台不保存用户表，因此展示名字、头像、邮箱时
// 只能向 UniSSO 要：POST /api/oauth/users/list（M2M，返回全量用户，没有分页也没有按 id 查）。
//
// 缓存策略是惰性的：启动时不预取、不做定时刷新，只有某个请求确实需要资料时才拉一次，
// 之后在 SSO_DIRECTORY_TTL_SECONDS 内复用同一份结果。拉取失败时沿用上一次成功的结果，
// 从未成功过就把名字留空（前端显示「未知用户」），不让页面 500。
import { query } from './db.js';
import { demoDirectory } from './demo-users.js';
import { devLoginEnabled, ssoConfigured, ssoCredentials } from './sso-config.js';

const REQUEST_TIMEOUT_MS = 5000;

let cached = null; // { users: Map<string, user>, fetchedAt: number }
let inflight = null;
let loggedFailure = false;

function ttlMs() {
  const seconds = Number(process.env.SSO_DIRECTORY_TTL_SECONDS ?? 60);
  if (!Number.isFinite(seconds) || seconds < 0) return 60_000;
  return seconds * 1000;
}

function normalize(raw) {
  return {
    id: String(raw.sub ?? ''),
    username: raw.preferred_username || null,
    name: raw.name || null,
    avatar: raw.picture || null,
    email: raw.email || null,
    developer: raw.developer === true,
    active: raw.active !== false,
  };
}

// 落库的展示缓存：登录回调抄下来的 userinfo 快照。目录里查不到的人用它兜底，
// developer 未知就是 null，交给前端显示「资格未知」。
function fromProfileRow(row) {
  return {
    id: String(row.user_id),
    username: null,
    name: row.name || null,
    avatar: row.avatar || null,
    email: row.email || null,
    developer: null,
    active: true,
    cached: true,
  };
}

async function readProfiles(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean).map(String))];
  if (wanted.length === 0) return new Map();
  const rows = await query(
    `SELECT user_id, name, avatar, email FROM user_profile
      WHERE user_id IN (${wanted.map(() => '?').join(',')})`,
    wanted,
  );
  return new Map(rows.map((row) => [String(row.user_id), fromProfileRow(row)]));
}

async function saveProfile(user) {
  try {
    await query(
      `INSERT INTO user_profile (user_id, name, avatar, email) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), avatar = VALUES(avatar), email = VALUES(email)`,
      [user.id, user.name, user.avatar, user.email],
    );
  } catch (error) {
    console.error('[directory] user_profile 写入失败：', error.message);
  }
}

async function fetchDirectory() {
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
  const body = await response.json().catch(() => null);
  if (!body || !Array.isArray(body.users)) throw new Error('users/list 响应缺少 users 数组');
  const users = new Map();
  for (const raw of body.users) {
    const user = normalize(raw);
    if (user.id) users.set(user.id, user);
  }
  return users;
}

async function load() {
  if (!ssoConfigured()) {
    // 没有真实目录可查：DEV_LOGIN 的演示身份由 withDemo() 合并，否则让 snapshot() 走降级。
    if (devLoginEnabled()) return new Map();
    throw new Error('未配置 SSO_ISSUER / SSO_CLIENT_ID / SSO_CLIENT_SECRET');
  }
  if (cached && Date.now() - cached.fetchedAt < ttlMs()) return cached.users;
  if (inflight) return inflight;
  inflight = fetchDirectory()
    .then((users) => {
      cached = { users, fetchedAt: Date.now() };
      loggedFailure = false;
      return users;
    })
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// DEV_LOGIN 只叠加演示身份；配置了 SSO 时仍然拉真实目录，密码登录的资格刷新依赖它。
function withDemo(users) {
  if (!devLoginEnabled()) return users;
  const merged = new Map(demoDirectory().map((user) => [user.id, user]));
  for (const [id, user] of users) merged.set(id, user);
  return merged;
}

// 取目录快照，永不抛错：失败时 stale=true，名字交给调用方降级。
export async function snapshot() {
  try {
    return { users: withDemo(await load()), stale: false };
  } catch (error) {
    // 连续失败只在第一次打日志，否则每个请求都会刷一行。
    if (!loggedFailure) {
      loggedFailure = true;
      console.error('[directory] 用户目录拉取失败，展示降级为「未知用户」：', error.message);
    }
    return { users: withDemo(cached?.users ?? new Map()), stale: true };
  }
}

// 登录回调已经拿到了权威的 userinfo：先塞进缓存。这样即使 users/list 不可用，
// 当前用户自己也总有名字可显示（别人仍然可能是「未知用户」）。
export async function remember(raw) {
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
  await saveProfile(users.get(user.id));
}

// 目录里没有的人从 user_profile 落库缓存补。表很小（每个登录过的人一行），
// 一次全取比逐 id 拼 SQL 简单；目录可用时也没必要按 id 过滤。
async function readCachedProfiles(directory) {
  try {
    const rows = await query('SELECT user_id, name, avatar, email FROM user_profile');
    return rows
      .filter((row) => !directory.has(String(row.user_id)))
      .map(fromProfileRow);
  } catch (error) {
    console.error('[directory] user_profile 读取失败：', error.message);
    return [];
  }
}

export async function getUser(id) {
  if (!id) return null;
  const users = await getUsers([id]);
  return users.get(String(id)) ?? null;
}

// 目录优先，user_profile 补缺；两者都没有就是查无此人。
export async function getUsers(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean).map(String))];
  const found = new Map();
  if (wanted.length === 0) return found;
  const { users: directory } = await snapshot();
  const missing = [];
  for (const id of wanted) {
    const user = directory.get(id);
    if (user) found.set(id, user);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const cached = await readProfiles(missing);
    for (const [id, user] of cached) found.set(id, user);
  }
  return found;
}

// join 平台可能替还没登录过的人提交申请：known=true/false 是明确结论，null 表示目录不可用、不做判断。
export async function lookup(id) {
  const key = String(id ?? '').trim();
  if (!key) return { known: false, user: null };
  const { users: directory, stale } = await snapshot();
  const user = directory.get(key) ?? (await readProfiles([key])).get(key) ?? null;
  if (user) return { known: true, user };
  return { known: stale ? null : false, user: null };
}

export async function searchUsers({ q = '', page = 1, pageSize = 20 } = {}) {
  const { users: directory, stale } = await snapshot();
  // 目录 ∪ user_profile：登录过但目录查不到的人（或目录完全不可用时）靠缓存显示名字。
  const cached = await readCachedProfiles(directory);
  const term = String(q).trim().toLowerCase();
  let list = [...directory.values(), ...cached].filter((user) => user.active !== false);
  if (term) {
    list = list.filter((user) =>
      [user.name, user.username, user.email, user.id].some((value) =>
        value ? String(value).toLowerCase().includes(term) : false,
      ),
    );
  }
  list.sort((a, b) =>
    String(a.name || a.username || a.id).localeCompare(String(b.name || b.username || b.id), 'zh'),
  );
  const total = list.length;
  const offset = (page - 1) * pageSize;
  return { items: list.slice(offset, offset + pageSize), total, stale };
}

// 接口里引用某个用户时的统一形状；user 缺失说明目录里没有或目录不可用，前端显示「未知用户」。
export function userRef(id, user) {
  return {
    id: id ?? null,
    name: user?.name ?? null,
    username: user?.username ?? null,
    avatar: user?.avatar ?? null,
  };
}
