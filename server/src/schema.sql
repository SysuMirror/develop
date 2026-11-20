-- Developer 平台数据结构（MySQL 8）
-- 用户实体不在这里：唯一来源是 UniSSO 的 users 表，users.id 就是 OAuth sub。
-- 本库引用用户时一律直接存 sub（VARCHAR(36)），不建 developers / users 表。
-- 业务表：projects / project_member / applies / demands
-- 附加表：sessions（登录会话）、developer_qual_sync（回写 UniSSO 资格的待同步队列）

CREATE TABLE IF NOT EXISTS projects (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(128) NOT NULL,
  misc TEXT NULL,
  leader_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_projects_leader (leader_id),
  KEY idx_projects_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_member (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id INT UNSIGNED NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role ENUM('leader','participant') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_member_project_user (project_id, user_id),
  KEY idx_member_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS applies (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(36) NOT NULL,
  project_id INT UNSIGNED NOT NULL,
  type ENUM('leader','participant') NOT NULL,
  status ENUM('waiting','accepted','rejected') NOT NULL DEFAULT 'waiting',
  note VARCHAR(500) NULL,
  resume_url VARCHAR(2048) NULL,
  source ENUM('web','join') NOT NULL DEFAULT 'web',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  decided_by VARCHAR(36) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_apply_triple (project_id, user_id, type),
  KEY idx_apply_user (user_id),
  KEY idx_apply_project_status (project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS demands (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id INT UNSIGNED NOT NULL,
  title VARCHAR(128) NOT NULL,
  detail TEXT NULL,
  user_id VARCHAR(36) NULL,
  created_by VARCHAR(36) NULL,
  status ENUM('waiting','accepted','review','completed','suspended') NOT NULL DEFAULT 'waiting',
  status_before_suspend ENUM('waiting','accepted','review') NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at DATETIME NULL,
  submitted_at DATETIME NULL,
  completed_at DATETIME NULL,
  -- 当前版本号，等于被修改的次数；0 表示还是发布时的原文。
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_demands_project_title (project_id, title),
  KEY idx_demands_project (project_id),
  KEY idx_demands_user (user_id),
  KEY idx_demands_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 需求正文的版本快照：revision 0 是发布时的原文，之后每次修改追加一条。
-- 存完整正文而不是补丁，diff 由前端对相邻两版计算。
CREATE TABLE IF NOT EXISTS demand_revision (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  demand_id INT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  title VARCHAR(128) NOT NULL,
  detail TEXT NULL,
  editor_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_revision_demand_no (demand_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 展示用资料缓存：登录回调把 userinfo 的姓名/头像/邮箱抄一份，目录接口不可用时兜底。
-- 它不承担身份语义，谁是开发者仍由 UniSSO 决定。
CREATE TABLE IF NOT EXISTS user_profile (
  user_id    VARCHAR(36) NOT NULL PRIMARY KEY,
  name       VARCHAR(128) NULL,
  avatar     VARCHAR(512) NULL,
  email      VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(43) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  auth_method VARCHAR(16) NOT NULL DEFAULT 'sso',
  developer TINYINT(1) NULL,
  access_token TEXT NULL,
  refresh_token TEXT NULL,
  access_token_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 资格写入 UniSSO 的待同步队列：每个用户只保留最新目标值。
-- user_id 就是 UniSSO 的 users.id（sub），不需要再存一列 sso_sub。
CREATE TABLE IF NOT EXISTS developer_qual_sync (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(36) NOT NULL,
  target_value TINYINT(1) NOT NULL,
  status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  next_attempt_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_qual_sync_user (user_id),
  KEY idx_qual_sync_pending (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
