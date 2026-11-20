import { Router } from 'express';
import { loadProject, requireMember } from '../access.ts';
import { isDuplicateEntry, one, query, withTx } from '../db.ts';
import { getUsers, userRef } from '../directory.ts';
import { badRequest, conflict, forbidden, likeTerm, notFound, parsePaging, wrap } from '../http.ts';
import type { DemandJoinedRow, DemandRevisionRow, DemandRow, DemandStatus, DirectoryUser } from '../types.ts';

const router = Router();

const DEMAND_SELECT = `
  SELECT d.id, d.title, d.detail, d.status, d.status_before_suspend,
         d.created_at, d.accepted_at, d.submitted_at, d.completed_at,
         d.created_by,
         d.user_id, d.revision,
         d.project_id, p.title AS project_title, p.leader_id
    FROM demands d
    JOIN projects p ON p.id = d.project_id`;

const SUSPENDABLE: DemandStatus[] = ['waiting', 'accepted', 'review'];
// 待确认、已完成的需求已经进入验收／结案，改动会让验收对象和记录失真。
const EDITABLE: DemandStatus[] = ['waiting', 'accepted', 'suspended'];

type Viewer = { id: string; leader: string | null; createdBy: string; assignee: string | null; status: DemandStatus };

function permissionsOf(viewer: Viewer | null) {
  if (!viewer) {
    return { canEdit: false, canAccept: false, canSubmit: false, canReview: false, canSuspend: false, canResume: false };
  }
  const isOwner = viewer.id === viewer.createdBy || viewer.id === viewer.leader;
  const isAssignee = viewer.assignee !== null && viewer.id === viewer.assignee;
  return {
    canEdit: viewer.id === viewer.createdBy && EDITABLE.includes(viewer.status),
    canAccept: viewer.status === 'waiting',
    canSubmit: viewer.status === 'accepted' && isAssignee,
    canReview: viewer.status === 'review' && isOwner,
    canSuspend: SUSPENDABLE.includes(viewer.status) && isOwner,
    canResume: viewer.status === 'suspended' && isOwner,
  };
}

function mapDemand(row: DemandJoinedRow, people: Map<string, DirectoryUser>, viewerId: string | null) {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at,
    revision: Number(row.revision),
    acceptedAt: row.accepted_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    project: { id: row.project_id, title: row.project_title },
    creator: userRef(row.created_by, people.get(row.created_by)),
    assignee: row.user_id ? userRef(row.user_id, people.get(row.user_id)) : null,
    permissions: permissionsOf(
      viewerId
        ? {
            id: viewerId,
            leader: row.leader_id,
            createdBy: row.created_by,
            assignee: row.user_id,
            status: row.status,
          }
        : null,
    ),
  };
}

async function mapDemands(rows: DemandJoinedRow[], viewerId: string | null = null) {
  const people = await getUsers(rows.flatMap((row) => [row.created_by, row.user_id]));
  return rows.map((row) => mapDemand(row, people, viewerId));
}

async function loadJoinedDemand(id: number): Promise<DemandJoinedRow> {
  const demand = await one<DemandJoinedRow>(`${DEMAND_SELECT} WHERE d.id = ?`, [id]);
  if (!demand) throw notFound('需求不存在');
  return demand;
}

function isOwner(demand: DemandJoinedRow, userId: string): boolean {
  return demand.created_by === userId || demand.leader_id === userId;
}

async function respond(res: import('express').Response, id: number, viewerId: string) {
  res.json((await mapDemands([await loadJoinedDemand(id)], viewerId))[0]);
}

router.get(
  '/demands',
  wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePaging(req);
    const status = String(req.query.status || '');
    const scope = String(req.query.scope || '');
    const term = likeTerm(req.query.q);
    const user = req.user;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (['waiting', 'accepted', 'review', 'completed', 'suspended'].includes(status)) {
      conditions.push('d.status = ?');
      params.push(status);
    }
    if (user && (scope === 'created' || scope === 'assigned')) {
      conditions.push(scope === 'created' ? 'd.created_by = ?' : 'd.user_id = ?');
      params.push(user.id);
    }
    if (term) {
      conditions.push('d.title LIKE ?');
      params.push(term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query<DemandJoinedRow>(
      `${DEMAND_SELECT} ${where}
        ORDER BY FIELD(d.status, 'waiting', 'accepted', 'review', 'completed', 'suspended'), d.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const [counted] = await query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM demands d ${where}`,
      params,
    );
    res.json({
      items: await mapDemands(rows, user?.id ?? null),
      total: Number(counted?.total ?? 0),
      page,
      pageSize,
    });
  }),
);

