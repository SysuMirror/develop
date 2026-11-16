import { Router } from 'express';
import { loadProject, requireMember } from '../access.js';
import { one, query } from '../db.js';
import { badRequest, conflict, forbidden, likeTerm, notFound, parsePaging, wrap } from '../http.js';

const router = Router();

const DEMAND_SELECT = `
  SELECT d.id, d.title, d.detail, d.status, d.created_at, d.accepted_at, d.completed_at,
         d.created_by, c.name AS creator_name,
         d.developer_id, a.name AS assignee_name, a.avatar AS assignee_avatar,
         d.project_id, p.title AS project_title, p.leader_id
    FROM demands d
    JOIN projects p ON p.id = d.project_id
    LEFT JOIN developers c ON c.id = d.created_by
    LEFT JOIN developers a ON a.id = d.developer_id`;

function mapDemand(row) {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
    project: { id: row.project_id, title: row.project_title },
    creator: { id: row.created_by, name: row.creator_name },
    assignee: row.developer_id ? { id: row.developer_id, name: row.assignee_name, avatar: row.assignee_avatar } : null,
  };
}

router.get(
  '/demands',
  wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePaging(req);
    const status = String(req.query.status || '');
    const term = likeTerm(req.query.q);
    const conditions = [];
    const params = [];
    if (['waiting', 'accepted', 'completed'].includes(status)) {
      conditions.push('d.status = ?');
      params.push(status);
    }
    if (term) {
      conditions.push('d.title LIKE ?');
      params.push(term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query(
      `${DEMAND_SELECT} ${where} ORDER BY FIELD(d.status, 'waiting', 'accepted', 'completed'), d.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM demands d ${where}`, params);
    res.json({ items: rows.map(mapDemand), total: Number(total), page, pageSize });
  }),
);

router.post(
  '/projects/:id/demands',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    await requireMember(project.id, req.user);
    const title = String(req.body?.title ?? '').trim();
    const detail = req.body?.detail == null ? null : String(req.body.detail).trim();
    if (!title || title.length > 200) throw badRequest('BAD_TITLE', '需求标题必填，且不超过 200 字');
    const result = await query(
      "INSERT INTO demands (project_id, title, detail, created_by, status) VALUES (?, ?, ?, ?, 'waiting')",
      [project.id, title, detail, req.user.id],
    );
    const [created] = await query(`${DEMAND_SELECT} WHERE d.id = ?`, [result.insertId]);
    res.status(201).json(mapDemand(created));
  }),
);

router.post(
  '/demands/:id/accept',
  wrap(async (req, res) => {
    const demand = await one('SELECT * FROM demands WHERE id = ?', [Number(req.params.id)]);
    if (!demand) throw notFound('需求不存在');
    if (demand.status !== 'waiting') throw conflict('NOT_PENDING', '该需求已被接单或已完成');
    if (demand.created_by === req.user.id) throw forbidden('SELF_ACCEPT', '不能接自己发布的需求');
    await query(
      "UPDATE demands SET status = 'accepted', developer_id = ?, accepted_at = NOW() WHERE id = ? AND status = 'waiting'",
      [req.user.id, demand.id],
    );
    const [updated] = await query(`${DEMAND_SELECT} WHERE d.id = ?`, [demand.id]);
    res.json(mapDemand(updated));
  }),
);

router.post(
  '/demands/:id/complete',
  wrap(async (req, res) => {
    const demand = await one(`${DEMAND_SELECT} WHERE d.id = ?`, [Number(req.params.id)]);
    if (!demand) throw notFound('需求不存在');
    if (demand.status !== 'accepted') throw conflict('NOT_PENDING', '只有已接单的需求可以标记完成');
    const allowed =
      req.user.id === demand.created_by || req.user.id === demand.developer_id || req.user.id === demand.leader_id;
    if (!allowed) throw forbidden('NOT_ALLOWED', '只有发布者、接单人或项目 leader 可以标记完成');
    await query("UPDATE demands SET status = 'completed', completed_at = NOW() WHERE id = ?", [demand.id]);
    const [updated] = await query(`${DEMAND_SELECT} WHERE d.id = ?`, [demand.id]);
    res.json(mapDemand(updated));
  }),
);

export default router;
