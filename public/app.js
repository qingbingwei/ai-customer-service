const state = {
  token: "mock-token-1-user",
  adminToken: "mock-token-2-admin",
  currentUser: null,
  sessions: [],
  knowledgeBases: [],
  activeSessionId: null,
  latestSources: [],
  isBusy: false
};

const elements = {
  operatorName: document.querySelector("#operator-name"),
  operatorRole: document.querySelector("#operator-role"),
  serviceStatus: document.querySelector("#service-status"),
  latencyLabel: document.querySelector("#latency-label"),
  sessionMetric: document.querySelector("#metric-sessions"),
  kbMetric: document.querySelector("#metric-kb"),
  docsMetric: document.querySelector("#metric-docs"),
  answersMetric: document.querySelector("#metric-answers"),
  sessionList: document.querySelector("#session-list"),
  sessionTitle: document.querySelector("#session-title"),
  messageList: document.querySelector("#message-list"),
  chatForm: document.querySelector("#chat-form"),
  messageInput: document.querySelector("#message-input"),
  composerFeedback: document.querySelector("#composer-feedback"),
  newSessionBtn: document.querySelector("#new-session-btn"),
  refreshSessionsBtn: document.querySelector("#refresh-sessions-btn"),
  knowledgeList: document.querySelector("#knowledge-list"),
  sourceList: document.querySelector("#source-list"),
  refreshKbBtn: document.querySelector("#refresh-kb-btn"),
  connectionStatus: document.querySelector("#connection-status"),
  uploadForm: document.querySelector("#upload-form"),
  uploadFeedback: document.querySelector("#upload-feedback")
};

async function api(path, options = {}) {
  const startedAt = performance.now();
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
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  elements.latencyLabel.textContent = `延迟 ${Math.round(performance.now() - startedAt)} ms`;
  if (!response.ok) {
    throw new Error(payload?.message || "请求失败");
  }
  return payload.data;
}

async function loadCurrentUser() {
  state.currentUser = await api("/api/user/me");
  elements.operatorName.textContent = state.currentUser.username;
  elements.operatorRole.textContent = state.currentUser.role === "admin" ? "管理员" : "普通用户";
}

async function loadSessions() {
  setLoading(elements.sessionList, "正在加载会话");
  const data = await api("/api/chat/sessions?page_size=50");
  state.sessions = data.items;
  const hashSessionId = Number((location.hash.match(/session-(\d+)/) || [])[1]);
  if (!state.activeSessionId && hashSessionId) {
    state.activeSessionId = hashSessionId;
  }
  if (!state.sessions.some(item => item.session_id === state.activeSessionId)) {
    state.activeSessionId = state.sessions[0]?.session_id || null;
  }
  elements.sessionMetric.textContent = String(data.total);
  renderSessions();
  await loadSessionDetail();
}

async function loadKnowledgeBases() {
  const data = await api("/api/knowledge/bases?page_size=50", { admin: true });
  state.knowledgeBases = data.items;
  elements.kbMetric.textContent = String(data.total);
  elements.docsMetric.textContent = String(data.items.reduce((sum, item) => sum + item.document_count, 0));
  renderKnowledgeBases();
}

