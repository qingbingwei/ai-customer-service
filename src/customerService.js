import crypto from "node:crypto";
import { HttpError } from "./http.js";

const SUPPORTED_FILE_TYPES = new Set(["txt", "pdf", "docx"]);

export function getRequestUser(data, req, defaultUserId) {
  const token = getBearerToken(req.headers.authorization || "");
  const tokenUserId = token?.startsWith("mock-token-") ? token.split("-")[2] : null;
  const rawUserId = tokenUserId || req.headers["x-user-id"] || defaultUserId;
  const userId = Number(rawUserId);
  const user = data.users.find(item => item.user_id === userId && item.status === 1);
  if (!user) {
    throw new HttpError(401, "未授权或账号已禁用", null, 401);
  }
  return user;
}

export function registerUser(data, payload) {
  const username = String(payload.username || "").trim();
  const phone = String(payload.phone || "").trim();
  const password = String(payload.password || "");
  const email = payload.email ? String(payload.email).trim() : null;

  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/.test(username)) {
    throw new HttpError(400, "用户名需为3到20位字符", null, 1001);
  }
  if (!/^1\d{10}$/.test(phone)) {
    throw new HttpError(400, "手机号格式不正确", null, 1001);
  }
  if (!isStrongPassword(password)) {
    throw new HttpError(400, "密码至少8位且需包含字母和数字", null, 1001);
  }
  if (data.users.some(item => item.username === username)) {
    throw new HttpError(409, "账号已存在", null, 2001);
  }
  if (data.users.some(item => item.phone === phone)) {
    throw new HttpError(409, "手机号已注册", null, 2001);
  }

  const now = nowIso();
  const user = {
    user_id: nextId(data, "user_id"),
    username,
    phone,
    email,
    password,
    password_hash: hashPassword(password),
    role: "user",
    status: 1,
    login_failed_count: 0,
    locked_until: null,
    created_at: now,
    updated_at: now,
    last_login_at: null
  };
  data.users.push(user);
  return publicUser(user);
}

export function loginUser(data, payload) {
  const account = String(payload.account || "").trim();
  const password = String(payload.password || "");
  const user = data.users.find(item => item.username === account || item.phone === account);

  if (!user) {
    throw new HttpError(401, "账号或密码错误", null, 2002);
  }
  if (user.status !== 1) {
    throw new HttpError(403, "账号已禁用", null, 2003);
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(403, "账号已锁定，请稍后再试", null, 2004);
  }
  if (user.password !== password) {
    user.login_failed_count = (user.login_failed_count || 0) + 1;
    if (user.login_failed_count >= 5) {
      user.locked_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    }
    throw new HttpError(401, "账号或密码错误", null, 2002);
  }

  user.login_failed_count = 0;
  user.locked_until = null;
  user.last_login_at = nowIso();
  user.updated_at = user.last_login_at;

  return {
    token: `mock-token-${user.user_id}-${user.role}`,
    expires_in: payload.remember_me ? 7 * 24 * 3600 : 24 * 3600,
    user: publicUser(user)
  };
}

export function getCurrentUser(user) {
  return publicUser(user);
}

export function listUsers(data, user, query) {
  assertAdmin(user);
  const role = query.get("role");
  const status = query.get("status");
  return paginate(
    data.users
      .filter(item => !role || item.role === role)
      .filter(item => !status || String(item.status) === status)
      .map(publicUser),
    query
  );
}

export function updateUserStatus(data, user, userId, payload) {
  assertAdmin(user);
  const target = findById(data.users, "user_id", Number(userId), "用户不存在");
  const status = Number(payload.status);
  if (![0, 1].includes(status)) {
    throw new HttpError(400, "status 只能为 0 或 1", null, 1001);
  }
  target.status = status;
  target.updated_at = nowIso();
  return publicUser(target);
}

export function deleteUser(data, user, userId) {
  assertAdmin(user);
  const target = findById(data.users, "user_id", Number(userId), "用户不存在");
  target.status = 0;
  target.updated_at = nowIso();
  return publicUser(target);
}

export function listKnowledgeBases(data, user, query) {
  assertAdmin(user);
  return paginate(
    data.knowledge_bases.map(kb => decorateKnowledgeBase(data, kb)),
    query
  );
}

