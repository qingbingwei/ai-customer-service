import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { JsonStore } from "./store.js";
import { handleError, notFound, parseBody, sendJson } from "./http.js";
import {
  aiChat,
  aiEmbedding,
  createKnowledgeBase,
  createSession,
  deleteDocument,
  deleteSession,
  deleteUser,
  getCurrentUser,
  getRequestUser,
  getSessionDetail,
  listDocuments,
  listKnowledgeBases,
  listSessions,
  listUsers,
  loginUser,
  registerUser,
  sendChatMessage,
  updateUserStatus,
  uploadDocument
} from "./customerService.js";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

export function createAppServer(options = {}) {
  const store = options.store || new JsonStore(options.dataFile || config.dataFile);
  const publicDir = options.publicDir || config.publicDir;
  const docsDir = options.docsDir || config.docsDir;
  const defaultUserId = options.defaultUserId || config.defaultUserId;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
      if (url.pathname === "/health") {
        sendJson(res, 200, {
          code: 200,
          message: "success",
          data: {
            status: "ok",
            service: "ai-customer-service",
            timestamp: new Date().toISOString()
          }
        });
        return;
      }

      if (url.pathname === "/api/ai/health") {
        sendJson(res, 200, {
          code: 200,
          message: "success",
          data: {
            status: "ok",
            service: "ai-service",
            model: "qwen-plus-mock",
            vector_store: "chroma-mock"
          }
        });
        return;
      }

      if (url.pathname.startsWith("/api")) {
        await handleApi(req, res, url, store, defaultUserId);
        return;
      }

      if (url.pathname.startsWith("/docs/")) {
        await serveStatic(res, docsDir, url.pathname.replace(/^\/docs/, ""));
        return;
      }

      await serveStatic(res, publicDir, url.pathname);
    } catch (error) {
      handleError(res, error);
    }
  });
}