async function loadSessionDetail() {
  if (!state.activeSessionId) {
    elements.sessionTitle.textContent = "暂无会话";
    elements.messageList.innerHTML = emptyState("暂无会话", "新建会话后开始演示");
    elements.answersMetric.textContent = "0";
    renderSources([]);
    return;
  }
  const session = await api(`/api/chat/sessions/${state.activeSessionId}`);
  elements.sessionTitle.textContent = session.title;
  elements.messageList.innerHTML = session.messages.map(renderMessage).join("");
  elements.answersMetric.textContent = String(session.messages.filter(item => item.role === "assistant").length);
  const lastAssistant = [...session.messages].reverse().find(item => item.role === "assistant" && item.sources);
  renderSources(lastAssistant?.sources || []);
  location.hash = `session-${session.session_id}`;
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderSessions() {
  if (!state.sessions.length) {
    elements.sessionList.innerHTML = emptyState("无会话", "点击新建会话");
    return;
  }
  elements.sessionList.innerHTML = state.sessions.map(session => `
    <button class="session-item ${session.session_id === state.activeSessionId ? "active" : ""}" data-session-id="${session.session_id}" type="button">
      <span class="session-title">${escapeHtml(session.title)}</span>
      <span class="session-meta">${escapeHtml(session.knowledge_base_name || "未绑定知识库")} · ${session.message_count} 条消息</span>
      <span class="session-preview">${escapeHtml(session.last_message_preview || "暂无消息")}</span>
    </button>
  `).join("");
}

function renderKnowledgeBases() {
  if (!state.knowledgeBases.length) {
    elements.knowledgeList.innerHTML = emptyState("无知识库", "请创建知识库");
    return;
  }
  elements.knowledgeList.innerHTML = state.knowledgeBases.map(item => `
    <article class="knowledge-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="status-chip neutral">${escapeHtml(item.status)}</span>
      </div>
      <p>${escapeHtml(item.description || "")}</p>
      <div class="row-meta">
        <span>${item.document_count} 个文档</span>
        <span>KB-${item.kb_id}</span>
      </div>
    </article>
  `).join("");
}

function renderMessage(message) {
  const roleLabel = message.role === "user" ? "用户" : "AI 客服";
  const meta = message.role === "assistant" && message.model_name
    ? `${escapeHtml(message.model_name)} · ${message.latency_ms} ms`
    : formatTime(message.created_at);
  return `
    <article class="message ${message.role}">
      <div class="message-meta">
        <span>${roleLabel}</span>
        <small>${meta}</small>
      </div>
      <p>${escapeHtml(message.content).replace(/\n/g, "<br>")}</p>
    </article>
  `;
}

function renderSources(sources) {
  state.latestSources = sources;
  if (!sources.length) {
    elements.sourceList.innerHTML = emptyState("暂无引用", "发送问题后展示来源");
    return;
  }
  elements.sourceList.innerHTML = sources.map(source => `
    <article class="source-item">
      <div>
        <strong>${escapeHtml(source.doc_name)}</strong>
        <span>${Number(source.score).toFixed(2)}</span>
      </div>
      <p>${escapeHtml(source.snippet)}</p>
    </article>
  `).join("");
}

async function createSession() {
  runTask(async () => {
    const session = await api("/api/chat/sessions", {
      method: "POST",
      body: { knowledge_base_id: 1 }
    });
    state.activeSessionId = session.session_id;
    await loadSessions();
    setFeedback(elements.composerFeedback, "会话已创建", "success");
  });
}

async function sendMessage(event) {
  event.preventDefault();
  const content = elements.messageInput.value.trim();
  if (!content) {
    setFeedback(elements.composerFeedback, "请输入客户问题", "error");
    elements.messageInput.focus();
    return;
  }
  if (!state.activeSessionId) {
    await createSession();
  }
  await runTask(async () => {
    elements.messageInput.value = "";
    setFeedback(elements.composerFeedback, "AI 正在生成回答", "loading");
    elements.connectionStatus.textContent = "生成中";
    elements.connectionStatus.className = "status-chip warning";
    const data = await api(`/api/chat/sessions/${state.activeSessionId}/messages`, {
      method: "POST",
      body: { content }
    });
    renderSources(data.assistant_message.sources || []);
    await loadSessions();
    setFeedback(elements.composerFeedback, "回答已生成", "success");
  });
  elements.connectionStatus.textContent = "已连接";
  elements.connectionStatus.className = "status-chip success";
}

async function uploadDocument(event) {
  event.preventDefault();
  const form = new FormData(elements.uploadForm);
  const fileName = String(form.get("file_name") || "").trim();
  const text = String(form.get("text") || "").trim();
  if (!fileName || !text) {
    setFeedback(elements.uploadFeedback, "文档名称和内容不能为空", "error");
    return;
  }
  await runTask(async () => {
    setFeedback(elements.uploadFeedback, "文档入库中", "loading");
    await api("/api/knowledge/bases/1/documents", {
      method: "POST",
      admin: true,
      body: {
        file_name: fileName,
        file_type: fileName.endsWith(".pdf") ? "pdf" : fileName.endsWith(".docx") ? "docx" : "txt",
        text
      }
    });
    await loadKnowledgeBases();
    setFeedback(elements.uploadFeedback, "文档已入库", "success");
  }, elements.uploadFeedback);
}

async function runTask(task, feedbackElement = elements.composerFeedback) {
  if (state.isBusy) return;
  state.isBusy = true;
  document.body.classList.add("is-busy");
  try {
    await task();
  } catch (error) {
    setFeedback(feedbackElement, error.message, "error");
    elements.connectionStatus.textContent = "需处理";
    elements.connectionStatus.className = "status-chip danger";
  } finally {
    state.isBusy = false;
    document.body.classList.remove("is-busy");
  }
}

function setFeedback(element, message, type) {
  element.textContent = message;
  element.dataset.state = type;
}

function setLoading(container, label) {
  container.innerHTML = `
    <div class="skeleton-stack" aria-label="${escapeHtml(label)}">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
}

function emptyState(title, detail) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
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
  elements.refreshSessionsBtn.addEventListener("click", loadSessions);
  elements.refreshKbBtn.addEventListener("click", loadKnowledgeBases);
  elements.uploadForm.addEventListener("submit", uploadDocument);

  document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => {
      elements.messageInput.value = button.dataset.prompt;
      elements.messageInput.focus();
    });
  });

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach(item => item.classList.toggle("active", item === button));
      document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.toggle("active", panel.id === `${button.dataset.tab}-panel`);
      });
    });
  });

  document.querySelectorAll("[data-panel]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button));
      if (button.dataset.panel === "knowledge") {
        document.querySelector('[data-tab="knowledge"]').click();
      }
      if (button.dataset.panel === "conversation") {
        document.querySelector('[data-tab="sources"]').click();
      }
    });
  });
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

async function bootstrap() {
  bindEvents();
  try {
    await loadCurrentUser();
    await Promise.all([loadSessions(), loadKnowledgeBases()]);
    elements.serviceStatus.textContent = "服务在线";
    elements.serviceStatus.className = "status-chip success";
  } catch (error) {
    elements.serviceStatus.textContent = "连接异常";
    elements.serviceStatus.className = "status-chip danger";
    setFeedback(elements.composerFeedback, error.message, "error");
  }
}

await bootstrap();
