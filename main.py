"""
Monorepo entrypoint for Render when Root Directory is empty (repo root).

Preferred: set Render Root Directory to `boon_hua_backend` and use that folder's main.py.
This shim lets `uvicorn main:app` work from the repository root as a fallback.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_backend_main = Path(__file__).resolve().parent / "boon_hua_backend" / "main.py"
if not _backend_main.is_file():
    raise RuntimeError(f"Backend not found at {_backend_main}")

_spec = importlib.util.spec_from_file_location("boonhua_backend_main", _backend_main)
_module = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_module)

app = _module.app
