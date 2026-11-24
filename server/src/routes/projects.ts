import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { loadMembership, loadProject, requireLeader } from '../access.ts';
import { isDuplicateEntry, query, withTx } from '../db.ts';
import { getUsers, lookup, searchUsers, userRef } from '../directory.ts';
import { badRequest, conflict, forbidden, likeTerm, notFound, parsePaging, wrap } from '../http.ts';
import { revokeIfNoMembership } from '../qual-sync.ts';
import type { DemandJoinedRow, ProjectRow, ProjectSummaryRow, Role } from '../types.ts';

const router = Router();

/** 仓库地址（可多个）：只接受 http(s)，去重，最多 10 个。 */
const MAX_REPOS = 10;

function cleanRepoUrls(raw: unknown): string[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of list) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    if (value.length > 512) throw badRequest('BAD_REPO_URL', '仓库地址过长');
    if (!/^https?:\/\//i.test(value)) throw badRequest('BAD_REPO_URL', '仓库地址需要以 http:// 或 https:// 开头');
    if (!out.includes(value)) out.push(value);
  }
  if (out.length > MAX_REPOS) throw badRequest('TOO_MANY_REPOS', `最多 ${MAX_REPOS} 个仓库地址`);
  return out;
}

/** 读库时兼容单仓库时代的数据。 */
function repoUrlsOf(row: ProjectRow): string[] {
  const raw = row.repo_urls;
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      /* 坏数据按空处理，回落到 repo_url */
    }
  }
  const out = list.map((item) => String(item)).filter((item) => item.length > 0);
  if (out.length === 0 && row.repo_url) out.push(row.repo_url);
  return out;
}

/** 开发说明只给成员看；空串按“没填”处理。 */
function cleanDevNotes(raw: unknown): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  return value ? value : null;
}

// 成员关系变更后，不再属于任何项目的用户撤销 UniSSO 资格；失败不阻塞业务。
async function syncAfterRemoval(userId: string): Promise<void> {
  try {
    await revokeIfNoMembership(userId);
  } catch (error) {
    console.error('[qual-sync] revoke check failed', error instanceof Error ? error.message : String(error));
  }
}

const PROJECT_SUMMARY = `
  SELECT p.id, p.title, p.misc, p.repo_url, p.repo_urls, p.created_at, p.updated_at, p.leader_id,
         (SELECT COUNT(*) FROM project_member m2 WHERE m2.project_id = p.id) AS member_count,
         (SELECT COUNT(*) FROM demands d3 WHERE d3.project_id = p.id AND d3.status = 'waiting') AS waiting_demand_count,
         (SELECT COUNT(*) FROM applies a2 WHERE a2.project_id = p.id AND a2.status = 'waiting') AS pending_apply_count,
         (SELECT m.role FROM project_member m WHERE m.project_id = p.id AND m.user_id = ? LIMIT 1) AS my_role,
         (SELECT a.status FROM applies a WHERE a.project_id = p.id AND a.user_id = ? AND a.status = 'waiting'
           ORDER BY a.id LIMIT 1) AS my_apply_status
    FROM projects p`;

interface MemberRow extends RowDataPacket {
  user_id: string;
  role: Role;
  created_at: Date;
}

interface ProjectDemandRow extends RowDataPacket {
  id: number;
  title: string;
  detail: string | null;
  status: DemandJoinedRow['status'];
  created_at: Date;
  user_id: string | null;
}

function mapSummary(row: ProjectSummaryRow, people: Awaited<ReturnType<typeof getUsers>>) {
  return {
    id: row.id,
    title: row.title,
    misc: row.misc,
    repoUrls: repoUrlsOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leader: row.leader_id ? userRef(row.leader_id, people.get(row.leader_id)) : null,
    memberCount: Number(row.member_count),
    waitingDemandCount: Number(row.waiting_demand_count),
    pendingApplyCount: Number(row.pending_apply_count),
    myRole: row.my_role || null,
    myApplyStatus: row.my_apply_status || null,
  };
}

async function loadSummary(userId: string, projectId: number): Promise<ProjectSummaryRow> {
  const [summary] = await query<ProjectSummaryRow>(`${PROJECT_SUMMARY} WHERE p.id = ?`, [userId, userId, projectId]);
  if (!summary) throw notFound('项目不存在');
  return summary;
}

