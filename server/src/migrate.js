import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const statement of statements) {
    await query(statement);
  }
  console.log(`schema ok (${statements.length} statements)`);
}

async function seed() {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM developers');
  if (Number(n) > 0) {
    console.log('seed skipped: developers not empty');
    return;
  }
  const people = [
    ['dev-1', '陈晓', 'chenxiao@example.com'],
    ['dev-2', '李知远', 'lizhiyuan@example.com'],
    ['dev-3', '王书意', 'wangshuyi@example.com'],
    ['dev-4', '赵铭', 'zhaoming@example.com'],
    ['dev-5', '孙可', 'sunke@example.com'],
    ['dev-6', '周澄', 'zhoucheng@example.com'],
  ];
  for (const [sub, name, email] of people) {
    await query('INSERT INTO developers (sso_sub, name, email) VALUES (?, ?, ?)', [sub, name, email]);
  }

  const projects = [
    ['软工集市 · 需求撮合', '把院内项目需求与学生开发者撮合起来，含需求发布、接单与交付验收。', 1],
    ['课程项目归档系统', '收集各课程的项目文档与代码，生成可检索的归档索引。', 2],
    ['SSO 接入示例集', '整理 UniSSO 在各语言下的接入样例与联调脚本。', 3],
    ['院系活动报名台', '活动发布、报名、签到与统计，面向全院社团。', 1],
  ];
  for (const [title, misc, leaderId] of projects) {
    const result = await query(
      'INSERT INTO projects (title, misc, leader_id, created_by) VALUES (?, ?, ?, ?)',
      [title, misc, leaderId, leaderId],
    );
    await query('INSERT INTO project_member (project_id, developer_id, role) VALUES (?, ?, ?)', [
      result.insertId,
      leaderId,
      'leader',
    ]);
  }

  const members = [
    [1, 2, 'participant'],
    [1, 3, 'participant'],
    [2, 4, 'participant'],
    [3, 5, 'participant'],
    [4, 6, 'participant'],
  ];
  for (const [projectId, developerId, role] of members) {
    await query('INSERT INTO project_member (project_id, developer_id, role) VALUES (?, ?, ?)', [
      projectId,
      developerId,
      role,
    ]);
  }

  const applies = [
    [4, 1, 'participant', 'waiting', '做过两个 Vue 项目，想参与前端。'],
    [5, 2, 'participant', 'waiting', '有空余时间，负责测试与文档。'],
    [6, 3, 'participant', 'rejected', '时间冲突，先撤了。'],
    [3, 1, 'participant', 'accepted', '已有成员，示例数据。'],
    [6, 4, 'participant', 'accepted', '签到统计模块。'],
  ];
  for (const [developerId, projectId, type, status, note] of applies) {
    await query(
      `INSERT INTO applies (developer_id, project_id, type, status, note, decided_at)
       VALUES (?, ?, ?, ?, ?, IF(? = 'waiting', NULL, NOW()))`,
      [developerId, projectId, type, status, note, status],
    );
  }

  const demands = [
    [1, '需求详情页支持 Markdown 渲染', '详情页目前是纯文本，需要支持代码块与表格。', 2, 'accepted'],
    [1, '需求列表增加按状态筛选', null, null, 'waiting'],
    [2, '导入课程大纲生成目录', '需要解析 PDF 大纲。', null, 'waiting'],
    [3, '补一份 Go 接入示例', null, 5, 'completed'],
    [4, '签到二维码生成', '每个活动一个动态二维码。', null, 'waiting'],
  ];
  for (const [projectId, title, detail, developerId, status] of demands) {
    await query(
      `INSERT INTO demands (project_id, title, detail, developer_id, created_by, status, accepted_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, IF(? = 'waiting', NULL, NOW()), IF(? = 'completed', NOW(), NULL))`,
      [projectId, title, detail, developerId, 1, status, status, status],
    );
  }
  console.log('seed ok');
}

try {
  await migrate();
  if (process.env.SEED === '1') await seed();
} finally {
  await pool.end();
}