export function createKnowledgeBase(data, user, payload) {
  assertAdmin(user);
  const name = String(payload.name || "").trim();
  if (!name) {
    throw new HttpError(400, "知识库名称不能为空", null, 1001);
  }
  if (data.knowledge_bases.some(item => item.name === name)) {
    throw new HttpError(409, "知识库名称已存在", null, 1001);
  }

  const now = nowIso();
  const kb = {
    kb_id: nextId(data, "kb_id"),
    name,
    description: String(payload.description || "").trim(),
    status: "enabled",
    document_count: 0,
    created_by: user.user_id,
    created_at: now,
    updated_at: now
  };
  data.knowledge_bases.push(kb);
  addAuditLog(data, user, "knowledge_base.create", { kb_id: kb.kb_id, name: kb.name });
  return decorateKnowledgeBase(data, kb);
}

export function listDocuments(data, user, kbId, query) {
  assertAdmin(user);
  const id = Number(kbId);
  findById(data.knowledge_bases, "kb_id", id, "知识库不存在");
  return paginate(
    data.documents.filter(item => item.kb_id === id),
    query
  );
}

export function uploadDocument(data, user, kbId, payload) {
  assertAdmin(user);
  const id = Number(kbId);
  const kb = findById(data.knowledge_bases, "kb_id", id, "知识库不存在");
  const fileName = String(payload.file_name || payload.fileName || "").trim();
  const fileType = String(payload.file_type || payload.fileType || "").trim().toLowerCase();
  const text = String(payload.text || "");
  const fileSize = Number(payload.file_size || payload.fileSize || Buffer.byteLength(text || fileName));

  if (!fileName) {
    throw new HttpError(400, "文件名不能为空", null, 1001);
  }
  if (!SUPPORTED_FILE_TYPES.has(fileType)) {
    throw new HttpError(400, "文档格式不支持", null, 4001);
  }
  if (fileSize > 20 * 1024 * 1024) {
    throw new HttpError(413, "文件超过大小限制", null, 4002);
  }

  const now = nowIso();
  const document = {
    document_id: nextId(data, "document_id"),
    kb_id: id,
    file_name: fileName,
    file_type: fileType,
    file_size: fileSize,
    file_path: `uploads/kb_${id}/${fileName}`,
    content_hash: hashText(text || fileName),
    status: "ready",
    chunk_count: 0,
    error_message: null,
    created_by: user.user_id,
    created_at: now,
    updated_at: now,
    processed_at: now
  };

  const chunks = splitText(text || `${fileName} 的演示知识片段。`);
  chunks.forEach((content, index) => {
    data.document_chunks.push({
      chunk_id: `${document.document_id}-${index}`,
      kb_id: id,
      document_id: document.document_id,
      chunk_index: index,
      content,
      embedding: makeEmbedding(content),
      metadata: {
        source: fileName,
        file_name: fileName,
        document_id: document.document_id,
        chunk_index: index
      }
    });
  });
  document.chunk_count = chunks.length;
  data.documents.push(document);
  kb.document_count = data.documents.filter(item => item.kb_id === id && item.status === "ready").length;
  kb.updated_at = now;
  addAuditLog(data, user, "document.upload", { kb_id: id, document_id: document.document_id, file_name: fileName });
  return document;
}

export function deleteDocument(data, user, documentId) {
  assertAdmin(user);
  const id = Number(documentId);
  const document = findById(data.documents, "document_id", id, "文档不存在");
  document.status = "deleted";
  document.updated_at = nowIso();
  data.document_chunks = data.document_chunks.filter(item => item.document_id !== id);

  const kb = data.knowledge_bases.find(item => item.kb_id === document.kb_id);
  if (kb) {
    kb.document_count = data.documents.filter(item => item.kb_id === kb.kb_id && item.status === "ready").length;
    kb.updated_at = document.updated_at;
  }
  addAuditLog(data, user, "document.delete", { document_id: id });
  return document;
}

