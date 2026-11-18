import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { getUsers, searchUsers, userRef } from '../directory.ts';
import { query } from '../db.ts';
import { notFound, parsePaging, wrap } from '../http.ts';
import type { Role } from '../types.ts';

const router = Router();

interface MemberCountRow extends RowDataPacket {
  user_id: string;
  n: number | string;
  leads: number | string | null;
}

interface UserProjectRow extends RowDataPacket {
  id: number;
  title: string;
  role: Role;
  created_at: Date;
}

interface UserApplyRow extends RowDataPacket {
  id: number;
  type: string;
  status: string;
  created_at: Date;
  project_id: number;
  project_title: string;
}

interface UserDemandRow extends RowDataPacket {
  id: number;
  title: string;
  status: string;
  created_at: Date;
  project_id: number;
  project_title: string;
}

// 用户列表：目录（UniSSO users 表）负责资料与搜索，本库只补项目参与度。
router.get(
  '/users',
  wrap(async (req, res) => {
    const { page, pageSize } = parsePaging(req);
    const { items, total, stale } = await searchUsers({ q: req.query.q, page, pageSize });
    const ids = items.map((user) => user.id);
    const counts =
      ids.length > 0
        ? await query<MemberCountRow>(
            `SELECT user_id, COUNT(*) AS n, SUM(role = 'leader') AS leads
               FROM project_member
              WHERE user_id IN (${ids.map(() => '?').join(',')})
              GROUP BY user_id`,
            ids,
          )
        : [];
    const byId = new Map(counts.map((row) => [row.user_id, row]));
    res.json({
      items: items.map((user) => {
        const stat = byId.get(user.id);
        return {
          ...userRef(user.id, user),
          projectCount: Number(stat?.n ?? 0),
          leadCount: Number(stat?.leads ?? 0),
        };
      }),
      total,
      page,
      pageSize,
      directoryStale: stale,
    });
  }),
);

// 用户详情：资料来自目录，项目 / 申请 / 需求来自本库。
router.get(
  '/users/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id);
    const [profiles, projects, applies, demands] = await Promise.all([
      getUsers([id]),
      query<UserProjectRow>(
        `SELECT p.id, p.title, m.role, m.created_at
           FROM project_member m JOIN projects p ON p.id = m.project_id
          WHERE m.user_id = ?
          ORDER BY m.created_at DESC`,
        [id],
      ),
      query<UserApplyRow>(
        `SELECT a.id, a.type, a.status, a.created_at, p.id AS project_id, p.title AS project_title
           FROM applies a JOIN projects p ON p.id = a.project_id
          WHERE a.user_id = ?
          ORDER BY a.created_at DESC
          LIMIT 20`,
        [id],
      ),
      query<UserDemandRow>(
        `SELECT d.id, d.title, d.status, d.created_at, p.id AS project_id, p.title AS project_title
           FROM demands d JOIN projects p ON p.id = d.project_id
          WHERE d.user_id = ?
          ORDER BY d.created_at DESC
          LIMIT 20`,
        [id],
      ),
    ]);
    const profile = profiles.get(id);
    if (!profile && projects.length === 0 && applies.length === 0 && demands.length === 0) {
      throw notFound('用户不存在');
    }
    res.json({
      ...userRef(id, profile),
      email: profile?.email ?? null,
      developer: profile?.developer ?? null,
      projects: projects.map((row) => ({
        projectId: row.id,
        title: row.title,
        role: row.role,
        joinedAt: row.created_at,
      })),
      applies,
      demands,
    });
  }),
);

export default router;
