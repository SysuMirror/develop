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

// 索引同理：CREATE TABLE IF NOT EXISTS 不会给旧表加索引。
async function ensureIndex(table: string, index: string, alterStatement: string): Promise<boolean> {
  const [row] = await query<{ n: number | string }>(
    `SELECT COUNT(*) AS n
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index],
  );
  if (Number(row?.n ?? 0) > 0) return false;
  await query(alterStatement);
  console.log(`added index ${table}.${index}`);
  return true;
}

// ENUM 补值不能靠 ensureColumn（列已存在），只改列定义；旧库的 waiting/accepted/completed 原样保留。
async function ensureDemandStatusEnum(): Promise<void> {
  const [column] = await query<{ column_type: string }>(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demands' AND COLUMN_NAME = 'status'`,
  );
  if (!column || column.column_type.includes('review')) return;
  await query(
    "ALTER TABLE demands MODIFY COLUMN status ENUM('waiting','accepted','review','completed','suspended') NOT NULL DEFAULT 'waiting'",
  );
  console.log('demands.status -> 5 states');
}

// 唯一索引建不上去就会一直失败，所以先把历史重复行清掉：同项目同标题只保留 id 最小的一条。
// 删除前把整行打到日志，方便事后追溯（这类重复多半是旧版 404 bug 带来的重试）。
async function dedupeDemands(): Promise<void> {
  const groups = await query<{ project_id: number; title: string }>(
    `SELECT project_id, title
       FROM demands
      GROUP BY project_id, title
     HAVING COUNT(*) > 1`,
  );
  for (const group of groups) {
    const rows = await query<{
      id: number;
      status: string;
      created_by: string | null;
      created_at: Date | string;
    }>('SELECT id, status, created_by, created_at FROM demands WHERE project_id = ? AND title = ? ORDER BY id', [
      group.project_id,
      group.title,
    ]);
    const [keep, ...dropped] = rows;
    if (!keep) continue;
    console.log(`dedupe demands: project ${group.project_id} title ${JSON.stringify(group.title)} 保留 id=${keep.id}`);
    for (const row of dropped) {
      console.log(
        `  drop id=${row.id} status=${row.status} created_by=${row.created_by} created_at=${String(row.created_at)}`,
      );
      await execute('DELETE FROM demands WHERE id = ?', [row.id]);
    }
  }
}

// 项目角色从 leader/participant 改为 owner/admin/member：
// 先扩枚举让新值可写，搬完数据再收紧，避免严格模式下截断报错。
async function migrateMemberRoles(): Promise<void> {
  const [column] = await query<{ type: string }>(
    `SELECT COLUMN_TYPE AS type
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_member' AND COLUMN_NAME = 'role'`,
  );
  const type = (column?.type || '').toLowerCase();
  if (!type) return;
  if (type.includes("'leader'") || type.includes("'participant'")) {
    await query("ALTER TABLE project_member MODIFY COLUMN role ENUM('leader','participant','owner','admin','member') NOT NULL");
    await query("UPDATE project_member SET role = 'owner' WHERE role = 'leader'");
    await query("UPDATE project_member SET role = 'member' WHERE role = 'participant'");
    await query("ALTER TABLE project_member MODIFY COLUMN role ENUM('owner','admin','member') NOT NULL");
    console.log('project_member.role -> owner/admin/member');
  }
  // 兜底：确保每个项目 leader_id 都有一条 owner 成员行。
  const [orphanOwners] = await query<{ n: number | string }>(
    `SELECT COUNT(*) AS n
       FROM projects p
      WHERE NOT EXISTS (
        SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p.leader_id AND m.role = 'owner')`,
  );
  if (Number(orphanOwners?.n ?? 0) > 0) {
    await query(
      `INSERT INTO project_member (project_id, user_id, role)
       SELECT p.id, p.leader_id, 'owner' FROM projects p
        WHERE NOT EXISTS (
          SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p.leader_id)
       ON DUPLICATE KEY UPDATE role = 'owner'`,
    );
    console.log(`backfill owner members: ${orphanOwners?.n}`);
  }
}