router.get(
  '/projects',
  wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePaging(req);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const term = likeTerm(req.query.q);
    const filter = String(req.query.filter || 'all');
    const conditions: string[] = [];
    const filterParams: unknown[] = [];
    if (term) {
      conditions.push('p.title LIKE ?');
      filterParams.push(term);
    }
    if (filter === 'mine-leader') {
      conditions.push('p.leader_id = ?');
      filterParams.push(user.id);
    } else if (filter === 'mine-member') {
      conditions.push(
        "EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = ? AND m.role = 'participant')",
      );
      filterParams.push(user.id);
    } else if (filter === 'recruiting') {
      conditions.push("EXISTS (SELECT 1 FROM demands d WHERE d.project_id = p.id AND d.status = 'waiting')");
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query<ProjectSummaryRow>(
      `${PROJECT_SUMMARY} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      [user.id, user.id, ...filterParams, pageSize, offset],
    );
    const [counted] = await query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM projects p ${where}`,
      filterParams,
    );
    const people = await getUsers(rows.map((row) => row.leader_id));
    res.json({ items: rows.map((row) => mapSummary(row, people)), total: Number(counted?.total ?? 0), page, pageSize });
  }),
);

router.get(
  '/projects/:id',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const summary = await loadSummary(user.id, project.id);
    const members = await query<MemberRow>(
      `SELECT m.user_id, m.role, m.created_at
         FROM project_member m
        WHERE m.project_id = ?
        ORDER BY FIELD(m.role, 'leader', 'participant'), m.created_at`,
      [project.id],
    );
    const demands = await query<ProjectDemandRow>(
      `SELECT d.id, d.title, d.detail, d.status, d.created_at, d.user_id
         FROM demands d
        WHERE d.project_id = ?
        ORDER BY FIELD(d.status, 'waiting', 'accepted', 'review', 'completed', 'suspended'), d.created_at DESC`,
      [project.id],
    );
    const people = await getUsers([
      summary.leader_id,
      ...members.map((row) => row.user_id),
      ...demands.map((row) => row.user_id),
    ]);
    const membership = await loadMembership(project.id, user.id);
    res.json({
      ...mapSummary(summary, people),
      // 开发说明只对成员开放；非成员拿到的永远是 null。
      devNotes: membership ? project.dev_notes : null,
      members: members.map((row) => ({
        userId: row.user_id,
        name: people.get(row.user_id)?.name ?? null,
        avatar: people.get(row.user_id)?.avatar ?? null,
        role: row.role,
        joinedAt: row.created_at,
      })),
      demands: demands.map((row) => ({
        id: row.id,
        title: row.title,
        detail: row.detail,
        status: row.status,
        createdAt: row.created_at,
        assignee: row.user_id ? userRef(row.user_id, people.get(row.user_id)) : null,
      })),
      permissions: {
        isMember: Boolean(membership),
        isLeader: project.leader_id === user.id,
        canApply: !membership,
        canManage: project.leader_id === user.id,
      },
    });
  }),
);

router.post(
  '/projects',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const title = String(req.body?.title ?? '').trim();
    const misc = req.body?.misc == null ? null : String(req.body.misc).trim();
    const repoUrls = cleanRepoUrls(
      req.body?.repoUrls !== undefined ? req.body.repoUrls : req.body?.repoUrl !== undefined ? [req.body.repoUrl] : [],
    );
    const devNotes = cleanDevNotes(req.body?.devNotes);
    if (!title || title.length > 128) throw badRequest('BAD_TITLE', '项目名称必填，且不超过 128 字');
    const projectId = await withTx(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        'INSERT INTO projects (title, misc, repo_url, repo_urls, dev_notes, leader_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [title, misc, repoUrls[0] ?? null, JSON.stringify(repoUrls), devNotes, user.id, user.id],
      );
      const newId = result.insertId;
      await conn.query('INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, ?)', [
        newId,
        user.id,
        'leader',
      ]);
      return newId;
    });
    const created = await loadSummary(user.id, projectId);
    res.status(201).json(mapSummary(created, await getUsers([created.leader_id])));
  }),
);

// 邀请成员用的人名/ID 搜索：先按 sub、用户名、姓名、邮箱模糊匹配，再按相关度排序。
router.get(
  '/directory/search',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const term = String(req.query.q ?? '').trim();
    if (!term) {
      res.json({ items: [] });
      return;
    }
    const projectId = Number(req.query.projectId);
    const people = await searchUsers(term, 12);
    let memberIds = new Set<string>();
    if (Number.isInteger(projectId) && projectId > 0) {
      const rows = await query<{ user_id: string }>('SELECT user_id FROM project_member WHERE project_id = ?', [projectId]);
      memberIds = new Set(rows.map((row) => String(row.user_id)));
    }
    res.json({
      items: people.map((person) => ({
        id: person.id,
        name: person.name,
        username: person.username,
        avatar: person.avatar,
        email: person.email,
        developer: person.developer,
        isMember: memberIds.has(person.id),
      })),
    });
  }),
);

