from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("PORT", "3000"))
PUBLIC_DIR = Path(os.environ.get("PUBLIC_DIR", ROOT_DIR / "public"))
DOCS_DIR = Path(os.environ.get("DOCS_DIR", ROOT_DIR / "docs"))
DATA_FILE = Path(os.environ.get("DATA_FILE", ROOT_DIR / "data" / "app-data.json"))
DEFAULT_USER_ID = int(os.environ.get("DEFAULT_USER_ID", "1"))