router.get(
  '/demands/:id',
  wrap(async (req, res) => {
    const demand = await loadJoinedDemand(Number(req.params.id));
    res.json((await mapDemands([demand], req.user?.id ?? null))[0]);
  }),
);

// 修订历史：每版完整正文，diff 由前端对相邻两版算。需求详情本来就对登录开发者可读，这里不额外收紧。
router.get(
  '/demands/:id/revisions',
  wrap(async (req, res) => {
    const demand = await loadJoinedDemand(Number(req.params.id));
    const rows = await query<DemandRevisionRow>(
      `SELECT id, demand_id, revision, title, detail, editor_id, created_at
         FROM demand_revision
        WHERE demand_id = ?
        ORDER BY revision DESC`,
      [demand.id],
    );
    const people = await getUsers(rows.map((row) => row.editor_id));
    res.json({
      items: rows.map((row) => ({
        revision: Number(row.revision),
        title: row.title,
        detail: row.detail,
        editor: userRef(row.editor_id, row.editor_id ? people.get(row.editor_id) : null),
        createdAt: row.created_at,
      })),
    });
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
    if (!title || title.length > 128) throw badRequest('BAD_TITLE', '需求标题必填，且不超过 128 字');
    const duplicate = await one<{ id: number }>('SELECT id FROM demands WHERE project_id = ? AND title = ?', [
      project.id,
      title,
    ]);
    if (duplicate) throw conflict('DUPLICATE_TITLE', '该项目下已有同名需求');
    let inserted: { insertId: number };
    try {
      // 需求行与 v0 快照同事务写入：只落半边会让修订历史少了发布时的原文。
      inserted = await withTx(async (conn) => {
        const [result] = await conn.query(
          "INSERT INTO demands (project_id, title, detail, created_by, status) VALUES (?, ?, ?, ?, 'waiting')",
          [project.id, title, detail, user.id],
        );
        const header = result as { insertId: number };
        await conn.query(
          'INSERT INTO demand_revision (demand_id, revision, title, detail, editor_id) VALUES (?, 0, ?, ?, ?)',
          [header.insertId, title, detail, user.id],
        );
        return header;
      });
    } catch (error) {
      // 并发发布同名：唯一键兜底，翻译成同一个 409，不冒 500。
      if (isDuplicateEntry(error)) throw conflict('DUPLICATE_TITLE', '该项目下已有同名需求');
      throw error;
    }
    await respond(res, inserted.insertId, user.id);
    res.status(201);
  }),
);

// 发布者可以修订标题与详情，验收开始后即锁定；标题仍受项目内唯一约束。
router.patch(
  '/demands/:id',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await loadJoinedDemand(Number(req.params.id));
    if (demand.created_by !== user.id) throw forbidden('NOT_CREATOR', '只有发布者可以修改需求');
    if (!EDITABLE.includes(demand.status)) throw conflict('NOT_EDITABLE', '待确认或已完成的需求不能修改');
    const title = String(req.body?.title ?? demand.title).trim();
    let detail = demand.detail;
    if (req.body?.detail === null) detail = null;
    else if (req.body?.detail !== undefined) detail = String(req.body.detail).trim();
    if (!title || title.length > 128) throw badRequest('BAD_TITLE', '需求标题必填，且不超过 128 字');
    const duplicate = await one<{ id: number }>('SELECT id FROM demands WHERE project_id = ? AND title = ? AND id <> ?', [
      demand.project_id,
      title,
      demand.id,
    ]);
    if (duplicate) throw conflict('DUPLICATE_TITLE', '该项目下已有同名需求');
    const nextDetail = detail ? detail : null;
    // 内容没变就不算一次修改：避免点开编辑又原样保存把版本号刷上去。
    if (title === demand.title && nextDetail === (demand.detail ?? null)) {
      await respond(res, demand.id, user.id);
      return;
    }
    const nextRevision = Number(demand.revision) + 1;
    try {
      await withTx(async (conn) => {
        await conn.query('UPDATE demands SET title = ?, detail = ?, revision = ? WHERE id = ?', [
          title,
          nextDetail,
          nextRevision,
          demand.id,
        ]);
        await conn.query(
          'INSERT INTO demand_revision (demand_id, revision, title, detail, editor_id) VALUES (?, ?, ?, ?, ?)',
          [demand.id, nextRevision, title, nextDetail, user.id],
        );
      });
    } catch (error) {
      if (isDuplicateEntry(error)) throw conflict('DUPLICATE_TITLE', '该项目下已有同名需求');
      throw error;
    }
    await respond(res, demand.id, user.id);
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
    await query(
      "UPDATE demands SET status = 'accepted', user_id = ?, accepted_at = NOW() WHERE id = ? AND status = 'waiting'",
      [user.id, demand.id],
    );
    await respond(res, demand.id, user.id);
  }),
);

