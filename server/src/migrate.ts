import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, pool, query } from './db.ts';
import { DEMO_USERS } from './demo-users.ts';

// 构建产物在 dist/，schema.sql 由 build 脚本一起复制过去；开发时直接读 src/。
const here = path.dirname(fileURLToPath(import.meta.url));

// CREATE TABLE IF NOT EXISTS 不会给旧表补列，已存在的库靠这里增量迁移。
// 调用方传完整的 ALTER 语句字面量，避免把标识符拼进 SQL。
async function ensureColumn(table: string, column: string, alterStatement: string): Promise<boolean> {
  const [row] = await query<{ n: number | string }>(
    `SELECT COUNT(*) AS n
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (Number(row?.n ?? 0) > 0) return false;
  await query(alterStatement);
  console.log(`added column ${table}.${column}`);
  return true;
}

async function migrate(): Promise<void> {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const statement of statements) {
    await query(statement);
  }
  // 旧库可能还是 developer_id 结构；这里只补列，不做数据迁移（用户实体已不在本地）。
  await ensureColumn('applies', 'resume_url', 'ALTER TABLE applies ADD COLUMN resume_url VARCHAR(2048) NULL AFTER note');
  await ensureColumn(
    'applies',
    'source',
    "ALTER TABLE applies ADD COLUMN source ENUM('web','join') NOT NULL DEFAULT 'web' AFTER resume_url",
  );
  await ensureColumn('sessions', 'access_token', 'ALTER TABLE sessions ADD COLUMN access_token TEXT NULL AFTER user_id');
  await ensureColumn(
    'sessions',
    'access_token_expires_at',
    'ALTER TABLE sessions ADD COLUMN access_token_expires_at DATETIME NULL AFTER access_token',
  );
  await ensureColumn(
    'sessions',
    'auth_method',
    "ALTER TABLE sessions ADD COLUMN auth_method VARCHAR(16) NOT NULL DEFAULT 'sso' AFTER user_id",
  );
  await ensureColumn('sessions', 'developer', 'ALTER TABLE sessions ADD COLUMN developer TINYINT(1) NULL AFTER auth_method');
  console.log(`schema ok (${statements.length} statements)`);
}

// 演示数据的用户标识就是写死的假 sub（真实 sub 由 UniSSO 提供，本地造不出来）。
async function seed(): Promise<void> {
  const [counted] = await query<{ n: number | string }>('SELECT COUNT(*) AS n FROM projects');
  if (Number(counted?.n ?? 0) > 0) {
    console.log('seed skipped: projects not empty');
    return;
  }
  const sub = (index: number): string => DEMO_USERS[index]?.id ?? `dev-${index + 1}`;

  const projects: Array<[string, string, string]> = [
    ['软工集市 · 需求撮合', '把院内项目需求与学生开发者撮合起来，含需求发布、接单与交付验收。', sub(0)],
    ['课程项目归档系统', '收集各课程的项目文档与代码，生成可检索的归档索引。', sub(1)],
    ['SSO 接入示例集', '整理 UniSSO 在各语言下的接入样例与联调脚本。', sub(2)],
    ['院系活动报名台', '活动发布、报名、签到与统计，面向全院社团。', sub(0)],
  ];
  for (const [title, misc, leaderId] of projects) {
    const inserted = await execute('INSERT INTO projects (title, misc, leader_id, created_by) VALUES (?, ?, ?, ?)', [
      title,
      misc,
      leaderId,
      leaderId,
    ]);
    await query('INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, ?)', [
      inserted.insertId,
      leaderId,
      'leader',
    ]);
  }

  const members: Array<[number, string, string]> = [
    [1, sub(1), 'participant'],
    [1, sub(2), 'participant'],
    [2, sub(3), 'participant'],
    [3, sub(4), 'participant'],
    [4, sub(5), 'participant'],
  ];
  for (const [projectId, userId, role] of members) {
    await query('INSERT INTO project_member (project_id, user_id, role) VALUES (?, ?, ?)', [projectId, userId, role]);
  }

  const applies: Array<[number, string, string, string, string]> = [
    [1, sub(3), 'participant', 'waiting', '做过两个 Vue 项目，想参与前端。'],
    [2, sub(4), 'participant', 'waiting', '有空余时间，负责测试与文档。'],
    [3, sub(5), 'participant', 'rejected', '时间冲突，先撤了。'],
    [4, sub(0), 'participant', 'accepted', '已有成员，示例数据。'],
    [1, sub(1), 'participant', 'accepted', '签到统计模块。'],
  ];
  for (const [projectId, userId, type, status, note] of applies) {
    await query(
      `INSERT INTO applies (user_id, project_id, type, status, note, decided_at)
       VALUES (?, ?, ?, ?, ?, IF(? = 'waiting', NULL, NOW()))`,
      [userId, projectId, type, status, note, status],
    );
  }

  const demands: Array<[number, string, string | null, string | null, string]> = [
    [1, '需求详情页支持 Markdown 渲染', '详情页目前是纯文本，需要支持代码块与表格。', sub(1), 'accepted'],
    [1, '需求列表增加按状态筛选', null, null, 'waiting'],
    [2, '导入课程大纲生成目录', '需要解析 PDF 大纲。', null, 'waiting'],
    [3, '补一份 Go 接入示例', null, sub(4), 'completed'],
    [4, '签到二维码生成', '每个活动一个动态二维码。', null, 'waiting'],
  ];
  for (const [projectId, title, detail, userId, status] of demands) {
    await query(
      `INSERT INTO demands (project_id, title, detail, user_id, created_by, status, accepted_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, IF(? = 'waiting', NULL, NOW()), IF(? = 'completed', NOW(), NULL))`,
      [projectId, title, detail, userId, sub(0), status, status, status],
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
