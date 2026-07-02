CREATE DATABASE IF NOT EXISTS ai_customer_service
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE ai_customer_service;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS operation_logs;
DROP TABLE IF EXISTS qa_feedback;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS knowledge_bases;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  username VARCHAR(50) NOT NULL COMMENT '用户名',
  phone VARCHAR(20) NOT NULL COMMENT '手机号',
  email VARCHAR(100) NULL COMMENT '邮箱',
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt密码哈希',
  role VARCHAR(20) NOT NULL DEFAULT 'user' COMMENT '角色：user/admin',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1正常/0禁用',
  login_failed_count INT NOT NULL DEFAULT 0 COMMENT '连续登录失败次数',
  locked_until DATETIME NULL COMMENT '账号锁定截止时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  last_login_at DATETIME NULL COMMENT '最后登录时间',
  PRIMARY KEY (user_id),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_phone (phone),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_role_status (role, status),
  KEY idx_users_locked_until (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户信息表';

CREATE TABLE knowledge_bases (
  kb_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '知识库ID',
  name VARCHAR(100) NOT NULL COMMENT '知识库名称',
  description VARCHAR(500) NULL COMMENT '知识库描述',
  status VARCHAR(20) NOT NULL DEFAULT 'enabled' COMMENT '状态：enabled/disabled',
  document_count INT NOT NULL DEFAULT 0 COMMENT '已入库文档数',
  created_by BIGINT UNSIGNED NOT NULL COMMENT '创建人用户ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (kb_id),
  UNIQUE KEY uk_knowledge_bases_name (name),
  KEY idx_knowledge_bases_status (status),
  KEY idx_knowledge_bases_created_by (created_by),
  CONSTRAINT fk_knowledge_bases_created_by
    FOREIGN KEY (created_by) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库表';

CREATE TABLE documents (
  document_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '文档ID',
  kb_id BIGINT UNSIGNED NOT NULL COMMENT '知识库ID',
  file_name VARCHAR(255) NOT NULL COMMENT '文件名',
  file_type VARCHAR(20) NOT NULL COMMENT '文件类型：txt/pdf/docx',
  file_size INT UNSIGNED NOT NULL COMMENT '文件大小（字节）',
  file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
  content_hash CHAR(64) NULL COMMENT '文件内容SHA-256，用于去重',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态：pending/ready/failed/deleted',
  chunk_count INT NOT NULL DEFAULT 0 COMMENT '切片数量',
  error_message VARCHAR(500) NULL COMMENT '入库失败原因',
  created_by BIGINT UNSIGNED NOT NULL COMMENT '上传人用户ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  processed_at DATETIME NULL COMMENT '入库完成时间',
  PRIMARY KEY (document_id),
  KEY idx_documents_kb_status (kb_id, status),
  KEY idx_documents_created_by (created_by),
  UNIQUE KEY uk_documents_kb_hash (kb_id, content_hash),
  CONSTRAINT fk_documents_kb
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases (kb_id),
  CONSTRAINT fk_documents_created_by
    FOREIGN KEY (created_by) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识库文档表';

CREATE TABLE sessions (
  session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '会话ID',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  kb_id BIGINT UNSIGNED NULL COMMENT '关联知识库ID',
  title VARCHAR(100) NOT NULL DEFAULT '新会话' COMMENT '会话标题',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1进行中/0已删除',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  last_message_at DATETIME NULL COMMENT '最后消息时间',
  PRIMARY KEY (session_id),
  KEY idx_sessions_user_updated (user_id, updated_at),
  KEY idx_sessions_kb (kb_id),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT fk_sessions_kb
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases (kb_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话表';

CREATE TABLE messages (
  message_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '消息ID',
  session_id BIGINT UNSIGNED NOT NULL COMMENT '会话ID',
  role VARCHAR(20) NOT NULL COMMENT '消息角色：user/assistant/system',
  content MEDIUMTEXT NOT NULL COMMENT '消息内容',
  sources JSON NULL COMMENT '知识来源引用，仅AI回答保存',
  token_count INT NOT NULL DEFAULT 0 COMMENT '估算token数',
  latency_ms INT NOT NULL DEFAULT 0 COMMENT 'AI生成耗时毫秒',
  model_name VARCHAR(100) NULL COMMENT '调用模型名称',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (message_id),
  KEY idx_messages_session_created (session_id, created_at),
  KEY idx_messages_role (role),
  CONSTRAINT fk_messages_session
    FOREIGN KEY (session_id) REFERENCES sessions (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息表';

CREATE TABLE qa_feedback (
  feedback_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '反馈ID',
  message_id BIGINT UNSIGNED NOT NULL COMMENT 'AI回答消息ID',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '反馈用户ID',
  rating TINYINT NOT NULL COMMENT '评分：1有帮助/-1无帮助',
  comment VARCHAR(500) NULL COMMENT '反馈说明',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '反馈时间',
  PRIMARY KEY (feedback_id),
  UNIQUE KEY uk_feedback_message_user (message_id, user_id),
  KEY idx_feedback_user_created (user_id, created_at),
  CONSTRAINT fk_feedback_message
    FOREIGN KEY (message_id) REFERENCES messages (message_id),
  CONSTRAINT fk_feedback_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI回答反馈表';

CREATE TABLE operation_logs (
  log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '操作日志ID',
  operator_id BIGINT UNSIGNED NOT NULL COMMENT '操作人用户ID',
  action VARCHAR(80) NOT NULL COMMENT '操作动作',
  target_type VARCHAR(50) NULL COMMENT '操作对象类型',
  target_id BIGINT UNSIGNED NULL COMMENT '操作对象ID',
  detail JSON NULL COMMENT '操作详情',
  ip_address VARCHAR(45) NULL COMMENT '客户端IP',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (log_id),
  KEY idx_operation_logs_operator_time (operator_id, created_at),
  KEY idx_operation_logs_target (target_type, target_id),
  CONSTRAINT fk_operation_logs_operator
    FOREIGN KEY (operator_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作审计日志表';