export function createSession(data, user, payload) {
  const kbId = payload.knowledge_base_id ?? payload.kb_id ?? 1;
  const kb = findById(data.knowledge_bases, "kb_id", Number(kbId), "知识库不存在");
  const now = nowIso();
  const session = {
    session_id: nextId(data, "session_id"),
    user_id: user.user_id,
    kb_id: kb.kb_id,
    title: String(payload.title || "新会话").trim(),
    status: 1,
    created_at: now,
    updated_at: now,
    last_message_at: null
  };
  data.sessions.push(session);
  return decorateSession(data, session);
}

export function listSessions(data, user, query) {
  const sessions = data.sessions
    .filter(item => item.user_id === user.user_id && item.status === 1)
    .sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at))
    .map(session => decorateSession(data, session));
  return paginate(sessions, query);
}

export function getSessionDetail(data, user, sessionId) {
  const session = findSessionForUser(data, user, sessionId);
  return {
    ...decorateSession(data, session),
    messages: data.messages
      .filter(item => item.session_id === session.session_id)
      .sort((left, right) => new Date(left.created_at) - new Date(right.created_at))
  };
}

export function deleteSession(data, user, sessionId) {
  const session = findSessionForUser(data, user, sessionId);
  session.status = 0;
  session.updated_at = nowIso();
  return decorateSession(data, session);
}

export function sendChatMessage(data, user, sessionId, payload) {
  const session = findSessionForUser(data, user, sessionId);
  const content = String(payload.content || "").trim();
  if (!content) {
    throw new HttpError(400, "消息内容不能为空", null, 3002);
  }

  const now = nowIso();
  const userMessage = {
    message_id: nextId(data, "message_id"),
    session_id: session.session_id,
    role: "user",
    content,
    sources: null,
    token_count: content.length,
    latency_ms: 0,
    model_name: null,
    created_at: now
  };
  data.messages.push(userMessage);

  const aiResult = generateAnswer(data, content, session.kb_id, Number(payload.top_k || 5));
  const assistantMessage = {
    message_id: nextId(data, "message_id"),
    session_id: session.session_id,
    role: "assistant",
    content: aiResult.answer,
    sources: aiResult.sources,
    token_count: aiResult.answer.length,
    latency_ms: 180,
    model_name: "qwen-plus-mock",
    created_at: nowIso()
  };
  data.messages.push(assistantMessage);

  if (session.title === "新会话") {
    session.title = content.slice(0, 20);
  }
  session.updated_at = assistantMessage.created_at;
  session.last_message_at = assistantMessage.created_at;

  return {
    user_message: userMessage,
    assistant_message: assistantMessage,
    events: buildSseEvents(assistantMessage)
  };
}

export function aiEmbedding(payload) {
  const texts = Array.isArray(payload.texts) ? payload.texts : [];
  if (texts.length === 0) {
    throw new HttpError(400, "texts 不能为空", null, 1001);
  }
  return {
    model: "text-embedding-v3-mock",
    embeddings: texts.map((text, index) => ({
      index,
      text,
      embedding: makeEmbedding(String(text))
    }))
  };
}

export function aiChat(data, payload) {
  const query = String(payload.query || "").trim();
  if (!query) {
    throw new HttpError(400, "query 不能为空", null, 3002);
  }
  const result = generateAnswer(data, query, Number(payload.knowledge_base_id || payload.kb_id || 1), Number(payload.top_k || 5));
  return {
    answer: result.answer,
    sources: result.sources,
    events: buildSseEvents({
      content: result.answer,
      sources: result.sources,
      message_id: null
    })
  };
}

