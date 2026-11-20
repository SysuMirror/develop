import { Router } from 'express';
import { loadProject, requireMember } from '../access.ts';
import { execute, one, query } from '../db.ts';
import { getUsers, userRef } from '../directory.ts';
import { badRequest, conflict, forbidden, likeTerm, notFound, parsePaging, wrap } from '../http.ts';
import type { DemandJoinedRow, DemandRow, DirectoryUser } from '../types.ts';

const router = Router();

const DEMAND_SELECT = `
  SELECT d.id, d.title, d.detail, d.status, d.created_at, d.accepted_at, d.completed_at,
         d.created_by,
         d.user_id,
         d.project_id, p.title AS project_title, p.leader_id
    FROM demands d
    JOIN projects p ON p.id = d.project_id`;

function mapDemand(row: DemandJoinedRow, people: Map<string, DirectoryUser>) {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
    project: { id: row.project_id, title: row.project_title },
    creator: userRef(row.created_by, people.get(row.created_by)),
    assignee: row.user_id ? userRef(row.user_id, people.get(row.user_id)) : null,
  };
}

async function mapDemands(rows: DemandJoinedRow[]) {
  const people = await getUsers(rows.flatMap((row) => [row.created_by, row.user_id]));
  return rows.map((row) => mapDemand(row, people));
}

async function loadJoinedDemand(id: number): Promise<DemandJoinedRow> {
  const demand = await one<DemandJoinedRow>(`${DEMAND_SELECT} WHERE d.id = ?`, [id]);
  if (!demand) throw notFound('需求不存在');
  return demand;
}

router.get(
  '/demands',
  wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePaging(req);
    const status = String(req.query.status || '');
    const term = likeTerm(req.query.q);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (['waiting', 'accepted', 'completed'].includes(status)) {
      conditions.push('d.status = ?');
      params.push(status);
    }
    if (term) {
      conditions.push('d.title LIKE ?');
      params.push(term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query<DemandJoinedRow>(
      `${DEMAND_SELECT} ${where} ORDER BY FIELD(d.status, 'waiting', 'accepted', 'completed'), d.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const [counted] = await query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM demands d ${where}`,
      params,
    );
    res.json({ items: await mapDemands(rows), total: Number(counted?.total ?? 0), page, pageSize });
  }),
);

router.post(
  '/projects/:id/demands',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    await requireMember(project.id, user);
    const title = String(req.body?.title ?? '').trim();
    const detail = req.body?.detail == null ? null : String(req.body.detail).trim();
    if (!title || title.length > 200) throw badRequest('BAD_TITLE', '需求标题必填，且不超过 200 字');
    const inserted = await execute(
      "INSERT INTO demands (project_id, title, detail, created_by, status) VALUES (?, ?, ?, ?, 'waiting')",
      [project.id, title, detail, user.id],
    );
    const created = await loadJoinedDemand(inserted.insertId);
    res.status(201).json((await mapDemands([created]))[0]);
  }),
);

router.post(
  '/demands/:id/accept',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await one<DemandRow>('SELECT * FROM demands WHERE id = ?', [Number(req.params.id)]);
    if (!demand) throw notFound('需求不存在');
    if (demand.status !== 'waiting') throw conflict('NOT_PENDING', '该需求已被接单或已完成');
    if (demand.created_by === user.id) throw forbidden('SELF_ACCEPT', '不能接自己发布的需求');
    await query(
      "UPDATE demands SET status = 'accepted', user_id = ?, accepted_at = NOW() WHERE id = ? AND status = 'waiting'",
      [user.id, demand.id],
    );
    res.json((await mapDemands([await loadJoinedDemand(demand.id)]))[0]);
  }),
);

router.post(
  '/demands/:id/complete',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await loadJoinedDemand(Number(req.params.id));
    if (demand.status !== 'accepted') throw conflict('NOT_PENDING', '只有已接单的需求可以标记完成');
    const allowed = user.id === demand.created_by || user.id === demand.user_id || user.id === demand.leader_id;
    if (!allowed) throw forbidden('NOT_ALLOWED', '只有发布者、接单人或项目 leader 可以标记完成');
    await query("UPDATE demands SET status = 'completed', completed_at = NOW() WHERE id = ?", [demand.id]);
    res.json((await mapDemands([await loadJoinedDemand(demand.id)]))[0]);
  }),
);

export default router;
