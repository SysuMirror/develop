import crypto from 'node:crypto';
import { Router } from 'express';
import { one, withTx } from '../db.js';
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
  if (!sub || sub.length > 64) throw badRequest('BAD_SSO_SUB', 'ssoSub 必填，且不超过 64 字符');
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

function parseName(value) {
  const name = String(value ?? '').trim();
  if (!name) return '开发者';
  if (name.length > 64) throw badRequest('BAD_NAME', 'name 不能超过 64 字符');
  return name;
}

function parseEmail(value) {
  const email = String(value ?? '').trim();
  if (!email) return null;
  if (email.length > 128) throw badRequest('BAD_EMAIL', 'email 不能超过 128 字符');
  return email;
}

// join 只传 SSO sub；开发者尚未在本平台登录过时，先建一条最小记录。
async function ensureDeveloper(ssoSub, name, email) {
  const existing = await one('SELECT id FROM developers WHERE sso_sub = ?', [ssoSub]);
  if (existing) return existing.id;
  try {
    const result = await withTx(async (conn) => {
      const [rows] = await conn.query('SELECT id FROM developers WHERE sso_sub = ?', [ssoSub]);
      if (rows.length > 0) return rows[0].id;
      const [inserted] = await conn.query('INSERT INTO developers (sso_sub, name, email) VALUES (?, ?, ?)', [
        ssoSub,
        name,
        email,
      ]);
      return inserted.insertId;
    });
    return result;
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const raced = await one('SELECT id FROM developers WHERE sso_sub = ?', [ssoSub]);
    if (!raced) throw error;
    return raced.id;
  }
}

async function loadProject(projectId) {
  const project = await one('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在');
  return project;
}

function submitApply(projectId, developerId, resumeUrl, note) {
  return withTx(async (conn) => {
    const [rows] = await conn.query(
      "SELECT id, status FROM applies WHERE project_id = ? AND developer_id = ? AND type = 'participant' FOR UPDATE",
      [projectId, developerId],
    );
    const existing = rows[0];
    // 已通过的申请优先返回，join 重试时不会因为已是成员而变成 409。
    if (existing?.status === 'accepted') {
      return { id: existing.id, status: 'accepted', duplicate: true, created: false };
    }

    const [memberships] = await conn.query(
      'SELECT id FROM project_member WHERE project_id = ? AND developer_id = ? LIMIT 1',
      [projectId, developerId],
    );
    if (memberships.length > 0) throw conflict('ALREADY_MEMBER', '该开发者已经是项目成员');

    if (!existing) {
      const [result] = await conn.query(
        `INSERT INTO applies (project_id, developer_id, type, status, note, resume_url, source)
         VALUES (?, ?, 'participant', 'waiting', ?, ?, 'join')`,
        [projectId, developerId, note ?? null, resumeUrl],
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
    const name = parseName(body.name);
    const email = parseEmail(body.email);

    const project = await loadProject(projectId);
    const developerId = await ensureDeveloper(ssoSub, name, email);

    let outcome;
    try {
      outcome = await submitApply(project.id, developerId, resumeUrl, note);
    } catch (error) {
      // 两个并发请求可能同时看不到记录；后插入的那个会撞唯一键，重试一次即可读到已有行。
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      outcome = await submitApply(project.id, developerId, resumeUrl, note);
    }

    res.status(outcome.created ? 201 : 200).json({
      id: outcome.id,
      status: outcome.status,
      developerId,
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
