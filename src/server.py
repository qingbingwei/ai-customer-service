from __future__ import annotations

import json
import mimetypes
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import config
from src.service import (
    ApiError,
    ai_chat,
    ai_embedding,
    create_knowledge_base,
    create_session,
    delete_document,
    delete_session,
    delete_user,
    get_request_user,
    get_session_detail,
    list_documents,
    list_knowledge_bases,
    list_sessions,
    list_users,
    login_user,
    now_iso,
    public_user,
    register_user,
    send_chat_message,
    update_user_status,
    upload_document,
)
from src.store import JsonStore


class AiCustomerServiceHandler(BaseHTTPRequestHandler):
    store: JsonStore
    public_dir: Path
    docs_dir: Path
    default_user_id: int

    server_version = "AiCustomerService/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_common_headers()
        self.end_headers()

    def do_GET(self) -> None:
        self.dispatch()

    def do_HEAD(self) -> None:
        self.dispatch()

    def do_POST(self) -> None:
        self.dispatch()

    def do_PUT(self) -> None:
        self.dispatch()

    def do_DELETE(self) -> None:
        self.dispatch()

    def log_message(self, format: str, *args: Any) -> None:
        return

    def dispatch(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = flatten_query(parse_qs(parsed.query))
        try:
            if path == "/health" and self.command == "GET":
                self.send_success(
                    {
                        "status": "ok",
                        "service": "ai-customer-service",
                        "timestamp": now_iso(),
                    }
                )
                return

            if path == "/api/ai/health" and self.command == "GET":
                self.send_success(
                    {
                        "status": "ok",
                        "service": "ai-service",
                        "model": "qwen-plus-mock",
                        "vector_store": "chroma-mock",
                    }
                )
                return

            if path.startswith("/api"):
                self.handle_api(path, query)
                return

            if path.startswith("/docs/"):
                self.serve_static(self.docs_dir, path.removeprefix("/docs") or "/")
                return

            self.serve_static(self.public_dir, path)
        except ApiError as error:
            self.send_error_payload(error.status, error.code, error.message, error.details)
        except Exception as error:
            print(error, file=sys.stderr)
            self.send_error_payload(500, 500, "服务器内部错误")

    def handle_api(self, path: str, query: dict[str, str]) -> None:
        if self.command == "GET" and path == "/api":
            self.send_success({"name": "AI 智能客服系统 API", "version": "0.1.0", "docs": "/docs/api.md"})
            return

        if self.command == "POST" and path == "/api/user/register":
            result = self.store.update(lambda data: register_user(data, self.read_json()))
            self.send_success(result, "注册成功")
            return

        if self.command == "POST" and path == "/api/user/login":
            result = self.store.update(lambda data: login_user(data, self.read_json()))
            self.send_success(result, "登录成功")
            return

        if self.command == "POST" and path == "/api/user/logout":
            self.send_success({"revoked": True}, "退出成功")
            return

        if self.command == "POST" and path == "/api/ai/embedding":
            self.send_success(ai_embedding(self.read_json()))
            return

        if self.command == "POST" and path == "/api/ai/chat":
            result = ai_chat(self.store.read(), self.read_json())
            if self.expects_sse(query):
                self.send_sse(result["events"])
            else:
                self.send_success({"answer": result["answer"], "sources": result["sources"]})
            return

        data = self.store.read()
        user = get_request_user(data, self.normalized_headers(), self.default_user_id)

        if self.command == "GET" and path == "/api/user/me":
            self.send_success(public_user(user))
            return

        if self.command == "GET" and path == "/api/user/list":
            self.send_success(list_users(data, user, query))
            return

        match = match_path(path, "/api/user/{id}/status")
        if self.command == "PUT" and match:
            payload = self.read_json()
            result = self.store.update(
                lambda current: update_user_status(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    match["id"],
                    payload,
                )
            )
            self.send_success(result)
            return

        match = match_path(path, "/api/user/{id}")
        if self.command == "DELETE" and match:
            result = self.store.update(
                lambda current: delete_user(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    match["id"],
                )
            )
            self.send_success(result)
            return

        if self.command == "GET" and path == "/api/knowledge/bases":
            self.send_success(list_knowledge_bases(data, user, query))
            return

        if self.command == "POST" and path == "/api/knowledge/bases":
            payload = self.read_json()
            result = self.store.update(
                lambda current: create_knowledge_base(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    payload,
                )
            )
            self.send_success(result, "知识库创建成功")
            return

        match = match_path(path, "/api/knowledge/bases/{id}/documents")
        if self.command == "GET" and match:
            self.send_success(list_documents(data, user, match["id"], query))
            return

        if self.command == "POST" and match:
            payload = self.read_json()
            result = self.store.update(
                lambda current: upload_document(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    match["id"],
                    payload,
                )
            )
            self.send_success(result, "文档上传成功")
            return

        match = match_path(path, "/api/knowledge/documents/{id}")
        if self.command == "DELETE" and match:
            result = self.store.update(
                lambda current: delete_document(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    match["id"],
                )
            )
            self.send_success(result)
            return

        if self.command == "POST" and path == "/api/chat/sessions":
            payload = self.read_json()
            result = self.store.update(
                lambda current: create_session(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    payload,
                )
            )
            self.send_success(result, "会话创建成功")
            return

        if self.command == "GET" and path == "/api/chat/sessions":
            self.send_success(list_sessions(data, user, query))
            return

        match = match_path(path, "/api/chat/sessions/{id}/messages")
        if self.command == "POST" and match:
            payload = self.read_json()
            result = self.store.update(
                lambda current: send_chat_message(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    match["id"],
                    payload,
                )
            )
            if self.expects_sse(query):
                self.send_sse(result["events"])
            else:
                self.send_success({"user_message": result["user_message"], "assistant_message": result["assistant_message"]})
            return

        match = match_path(path, "/api/chat/sessions/{id}")
        if self.command == "GET" and match:
            self.send_success(get_session_detail(data, user, match["id"]))
            return

        if self.command == "DELETE" and match:
            result = self.store.update(
                lambda current: delete_session(
                    current,
                    get_request_user(current, self.normalized_headers(), self.default_user_id),
                    match["id"],
                )
            )
            self.send_success(result)
            return

        raise ApiError(404, "请求资源不存在", 1002)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0") or 0)
        if length == 0:
            return {}
        if length > 1024 * 1024:
            raise ApiError(413, "请求体过大", 413)
        raw = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            raise ApiError(400, "请求体必须是合法 JSON", 1001)
        if not isinstance(payload, dict):
            raise ApiError(400, "请求体必须是 JSON 对象", 1001)
        return payload

    def send_success(self, data: Any, message: str = "success", status: int = 200) -> None:
        self.send_json(status, {"code": 200, "message": message, "data": data})

    def send_error_payload(self, status: int, code: int, message: str, details: Any = None) -> None:
        self.send_json(status, {"code": code, "message": message, "data": None, "details": details})

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_common_headers()
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_sse(self, events: list[dict[str, Any]]) -> None:
        self.send_response(200)
        self.send_common_headers()
        self.send_header("content-type", "text/event-stream; charset=utf-8")
        self.send_header("cache-control", "no-cache, no-transform")
        self.end_headers()
        for event in events:
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
        self.wfile.flush()

    def send_common_headers(self) -> None:
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("access-control-allow-headers", "Authorization, Content-Type, X-User-Id")

    def serve_static(self, base_dir: Path, request_path: str) -> None:
        relative = request_path.lstrip("/") or "index.html"
        file_path = (base_dir / relative).resolve()
        base = base_dir.resolve()
        if base not in file_path.parents and file_path != base:
            raise ApiError(404, "请求资源不存在", 1002)
        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.exists() or not file_path.is_file():
            raise ApiError(404, "请求资源不存在", 1002)
        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        if content_type.startswith("text/") or file_path.suffix in {".js", ".json", ".md"}:
            content_type = f"{content_type}; charset=utf-8"
        self.send_response(200)
        self.send_common_headers()
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(content)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def normalized_headers(self) -> dict[str, str]:
        return {key.lower(): value for key, value in self.headers.items()}

    def expects_sse(self, query: dict[str, str]) -> bool:
        return query.get("stream") == "1" or "text/event-stream" in self.headers.get("accept", "")


def flatten_query(query: dict[str, list[str]]) -> dict[str, str]:
    return {key: values[-1] for key, values in query.items() if values}


def match_path(path: str, pattern: str) -> dict[str, str] | None:
    path_parts = [part for part in path.split("/") if part]
    pattern_parts = [part for part in pattern.split("/") if part]
    if len(path_parts) != len(pattern_parts):
        return None
    result: dict[str, str] = {}
    for actual, expected in zip(path_parts, pattern_parts):
        if expected.startswith("{") and expected.endswith("}"):
            result[expected[1:-1]] = actual
        elif actual != expected:
            return None
    return result


def create_app_server(
    host: str = "0.0.0.0",
    port: int = config.PORT,
    data_file: Path = config.DATA_FILE,
    public_dir: Path = config.PUBLIC_DIR,
    docs_dir: Path = config.DOCS_DIR,
    default_user_id: int = config.DEFAULT_USER_ID,
) -> ThreadingHTTPServer:
    store = JsonStore(data_file)
    public_path = Path(public_dir)
    docs_path = Path(docs_dir)
    fallback_user_id = default_user_id

    class Handler(AiCustomerServiceHandler):
        pass

    Handler.store = store
    Handler.public_dir = public_path
    Handler.docs_dir = docs_path
    Handler.default_user_id = fallback_user_id

    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    server = create_app_server()
    print(f"AI Customer Service is running at http://localhost:{config.PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
