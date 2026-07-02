USE ai_customer_service;

INSERT INTO users (
  user_id, username, phone, email, password_hash, role, status,
  login_failed_count, locked_until, created_at, updated_at, last_login_at
)
VALUES
  (
    1, 'zhangsan', '13800138000', 'zhangsan@example.com',
    '$2b$12$mockUserHashForCourseDesignOnly', 'user', 1,
    0, NULL, '2026-07-01 10:00:00', '2026-07-01 10:00:00', '2026-07-01 14:00:00'
  ),
  (
    2, 'admin', '13800000000', 'admin@example.com',
    '$2b$12$mockAdminHashForCourseDesignOnly', 'admin', 1,
    0, NULL, '2026-07-01 09:00:00', '2026-07-01 09:00:00', '2026-07-01 13:30:00'
  );

INSERT INTO knowledge_bases (
  kb_id, name, description, status, document_count, created_by, created_at, updated_at
)
VALUES
  (
    1, '默认客服知识库', '覆盖售后、保修、发票、物流和常见故障排查的演示知识库。',
    'enabled', 2, 2, '2026-07-01 10:10:00', '2026-07-01 10:30:00'
  );

INSERT INTO documents (
  document_id, kb_id, file_name, file_type, file_size, file_path, content_hash,
  status, chunk_count, error_message, created_by, created_at, updated_at, processed_at
)
VALUES
  (
    1, 1, '扫地机器人故障排查手册.txt', 'txt', 2048,
    'uploads/kb_1/扫地机器人故障排查手册.txt',
    'd0fda08a6e2410ab7f55fb67484f9810651dc10857eeb476678ef0fcd2c62a41',
    'ready', 3, NULL, 2, '2026-07-01 10:20:00', '2026-07-01 10:25:00', '2026-07-01 10:25:00'
  ),
  (
    2, 1, '订单售后政策.md', 'txt', 1536,
    'uploads/kb_1/订单售后政策.md',
    '277c7c639dcd6c4fa1e653f2cb49eae9de7db3603272d2d3a3d345792c45852d',
    'ready', 2, NULL, 2, '2026-07-01 10:26:00', '2026-07-01 10:30:00', '2026-07-01 10:30:00'
  );

INSERT INTO sessions (
  session_id, user_id, kb_id, title, status, created_at, updated_at, last_message_at
)
VALUES
  (
    100, 1, 1, '扫地机器人故障咨询', 1,
    '2026-07-01 14:00:00', '2026-07-01 14:03:00', '2026-07-01 14:03:00'
  );

INSERT INTO messages (
  message_id, session_id, role, content, sources, token_count, latency_ms, model_name, created_at
)
VALUES
  (
    1000, 100, 'user', '扫地机器人无法开机怎么办？',
    NULL, 13, 0, NULL, '2026-07-01 14:01:00'
  ),
  (
    1001, 100, 'assistant',
    '根据知识库内容，建议先检查电源适配器、充电底座指示灯，并在长时间未使用后至少充电30分钟再尝试开机。',
    JSON_ARRAY(JSON_OBJECT(
      'document_id', 1,
      'doc_name', '扫地机器人故障排查手册.txt',
      'score', 0.93,
      'snippet', '扫地机器人无法开机时，请先检查电源适配器是否正常连接...'
    )),
    54, 220, 'qwen-plus-mock', '2026-07-01 14:03:00'
  );

INSERT INTO operation_logs (
  log_id, operator_id, action, target_type, target_id, detail, ip_address, created_at
)
VALUES
  (
    1, 2, 'document.upload', 'document', 1,
    JSON_OBJECT('kb_id', 1, 'file_name', '扫地机器人故障排查手册.txt'),
    '127.0.0.1', '2026-07-01 10:20:00'
  );
