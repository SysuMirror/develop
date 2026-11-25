// 平台动态：最近新建的项目、发布的需求、完成的需求，合成一条时间线。
// 首页“与我无关”一栏用它替代三块预览，降低视觉噪音。

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { query } from '../db.ts';
import { getUsers, userRef } from '../directory.ts';
import { parsePaging, wrap } from '../http.ts';

const router = Router();

interface ProjectEventRow extends RowDataPacket {
  id: number;
  title: string;
  created_at: Date;
  leader_id: string | null;
}

interface DemandEventRow extends RowDataPacket {
  id: number;
  title: string;
  created_at: Date;
  completed_at: Date | null;
  status: string;
  created_by: string | null;
  user_id: string | null;
  project_id: number;
  project_title: string;
}

interface ActivityItem {
  kind: 'project' | 'demand' | 'demand_done';
  id: number;
  title: string;
  at: Date;
  actor: string | null;
  project: { id: number; title: string } | null;
}

router.get(
  '/activity',
  wrap(async (req, res) => {
    const { pageSize } = parsePaging(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
    const projects = await query<ProjectEventRow>(
      'SELECT id, title, created_at, leader_id FROM projects ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    const demands = await query<DemandEventRow>(
      `SELECT d.id, d.title, d.created_at, d.completed_at, d.status, d.created_by, d.user_id,
              d.project_id, p.title AS project_title
         FROM demands d JOIN projects p ON p.id = d.project_id
        ORDER BY GREATEST(d.created_at, COALESCE(d.completed_at, d.created_at)) DESC
        LIMIT ?`,
      [limit],
    );
    const events: ActivityItem[] = [
      ...projects.map((row) => ({
        kind: 'project' as const,
        id: row.id,
        title: row.title,
        at: row.created_at,
        actor: row.leader_id,
        project: { id: row.id, title: row.title },
      })),
      ...demands.map((row) => ({
        kind: 'demand' as const,
        id: row.id,
        title: row.title,
        at: row.created_at,
        actor: row.created_by,
        project: { id: row.project_id, title: row.project_title },
      })),
      ...demands
        .filter((row) => row.status === 'completed' && row.completed_at)
        .map((row) => ({
          kind: 'demand_done' as const,
          id: row.id,
          title: row.title,
          at: row.completed_at as Date,
          actor: row.user_id,
          project: { id: row.project_id, title: row.project_title },
        })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit);
    const people = await getUsers(events.map((event) => event.actor));
    res.json({
      items: events.map((event) => ({
        kind: event.kind,
        id: event.id,
        title: event.title,
        at: event.at,
        actor: event.actor ? userRef(event.actor, people.get(event.actor)) : null,
        project: event.project,
      })),
      pageSize,
    });
  }),
);

export default router;
