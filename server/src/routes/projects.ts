import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { loadMembership, loadProject, roleOf, requireManager, requireOwner } from '../access.ts';
import { isDuplicateEntry, query, withTx } from '../db.ts';
import { getUsers, lookup, searchUsers, userRef } from '../directory.ts';
import { badRequest, conflict, forbidden, likeTerm, notFound, parsePaging, wrap } from '../http.ts';
import { deleteObject, storageConfigured } from '../minio.ts';
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

const PROJECT_STATUSES = ['recruiting', 'active', 'paused', 'archived'] as const;
const PROJECT_DIFFICULTIES = ['starter', 'standard'] as const;

function cleanStatus(raw: unknown, fallback: (typeof PROJECT_STATUSES)[number] = 'active') {
  if (raw == null || raw === '') return fallback;
  const value = String(raw);
  if (!(PROJECT_STATUSES as readonly string[]).includes(value)) throw badRequest('BAD_STATUS', '项目状态不合法');
  return value as (typeof PROJECT_STATUSES)[number];
}

function cleanDifficulty(raw: unknown, fallback: (typeof PROJECT_DIFFICULTIES)[number] = 'standard') {
  if (raw == null || raw === '') return fallback;
  const value = String(raw);
  if (!(PROJECT_DIFFICULTIES as readonly string[]).includes(value)) {
    throw badRequest('BAD_DIFFICULTY', '项目难度不合法');
  }
  return value as (typeof PROJECT_DIFFICULTIES)[number];
}

/** 技术栈标签：去重、限长、最多 10 个。 */
function cleanTechStack(raw: unknown): string[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const out: string[] = [];
  for (const item of list) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    if (value.length > 24) throw badRequest('BAD_TECH', '单个技术标签不超过 24 字');
    if (!out.includes(value)) out.push(value);
  }
  if (out.length > 10) throw badRequest('TOO_MANY_TECH', '技术标签最多 10 个');
  return out;
}

/** JSON 列在 mysql2 里可能是数组或字符串，统一读成数组。 */
function jsonListOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      /* 坏数据按空处理 */
    }
  }
  return [];
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
  SELECT p.id, p.title, p.misc, p.repo_url, p.repo_urls, p.dev_notes,
         p.status, p.difficulty, p.tech_stack, p.created_at, p.updated_at, p.leader_id,
         (SELECT COUNT(*) FROM project_member m2 WHERE m2.project_id = p.id) AS member_count,
         (SELECT COUNT(*) FROM demands d3 WHERE d3.project_id = p.id AND d3.status = 'waiting') AS waiting_demand_count,
         (SELECT COUNT(*) FROM applies a2 WHERE a2.project_id = p.id AND a2.status = 'waiting') AS pending_apply_count,
         CASE WHEN p.leader_id = ?
              THEN 'owner'
              ELSE (SELECT m.role FROM project_member m WHERE m.project_id = p.id AND m.user_id = ? LIMIT 1)
          END AS my_role,
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
    status: row.status,
    difficulty: row.difficulty,
    techStack: jsonListOf(row.tech_stack),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owner: row.leader_id ? userRef(row.leader_id, people.get(row.leader_id)) : null,
    memberCount: Number(row.member_count),
    waitingDemandCount: Number(row.waiting_demand_count),
    pendingApplyCount: Number(row.pending_apply_count),
    myRole: row.my_role || null,
    myApplyStatus: row.my_apply_status || null,
  };
}

