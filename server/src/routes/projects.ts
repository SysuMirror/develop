import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { loadMembership, loadProject, requireLeader } from '../access.ts';
import { query, withTx } from '../db.ts';
import { getUsers, userRef } from '../directory.ts';
import { badRequest, conflict, forbidden, likeTerm, notFound, parsePaging, wrap } from '../http.ts';
import { revokeIfNoMembership } from '../qual-sync.ts';
import type { DemandJoinedRow, ProjectRow, ProjectSummaryRow, Role } from '../types.ts';

const router = Router();

// 成员关系变更后，不再属于任何项目的用户撤销 UniSSO 资格；失败不阻塞业务。
async function syncAfterRemoval(userId: string): Promise<void> {
  try {
    await revokeIfNoMembership(userId);
  } catch (error) {
    console.error('[qual-sync] revoke check failed', error instanceof Error ? error.message : String(error));
  }
}

const PROJECT_SUMMARY = `
  SELECT p.id, p.title, p.misc, p.created_at, p.updated_at, p.leader_id,
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
        ORDER BY FIELD(d.status, 'waiting', 'accepted', 'completed'), d.created_at DESC`,
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
    if (!title || title.length > 128) throw badRequest('BAD_TITLE', '项目名称必填，且不超过 128 字');
    const projectId = await withTx(async (conn) => {
      const [result] = await conn.query<ResultSetHeader>(
        'INSERT INTO projects (title, misc, leader_id, created_by) VALUES (?, ?, ?, ?)',
        [title, misc, user.id, user.id],
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
    if (Object.keys(patch).length === 0) throw badRequest('NOTHING_TO_UPDATE', '没有可更新的字段');
    await query('UPDATE projects SET ? WHERE id = ?', [patch, project.id]);
    const updated = await loadSummary(user.id, project.id);
    res.json(mapSummary(updated, await getUsers([updated.leader_id])));
  }),
);

router.post(
  '/projects/:id/transfer',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireLeader(project, user);
    const targetId = String(req.body?.userId ?? '').trim();
    if (!targetId) throw badRequest('BAD_REQUEST', '缺少 userId');
    if (targetId === user.id) throw badRequest('BAD_REQUEST', '不能转让给自己');
    const target = await loadMembership(project.id, targetId);
    if (!target) throw notFound('目标用户不是项目成员');
    await withTx(async (conn) => {
      await conn.query("UPDATE project_member SET role = 'participant' WHERE project_id = ? AND user_id = ?", [
        project.id,
        user.id,
      ]);
      await conn.query("UPDATE project_member SET role = 'leader' WHERE project_id = ? AND user_id = ?", [
        project.id,
        targetId,
      ]);
      await conn.query('UPDATE projects SET leader_id = ? WHERE id = ?', [targetId, project.id]);
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/projects/:id/release',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireLeader(project, user);
    await withTx(async (conn) => {
      await conn.query('DELETE FROM project_member WHERE project_id = ? AND user_id = ?', [project.id, user.id]);
      await conn.query('UPDATE projects SET leader_id = NULL WHERE id = ?', [project.id]);
    });
    await syncAfterRemoval(user.id);
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
      throw conflict('LEADER_MUST_TRANSFER', 'leader 需要先转让或释放项目，再退出');
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
