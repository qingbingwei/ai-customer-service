import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAppServer } from "../src/server.js";

async function createTestServer() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-customer-service-"));
  const dataFile = path.join(tmpDir, "app-data.json");
  await fs.copyFile(path.resolve("data/app-data.json"), dataFile);
  const server = createAppServer({
    dataFile,
    publicDir: path.resolve("public"),
    docsDir: path.resolve("docs")
  });
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

test("health check returns ok", async () => {
  const app = await createTestServer();
  try {
    const response = await fetch(`${app.baseUrl}/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.status, "ok");
    assert.equal(payload.data.service, "ai-customer-service");
  } finally {
    await app.close();
  }
});

test("login returns a mock token and user profile", async () => {
  const app = await createTestServer();
  try {
    const response = await fetch(`${app.baseUrl}/api/user/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "zhangsan", password: "Pass1234" })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.match(payload.data.token, /^mock-token-1-user$/);
    assert.equal(payload.data.user.username, "zhangsan");
  } finally {
    await app.close();
  }
});

test("knowledge base list requires admin role", async () => {
  const app = await createTestServer();
  try {
    const response = await fetch(`${app.baseUrl}/api/knowledge/bases`, {
      headers: { "x-user-id": "1" }
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.code, 403);
  } finally {
    await app.close();
  }
});

test("chat message returns assistant answer with sources", async () => {
  const app = await createTestServer();
  try {
    const response = await fetch(`${app.baseUrl}/api/chat/sessions/100/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "1"
      },
      body: JSON.stringify({ content: "扫地机器人无法开机怎么办？" })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.assistant_message.role, "assistant");
    assert.ok(payload.data.assistant_message.sources.length >= 1);
  } finally {
    await app.close();
  }
});

test("chat message can stream server-sent events", async () => {
  const app = await createTestServer();
  try {
    const response = await fetch(`${app.baseUrl}/api/chat/sessions/100/messages?stream=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "1",
        accept: "text/event-stream"
      },
      body: JSON.stringify({ content: "怎么申请发票？" })
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.match(text, /"type":"token"/);
    assert.match(text, /"type":"done"/);
  } finally {
    await app.close();
  }
});
