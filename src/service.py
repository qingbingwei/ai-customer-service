from __future__ import annotations

import hashlib
import math
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any


SUPPORTED_FILE_TYPES = {"txt", "pdf", "docx"}


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: int | None = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code or status
        self.details = details


def get_request_user(data: dict[str, Any], headers: dict[str, str], default_user_id: int) -> dict[str, Any]:
    token = get_bearer_token(headers.get("authorization", ""))
    token_user_id = None
    if token and token.startswith("mock-token-"):
        parts = token.split("-")
        if len(parts) >= 4 and parts[2].isdigit():
            token_user_id = int(parts[2])
    raw_user_id = token_user_id or headers.get("x-user-id") or default_user_id
    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        raise ApiError(401, "未授权或账号已禁用", 401)
    user = next((item for item in data["users"] if item["user_id"] == user_id and item["status"] == 1), None)
    if not user:
        raise ApiError(401, "未授权或账号已禁用", 401)
    return user


def register_user(data: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    username = str(payload.get("username", "")).strip()
    phone = str(payload.get("phone", "")).strip()
    password = str(payload.get("password", ""))
    email = str(payload["email"]).strip() if payload.get("email") else None

    if not re.match(r"^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$", username):
        raise ApiError(400, "用户名需为3到20位字符", 1001)
    if not re.match(r"^1\d{10}$", phone):
        raise ApiError(400, "手机号格式不正确", 1001)
    if not is_strong_password(password):
        raise ApiError(400, "密码至少8位且需包含字母和数字", 1001)
    if any(item["username"] == username for item in data["users"]):
        raise ApiError(409, "账号已存在", 2001)
    if any(item["phone"] == phone for item in data["users"]):
        raise ApiError(409, "手机号已注册", 2001)

    now = now_iso()
    user = {
        "user_id": next_id(data, "user_id"),
        "username": username,
        "phone": phone,
        "email": email,
        "password": password,
        "password_hash": hash_password(password),
        "role": "user",
        "status": 1,
        "login_failed_count": 0,
        "locked_until": None,
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    data["users"].append(user)
    return public_user(user)


def login_user(data: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    account = str(payload.get("account", "")).strip()
    password = str(payload.get("password", ""))
    user = next((item for item in data["users"] if item["username"] == account or item["phone"] == account), None)
    if not user:
        raise ApiError(401, "账号或密码错误", 2002)
    if user["status"] != 1:
        raise ApiError(403, "账号已禁用", 2003)
    if user.get("locked_until") and parse_iso(user["locked_until"]) > datetime.now(timezone.utc):
        raise ApiError(403, "账号已锁定，请稍后再试", 2004)
    if user.get("password") != password:
        user["login_failed_count"] = int(user.get("login_failed_count") or 0) + 1
        if user["login_failed_count"] >= 5:
            user["locked_until"] = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat().replace("+00:00", "Z")
        raise ApiError(401, "账号或密码错误", 2002)

    now = now_iso()
    user["login_failed_count"] = 0
    user["locked_until"] = None
    user["last_login_at"] = now
    user["updated_at"] = now
    return {
        "token": f"mock-token-{user['user_id']}-{user['role']}",
        "expires_in": 7 * 24 * 3600 if payload.get("remember_me") else 24 * 3600,
        "user": public_user(user),
    }


def list_users(data: dict[str, Any], user: dict[str, Any], query: dict[str, str]) -> dict[str, Any]:
    assert_admin(user)
    role = query.get("role")
    status = query.get("status")
    users = [
        public_user(item)
        for item in data["users"]
        if (not role or item["role"] == role) and (not status or str(item["status"]) == str(status))
    ]
    return paginate(users, query)


def update_user_status(data: dict[str, Any], user: dict[str, Any], user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    assert_admin(user)
    target = find_by_id(data["users"], "user_id", int(user_id), "用户不存在")
    status = int(payload.get("status", -1))
    if status not in (0, 1):
        raise ApiError(400, "status 只能为 0 或 1", 1001)
    target["status"] = status
    target["updated_at"] = now_iso()
    return public_user(target)


def delete_user(data: dict[str, Any], user: dict[str, Any], user_id: str) -> dict[str, Any]:
    assert_admin(user)
    target = find_by_id(data["users"], "user_id", int(user_id), "用户不存在")
    target["status"] = 0
    target["updated_at"] = now_iso()
    return public_user(target)


def list_knowledge_bases(data: dict[str, Any], user: dict[str, Any], query: dict[str, str]) -> dict[str, Any]:
    assert_admin(user)
    bases = [decorate_knowledge_base(data, item) for item in data["knowledge_bases"]]
    return paginate(bases, query)


def create_knowledge_base(data: dict[str, Any], user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    assert_admin(user)
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ApiError(400, "知识库名称不能为空", 1001)
    if any(item["name"] == name for item in data["knowledge_bases"]):
        raise ApiError(409, "知识库名称已存在", 1001)
    now = now_iso()
    kb = {
        "kb_id": next_id(data, "kb_id"),
        "name": name,
        "description": str(payload.get("description", "")).strip(),
        "status": "enabled",
        "document_count": 0,
        "created_by": user["user_id"],
        "created_at": now,
        "updated_at": now,
    }
    data["knowledge_bases"].append(kb)
    add_audit_log(data, user, "knowledge_base.create", {"kb_id": kb["kb_id"], "name": kb["name"]})
    return decorate_knowledge_base(data, kb)


def list_documents(data: dict[str, Any], user: dict[str, Any], kb_id: str, query: dict[str, str]) -> dict[str, Any]:
    assert_admin(user)
    kb = int(kb_id)
    find_by_id(data["knowledge_bases"], "kb_id", kb, "知识库不存在")
    return paginate([item for item in data["documents"] if item["kb_id"] == kb], query)


def upload_document(data: dict[str, Any], user: dict[str, Any], kb_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    assert_admin(user)
    kb = find_by_id(data["knowledge_bases"], "kb_id", int(kb_id), "知识库不存在")
    file_name = str(payload.get("file_name") or payload.get("fileName") or "").strip()
    file_type = str(payload.get("file_type") or payload.get("fileType") or "").strip().lower()
    text = str(payload.get("text", ""))
    file_size = int(payload.get("file_size") or payload.get("fileSize") or len((text or file_name).encode("utf-8")))
    if not file_name:
        raise ApiError(400, "文件名不能为空", 1001)
    if file_type not in SUPPORTED_FILE_TYPES:
        raise ApiError(400, "文档格式不支持", 4001)
    if file_size > 20 * 1024 * 1024:
        raise ApiError(413, "文件超过大小限制", 4002)

    now = now_iso()
    document = {
        "document_id": next_id(data, "document_id"),
        "kb_id": kb["kb_id"],
        "file_name": file_name,
        "file_type": file_type,
        "file_size": file_size,
        "file_path": f"uploads/kb_{kb['kb_id']}/{file_name}",
        "content_hash": hash_text(text or file_name),
        "status": "ready",
        "chunk_count": 0,
        "error_message": None,
        "created_by": user["user_id"],
        "created_at": now,
        "updated_at": now,
        "processed_at": now,
    }
    chunks = split_text(text or f"{file_name} 的演示知识片段。")
    for index, content in enumerate(chunks):
        data["document_chunks"].append(
            {
                "chunk_id": f"{document['document_id']}-{index}",
                "kb_id": kb["kb_id"],
                "document_id": document["document_id"],
                "chunk_index": index,
                "content": content,
                "embedding": make_embedding(content),
                "metadata": {
                    "source": file_name,
                    "file_name": file_name,
                    "document_id": document["document_id"],
                    "chunk_index": index,
                },
            }
        )
    document["chunk_count"] = len(chunks)
    data["documents"].append(document)
    kb["document_count"] = len([item for item in data["documents"] if item["kb_id"] == kb["kb_id"] and item["status"] == "ready"])
    kb["updated_at"] = now
    add_audit_log(data, user, "document.upload", {"kb_id": kb["kb_id"], "document_id": document["document_id"], "file_name": file_name})
    return document


def delete_document(data: dict[str, Any], user: dict[str, Any], document_id: str) -> dict[str, Any]:
    assert_admin(user)
    doc = find_by_id(data["documents"], "document_id", int(document_id), "文档不存在")
    doc["status"] = "deleted"
    doc["updated_at"] = now_iso()
    data["document_chunks"] = [item for item in data["document_chunks"] if item["document_id"] != doc["document_id"]]
    kb = next((item for item in data["knowledge_bases"] if item["kb_id"] == doc["kb_id"]), None)
    if kb:
        kb["document_count"] = len([item for item in data["documents"] if item["kb_id"] == kb["kb_id"] and item["status"] == "ready"])
        kb["updated_at"] = doc["updated_at"]
    add_audit_log(data, user, "document.delete", {"document_id": doc["document_id"]})
    return doc


def create_session(data: dict[str, Any], user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    kb_id = int(payload.get("knowledge_base_id") or payload.get("kb_id") or 1)
    kb = find_by_id(data["knowledge_bases"], "kb_id", kb_id, "知识库不存在")
    now = now_iso()
    session = {
        "session_id": next_id(data, "session_id"),
        "user_id": user["user_id"],
        "kb_id": kb["kb_id"],
        "title": str(payload.get("title") or "新会话").strip(),
        "status": 1,
        "created_at": now,
        "updated_at": now,
        "last_message_at": None,
    }
    data["sessions"].append(session)
    return decorate_session(data, session)


def list_sessions(data: dict[str, Any], user: dict[str, Any], query: dict[str, str]) -> dict[str, Any]:
    sessions = [
        decorate_session(data, item)
        for item in data["sessions"]
        if item["user_id"] == user["user_id"] and item["status"] == 1
    ]
    sessions.sort(key=lambda item: item["updated_at"], reverse=True)
    return paginate(sessions, query)


def get_session_detail(data: dict[str, Any], user: dict[str, Any], session_id: str) -> dict[str, Any]:
    session = find_session_for_user(data, user, session_id)
    messages = [item for item in data["messages"] if item["session_id"] == session["session_id"]]
    messages.sort(key=lambda item: item["created_at"])
    return {**decorate_session(data, session), "messages": messages}


def delete_session(data: dict[str, Any], user: dict[str, Any], session_id: str) -> dict[str, Any]:
    session = find_session_for_user(data, user, session_id)
    session["status"] = 0
    session["updated_at"] = now_iso()
    return decorate_session(data, session)


def send_chat_message(data: dict[str, Any], user: dict[str, Any], session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    session = find_session_for_user(data, user, session_id)
    content = str(payload.get("content", "")).strip()
    if not content:
        raise ApiError(400, "消息内容不能为空", 3002)
    now = now_iso()
    user_message = {
        "message_id": next_id(data, "message_id"),
        "session_id": session["session_id"],
        "role": "user",
        "content": content,
        "sources": None,
        "token_count": len(content),
        "latency_ms": 0,
        "model_name": None,
        "created_at": now,
    }
    data["messages"].append(user_message)

    result = generate_answer(data, content, session["kb_id"], int(payload.get("top_k") or 5))
    assistant_message = {
        "message_id": next_id(data, "message_id"),
        "session_id": session["session_id"],
        "role": "assistant",
        "content": result["answer"],
        "sources": result["sources"],
        "token_count": len(result["answer"]),
        "latency_ms": 180,
        "model_name": "qwen-plus-mock",
        "created_at": now_iso(),
    }
    data["messages"].append(assistant_message)
    if session["title"] == "新会话":
        session["title"] = content[:20]
    session["updated_at"] = assistant_message["created_at"]
    session["last_message_at"] = assistant_message["created_at"]
    return {
        "user_message": user_message,
        "assistant_message": assistant_message,
        "events": build_sse_events(assistant_message),
    }


def ai_embedding(payload: dict[str, Any]) -> dict[str, Any]:
    texts = payload.get("texts")
    if not isinstance(texts, list) or not texts:
        raise ApiError(400, "texts 不能为空", 1001)
    return {
        "model": "text-embedding-v3-mock",
        "embeddings": [{"index": index, "text": text, "embedding": make_embedding(str(text))} for index, text in enumerate(texts)],
    }


def ai_chat(data: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query", "")).strip()
    if not query:
        raise ApiError(400, "query 不能为空", 3002)
    result = generate_answer(data, query, int(payload.get("knowledge_base_id") or payload.get("kb_id") or 1), int(payload.get("top_k") or 5))
    return {
        "answer": result["answer"],
        "sources": result["sources"],
        "events": build_sse_events({"content": result["answer"], "sources": result["sources"], "message_id": None}),
    }


def generate_answer(data: dict[str, Any], query: str, kb_id: int, top_k: int) -> dict[str, Any]:
    chunks = []
    for chunk in data["document_chunks"]:
        if chunk["kb_id"] != kb_id:
            continue
        score = score_chunk(query, chunk["content"])
        if score > 0:
            chunks.append({**chunk, "score": score})
    chunks.sort(key=lambda item: item["score"], reverse=True)
    chunks = chunks[:top_k]
    if not chunks:
        raise ApiError(400, "知识库为空或未检索到可用内容", 5003)
    best = chunks[0]
    answer = "\n".join(
        [
            "根据知识库内容，建议先按以下步骤处理：",
            summarize_chunk(best["content"]),
            "如果问题仍然存在，请保留故障现象、设备型号和操作时间，再转人工客服继续排查。",
        ]
    )
    return {
        "answer": answer,
        "sources": [
            {
                "document_id": chunk["document_id"],
                "doc_name": chunk["metadata"]["file_name"],
                "score": round(chunk["score"], 2),
                "snippet": chunk["content"][:120],
            }
            for chunk in chunks
        ],
    }


def build_sse_events(message: dict[str, Any]) -> list[dict[str, Any]]:
    events = [{"type": "token", "content": token} for token in split_answer_tokens(message["content"])]
    events.append({"type": "sources", "sources": message.get("sources") or []})
    events.append({"type": "done", "message_id": message.get("message_id")})
    return events


def split_answer_tokens(text: str) -> list[str]:
    return [text[index : index + 12] for index in range(0, len(text), 12)]


def score_chunk(query: str, content: str) -> float:
    normalized_query = query.lower()
    normalized_content = content.lower()
    words = [word for word in re.split(r"[^\w\u4e00-\u9fa5]+", normalized_query) if word]
    score = 0.55 + sum(0.2 for word in words if word in normalized_content)
    for keyword in ("无法开机", "开机", "退款", "发票", "保修", "物流", "售后"):
        if keyword in normalized_query and keyword in normalized_content:
            score += 0.25
    return min(score, 0.98)


def summarize_chunk(content: str) -> str:
    sentences = [item.strip() for item in re.split(r"[。！？\n]", content) if item.strip()]
    return "\n".join(f"{index + 1}. {sentence}" for index, sentence in enumerate(sentences[:3]))


def decorate_knowledge_base(data: dict[str, Any], kb: dict[str, Any]) -> dict[str, Any]:
    return {
        **kb,
        "document_count": len([item for item in data["documents"] if item["kb_id"] == kb["kb_id"] and item["status"] == "ready"]),
    }


def decorate_session(data: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    kb = next((item for item in data["knowledge_bases"] if item["kb_id"] == session["kb_id"]), None)
    messages = [item for item in data["messages"] if item["session_id"] == session["session_id"]]
    messages.sort(key=lambda item: item["created_at"])
    last = messages[-1] if messages else None
    return {
        **session,
        "knowledge_base_name": kb["name"] if kb else None,
        "message_count": len(messages),
        "last_message_preview": (last.get("content", "")[:40] if last else ""),
    }


def find_session_for_user(data: dict[str, Any], user: dict[str, Any], session_id: str) -> dict[str, Any]:
    session = next((item for item in data["sessions"] if item["session_id"] == int(session_id) and item["status"] == 1), None)
    if not session:
        raise ApiError(404, "会话不存在", 3001)
    if session["user_id"] != user["user_id"] and user["role"] != "admin":
        raise ApiError(403, "无权访问该会话", 403)
    return session


def find_by_id(items: list[dict[str, Any]], key: str, item_id: int, message: str) -> dict[str, Any]:
    item = next((candidate for candidate in items if candidate[key] == item_id), None)
    if not item:
        raise ApiError(404, message, 1002)
    return item


def assert_admin(user: dict[str, Any]) -> None:
    if user["role"] != "admin":
        raise ApiError(403, "需要管理员权限", 403)


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in user.items()
        if key not in {"password", "password_hash", "login_failed_count", "locked_until"}
    }


def paginate(items: list[Any], query: dict[str, str]) -> dict[str, Any]:
    page = max(1, int(query.get("page", "1") or 1))
    page_size = min(100, max(1, int(query.get("page_size", "10") or 10)))
    start = (page - 1) * page_size
    return {"total": len(items), "page": page, "page_size": page_size, "items": items[start : start + page_size]}


def next_id(data: dict[str, Any], name: str) -> int:
    data["sequences"][name] = int(data["sequences"].get(name, 1)) + 1
    return data["sequences"][name] - 1


def add_audit_log(data: dict[str, Any], user: dict[str, Any], action: str, detail: dict[str, Any]) -> None:
    data["operation_logs"].append(
        {
            "log_id": next_id(data, "log_id"),
            "operator_id": user["user_id"],
            "action": action,
            "detail": detail,
            "created_at": now_iso(),
        }
    )


def split_text(text: str) -> list[str]:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return ["空文档占位片段。"]
    return [clean[index : index + 600] for index in range(0, len(clean), 500)]


def make_embedding(text: str) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [round(digest[index] / 255, 4) for index in range(8)]


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return f"$mock${hash_text(password)[:32]}"


def is_strong_password(password: str) -> bool:
    return len(password) >= 8 and bool(re.search(r"[A-Za-z]", password)) and bool(re.search(r"\d", password))


def get_bearer_token(value: str) -> str | None:
    match = re.match(r"^Bearer\s+(.+)$", value or "", re.IGNORECASE)
    return match.group(1) if match else None


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
