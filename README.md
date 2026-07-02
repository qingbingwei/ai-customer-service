# AI 智能客服系统

本工程是“AI 智能客服系统”的初始代码交付，依据已有需求、概要设计和详细设计文档建立。当前版本采用零依赖 Python 标准库 HTTP 服务模拟 Gateway 与核心业务服务，前端提供可运行的客服工作台原型；后续可按设计文档拆分为 FastAPI 微服务，并接入 MySQL、Redis、ChromaDB 与 DashScope。

## 功能范围

- 用户注册、登录、退出、个人信息、管理员用户管理
- 知识库列表、知识库创建、文档上传入库、文档删除
- 会话创建、会话列表、会话详情、删除会话
- RAG 问答 mock、知识来源引用、SSE 流式输出
- AI 内部能力 mock：健康检查、文本向量化、RAG 生成

## 技术方案

- 运行环境：Python 3.11+
- 服务端：Python 标准库 `http.server`
- 前端：HTML、CSS、原生 JavaScript
- 演示数据：`data/app-data.json`
- 目标数据库：MySQL 8.0，详见 `docs/database-design.md`
- 目标架构：React + Gateway + user/chat/knowledge/ai-service + MySQL/Redis/ChromaDB/DashScope

## 目录结构

```text
.
├── data/                  # 初始演示数据与 mock 知识库
├── database/              # MySQL 初始化脚本与种子数据
├── docs/                  # 数据库设计文档、接口文档初版
├── public/                # 客服工作台前端页面
├── src/                   # 初始工程服务端代码
└── tests/                 # Python 接口测试
```

## 快速启动

```bash
python3 src/server.py
```

启动后访问：

- Web 工作台：`http://localhost:3000`
- 健康检查：`http://localhost:3000/health`
- 接口根路径：`http://localhost:3000/api`
- 接口文档：`http://localhost:3000/docs/api.md`

## 测试

```bash
python3 -m unittest discover -s tests
```

## 演示账号

当前初始工程使用 mock token，也支持请求头 `x-user-id` 便于测试：

| 用户 | 密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| `zhangsan` | `Pass1234` | `user` | 普通咨询用户 |
| `admin` | `admin123` | `admin` | 知识库和用户管理员 |

登录接口会返回形如 `mock-token-1-user` 的 token。正式版本中应替换为 JWT、bcrypt 密码校验和 Redis token 黑名单。