async function loadSummary(userId: string, projectId: number): Promise<ProjectSummaryRow> {
  const [summary] = await query<ProjectSummaryRow>(`${PROJECT_SUMMARY} WHERE p.id = ?`, [
    userId,
    userId,
    userId,
    projectId,
  ]);
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
      // 搜索同时命中名称、说明与技术栈：列表只有一个搜索框，用户不该猜字段。
      // 技术栈是 JSON 列，转成字符串再 LIKE 才会按排序规则忽略大小写（JSON_SEARCH 区分大小写）。
      conditions.push(
        '(p.title LIKE ? OR p.misc LIKE ? OR CAST(COALESCE(p.tech_stack, JSON_ARRAY()) AS CHAR) LIKE ?)',
      );
      filterParams.push(term, term, term);
    }
    const statusFilter = String(req.query.status || '');
    if ((PROJECT_STATUSES as readonly string[]).includes(statusFilter)) {
      conditions.push('p.status = ?');
      filterParams.push(statusFilter);
    }
    const difficultyFilter = String(req.query.difficulty || '');
    if ((PROJECT_DIFFICULTIES as readonly string[]).includes(difficultyFilter)) {
      conditions.push('p.difficulty = ?');
      filterParams.push(difficultyFilter);
    }
    const tech = String(req.query.tech || '').trim();
    if (tech) {
      conditions.push('JSON_CONTAINS(COALESCE(p.tech_stack, JSON_ARRAY()), JSON_QUOTE(?))');
      filterParams.push(tech);
    }
    if (filter === 'mine-owner' || filter === 'mine-leader') {
      conditions.push(
        "EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = ? AND m.role = 'owner')",
      );
      filterParams.push(user.id);
    } else if (filter === 'mine-member') {
      conditions.push(
        "EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = ? AND m.role IN ('admin','member'))",
      );
      filterParams.push(user.id);
    } else if (filter === 'recruiting') {
      conditions.push("EXISTS (SELECT 1 FROM demands d WHERE d.project_id = p.id AND d.status = 'waiting')");
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query<ProjectSummaryRow>(
      `${PROJECT_SUMMARY} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      [user.id, user.id, user.id, ...filterParams, pageSize, offset],
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
        ORDER BY FIELD(m.role, 'owner', 'admin', 'member'), m.created_at`,
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
    const role = await roleOf(project, user.id);
    const memberIds = members.map((row) => row.user_id);
    const skillRows = memberIds.length
      ? await query<{ user_id: string; skills: unknown }>(
          `SELECT user_id, skills FROM user_profile WHERE user_id IN (${memberIds.map(() => '?').join(',')})`,
          memberIds,
        )
      : [];
    const skillsById = new Map(skillRows.map((row) => [row.user_id, jsonListOf(row.skills)]));
    const owners = members
      .filter((row) => row.role === 'owner')
      .map((row) => ({
        userId: row.user_id,
        name: people.get(row.user_id)?.name ?? null,
        avatar: people.get(row.user_id)?.avatar ?? null,
        username: people.get(row.user_id)?.username ?? null,
      }));
    res.json({
      ...mapSummary(summary, people),
      // 开发说明只对成员开放；非成员拿到的永远是 null。
      devNotes: role ? project.dev_notes : null,
      owners,
      members: members.map((row) => ({
        userId: row.user_id,
        name: people.get(row.user_id)?.name ?? null,
        avatar: people.get(row.user_id)?.avatar ?? null,
        skills: skillsById.get(row.user_id) ?? [],
        role: row.role,
        isPrimary: row.user_id === project.leader_id,
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
        isMember: Boolean(role),
        role,
        isOwner: role === 'owner',
        isAdmin: role === 'owner' || role === 'admin',
        canApply: !role,
        canManage: role === 'owner' || role === 'admin',
        canDelete: role === 'owner',
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
    const status = cleanStatus(req.body?.status);
    const difficulty = cleanDifficulty(req.body?.difficulty);
    const techStack = cleanTechStack(req.body?.techStack);
    if (!title || title.length > 128) throw badRequest('BAD_TITLE', '项目名称必填，且不超过 128 字');
    const projectId = await withTx(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        `INSERT INTO projects (title, misc, repo_url, repo_urls, dev_notes, status, difficulty, tech_stack, leader_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          misc,
          repoUrls[0] ?? null,
          JSON.stringify(repoUrls),
          devNotes,
          status,
          difficulty,
          JSON.stringify(techStack),
          user.id,
          user.id,
        ],
      );
      const newId = result.insertId;
      await conn.query('INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, ?)', [
        newId,
        user.id,
        'owner',
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

// 所有者/管理员按 id 直接拉人进项目（不走申请）。可顺便授予“管理员”。
router.post(
  '/projects/:id/members',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireManager(project, user);
    const targetId = String(req.body?.userId ?? '').trim();
    if (!targetId || targetId.length > 64) throw badRequest('BAD_USER', '缺少要邀请的用户');
    const role = String(req.body?.role ?? 'member');
    if (role !== 'member' && role !== 'admin') throw badRequest('BAD_ROLE', '邀请角色只能是 member 或 admin');
    if (targetId === project.leader_id) throw conflict('ALREADY_MEMBER', '对方已经是项目成员');
    if (await loadMembership(project.id, targetId)) throw conflict('ALREADY_MEMBER', '对方已经是项目成员');
    // 管理员只能邀请普通成员；授予管理员/所有者需要 owner 权限。
    if (role === 'admin' && (await roleOf(project, user.id)) !== 'owner') {
      throw forbidden('NOT_OWNER', '只有项目所有者可以授予管理员');
    }
    const found = await lookup(targetId);
    if (found.known === false) throw notFound('统一身份目录里找不到这个账号');
    if (found.known === null) throw conflict('DIRECTORY_UNAVAILABLE', '身份目录暂时不可用，稍后再试');
    try {
      await query('INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, ?)', [
        project.id,
        targetId,
        role,
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
        role,
      },
    });
  }),
);

// 调整成员角色：member ↔ admin 由所有者操作；授予/撤销 owner 只归首任 owner。
router.patch(
  '/projects/:id/members/:userId',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireOwner(project, user);
    const targetId = String(req.params.userId || '');
    const role = String(req.body?.role ?? '');
    if (!['owner', 'admin', 'member'].includes(role)) throw badRequest('BAD_ROLE', '角色只能是 owner / admin / member');
    if (targetId === project.leader_id) throw forbidden('PRIMARY_OWNER_LOCKED', '首任所有者不能被改角色');
    const membership = await loadMembership(project.id, targetId);
    if (!membership) throw notFound('该用户不是项目成员');
    if (membership.role === 'owner' && project.leader_id !== user.id) {
      throw forbidden('NOT_PRIMARY_OWNER', '只有首任所有者可以调整其他所有者的角色');
    }
    if (role === 'owner' && project.leader_id !== user.id) {
      throw forbidden('NOT_PRIMARY_OWNER', '只有首任所有者可以任命新的所有者');
    }
    await query('UPDATE project_member SET role = ? WHERE project_id = ? AND user_id = ?', [
      role,
      project.id,
      targetId,
    ]);
    res.json({ ok: true, role });
  }),
);

router.patch(
  '/projects/:id',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireManager(project, user);
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
    if (req.body?.status !== undefined) patch.status = cleanStatus(req.body.status, project.status);
    if (req.body?.difficulty !== undefined) patch.difficulty = cleanDifficulty(req.body.difficulty, project.difficulty);
    if (req.body?.techStack !== undefined) patch.tech_stack = JSON.stringify(cleanTechStack(req.body.techStack));
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
    await requireOwner(project, user);
    const [blocking] = await query<{ n: number | string }>(
      "SELECT COUNT(*) AS n FROM demands WHERE project_id = ? AND status IN ('accepted', 'review')",
      [project.id],
    );
    if (Number(blocking?.n ?? 0) > 0) throw conflict('DEMAND_IN_PROGRESS', '项目还有进行中的需求，先完成后再删除');
    const fileRows = await query<{ object_key: string }>('SELECT object_key FROM project_file WHERE project_id = ?', [
      project.id,
    ]);
    const members = await withTx(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>('SELECT user_id FROM project_member WHERE project_id = ?', [
        project.id,
      ]);
      await conn.query('DELETE FROM project_file WHERE project_id = ?', [project.id]);
      await conn.query('DELETE FROM applies WHERE project_id = ?', [project.id]);
      await conn.query('DELETE FROM demands WHERE project_id = ?', [project.id]);
      await conn.query('DELETE FROM project_member WHERE project_id = ?', [project.id]);
      await conn.query('DELETE FROM projects WHERE id = ?', [project.id]);
      return rows.map((row) => String(row.user_id));
    });
    // 对象存储里的附件跟着项目一起清掉；失败只记日志，不回滚已删除的项目。
    if (storageConfigured()) {
      for (const file of fileRows) {
        try {
          await deleteObject(file.object_key);
        } catch (error) {
          console.error('[projects] 删除附件对象失败', file.object_key, error instanceof Error ? error.message : String(error));
        }
      }
    }
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
    if ((await roleOf(project, user.id)) === 'owner') {
      throw conflict('OWNER_CANNOT_LEAVE', '所有者不能直接退出：请先由首任所有者调整角色，或删除项目');
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
    await requireManager(project, user);
    const targetId = String(req.params.userId);
    if (targetId === project.leader_id) throw forbidden('CANNOT_REMOVE_PRIMARY_OWNER', '不能移除首任所有者');
    const membership = await loadMembership(project.id, targetId);
    if (!membership) throw notFound('该用户不是项目成员');
    const actorRole = await roleOf(project, user.id);
    if (membership.role === 'owner' && project.leader_id !== user.id) {
      throw forbidden('NOT_PRIMARY_OWNER', '只有首任所有者可以移除其他所有者');
    }
    if (membership.role === 'admin' && actorRole !== 'owner') {
      throw forbidden('NOT_OWNER', '只有项目所有者可以移除管理员');
    }
    await query('DELETE FROM project_member WHERE project_id = ? AND user_id = ?', [project.id, targetId]);
    await syncAfterRemoval(targetId);
    res.json({ ok: true });
  }),
);

export type { ProjectRow };
export default router;
