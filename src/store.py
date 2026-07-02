from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Callable


class JsonStore:
    def __init__(self, file_path: str | Path):
        self.file_path = Path(file_path)
        self._lock = threading.Lock()

    def read(self) -> dict[str, Any]:
        with self.file_path.open("r", encoding="utf-8") as file:
            return json.load(file)

    def update(self, mutator: Callable[[dict[str, Any]], Any]) -> Any:
        with self._lock:
            data = self.read()
            result = mutator(data)
            self.file_path.parent.mkdir(parents=True, exist_ok=True)
            with self.file_path.open("w", encoding="utf-8") as file:
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.write("\n")
            return result
