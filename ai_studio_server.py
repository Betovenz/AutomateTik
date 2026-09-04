"""Lifecycle manager for the vendored AutoGT-powered AI Studio server."""

from __future__ import annotations

import atexit
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
AI_STUDIO_DIR = RESOURCE_DIR / "ai_studio"
AI_STUDIO_PORT = int(os.environ.get("AUTOTIK_AI_STUDIO_PORT", "18787"))
AI_STUDIO_URL = f"http://127.0.0.1:{AI_STUDIO_PORT}"

_lock = threading.RLock()
_process: subprocess.Popen | None = None
_log_handle = None


def _node_executable() -> str | None:
    configured = os.environ.get("AUTOTIK_NODE_PATH", "").strip()
    candidates = [
        configured,
        # Portable build ships its own node.exe next to the bundled resources, so
        # the target machine does not need Node installed. Checked before PATH so
        # the build always runs the runtime it was tested against.
        str(RESOURCE_DIR / "runtime" / "node.exe"),
        str(Path(sys.executable).resolve().parent / "runtime" / "node.exe"),
        shutil.which("node.exe") or shutil.which("node") or "",
        str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "nodejs" / "node.exe"),
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs" / "node.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    return None


def _port_open(timeout: float = 0.35) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", AI_STUDIO_PORT), timeout=timeout):
            return True
    except OSError:
        return False


def _server_ready(timeout: float = 0.8) -> bool:
    try:
        with urllib.request.urlopen(f"{AI_STUDIO_URL}/api/extension-status", timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
            return response.status == 200 and isinstance(payload, dict) and "connected" in payload
    except (OSError, ValueError, urllib.error.URLError):
        return False


def ensure_ai_studio_server_started() -> int | None:
    global _process, _log_handle
    with _lock:
        if _server_ready():
            return AI_STUDIO_PORT
        if _port_open():
            raise RuntimeError(
                f"AI Studio port {AI_STUDIO_PORT} is already used by another program. "
                "Close that program and restart Automate Tik."
            )
        if _process and _process.poll() is None:
            return AI_STUDIO_PORT
        server_script = AI_STUDIO_DIR / "server.js"
        if not server_script.is_file():
            raise RuntimeError(f"AI Studio server is missing: {server_script}")
        node = _node_executable()
        if not node:
            raise RuntimeError("Node.js was not found. Install Node.js or set AUTOTIK_NODE_PATH.")

        runtime_dir = AI_STUDIO_DIR / "runtime"
        runtime_dir.mkdir(parents=True, exist_ok=True)
        log_path = runtime_dir / "ai-studio-server.log"
        _log_handle = log_path.open("a", encoding="utf-8")
        env = os.environ.copy()
        env["PORT"] = str(AI_STUDIO_PORT)
        # Where library_source.json lives (next to the exe when frozen). The node
        # server reads it to learn the Video Library folder that finished clips
        # get copied into, named after their product.
        env["AUTOGT_APP_DIR"] = str(
            Path(sys.executable).resolve().parent
            if getattr(sys, "frozen", False)
            else Path(__file__).resolve().parent
        )
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        _process = subprocess.Popen(
            [node, str(server_script)],
            cwd=str(AI_STUDIO_DIR),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=_log_handle,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
        )

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if _process and _process.poll() is not None:
            break
        if _server_ready():
            return AI_STUDIO_PORT
        time.sleep(0.2)
    stop_ai_studio_server()
    raise RuntimeError(f"AI Studio server did not start. Check {AI_STUDIO_DIR / 'runtime' / 'ai-studio-server.log'}")


def stop_ai_studio_server() -> None:
    global _process, _log_handle
    with _lock:
        process = _process
        _process = None
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        if _log_handle:
            try:
                _log_handle.close()
            except OSError:
                pass
            _log_handle = None


atexit.register(stop_ai_studio_server)