// leader 按 id 直接拉人进项目（不走申请）。对方必须是统一身份目录里存在的账号。
router.post(
  '/projects/:id/members',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireLeader(project, user);
    const targetId = String(req.body?.userId ?? '').trim();
    if (!targetId || targetId.length > 64) throw badRequest('BAD_USER', '缺少要邀请的用户');
    if (targetId === project.leader_id) throw conflict('ALREADY_MEMBER', '对方已经是项目成员');
    if (await loadMembership(project.id, targetId)) throw conflict('ALREADY_MEMBER', '对方已经是项目成员');
    const found = await lookup(targetId);
    if (found.known === false) throw notFound('统一身份目录里找不到这个账号');
    if (found.known === null) throw conflict('DIRECTORY_UNAVAILABLE', '身份目录暂时不可用，稍后再试');
    try {
      await query("INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, 'participant')", [
        project.id,
        targetId,
      ]);
    } catch (error) {
      if (isDuplicateEntry(error)) throw conflict('ALREADY_MEMBER', '对方已经是项目成员');
      throw error;
    }
    res.status(201).json({
      ok: true,
      member: {
        userId: targetId,
        name: found.user?.name ?? null,
        avatar: found.user?.avatar ?? null,
        role: 'participant' as const,
      },
    });
  }),
);

router.patch(
  '/projects/:id',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireLeader(project, user);
    const patch: Record<string, string | null> = {};
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title || title.length > 128) throw badRequest('BAD_TITLE', '项目名称必填，且不超过 128 字');
      patch.title = title;
    }
    if (req.body?.misc !== undefined) patch.misc = req.body.misc == null ? null : String(req.body.misc).trim();
    if (req.body?.repoUrls !== undefined || req.body?.repoUrl !== undefined) {
      const repoUrls = cleanRepoUrls(req.body.repoUrls !== undefined ? req.body.repoUrls : [req.body.repoUrl]);
      patch.repo_urls = JSON.stringify(repoUrls);
      patch.repo_url = repoUrls[0] ?? null;
    }
    if (req.body?.devNotes !== undefined) patch.dev_notes = cleanDevNotes(req.body.devNotes);
    if (Object.keys(patch).length === 0) throw badRequest('NOTHING_TO_UPDATE', '没有可更新的字段');
    await query('UPDATE projects SET ? WHERE id = ?', [patch, project.id]);
    const updated = await loadSummary(user.id, project.id);
    res.json(mapSummary(updated, await getUsers([updated.leader_id])));
  }),
);

router.delete(
  '/projects/:id',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireLeader(project, user);
    const [blocking] = await query<{ n: number | string }>(
      "SELECT COUNT(*) AS n FROM demands WHERE project_id = ? AND status IN ('accepted', 'review')",
      [project.id],
    );
    if (Number(blocking?.n ?? 0) > 0) throw conflict('DEMAND_IN_PROGRESS', '项目还有进行中的需求，先完成后再删除');
    const members = await withTx(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>('SELECT user_id FROM project_member WHERE project_id = ?', [
        project.id,
      ]);
      await conn.query('DELETE FROM applies WHERE project_id = ?', [project.id]);
      await conn.query('DELETE FROM demands WHERE project_id = ?', [project.id]);
      await conn.query('DELETE FROM project_member WHERE project_id = ?', [project.id]);
      await conn.query('DELETE FROM projects WHERE id = ?', [project.id]);
      return rows.map((row) => String(row.user_id));
    });
    // 项目连同成员关系一起消失，逐个检查是否还需要开发者资格（可能仍在别的项目里）。
    for (const memberId of new Set([...members, project.leader_id])) {
      if (memberId) await syncAfterRemoval(memberId);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/projects/:id/members/me',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    if (project.leader_id === user.id) {
      throw conflict('LEADER_CANNOT_LEAVE', 'leader 不能退出项目；不需要它时请删除项目');
    }
    const membership = await loadMembership(project.id, user.id);
    if (!membership) throw notFound('你不是该项目成员');
    await query('DELETE FROM project_member WHERE project_id = ? AND user_id = ?', [project.id, user.id]);
    await syncAfterRemoval(user.id);
    res.json({ ok: true });
  }),
);

router.delete(
  '/projects/:id/members/:userId',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireLeader(project, user);
    const targetId = String(req.params.userId);
    if (targetId === project.leader_id) throw forbidden('CANNOT_FIRE_LEADER', '不能移除 leader');
    const membership = await loadMembership(project.id, targetId);
    if (!membership) throw notFound('该用户不是项目成员');
    await query('DELETE FROM project_member WHERE project_id = ? AND user_id = ?', [project.id, targetId]);
    await syncAfterRemoval(targetId);
    res.json({ ok: true });
  }),
);

export type { ProjectRow };
export default router;
