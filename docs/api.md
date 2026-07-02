# AI 智能客服系统接口文档（初版）

> 版本：0.1.0  
> 状态：初版，可用于前后端联调  
> 本地服务地址：`http://localhost:3000`  
> 目标网关地址：`http://localhost:8000`  
> 数据格式：`application/json`，流式问答使用 `text/event-stream`

## 1. 接口约定

### 1.1 统一响应结构

成功响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

失败响应：

```json
{
  "code": 1001,
  "message": "参数错误",
  "data": null,
  "details": null
}
```

### 1.2 认证方式

正式方案使用 JWT：

```http
Authorization: Bearer <JWT>
```

当前初始工程使用 mock token，登录后返回：

```text
mock-token-{user_id}-{role}
```

也支持 `x-user-id` 请求头辅助测试。

### 1.3 分页参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| page | number | 否 | 1 | 页码，从1开始 |
| page_size | number | 否 | 10 | 每页数量，最大100 |

分页响应：

```json
{
  "total": 12,
  "page": 1,
  "page_size": 10,
  "items": []
}
```

### 1.4 通用错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| 200 | 200 | 成功 |
| 1001 | 400 | 参数错误 |
| 1002 | 404 | 资源不存在 |
| 2001 | 409 | 账号已存在 |
| 2002 | 401 | 账号或密码错误 |
| 2003 | 403 | 账号已禁用 |
| 2004 | 403 | 账号已锁定 |
| 3001 | 404 | 会话不存在 |
| 3002 | 400 | 消息内容为空 |
| 4001 | 400 | 文档格式不支持 |
| 4002 | 413 | 文件超过大小限制 |
| 4003 | 500 | 文档入库失败 |
| 5001 | 504 | AI服务超时 |
| 5002 | 503 | AI服务不可用 |
| 5003 | 400 | 知识库为空或未检索到内容 |
| 401 | 401 | 未授权 |
| 403 | 403 | 权限不足 |
| 429 | 429 | 请求过多 |
| 500 | 500 | 服务器错误 |

## 2. 健康检查

### 2.1 系统健康检查

```http
GET /health
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "status": "ok",
    "service": "ai-customer-service",
    "timestamp": "2026-07-02T08:00:00.000Z"
  }
}
```

## 3. 用户接口 /api/user

### 3.1 用户注册

```http
POST /api/user/register
Content-Type: application/json
```

请求体：

```json
{
  "username": "lisi",
  "phone": "13900139000",
  "email": "lisi@example.com",
  "password": "Pass1234"
}
```

规则：

| 字段 | 规则 |
| --- | --- |
| username | 3-20位，唯一 |
| phone | 11位手机号，唯一 |
| password | 至少8位，包含字母和数字 |

响应：

```json
{
  "code": 200,
  "message": "注册成功",
  "data": {
    "user_id": 3,
    "username": "lisi",
    "phone": "13900139000",
    "email": "lisi@example.com",
    "role": "user",
    "status": 1
  }
}
```

### 3.2 用户登录

```http
POST /api/user/login
Content-Type: application/json
```

请求体：

```json
{
  "account": "zhangsan",
  "password": "Pass1234",
  "remember_me": false
}
```

响应：

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "mock-token-1-user",
    "expires_in": 86400,
    "user": {
      "user_id": 1,
      "username": "zhangsan",
      "role": "user"
    }
  }
}
```

### 3.3 退出登录

```http
POST /api/user/logout
Authorization: Bearer <token>
```

响应：

```json
{
  "code": 200,
  "message": "退出成功",
  "data": {
    "revoked": true
  }
}
```

正式版本需将 JWT `jti` 写入 Redis 黑名单。

### 3.4 获取个人信息

```http
GET /api/user/me
Authorization: Bearer <token>
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "user_id": 1,
    "username": "zhangsan",
    "phone": "13800138000",
    "email": "zhangsan@example.com",
    "role": "user",
    "status": 1,
    "created_at": "2026-07-01T10:00:00.000Z",
    "last_login_at": "2026-07-01T14:00:00.000Z"
  }
}
```

### 3.5 用户列表（管理员）

```http
GET /api/user/list?page=1&page_size=10&role=user&status=1
Authorization: Bearer <admin-token>
```

响应数据：分页用户列表。

### 3.6 修改用户状态（管理员）

```http
PUT /api/user/{user_id}/status
Authorization: Bearer <admin-token>
Content-Type: application/json
```

请求体：

```json
{
  "status": 0
}
```

### 3.7 删除用户（管理员）

```http
DELETE /api/user/{user_id}
Authorization: Bearer <admin-token>
```

说明：初版实现为禁用用户，正式版本保持软删除/禁用策略。

## 4. 知识库接口 /api/knowledge

### 4.1 创建知识库（管理员）

```http
POST /api/knowledge/bases
Authorization: Bearer <admin-token>
Content-Type: application/json
```

请求体：

```json
{
  "name": "售后知识库",
  "description": "保修、退换货、发票和物流说明"
}
```

### 4.2 知识库列表（管理员）

```http
GET /api/knowledge/bases?page=1&page_size=10
Authorization: Bearer <admin-token>
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 10,
    "items": [
      {
        "kb_id": 1,
        "name": "默认客服知识库",
        "description": "覆盖售后、保修、发票、物流和常见故障排查的演示知识库。",
        "status": "enabled",
        "document_count": 2
      }
    ]
  }
}
```

### 4.3 上传文档（管理员）

正式接口：

```http
POST /api/knowledge/bases/{kb_id}/documents
Authorization: Bearer <admin-token>
Content-Type: multipart/form-data

