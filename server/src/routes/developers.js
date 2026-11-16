import { Router } from 'express';
import { query } from '../db.js';
import { likeTerm, parsePaging, wrap } from '../http.js';

const router = Router();

router.get(
  '/developers',
  wrap(async (req, res) => {
    const { page, pageSize, offset } = parsePaging(req);
    const term = likeTerm(req.query.q);
    const where = term ? 'WHERE d.name LIKE ?' : '';
    const params = term ? [term] : [];
    const items = await query(
      `SELECT d.id, d.name, d.avatar,
              (SELECT COUNT(*) FROM project_member m WHERE m.developer_id = d.id) AS project_count,
              (SELECT COUNT(*) FROM project_member m WHERE m.developer_id = d.id AND m.role = 'leader') AS lead_count
         FROM developers d
         ${where}
        ORDER BY d.id
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM developers d ${where}`, params);
    res.json({
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        projectCount: Number(row.project_count),
        leadCount: Number(row.lead_count),
      })),
      total: Number(total),
      page,
      pageSize,
    });
  }),
);

router.get(
  '/developers/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const developer = await query('SELECT id, name, avatar, email, created_at FROM developers WHERE id = ?', [id]);
    if (developer.length === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '开发者不存在' } });
      return;
    }
    const profiles = developer[0];
    const projects = await query(
      `SELECT p.id, p.title, m.role, m.created_at
         FROM project_member m JOIN projects p ON p.id = m.project_id
        WHERE m.developer_id = ?
        ORDER BY m.created_at DESC`,
      [id],
    );
    const applies = await query(
      `SELECT a.id, a.type, a.status, a.created_at, p.id AS project_id, p.title AS project_title
         FROM applies a JOIN projects p ON p.id = a.project_id
        WHERE a.developer_id = ?
        ORDER BY a.created_at DESC
        LIMIT 20`,
      [id],
    );
    const demands = await query(
      `SELECT d.id, d.title, d.status, d.created_at, p.id AS project_id, p.title AS project_title
         FROM demands d JOIN projects p ON p.id = d.project_id
        WHERE d.developer_id = ?
        ORDER BY d.created_at DESC
        LIMIT 20`,
      [id],
    );
    res.json({
      id: profiles.id,
      name: profiles.name,
      avatar: profiles.avatar,
      email: profiles.email,
      createdAt: profiles.created_at,
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
