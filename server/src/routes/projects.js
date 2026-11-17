import { Router } from 'express';
import { loadMembership, loadProject, requireLeader } from '../access.js';
import { query, withTx } from '../db.js';
import { badRequest, conflict, forbidden, likeTerm, notFound, parsePaging, wrap } from '../http.js';
import { revokeIfNoMembership } from '../qual-sync.js';

const router = Router();

// 成员关系变更后，不再属于任何项目的开发者撤销 UniSSO 资格；失败不阻塞业务。
async function syncAfterRemoval(developerId) {
  try {
    await revokeIfNoMembership(developerId);
  } catch (error) {
    console.error('[qual-sync] revoke check failed', error.message);
  }
}

const PROJECT_SUMMARY = `
  SELECT p.id, p.title, p.misc, p.created_at, p.updated_at, p.leader_id,
         ld.name AS leader_name, ld.avatar AS leader_avatar,
         (SELECT COUNT(*) FROM project_member m2 WHERE m2.project_id = p.id) AS member_count,
         (SELECT COUNT(*) FROM demands d3 WHERE d3.project_id = p.id AND d3.status = 'waiting') AS waiting_demand_count,
         (SELECT COUNT(*) FROM applies a2 WHERE a2.project_id = p.id AND a2.status = 'waiting') AS pending_apply_count,
         (SELECT m.role FROM project_member m WHERE m.project_id = p.id AND m.developer_id = ? LIMIT 1) AS my_role,
         (SELECT a.status FROM applies a WHERE a.project_id = p.id AND a.developer_id = ? AND a.status = 'waiting'
           ORDER BY a.id LIMIT 1) AS my_apply_status
    FROM projects p
    LEFT JOIN developers ld ON ld.id = p.leader_id`;

function mapSummary(row) {
  return {
    id: row.id,
    title: row.title,
    misc: row.misc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leader: row.leader_id ? { id: row.leader_id, name: row.leader_name, avatar: row.leader_avatar } : null,
    memberCount: Number(row.member_count),
    waitingDemandCount: Number(row.waiting_demand_count),
    pendingApplyCount: Number(row.pending_apply_count),
    myRole: row.my_role || null,
    myApplyStatus: row.my_apply_status || null,
  };
}

