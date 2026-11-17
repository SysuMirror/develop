-- Developer 平台数据结构（MySQL 8）
-- 五张业务表：developers / projects / project_member / applies / demands
-- 附加 sessions 用于登录会话

CREATE TABLE IF NOT EXISTS developers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sso_sub VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  avatar VARCHAR(255) NULL,
  email VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_developers_sso_sub (sso_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS projects (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(128) NOT NULL,
  misc TEXT NULL,
  leader_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_projects_leader (leader_id),
  KEY idx_projects_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_member (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id INT UNSIGNED NOT NULL,
  developer_id INT UNSIGNED NOT NULL,
  role ENUM('leader','participant') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_member_project_developer (project_id, developer_id),
  KEY idx_member_developer (developer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS applies (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  developer_id INT UNSIGNED NOT NULL,
  project_id INT UNSIGNED NOT NULL,
  type ENUM('leader','participant') NOT NULL,
  status ENUM('waiting','accepted','rejected') NOT NULL DEFAULT 'waiting',
  note VARCHAR(500) NULL,
  resume_url VARCHAR(2048) NULL,
  source ENUM('web','join') NOT NULL DEFAULT 'web',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  decided_by INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_apply_triple (project_id, developer_id, type),
  KEY idx_apply_developer (developer_id),
  KEY idx_apply_project_status (project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS demands (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id INT UNSIGNED NOT NULL,
  title VARCHAR(128) NOT NULL,
  detail TEXT NULL,
  developer_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  status ENUM('waiting','accepted','completed') NOT NULL DEFAULT 'waiting',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at DATETIME NULL,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_demands_project (project_id),
  KEY idx_demands_developer (developer_id),
  KEY idx_demands_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(43) NOT NULL,
  developer_id INT UNSIGNED NOT NULL,
  access_token TEXT NULL,
  access_token_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_developer (developer_id),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 开发者资格写入 UniSSO 的待同步队列：每个开发者只保留最新目标值
CREATE TABLE IF NOT EXISTS developer_qual_sync (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  developer_id INT UNSIGNED NOT NULL,
  sso_sub VARCHAR(64) NOT NULL,
  target_value TINYINT(1) NOT NULL,
  status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  next_attempt_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_qual_sync_developer (developer_id),
  KEY idx_qual_sync_pending (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
