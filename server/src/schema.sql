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
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_developer (developer_id),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