async function handleApi(req, res, url, store, defaultUserId) {
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/api") {
    sendSuccess(res, 200, {
      name: "AI 智能客服系统 API",
      version: "0.1.0",
      docs: "/docs/api.md"
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/user/register") {
    const body = await parseBody(req);
    const user = await store.update(data => registerUser(data, body));
    sendSuccess(res, 200, user, "注册成功");
    return;
  }

  if (method === "POST" && url.pathname === "/api/user/login") {
    const body = await parseBody(req);
    const loginResult = await store.update(data => loginUser(data, body));
    sendSuccess(res, 200, loginResult, "登录成功");
    return;
  }

  if (method === "POST" && url.pathname === "/api/user/logout") {
    sendSuccess(res, 200, { revoked: true }, "退出成功");
    return;
  }

  if (method === "POST" && url.pathname === "/api/ai/embedding") {
    const body = await parseBody(req);
    sendSuccess(res, 200, aiEmbedding(body));
    return;
  }

  if (method === "POST" && url.pathname === "/api/ai/chat") {
    const body = await parseBody(req);
    const data = await store.read();
    const result = aiChat(data, body);
    if (expectsSse(req, url)) {
      sendSse(res, result.events);
    } else {
      sendSuccess(res, 200, { answer: result.answer, sources: result.sources });
    }
    return;
  }

  const data = await store.read();
  const user = getRequestUser(data, req, defaultUserId);

  if (method === "GET" && url.pathname === "/api/user/me") {
    sendSuccess(res, 200, getCurrentUser(user));
    return;
  }

  if (method === "GET" && url.pathname === "/api/user/list") {
    sendSuccess(res, 200, listUsers(data, user, url.searchParams));
    return;
  }

  const userStatusMatch = url.pathname.match(/^\/api\/user\/(\d+)\/status$/);
  if (method === "PUT" && userStatusMatch) {
    const body = await parseBody(req);
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return updateUserStatus(currentData, currentUser, userStatusMatch[1], body);
    });
    sendSuccess(res, 200, result);
    return;
  }

  const userDeleteMatch = url.pathname.match(/^\/api\/user\/(\d+)$/);
  if (method === "DELETE" && userDeleteMatch) {
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return deleteUser(currentData, currentUser, userDeleteMatch[1]);
    });
    sendSuccess(res, 200, result);
    return;
  }

  if (method === "GET" && url.pathname === "/api/knowledge/bases") {
    sendSuccess(res, 200, listKnowledgeBases(data, user, url.searchParams));
    return;
  }

  if (method === "POST" && url.pathname === "/api/knowledge/bases") {
    const body = await parseBody(req);
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return createKnowledgeBase(currentData, currentUser, body);
    });
    sendSuccess(res, 200, result, "知识库创建成功");
    return;
  }

  const kbDocumentsMatch = url.pathname.match(/^\/api\/knowledge\/bases\/(\d+)\/documents$/);
  if (method === "GET" && kbDocumentsMatch) {
    sendSuccess(res, 200, listDocuments(data, user, kbDocumentsMatch[1], url.searchParams));
    return;
  }

  if (method === "POST" && kbDocumentsMatch) {
    const body = await parseBody(req);
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return uploadDocument(currentData, currentUser, kbDocumentsMatch[1], body);
    });
    sendSuccess(res, 200, result, "文档上传成功");
    return;
  }

  const documentDeleteMatch = url.pathname.match(/^\/api\/knowledge\/documents\/(\d+)$/);
  if (method === "DELETE" && documentDeleteMatch) {
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return deleteDocument(currentData, currentUser, documentDeleteMatch[1]);
    });
    sendSuccess(res, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/api/chat/sessions") {
    const body = await parseBody(req);
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return createSession(currentData, currentUser, body);
    });
    sendSuccess(res, 200, result, "会话创建成功");
    return;
  }

  if (method === "GET" && url.pathname === "/api/chat/sessions") {
    sendSuccess(res, 200, listSessions(data, user, url.searchParams));
    return;
  }

  const sessionMessagesMatch = url.pathname.match(/^\/api\/chat\/sessions\/(\d+)\/messages$/);
  if (method === "POST" && sessionMessagesMatch) {
    const body = await parseBody(req);
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return sendChatMessage(currentData, currentUser, sessionMessagesMatch[1], body);
    });
    if (expectsSse(req, url)) {
      sendSse(res, result.events);
    } else {
      sendSuccess(res, 200, {
        user_message: result.user_message,
        assistant_message: result.assistant_message
      });
    }
    return;
  }

  const sessionMatch = url.pathname.match(/^\/api\/chat\/sessions\/(\d+)$/);
  if (method === "GET" && sessionMatch) {
    sendSuccess(res, 200, getSessionDetail(data, user, sessionMatch[1]));
    return;
  }

  if (method === "DELETE" && sessionMatch) {
    const result = await store.update(currentData => {
      const currentUser = getRequestUser(currentData, req, defaultUserId);
      return deleteSession(currentData, currentUser, sessionMatch[1]);
    });
    sendSuccess(res, 200, result);
    return;
  }

  notFound(res);
}

function sendSuccess(res, status, data, message = "success") {
  sendJson(res, status, {
    code: 200,
    message,
    data
  });
}

function expectsSse(req, url) {
  return url.searchParams.get("stream") === "1" || String(req.headers.accept || "").includes("text/event-stream");
}

function sendSse(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

async function serveStatic(res, publicDir, requestPath) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const baseDir = path.resolve(publicDir);
  const filePath = path.resolve(path.join(baseDir, safePath));
  const relativePath = path.relative(baseDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    notFound(res);
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    notFound(res);
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream"
  });
  fs.createReadStream(filePath).pipe(res);
}

const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isEntrypoint) {
  const server = createAppServer();
  server.listen(config.port, () => {
    console.log(`AI Customer Service is running at http://localhost:${config.port}`);
  });
}