// 每个项目必须恰好一个 leader：先把历史 leader 缺位行修好，再把列收紧为 NOT NULL。
// 有成员的项目把最早加入者升为 leader；没有任何成员的项目无法满足约束，级联删除并打日志。
async function enforceLeaderRequired(): Promise<void> {
  const orphans = await query<{ id: number; title: string }>(
    'SELECT id, title FROM projects WHERE leader_id IS NULL ORDER BY id',
  );
  for (const project of orphans) {
    const [member] = await query<{ user_id: string }>(
      'SELECT user_id FROM project_member WHERE project_id = ? ORDER BY created_at, id LIMIT 1',
      [project.id],
    );
    if (member) {
      await query("UPDATE project_member SET role = 'owner' WHERE project_id = ? AND user_id = ?", [
        project.id,
        member.user_id,
      ]);
      await query('UPDATE projects SET leader_id = ? WHERE id = ?', [member.user_id, project.id]);
      console.log(`promote owner: project ${project.id} ${JSON.stringify(project.title)} -> ${member.user_id}`);
      continue;
    }
    console.log(`drop leaderless project: id=${project.id} title=${JSON.stringify(project.title)}`);
    await query('DELETE FROM applies WHERE project_id = ?', [project.id]);
    await query('DELETE FROM demands WHERE project_id = ?', [project.id]);
    await query('DELETE FROM project_member WHERE project_id = ?', [project.id]);
    await query('DELETE FROM projects WHERE id = ?', [project.id]);
  }
  // leader 型申请已不再受理，残留的 waiting 行没人能审批，直接置为 rejected。
  await query("UPDATE applies SET status = 'rejected', decided_at = NOW() WHERE status = 'waiting' AND type = 'leader'");
  const [column] = await query<{ nullable: string }>(
    `SELECT IS_NULLABLE AS nullable
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'leader_id'`,
  );
  if (column?.nullable === 'YES') {
    await query('ALTER TABLE projects MODIFY COLUMN leader_id VARCHAR(36) NOT NULL');
    console.log('projects.leader_id -> NOT NULL');
  }
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
  await ensureColumn('projects', 'repo_url', 'ALTER TABLE projects ADD COLUMN repo_url VARCHAR(512) NULL AFTER misc');
  await ensureColumn('projects', 'repo_urls', 'ALTER TABLE projects ADD COLUMN repo_urls JSON NULL AFTER repo_url');
  // 单仓库时代的数据搬进数组；后续以 repo_urls 为准，repo_url 只保留第一个做兼容。
  await query(
    "UPDATE projects SET repo_urls = JSON_ARRAY(repo_url) WHERE repo_url IS NOT NULL AND repo_url <> '' AND repo_urls IS NULL",
  );
  await ensureColumn('projects', 'dev_notes', 'ALTER TABLE projects ADD COLUMN dev_notes TEXT NULL AFTER repo_url');
  await ensureColumn('applies', 'resume_url', 'ALTER TABLE applies ADD COLUMN resume_url VARCHAR(2048) NULL AFTER note');
  await ensureColumn(
    'applies',
    'source',
    "ALTER TABLE applies ADD COLUMN source ENUM('web','join') NOT NULL DEFAULT 'web' AFTER resume_url",
  );
  await ensureColumn('sessions', 'access_token', 'ALTER TABLE sessions ADD COLUMN access_token TEXT NULL AFTER user_id');
  // external 应用的 access token 只有 1 小时，靠 refresh_token 续期。
  await ensureColumn('sessions', 'refresh_token', 'ALTER TABLE sessions ADD COLUMN refresh_token TEXT NULL AFTER access_token');
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
  // 无感登录：保存共享 Cookie 里的 UniSSO 会话 id，用于资格校验与单点登出。
  await ensureColumn('sessions', 'sso_session', 'ALTER TABLE sessions ADD COLUMN sso_session VARCHAR(128) NULL AFTER developer');
  // 需求状态机扩到五态：接单人提交后待确认，发布者可挂起与恢复。
  await ensureColumn('demands', 'submitted_at', 'ALTER TABLE demands ADD COLUMN submitted_at DATETIME NULL AFTER accepted_at');
  await ensureColumn(
    'demands',
    'status_before_suspend',
    "ALTER TABLE demands ADD COLUMN status_before_suspend ENUM('waiting','accepted','review') NULL AFTER status",
  );
  await ensureColumn(
    'demands',
    'revision',
    'ALTER TABLE demands ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 0 AFTER completed_at',
  );
  await ensureDemandStatusEnum();
  // 去重必须排在唯一索引之前，否则 ALTER 会因重复键失败。
  await dedupeDemands();
  // 角色枚举改名（leader→owner、participant→member、新增 admin）必须在
  // enforceLeaderRequired 之前完成，否则它写入的 owner 会被旧枚举拒绝。
  await migrateMemberRoles();
  // 收紧 leader 约束要排在列表查询/索引之前，旧库的 NULL 行必须先清掉。
  await enforceLeaderRequired();
  await ensureIndex(
    'demands',
    'uk_demands_project_title',
    'ALTER TABLE demands ADD UNIQUE KEY uk_demands_project_title (project_id, title)',
  );
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
      'owner',
    ]);
  }

  const members: Array<[number, string, string]> = [
    [1, sub(1), 'member'],
    [1, sub(2), 'member'],
    [2, sub(3), 'member'],
    [3, sub(4), 'member'],
    [4, sub(5), 'member'],
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
