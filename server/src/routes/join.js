import crypto from 'node:crypto';
import { Router } from 'express';
import { one, withTx } from '../db.js';
import { lookup } from '../directory.js';
import { ApiError, badRequest, conflict, wrap } from '../http.js';

const router = Router();

const MAX_RESUME_URL = 2048;
const MAX_NOTE = 500;

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 只接受后端到后端的凭证：Authorization: Bearer <key> 或 X-Api-Key: <key>。
function providedKey(req) {
  const authorization = req.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return (req.get('x-api-key') || '').trim();
}

router.use((req, res, next) => {
  const expected = (process.env.JOIN_API_KEY || '').trim();
  if (!expected) {
    // 直接响应，避免全局错误处理把 5xx 的 message 统一替换掉。
    res.status(503).json({ error: { code: 'JOIN_NOT_CONFIGURED', message: 'join 接入尚未配置 JOIN_API_KEY' } });
    return;
  }
  if (!safeEqual(providedKey(req), expected)) {
    next(new ApiError(401, 'INVALID_API_KEY', '接口密钥无效'));
    return;
  }
  next();
});

function parseSsoSub(value) {
  const sub = String(value ?? '').trim();
  // sub 就是 UniSSO users.id，定长 36；本地表也只用 36 存。
  if (!sub || sub.length > 36) throw badRequest('BAD_SSO_SUB', 'ssoSub 必填，且不超过 36 字符');
  return sub;
}

function parseProjectId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('BAD_PROJECT_ID', 'projectId 必须是正整数');
  return id;
}

function parseResumeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > MAX_RESUME_URL) {
    throw badRequest('BAD_RESUME_URL', `resumeUrl 必填，且不超过 ${MAX_RESUME_URL} 字符`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('BAD_RESUME_URL', 'resumeUrl 不是合法 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('BAD_RESUME_URL', 'resumeUrl 只支持 http/https');
  }
  if (url.username || url.password) {
    throw badRequest('BAD_RESUME_URL', 'resumeUrl 不能包含用户名或密码');
  }
  return url.toString();
}

function parseNote(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const note = String(value).trim();
  if (note.length > MAX_NOTE) throw badRequest('BAD_NOTE', `note 不能超过 ${MAX_NOTE} 字符`);
  return note || null;
}

// 用户实体在 UniSSO：这里只确认目录里确实有这个人，不往本地写任何用户记录。
// 目录不可用时 known 为 null，不做拦截（否则 SSO 抖动会让整个接入不可用）。
async function ensureUser(ssoSub) {
  const { known } = await lookup(ssoSub);
  if (known === false) throw new ApiError(404, 'USER_NOT_FOUND', 'UniSSO 中不存在该用户');
  return ssoSub;
}

async function loadProject(projectId) {
  const project = await one('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在');
  return project;
}

function submitApply(projectId, userId, resumeUrl, note) {
  return withTx(async (conn) => {
    const [rows] = await conn.query(
      "SELECT id, status FROM applies WHERE project_id = ? AND user_id = ? AND type = 'participant' FOR UPDATE",
      [projectId, userId],
    );
    const existing = rows[0];
    // 已通过的申请优先返回，join 重试时不会因为已是成员而变成 409。
    if (existing?.status === 'accepted') {
      return { id: existing.id, status: 'accepted', duplicate: true, created: false };
    }

    const [memberships] = await conn.query(
      'SELECT id FROM project_member WHERE project_id = ? AND user_id = ? LIMIT 1',
      [projectId, userId],
    );
    if (memberships.length > 0) throw conflict('ALREADY_MEMBER', '该用户已经是项目成员');

    if (!existing) {
      const [result] = await conn.query(
        `INSERT INTO applies (project_id, user_id, type, status, note, resume_url, source)
         VALUES (?, ?, 'participant', 'waiting', ?, ?, 'join')`,
        [projectId, userId, note ?? null, resumeUrl],
      );
      return { id: result.insertId, status: 'waiting', duplicate: false, created: true };
    }
    if (existing.status === 'waiting') {
      await conn.query(
        "UPDATE applies SET note = COALESCE(?, note), resume_url = ?, source = 'join' WHERE id = ?",
        [note ?? null, resumeUrl, existing.id],
      );
      return { id: existing.id, status: 'waiting', duplicate: true, created: false };
    }
    // 被拒绝过的申请允许重新打开，和站内申请的行为保持一致。
    await conn.query(
      `UPDATE applies
          SET status = 'waiting', note = COALESCE(?, note), resume_url = ?, source = 'join',
              decided_at = NULL, decided_by = NULL, created_at = NOW()
        WHERE id = ?`,
      [note ?? null, resumeUrl, existing.id],
    );
    return { id: existing.id, status: 'waiting', duplicate: false, created: false, reopened: true };
  });
}

router.post(
  '/applies',
  wrap(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ssoSub = parseSsoSub(body.ssoSub);
    const projectId = parseProjectId(body.projectId);
    const resumeUrl = parseResumeUrl(body.resumeUrl);
    const note = parseNote(body.note);

    const project = await loadProject(projectId);
    const userId = await ensureUser(ssoSub);

    let outcome;
    try {
      outcome = await submitApply(project.id, userId, resumeUrl, note);
    } catch (error) {
      // 两个并发请求可能同时看不到记录；后插入的那个会撞唯一键，重试一次即可读到已有行。
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      outcome = await submitApply(project.id, userId, resumeUrl, note);
    }

    res.status(outcome.created ? 201 : 200).json({
      id: outcome.id,
      status: outcome.status,
      userId,
      projectId: project.id,
      duplicate: outcome.duplicate,
      ...(outcome.reopened ? { reopened: true } : {}),
    });
  }),
);

router.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

export default router;
