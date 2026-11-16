import { Router } from 'express';
import { loadMembership, loadProject, requireApplyDecider } from '../access.js';
import { one, query, withTx } from '../db.js';
import { badRequest, conflict, forbidden, notFound, wrap } from '../http.js';

const router = Router();

const APPLY_SELECT = `
  SELECT a.id, a.type, a.status, a.note, a.created_at, a.decided_at,
         a.project_id, p.title AS project_title, p.leader_id,
         a.developer_id, d.name AS developer_name, d.avatar AS developer_avatar
    FROM applies a
    JOIN projects p ON p.id = a.project_id
    JOIN developers d ON d.id = a.developer_id`;

function mapApply(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    project: { id: row.project_id, title: row.project_title },
    developer: { id: row.developer_id, name: row.developer_name, avatar: row.developer_avatar },
  };
}

router.post(
  '/projects/:id/applies',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    const type = String(req.body?.type || 'participant');
    const note = req.body?.note == null ? null : String(req.body.note).trim();
    if (!['leader', 'participant'].includes(type)) throw badRequest('BAD_TYPE', 'type 只能是 leader 或 participant');
    if (project.leader_id === user.id) throw conflict('ALREADY_MEMBER', '你已经是该项目 leader');
    const membership = await loadMembership(project.id, user.id);
    if (membership) throw conflict('ALREADY_MEMBER', '你已经是该项目成员');
    if (type === 'leader' && project.leader_id !== null) throw conflict('LEADER_EXISTS', '该项目已有 leader');

    const existing = await one('SELECT * FROM applies WHERE project_id = ? AND developer_id = ? AND type = ?', [
      project.id,
      user.id,
      type,
    ]);
    if (existing && existing.status === 'waiting') throw conflict('DUPLICATE_APPLY', '已有一条等待中的申请');
    if (existing && existing.status === 'accepted') throw conflict('ALREADY_MEMBER', '该申请已经通过');
    if (existing) {
      await query(
        "UPDATE applies SET status = 'waiting', note = ?, decided_at = NULL, decided_by = NULL, created_at = NOW() WHERE id = ?",
        [note, existing.id],
      );
      res.status(201).json({ id: existing.id, status: 'waiting' });
      return;
    }
    const result = await query(
      "INSERT INTO applies (project_id, developer_id, type, status, note) VALUES (?, ?, ?, 'waiting', ?)",
      [project.id, user.id, type, note],
    );
    res.status(201).json({ id: result.insertId, status: 'waiting' });
  }),
);

router.get(
  '/applies/mine',
  wrap(async (req, res) => {
    const rows = await query(`${APPLY_SELECT} WHERE a.developer_id = ? ORDER BY a.created_at DESC LIMIT 100`, [
      req.user.id,
    ]);
    res.json({ items: rows.map(mapApply) });
  }),
);

router.get(
  '/applies/inbox',
  wrap(async (req, res) => {
    const rows = await query(
      `${APPLY_SELECT}
        WHERE a.status = 'waiting'
          AND (p.leader_id = ? OR (p.leader_id IS NULL AND a.type = 'leader'))
        ORDER BY a.created_at`,
      [req.user.id],
    );
    res.json({ items: rows.map(mapApply) });
  }),
);

router.post(
  '/applies/:id/accept',
  wrap(async (req, res) => {
    const apply = await one(`${APPLY_SELECT} WHERE a.id = ?`, [Number(req.params.id)]);
    if (!apply) throw notFound('申请不存在');
    if (apply.status !== 'waiting') throw conflict('NOT_PENDING', '该申请已被处理');
    requireApplyDecider(apply, req.user, apply.type);

    await withTx(async (conn) => {
      const [memberships] = await conn.query(
        'SELECT role FROM project_member WHERE project_id = ? AND developer_id = ? FOR UPDATE',
        [apply.project_id, apply.developer_id],
      );
      if (memberships.length > 0) {
        await conn.query('UPDATE project_member SET role = ? WHERE project_id = ? AND developer_id = ?', [
          apply.type === 'leader' ? 'leader' : 'participant',
          apply.project_id,
          apply.developer_id,
        ]);
      } else {
        await conn.query('INSERT INTO project_member (project_id, developer_id, role) VALUES (?, ?, ?)', [
          apply.project_id,
          apply.developer_id,
          apply.type === 'leader' ? 'leader' : 'participant',
        ]);
      }
      if (apply.type === 'leader') {
        const [updated] = await conn.query(
          'UPDATE projects SET leader_id = ? WHERE id = ? AND leader_id IS NULL',
          [apply.developer_id, apply.project_id],
        );
        if (updated.affectedRows === 0) {
          const error = new Error('该项目已有 leader');
          error.status = 409;
          error.code = 'LEADER_EXISTS';
          throw error;
        }
      }
      await conn.query("UPDATE applies SET status = 'accepted', decided_at = NOW(), decided_by = ? WHERE id = ?", [
        req.user.id,
        apply.id,
      ]);
      await conn.query(
        `UPDATE applies SET status = 'rejected', decided_at = NOW(), decided_by = ?
          WHERE project_id = ? AND status = 'waiting' AND id <> ?`,
        [req.user.id, apply.project_id, apply.id],
      );
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/applies/:id/reject',
  wrap(async (req, res) => {
    const apply = await one(`${APPLY_SELECT} WHERE a.id = ?`, [Number(req.params.id)]);
    if (!apply) throw notFound('申请不存在');
    if (apply.status !== 'waiting') throw conflict('NOT_PENDING', '该申请已被处理');
    requireApplyDecider(apply, req.user, apply.type);
    await query("UPDATE applies SET status = 'rejected', decided_at = NOW(), decided_by = ? WHERE id = ?", [
      req.user.id,
      apply.id,
    ]);
    res.json({ ok: true });
  }),
);

router.delete(
  '/applies/:id',
  wrap(async (req, res) => {
    const apply = await one('SELECT * FROM applies WHERE id = ?', [Number(req.params.id)]);
    if (!apply) throw notFound('申请不存在');
    if (apply.developer_id !== req.user.id) throw forbidden('NOT_OWNER', '只能撤回自己的申请');
    if (apply.status !== 'waiting') throw conflict('NOT_PENDING', '只有等待中的申请可以撤回');
    await query('DELETE FROM applies WHERE id = ?', [apply.id]);
    res.json({ ok: true });
  }),
);

export default router;