router.get(
  '/projects',
  wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePaging(req);
    const user = req.user;
    const term = likeTerm(req.query.q);
    const filter = String(req.query.filter || 'all');
    const conditions = [];
    const filterParams = [];
    if (term) {
      conditions.push('p.title LIKE ?');
      filterParams.push(term);
    }
    if (filter === 'mine-leader') {
      conditions.push('p.leader_id = ?');
      filterParams.push(user.id);
    } else if (filter === 'mine-member') {
      conditions.push(
        "EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.developer_id = ? AND m.role = 'participant')",
      );
      filterParams.push(user.id);
    } else if (filter === 'recruiting') {
      conditions.push("EXISTS (SELECT 1 FROM demands d WHERE d.project_id = p.id AND d.status = 'waiting')");
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query(`${PROJECT_SUMMARY} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`, [
      user.id,
      user.id,
      ...filterParams,
      pageSize,
      offset,
    ]);
    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM projects p ${where}`,
      filterParams,
    );
    res.json({ items: rows.map(mapSummary), total: Number(total), page, pageSize });
  }),
);

router.get(
  '/projects/:id',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    const [summary] = await query(`${PROJECT_SUMMARY} WHERE p.id = ?`, [user.id, user.id, project.id]);
    const members = await query(
      `SELECT m.developer_id, m.role, m.created_at, d.name, d.avatar
         FROM project_member m JOIN developers d ON d.id = m.developer_id
        WHERE m.project_id = ?
        ORDER BY FIELD(m.role, 'leader', 'participant'), m.created_at`,
      [project.id],
    );
    const demands = await query(
      `SELECT d.id, d.title, d.detail, d.status, d.created_at, d.developer_id, a.name AS assignee_name
         FROM demands d LEFT JOIN developers a ON a.id = d.developer_id
        WHERE d.project_id = ?
        ORDER BY FIELD(d.status, 'waiting', 'accepted', 'completed'), d.created_at DESC`,
      [project.id],
    );
    const membership = await loadMembership(project.id, user.id);
    res.json({
      ...mapSummary(summary),
      members: members.map((row) => ({
        developerId: row.developer_id,
        name: row.name,
        avatar: row.avatar,
        role: row.role,
        joinedAt: row.created_at,
      })),
      demands: demands.map((row) => ({
        id: row.id,
        title: row.title,
        detail: row.detail,
        status: row.status,
        createdAt: row.created_at,
        assignee: row.developer_id ? { id: row.developer_id, name: row.assignee_name } : null,
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
    const title = String(req.body?.title ?? '').trim();
    const misc = req.body?.misc == null ? null : String(req.body.misc).trim();
    if (!title || title.length > 128) throw badRequest('BAD_TITLE', '项目名称必填，且不超过 128 字');
    const projectId = await withTx(async (conn) => {
      const [result] = await conn.query(
        'INSERT INTO projects (title, misc, leader_id, created_by) VALUES (?, ?, ?, ?)',
        [title, misc, req.user.id, req.user.id],
      );
      await conn.query('INSERT INTO project_member (project_id, developer_id, role) VALUES (?, ?, ?)', [
        result.insertId,
        req.user.id,
        'leader',
      ]);
      return result.insertId;
    });
    const [created] = await query(`${PROJECT_SUMMARY} WHERE p.id = ?`, [req.user.id, req.user.id, projectId]);
    res.status(201).json(mapSummary(created));
  }),
);

router.patch(
  '/projects/:id',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    requireLeader(project, req.user);
    const patch = {};
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title || title.length > 128) throw badRequest('BAD_TITLE', '项目名称必填，且不超过 128 字');
      patch.title = title;
    }
    if (req.body?.misc !== undefined) patch.misc = req.body.misc == null ? null : String(req.body.misc).trim();
    if (Object.keys(patch).length === 0) throw badRequest('NOTHING_TO_UPDATE', '没有可更新的字段');
    await query('UPDATE projects SET ? WHERE id = ?', [patch, project.id]);
    const [updated] = await query(`${PROJECT_SUMMARY} WHERE p.id = ?`, [req.user.id, req.user.id, project.id]);
    res.json(mapSummary(updated));
  }),
);

router.post(
  '/projects/:id/transfer',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    requireLeader(project, req.user);
    const targetId = Number(req.body?.developerId);
    if (!targetId) throw badRequest('BAD_REQUEST', '缺少 developerId');
    if (targetId === req.user.id) throw badRequest('BAD_REQUEST', '不能转让给自己');
    const target = await loadMembership(project.id, targetId);
    if (!target) throw notFound('目标开发者不是项目成员');
    await withTx(async (conn) => {
      await conn.query("UPDATE project_member SET role = 'participant' WHERE project_id = ? AND developer_id = ?", [
        project.id,
        req.user.id,
      ]);
      await conn.query("UPDATE project_member SET role = 'leader' WHERE project_id = ? AND developer_id = ?", [
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
    requireLeader(project, req.user);
    await withTx(async (conn) => {
      await conn.query('DELETE FROM project_member WHERE project_id = ? AND developer_id = ?', [
        project.id,
        req.user.id,
      ]);
      await conn.query('UPDATE projects SET leader_id = NULL WHERE id = ?', [project.id]);
    });
    await syncAfterRemoval(req.user.id);
    res.json({ ok: true });
  }),
);

router.delete(
  '/projects/:id/members/me',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    if (project.leader_id === req.user.id) {
      throw conflict('LEADER_MUST_TRANSFER', 'leader 需要先转让或释放项目，再退出');
    }
    const membership = await loadMembership(project.id, req.user.id);
    if (!membership) throw notFound('你不是该项目成员');
    await query('DELETE FROM project_member WHERE project_id = ? AND developer_id = ?', [project.id, req.user.id]);
    await syncAfterRemoval(req.user.id);
    res.json({ ok: true });
  }),
);

router.delete(
  '/projects/:id/members/:developerId',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    requireLeader(project, req.user);
    const targetId = Number(req.params.developerId);
    if (targetId === project.leader_id) throw forbidden('CANNOT_FIRE_LEADER', '不能移除 leader');
    const membership = await loadMembership(project.id, targetId);
    if (!membership) throw notFound('该开发者不是项目成员');
    await query('DELETE FROM project_member WHERE project_id = ? AND developer_id = ?', [project.id, targetId]);
    await syncAfterRemoval(targetId);
    res.json({ ok: true });
  }),
);

export default router;
