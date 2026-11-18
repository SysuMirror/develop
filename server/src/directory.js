// 用户资料目录。
//
// 用户实体只存在于 UniSSO 的 users 表里，本平台不保存用户表，因此展示名字、头像、邮箱时
// 只能向 UniSSO 要：POST /api/oauth/users/list（M2M，返回全量用户，没有分页也没有按 id 查）。
//
// 缓存策略是惰性的：启动时不预取、不做定时刷新，只有某个请求确实需要资料时才拉一次，
// 之后在 SSO_DIRECTORY_TTL_SECONDS 内复用同一份结果。拉取失败时沿用上一次成功的结果，
// 从未成功过就把名字留空（前端显示「未知用户」），不让页面 500。
import { demoDirectory } from './demo-users.js';
import { devLoginEnabled, ssoCredentials } from './sso-config.js';

const REQUEST_TIMEOUT_MS = 5000;

let cached = null; // { users: Map<string, user>, fetchedAt: number }
let inflight = null;
let lastError = null;

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
  if (devLoginEnabled()) {
    // 本地联调不查 SSO，用写死的演示用户，保证页面有名字。
    return new Map(demoDirectory().map((user) => [user.id, user]));
  }
  if (cached && Date.now() - cached.fetchedAt < ttlMs()) return cached.users;
  if (inflight) return inflight;
  inflight = fetchDirectory()
    .then((users) => {
      cached = { users, fetchedAt: Date.now() };
      lastError = null;
      return users;
    })
    .catch((error) => {
      lastError = error;
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// 取目录快照，永不抛错：失败时 stale=true，名字交给调用方降级。
export async function snapshot() {
  try {
    return { users: await load(), stale: false };
  } catch (error) {
    if (lastError === error) {
      console.error('[directory] 用户目录拉取失败，展示降级为「未知用户」：', error.message);
    }
    return { users: cached?.users ?? new Map(), stale: true };
  }
}

export async function getUser(id) {
  if (!id) return null;
  const { users } = await snapshot();
  return users.get(String(id)) ?? null;
}

export async function getUsers(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean).map(String))];
  const found = new Map();
  if (wanted.length === 0) return found;
  const { users } = await snapshot();
  for (const id of wanted) {
    const user = users.get(id);
    if (user) found.set(id, user);
  }
  return found;
}

// join 平台可能替还没登录过的人提交申请：known=true/false 是明确结论，null 表示目录不可用、不做判断。
export async function lookup(id) {
  const key = String(id ?? '').trim();
  if (!key) return { known: false, user: null };
  const { users, stale } = await snapshot();
  const user = users.get(key) ?? null;
  if (user) return { known: true, user };
  return { known: stale ? null : false, user: null };
}

export async function searchUsers({ q = '', page = 1, pageSize = 20 } = {}) {
  const { users, stale } = await snapshot();
  const term = String(q).trim().toLowerCase();
  let list = [...users.values()].filter((user) => user.active !== false);
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