file=<PDF/TXT/DOCX文件>
```

当前初始工程为便于本地演示，支持 JSON mock 上传：

```json
{
  "file_name": "保修政策.txt",
  "file_type": "txt",
  "file_size": 1024,
  "text": "设备保修期为自签收日起12个月..."
}
```

响应：

```json
{
  "code": 200,
  "message": "文档上传成功",
  "data": {
    "document_id": 3,
    "kb_id": 1,
    "file_name": "保修政策.txt",
    "status": "ready",
    "chunk_count": 1
  }
}
```

### 4.4 文档列表（管理员）

```http
GET /api/knowledge/bases/{kb_id}/documents?page=1&page_size=10
Authorization: Bearer <admin-token>
```

### 4.5 删除文档（管理员）

```http
DELETE /api/knowledge/documents/{document_id}
Authorization: Bearer <admin-token>
```

说明：删除后文档状态置为 `deleted`，同时移除 mock 切片；正式版本需同步删除 ChromaDB 对应向量。

## 5. 对话接口 /api/chat

### 5.1 创建会话

```http
POST /api/chat/sessions
Authorization: Bearer <token>
Content-Type: application/json
```

请求体：

```json
{
  "knowledge_base_id": 1,
  "title": "新会话"
}
```

响应：

```json
{
  "code": 200,
  "message": "会话创建成功",
  "data": {
    "session_id": 101,
    "user_id": 1,
    "kb_id": 1,
    "title": "新会话",
    "status": 1
  }
}
```

### 5.2 会话列表

```http
GET /api/chat/sessions?page=1&page_size=20
Authorization: Bearer <token>
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 1,
    "items": [
      {
        "session_id": 100,
        "title": "扫地机器人故障咨询",
        "knowledge_base_name": "默认客服知识库",
        "message_count": 2,
        "last_message_preview": "根据知识库内容，建议先检查..."
      }
    ]
  }
}
```

### 5.3 会话详情

```http
GET /api/chat/sessions/{session_id}
Authorization: Bearer <token>
```

响应数据包含会话信息和 `messages` 数组。

### 5.4 发送消息（JSON响应）

```http
POST /api/chat/sessions/{session_id}/messages
Authorization: Bearer <token>
Content-Type: application/json
```

请求体：

```json
{
  "content": "扫地机器人无法开机怎么办？",
  "top_k": 5
}
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "user_message": {
      "message_id": 1002,
      "role": "user",
      "content": "扫地机器人无法开机怎么办？"
    },
    "assistant_message": {
      "message_id": 1003,
      "role": "assistant",
      "content": "根据知识库内容，建议先按以下步骤处理...",
      "sources": [
        {
          "document_id": 1,
          "doc_name": "扫地机器人故障排查手册.txt",
          "score": 0.98,
          "snippet": "扫地机器人无法开机时，请先检查电源适配器..."
        }
      ]
    }
  }
}
```

### 5.5 发送消息（SSE流式）

```http
POST /api/chat/sessions/{session_id}/messages?stream=1
Authorization: Bearer <token>
Accept: text/event-stream
Content-Type: application/json
```

SSE 数据格式：

```text
data: {"type":"token","content":"根据知识库内容"}

data: {"type":"sources","sources":[{"doc_name":"扫地机器人故障排查手册.txt","score":0.98}]}

data: {"type":"done","message_id":1003}
```

异常事件：

```text
data: {"type":"error","code":5002,"message":"AI服务暂时不可用"}
```

### 5.6 删除会话

```http
DELETE /api/chat/sessions/{session_id}
Authorization: Bearer <token>
```

说明：初版实现为 `status = 0` 软删除。

## 6. AI 内部接口 /api/ai

AI 内部接口原则上只允许 chat-service、knowledge-service 调用；初始工程开放用于演示。

### 6.1 AI 服务健康检查

```http
GET /api/ai/health
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "status": "ok",
    "service": "ai-service",
    "model": "qwen-plus-mock",
    "vector_store": "chroma-mock"
  }
}
```

### 6.2 文本向量化

```http
POST /api/ai/embedding
Content-Type: application/json
```

请求体：

```json
{
  "texts": ["文本片段1", "文本片段2"],
  "kb_id": 1
}
```

响应：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "model": "text-embedding-v3-mock",
    "embeddings": [
      {
        "index": 0,
        "text": "文本片段1",
        "embedding": [0.12, 0.44, 0.81]
      }
    ]
  }
}
```

### 6.3 RAG 问答

```http
POST /api/ai/chat
Content-Type: application/json
```

请求体：

```json
{
  "query": "怎么申请发票？",
  "knowledge_base_id": 1,
  "context": [
    {"role": "user", "content": "我刚下单"}
  ],
  "top_k": 5
}
```

响应：默认 JSON；传 `?stream=1` 或 `Accept: text/event-stream` 时返回 SSE。

## 7. 初版与正式版差异

| 项目 | 初始工程 | 正式开发目标 |
| --- | --- | --- |
| 鉴权 | mock token / x-user-id | JWT + Redis 黑名单 |
| 密码 | mock hash | bcrypt |
| 数据库 | JSON 文件演示数据 | MySQL 8.0 |
| 向量库 | 内存 mock 切片 | ChromaDB |
| AI模型 | mock RAG 回答 | DashScope 通义千问 |
| 文档上传 | JSON mock 上传 | multipart 文件上传、异步解析入库 |
| 服务形态 | 单进程模拟 Gateway | Gateway + 4 个 FastAPI 微服务 |
