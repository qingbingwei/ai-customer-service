from __future__ import annotations

import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from urllib import request
from urllib.error import HTTPError

from src.server import create_app_server


ROOT_DIR = Path(__file__).resolve().parent.parent


class ApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="ai-customer-service-"))
        self.data_file = self.tmp_dir / "app-data.json"
        shutil.copyfile(ROOT_DIR / "data" / "app-data.json", self.data_file)
        self.server = create_app_server(
            host="127.0.0.1",
            port=0,
            data_file=self.data_file,
            public_dir=ROOT_DIR / "public",
            docs_dir=ROOT_DIR / "docs",
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        shutil.rmtree(self.tmp_dir)

    def api(self, path: str, method: str = "GET", payload: dict | None = None, headers: dict | None = None):
        body = None
        request_headers = dict(headers or {})
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            request_headers["content-type"] = "application/json"
        req = request.Request(f"{self.base_url}{path}", data=body, headers=request_headers, method=method)
        try:
            with request.urlopen(req, timeout=5) as response:
                content_type = response.headers.get("content-type", "")
                text = response.read().decode("utf-8")
                if "application/json" in content_type:
                    return response.status, json.loads(text), response.headers
                return response.status, text, response.headers
        except HTTPError as error:
            text = error.read().decode("utf-8")
            return error.code, json.loads(text), error.headers

    def test_health_check_returns_ok(self) -> None:
        status, payload, _headers = self.api("/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["status"], "ok")
        self.assertEqual(payload["data"]["service"], "ai-customer-service")

    def test_login_returns_mock_token_and_profile(self) -> None:
        status, payload, _headers = self.api(
            "/api/user/login",
            "POST",
            {"account": "zhangsan", "password": "Pass1234"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["token"], "mock-token-1-user")
        self.assertEqual(payload["data"]["user"]["username"], "zhangsan")

    def test_knowledge_base_list_requires_admin_role(self) -> None:
        status, payload, _headers = self.api("/api/knowledge/bases", headers={"x-user-id": "1"})
        self.assertEqual(status, 403)
        self.assertEqual(payload["code"], 403)

    def test_chat_message_returns_assistant_answer_with_sources(self) -> None:
        status, payload, _headers = self.api(
            "/api/chat/sessions/100/messages",
            "POST",
            {"content": "扫地机器人无法开机怎么办？"},
            {"x-user-id": "1"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["assistant_message"]["role"], "assistant")
        self.assertGreaterEqual(len(payload["data"]["assistant_message"]["sources"]), 1)

    def test_chat_message_can_stream_server_sent_events(self) -> None:
        status, text, headers = self.api(
            "/api/chat/sessions/100/messages?stream=1",
            "POST",
            {"content": "怎么申请发票？"},
            {"x-user-id": "1", "accept": "text/event-stream"},
        )
        self.assertEqual(status, 200)
        self.assertIn("text/event-stream", headers.get("content-type", ""))
        self.assertIn('"type": "token"', text)
        self.assertIn('"type": "done"', text)


if __name__ == "__main__":
    unittest.main()