function generateAnswer(data, query, kbId, topK) {
  const chunks = data.document_chunks
    .filter(item => item.kb_id === kbId)
    .map(chunk => ({
      ...chunk,
      score: scoreChunk(query, chunk.content)
    }))
    .filter(chunk => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  if (chunks.length === 0) {
    throw new HttpError(400, "知识库为空或未检索到可用内容", null, 5003);
  }

  const best = chunks[0];
  const answer = [
    "根据知识库内容，建议先按以下步骤处理：",
    summarizeChunk(best.content),
    "如果问题仍然存在，请保留故障现象、设备型号和操作时间，再转人工客服继续排查。"
  ].join("\n");

  return {
    answer,
    sources: chunks.map(chunk => ({
      document_id: chunk.document_id,
      doc_name: chunk.metadata.file_name,
      score: Number(chunk.score.toFixed(2)),
      snippet: chunk.content.slice(0, 120)
    }))
  };
}

function buildSseEvents(message) {
  const tokens = splitAnswerTokens(message.content);
  return [
    ...tokens.map(content => ({ type: "token", content })),
    { type: "sources", sources: message.sources || [] },
    { type: "done", message_id: message.message_id }
  ];
}

function splitAnswerTokens(text) {
  const parts = text.match(/.{1,12}/gs) || [];
  return parts;
}

function scoreChunk(query, content) {
  const normalizedQuery = query.toLowerCase();
  const normalizedContent = content.toLowerCase();
  const words = normalizedQuery
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  let score = words.reduce((total, word) => total + (normalizedContent.includes(word) ? 0.2 : 0), 0.55);
  for (const keyword of ["无法开机", "开机", "退款", "发票", "保修", "物流", "售后"]) {
    if (normalizedQuery.includes(keyword) && normalizedContent.includes(keyword)) {
      score += 0.25;
    }
  }
  return Math.min(score, 0.98);
}

function summarizeChunk(content) {
  const sentences = content
    .split(/[。！？\n]/)
    .map(item => item.trim())
    .filter(Boolean);
  return sentences.slice(0, 3).map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function decorateKnowledgeBase(data, kb) {
  return {
    ...kb,
    document_count: data.documents.filter(item => item.kb_id === kb.kb_id && item.status === "ready").length
  };
}

function decorateSession(data, session) {
  const kb = data.knowledge_bases.find(item => item.kb_id === session.kb_id);
  const messages = data.messages
    .filter(item => item.session_id === session.session_id)
    .sort((left, right) => new Date(left.created_at) - new Date(right.created_at));
  const last = messages[messages.length - 1];
  return {
    ...session,
    knowledge_base_name: kb?.name || null,
    message_count: messages.length,
    last_message_preview: last?.content?.slice(0, 40) || ""
  };
}

function findSessionForUser(data, user, sessionId) {
  const id = Number(sessionId);
  const session = data.sessions.find(item => item.session_id === id && item.status === 1);
  if (!session) {
    throw new HttpError(404, "会话不存在", null, 3001);
  }
  if (session.user_id !== user.user_id && user.role !== "admin") {
    throw new HttpError(403, "无权访问该会话", null, 403);
  }
  return session;
}

function findById(items, key, id, message) {
  const item = items.find(candidate => candidate[key] === id);
  if (!item) {
    throw new HttpError(404, message, null, 1002);
  }
  return item;
}

function assertAdmin(user) {
  if (user.role !== "admin") {
    throw new HttpError(403, "需要管理员权限", null, 403);
  }
}

function publicUser(user) {
  const {
    password,
    password_hash: _passwordHash,
    login_failed_count: _loginFailedCount,
    locked_until: _lockedUntil,
    ...safeUser
  } = user;
  return safeUser;
}

function paginate(items, query) {
  const page = Math.max(1, Number(query.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(query.get("page_size") || 10)));
  const start = (page - 1) * pageSize;
  return {
    total: items.length,
    page,
    page_size: pageSize,
    items: items.slice(start, start + pageSize)
  };
}

function nextId(data, name) {
  data.sequences[name] = Number(data.sequences[name] || 1) + 1;
  return data.sequences[name] - 1;
}

function addAuditLog(data, user, action, detail) {
  data.operation_logs.push({
    log_id: nextId(data, "log_id"),
    operator_id: user.user_id,
    action,
    detail,
    created_at: nowIso()
  });
}

function splitText(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) {
    return ["空文档占位片段。"];
  }
  const chunks = [];
  for (let index = 0; index < clean.length; index += 500) {
    chunks.push(clean.slice(index, index + 600));
  }
  return chunks;
}

function makeEmbedding(text) {
  const hash = crypto.createHash("sha256").update(text).digest();
  return Array.from({ length: 8 }, (_, index) => Number((hash[index] / 255).toFixed(4)));
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function hashPassword(password) {
  return `$mock$${hashText(password).slice(0, 32)}`;
}

function isStrongPassword(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function getBearerToken(value) {
  const match = String(value).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function nowIso() {
  return new Date().toISOString();
}