// 接单人交付：进入待确认，等发布者或项目 leader 验收。
router.post(
  '/demands/:id/submit',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await loadJoinedDemand(Number(req.params.id));
    if (demand.user_id !== user.id) throw forbidden('NOT_ASSIGNEE', '只有接单人才能提交完成');
    if (demand.status !== 'accepted') throw conflict('NOT_ACCEPTED', '只有进行中的需求可以提交完成');
    await query("UPDATE demands SET status = 'review', submitted_at = NOW() WHERE id = ? AND status = 'accepted'", [
      demand.id,
    ]);
    await respond(res, demand.id, user.id);
  }),
);

router.post(
  '/demands/:id/confirm',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await loadJoinedDemand(Number(req.params.id));
    if (!isOwner(demand, user.id)) throw forbidden('NOT_REVIEWER', '只有发布者或项目 leader 可以验收');
    if (demand.status !== 'review') throw conflict('NOT_IN_REVIEW', '只有待确认的需求可以验收');
    await query("UPDATE demands SET status = 'completed', completed_at = NOW() WHERE id = ? AND status = 'review'", [
      demand.id,
    ]);
    await respond(res, demand.id, user.id);
  }),
);

// 驳回：退回进行中，接单人不变，可以重新提交。
router.post(
  '/demands/:id/reject',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await loadJoinedDemand(Number(req.params.id));
    if (!isOwner(demand, user.id)) throw forbidden('NOT_REVIEWER', '只有发布者或项目 leader 可以驳回');
    if (demand.status !== 'review') throw conflict('NOT_IN_REVIEW', '只有待确认的需求可以驳回');
    await query("UPDATE demands SET status = 'accepted', submitted_at = NULL WHERE id = ? AND status = 'review'", [
      demand.id,
    ]);
    await respond(res, demand.id, user.id);
  }),
);

router.post(
  '/demands/:id/suspend',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await loadJoinedDemand(Number(req.params.id));
    if (!isOwner(demand, user.id)) throw forbidden('NOT_REVIEWER', '只有发布者或项目 leader 可以挂起');
    if (!SUSPENDABLE.includes(demand.status)) throw conflict('CANNOT_SUSPEND', '当前状态不能挂起');
    await query("UPDATE demands SET status = 'suspended', status_before_suspend = ? WHERE id = ? AND status = ?", [
      demand.status,
      demand.id,
      demand.status,
    ]);
    await respond(res, demand.id, user.id);
  }),
);

router.post(
  '/demands/:id/resume',
  wrap(async (req, res) => {
    const user = req.user;
    if (!user) throw forbidden('NOT_MEMBER', '请先登录');
    const demand = await loadJoinedDemand(Number(req.params.id));
    if (!isOwner(demand, user.id)) throw forbidden('NOT_REVIEWER', '只有发布者或项目 leader 可以恢复');
    if (demand.status !== 'suspended') throw conflict('NOT_SUSPENDED', '只有挂起的需求可以恢复');
    const back = demand.status_before_suspend ?? 'waiting';
    await query('UPDATE demands SET status = ?, status_before_suspend = NULL WHERE id = ? AND status = \'suspended\'', [
      back,
      demand.id,
    ]);
    await respond(res, demand.id, user.id);
  }),
);

export default router;
