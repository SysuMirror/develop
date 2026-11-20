import { Router } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { loadMembership, loadProject, requireApplyDecider } from '../access.ts';
import { execute, one, query, withTx } from '../db.ts';
import { getUsers, userRef } from '../directory.ts';
import { ApiError, badRequest, conflict, forbidden, notFound, wrap } from '../http.ts';
import { enqueueQualification } from '../qual-sync.ts';
import type { ApplyJoinedRow, ApplyRow, DirectoryUser } from '../types.ts';

const router = Router();

const APPLY_SELECT = `
  SELECT a.id, a.type, a.status, a.note, a.resume_url, a.source, a.created_at, a.decided_at,
         a.project_id, p.title AS project_title, p.leader_id,
         a.user_id
    FROM applies a
    JOIN projects p ON p.id = a.project_id`;

function mapApply(row: ApplyJoinedRow, people: Map<string, DirectoryUser>) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    note: row.note,
    resumeUrl: row.resume_url,
    source: row.source,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    project: { id: row.project_id, title: row.project_title },
    user: userRef(row.user_id, people.get(row.user_id)),
  };
}

// 一条 SQL 取全部申请，再由目录补申请人资料。
async function mapApplies(rows: ApplyJoinedRow[]) {
  const people = await getUsers(rows.map((row) => row.user_id));
  return rows.map((row) => mapApply(row, people));
}

router.post(
  '/projects/:id/applies',
  wrap(async (req, res) => {
    const project = await loadProject(req.params.id);
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const type = String(req.body?.type || 'participant');
    const note = req.body?.note == null ? null : String(req.body.note).trim();
    if (!['leader', 'participant'].includes(type)) throw badRequest('BAD_TYPE', 'type 只能是 leader 或 participant');
    if (project.leader_id === user.id) throw conflict('ALREADY_MEMBER', '你已经是该项目 leader');
    const membership = await loadMembership(project.id, user.id);
    if (membership) throw conflict('ALREADY_MEMBER', '你已经是该项目成员');
    if (type === 'leader' && project.leader_id !== null) throw conflict('LEADER_EXISTS', '该项目已有 leader');

    const existing = await one<ApplyRow>('SELECT * FROM applies WHERE project_id = ? AND user_id = ? AND type = ?', [
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
    const result = await execute(
      "INSERT INTO applies (project_id, user_id, type, status, note) VALUES (?, ?, ?, 'waiting', ?)",
      [project.id, user.id, type, note],
    );
    res.status(201).json({ id: result.insertId, status: 'waiting' });
  }),
);

router.get(
  '/applies/mine',
  wrap(async (req, res) => {
    const rows = await query<ApplyJoinedRow>(
      `${APPLY_SELECT} WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 100`,
      [req.user?.id],
    );
    res.json({ items: await mapApplies(rows) });
  }),
);

router.get(
  '/applies/inbox',
  wrap(async (req, res) => {
    const rows = await query<ApplyJoinedRow>(
      `${APPLY_SELECT}
        WHERE a.status = 'waiting'
          AND (p.leader_id = ? OR (p.leader_id IS NULL AND a.type = 'leader'))
        ORDER BY a.created_at`,
      [req.user?.id],
    );
    res.json({ items: await mapApplies(rows) });
  }),
);

router.post(
  '/applies/:id/accept',
  wrap(async (req, res) => {
    const apply = await one<ApplyJoinedRow>(`${APPLY_SELECT} WHERE a.id = ?`, [Number(req.params.id)]);
    if (!apply) throw notFound('申请不存在');
    if (apply.status !== 'waiting') throw conflict('NOT_PENDING', '该申请已被处理');
    const decider = req.user;
    if (!decider) throw forbidden('NOT_LEADER', '请先登录');
    await requireApplyDecider(apply, decider, apply.type);

    await withTx(async (conn) => {
      const [memberships] = await conn.query<RowDataPacket[]>(
        'SELECT role FROM project_member WHERE project_id = ? AND user_id = ? FOR UPDATE',
        [apply.project_id, apply.user_id],
      );
      if (memberships.length > 0) {
        await conn.query('UPDATE project_member SET role = ? WHERE project_id = ? AND user_id = ?', [
          apply.type === 'leader' ? 'leader' : 'participant',
          apply.project_id,
          apply.user_id,
        ]);
      } else {
        await conn.query('INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, ?)', [
          apply.project_id,
          apply.user_id,
          apply.type === 'leader' ? 'leader' : 'participant',
        ]);
      }
      if (apply.type === 'leader') {
        const [updated] = await conn.query<ResultSetHeader>(
          'UPDATE projects SET leader_id = ? WHERE id = ? AND leader_id IS NULL',
          [apply.user_id, apply.project_id],
        );
        if (updated.affectedRows === 0) {
          throw new ApiError(409, 'LEADER_EXISTS', '该项目已有 leader');
        }
      }
      await conn.query("UPDATE applies SET status = 'accepted', decided_at = NOW(), decided_by = ? WHERE id = ?", [
        decider.id,
        apply.id,
      ]);
      await conn.query(
        `UPDATE applies SET status = 'rejected', decided_at = NOW(), decided_by = ?
          WHERE project_id = ? AND status = 'waiting' AND id <> ?`,
        [decider.id, apply.project_id, apply.id],
      );
    });
    // 审批通过即授予全局开发者资格；写入失败不影响审批，由待同步表重试。
    try {
      await enqueueQualification(apply.user_id, true);
    } catch (error) {
      console.error('[qual-sync] enqueue grant failed', error instanceof Error ? error.message : String(error));
    }
    res.json({ ok: true });
  }),
);

router.post(
  '/applies/:id/reject',
  wrap(async (req, res) => {
    const apply = await one<ApplyJoinedRow>(`${APPLY_SELECT} WHERE a.id = ?`, [Number(req.params.id)]);
    if (!apply) throw notFound('申请不存在');
    if (apply.status !== 'waiting') throw conflict('NOT_PENDING', '该申请已被处理');
    const decider = req.user;
    if (!decider) throw forbidden('NOT_LEADER', '请先登录');
    await requireApplyDecider(apply, decider, apply.type);
    await query("UPDATE applies SET status = 'rejected', decided_at = NOW(), decided_by = ? WHERE id = ?", [
      decider.id,
      apply.id,
    ]);
    res.json({ ok: true });
  }),
);

router.delete(
  '/applies/:id',
  wrap(async (req, res) => {
    const apply = await one<ApplyRow>('SELECT * FROM applies WHERE id = ?', [Number(req.params.id)]);
    if (!apply) throw notFound('申请不存在');
    if (apply.user_id !== req.user?.id) throw forbidden('NOT_OWNER', '只能撤回自己的申请');
    if (apply.status !== 'waiting') throw conflict('NOT_PENDING', '只有等待中的申请可以撤回');
    await query('DELETE FROM applies WHERE id = ?', [apply.id]);
    res.json({ ok: true });
  }),
);

export default router;
