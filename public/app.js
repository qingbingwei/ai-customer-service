const state = {
  token: "mock-token-1-user",
  adminToken: "mock-token-2-admin",
  sessions: [],
  activeSessionId: null,
  latestSources: []
};

const elements = {
  sessionList: document.querySelector("#session-list"),
  sessionTitle: document.querySelector("#session-title"),
  messageList: document.querySelector("#message-list"),
  chatForm: document.querySelector("#chat-form"),
  messageInput: document.querySelector("#message-input"),
  newSessionBtn: document.querySelector("#new-session-btn"),
  knowledgeList: document.querySelector("#knowledge-list"),
  sourceList: document.querySelector("#source-list"),
  kbCount: document.querySelector("#kb-count"),
  docCount: document.querySelector("#doc-count"),
  refreshKbBtn: document.querySelector("#refresh-kb-btn"),
  connectionStatus: document.querySelector("#connection-status")
};

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${options.admin ? state.adminToken : state.token}`,
    ...(options.headers || {})
  };
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "请求失败");
  }
  return payload.data;
}

async function loadSessions() {
  const data = await api("/api/chat/sessions?page_size=20");
  state.sessions = data.items;
  if (!state.activeSessionId && state.sessions.length > 0) {
    state.activeSessionId = state.sessions[0].session_id;
  }
  renderSessions();
  await loadSessionDetail();
}

async function loadKnowledgeBases() {
  const data = await api("/api/knowledge/bases?page_size=20", { admin: true });
  elements.kbCount.textContent = data.total;
  const totalDocuments = data.items.reduce((sum, item) => sum + item.document_count, 0);
  elements.docCount.textContent = totalDocuments;
  elements.knowledgeList.innerHTML = data.items.map(item => `
    <article class="knowledge-item">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${item.document_count} 个文档</span>
      <p>${escapeHtml(item.description || "")}</p>
    </article>
  `).join("");
}

async function loadSessionDetail() {
  if (!state.activeSessionId) {
    elements.sessionTitle.textContent = "暂无会话";
    elements.messageList.innerHTML = "";
    renderSources([]);
    return;
  }
  const session = await api(`/api/chat/sessions/${state.activeSessionId}`);
  elements.sessionTitle.textContent = session.title;
  elements.messageList.innerHTML = session.messages.map(renderMessage).join("");
  const lastAssistant = [...session.messages].reverse().find(item => item.role === "assistant" && item.sources);
  renderSources(lastAssistant?.sources || []);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderSessions() {
  elements.sessionList.innerHTML = state.sessions.map(session => `
    <button class="session-item ${session.session_id === state.activeSessionId ? "active" : ""}" data-session-id="${session.session_id}" type="button">
      <strong>${escapeHtml(session.title)}</strong>
      <span>${escapeHtml(session.last_message_preview || "暂无消息")}</span>
    </button>
  `).join("");
}

function renderMessage(message) {
  const roleLabel = message.role === "user" ? "用户" : "AI";
  return `
    <article class="message ${message.role}">
      <span>${roleLabel}</span>
      <p>${escapeHtml(message.content).replace(/\n/g, "<br>")}</p>
    </article>
  `;
}

function renderSources(sources) {
  state.latestSources = sources;
  if (!sources.length) {
    elements.sourceList.innerHTML = "<p class=\"empty-text\">暂无引用</p>";
    return;
  }
  elements.sourceList.innerHTML = sources.map(source => `
    <article class="source-item">
      <strong>${escapeHtml(source.doc_name)}</strong>
      <span>匹配度 ${source.score}</span>
      <p>${escapeHtml(source.snippet)}</p>
    </article>
  `).join("");
}

async function createSession() {
  const session = await api("/api/chat/sessions", {
    method: "POST",
    body: { knowledge_base_id: 1 }
  });
  state.activeSessionId = session.session_id;
  await loadSessions();
}

async function sendMessage(event) {
  event.preventDefault();
  const content = elements.messageInput.value.trim();
  if (!content || !state.activeSessionId) {
    return;
  }
  elements.messageInput.value = "";
  elements.connectionStatus.textContent = "生成中";
  const data = await api(`/api/chat/sessions/${state.activeSessionId}/messages`, {
    method: "POST",
    body: { content }
  });
  renderSources(data.assistant_message.sources || []);
  await loadSessions();
  elements.connectionStatus.textContent = "已连接";
}

function bindEvents() {
  elements.sessionList.addEventListener("click", async event => {
    const button = event.target.closest("[data-session-id]");
    if (!button) return;
    state.activeSessionId = Number(button.dataset.sessionId);
    renderSessions();
    await loadSessionDetail();
  });
  elements.chatForm.addEventListener("submit", sendMessage);
  elements.newSessionBtn.addEventListener("click", createSession);
  elements.refreshKbBtn.addEventListener("click", loadKnowledgeBases);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

bindEvents();
await Promise.all([loadSessions(), loadKnowledgeBases()]);
