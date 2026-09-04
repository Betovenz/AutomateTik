"""AI Studio backend — adapted for the AutoTik app.

Runs as a small second HTTP+WebSocket server alongside the main TikTok
Manager Pro server (server.py). It serves the ported webui from
ui/gtpro/, speaks the same ws/ui + ws/extension protocol as the original
AutoTik Chrome extension (gtpro_extension/), and relays generate/publish
jobs to that extension so it can drive Grok, Google Flow (labs.google) and
the real TikTok Studio in the user's own logged-in Chrome.

Ported from Aotutik/launcher_server.py. Differences from the source:
- Every job source (grok / google_labs / tiktok) is relayed to the
  extension via ext.command{action:"generate"} — the original's
  server-side Google Flow REST engine (run_google_flow_job) depended on
  an external reference module that isn't part of this build, so Flow
  generation goes through the extension's DOM-automation path instead
  (content/google-labs.js), same as every other source.
- settings/keys are persisted across restarts via server.get_setting /
  server.set_setting (one JSON blob under the "gtpro_settings" key in
  the existing app_settings table) instead of living purely in memory.
- uploads go to gtpro_uploads/ instead of uploads/ (kept separate from
  the ADB-posting flow's own uploads/ directory).
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import socket
import struct
import sys
import threading
import time
import uuid
import webbrowser
from datetime import datetime, timezone, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
RESOURCE_DIR = Path(__file__).resolve().parent
BASE_DIR = APP_DIR
WEBUI_DIR = RESOURCE_DIR / "ui" / "gtpro"
UPLOAD_DIR = BASE_DIR / "gtpro_uploads"
APP_ID = "automate-tik-ai-studio"
DEFAULT_PORT = 18800
PORT_SCAN_SPAN = 10
VERSION = "gtpro-embedded-1.0"
SETTINGS_KEY = "gtpro_settings"

mimetypes.add_type("image/webp", ".webp")

REALISTIC_VIDEO_FIXED_STYLE = (
    "Camera style: realistic cinematic product advertisement, soft lighting, "
    "shallow depth of field, natural movement, stable commercial framing."
)
VIDEO_NEGATIVE_PROMPT = (
    "low quality, blurry, extra fingers, distorted body, duplicate person, "
    "watermark, logo glitch, subtitles, text error, shaky camera, overexposed, "
    "cartoon, anime, CGI, noisy image"
)
COMPLIANCE_RULES = """[Compliance] STRICTLY FORBIDDEN WORDS. Do NOT use these terms or similar meanings in Thai:
- No absolute or exaggerated claims: ที่สุด, อันดับ1, ดีที่สุด, หนึ่งเดียว, เจ้าแรก, การันตี, รับประกัน, เห็นผล100%, เห็นผลทันที
- No medical/treatment claims: หายขาด, รักษา, บำบัด, ป้องกัน, ยา
- No whitening/slimming claims: ขาว, ขาวไว, ผอม, ลดน้ำหนัก, ลดความอ้วน, สลายไขมัน
- No finance traps: รวย, รวยเร็ว, ปลดหนี้, ลงทุน, ผลตอบแทนสูง
- Keep claims soft, observational, and product-safe."""
VIDEO_DIALOGUES = [
    "ตัวนี้ใช้แล้วรู้สึกว่าสะดวกขึ้นในชีวิตประจำวัน",
    "ตอนแรกไม่ได้คาดหวังมาก แต่ดีเทลของสินค้าทำออกมาใช้ง่าย",
    "ถ้ากำลังหาอะไรที่ช่วยให้การใช้งานง่ายขึ้น ลองดูตัวนี้ได้",
    "ชอบที่หยิบใช้ได้จริง และภาพรวมดูคุ้มกับการใช้งาน",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def future_iso(days: int = 3650) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def pick_stable(items: list[str], seed: str) -> str:
    if not items:
        return ""
    digest = hashlib.sha1(seed.encode("utf-8", "ignore")).digest()
    return items[digest[0] % len(items)]


def first_text(*values: object) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def is_blank_prompt(value: object) -> bool:
    text = str(value or "").strip()
    return not text or text.lower() in {"text", "prompt", "-", "none", "null"}


def product_name_from_job(data: dict) -> str:
    options = data.get("options") or {}
    target = data.get("target") or {}
    return first_text(
        options.get("productTitle"),
        options.get("productName"),
        target.get("title"),
        target.get("name"),
        target.get("productTitle"),
        target.get("product_name"),
        data.get("productTitle"),
        data.get("productName"),
        target.get("product_id"),
        "สินค้า",
    )


def build_local_image_prompt(product_name: str, options: dict) -> str:
    style = first_text(options.get("TypeVideo"), options.get("style"), "realistic Thai UGC product photo")
    feeling = first_text(options.get("feeling"), options.get("tone"), "natural, friendly, trustworthy")
    return f"""Product name: {product_name}
Create a realistic vertical 9:16 Thai UGC product image for social commerce.
Style: {style}
Feeling: {feeling}

Visual direction:
- Show the product clearly as the hero object.
- Natural Thai lifestyle setting, clean background, soft commercial lighting.
- Realistic skin texture and real-life camera perspective if a person is shown.
- Product packaging, shape, color, and key visible details must remain consistent.
- No added text, no fake labels, no watermark, no UI overlay.

Negative Prompt:
{VIDEO_NEGATIVE_PROMPT}

{COMPLIANCE_RULES}"""


def build_local_video_prompt(product_name: str, options: dict, mode: str) -> str:
    duration = "6 seconds" if "6" in str(options.get("queueMode") or mode) else "10 seconds"
    feeling = first_text(options.get("feeling"), "relaxed")
    voice = first_text(options.get("feelingVoice"), options.get("voice"), "polite Thai female voice")
    dialogue = pick_stable(VIDEO_DIALOGUES, product_name + mode + json.dumps(options, ensure_ascii=False, sort_keys=True))
    return f"""{REALISTIC_VIDEO_FIXED_STYLE}

Scene = Hook to Product Usage
Duration: {duration}
Product name: {product_name}
Video Feeling: {feeling}
Voice Feeling: {voice}

Goal:
Create a realistic TikTok-style product showcase video. Start with a simple hook, show the product in use, then close with a soft invitation to check the product.

Camera:
- Vertical 9:16 framing.
- Natural handheld movement, stable and commercial.
- Close-up product focus, then usage focus, then product hero shot.

Dialogue rules:
- Thai speech only.
- Keep dialogue short, natural, and compliant.
- Do not mention exaggerated, medical, whitening, slimming, or guaranteed-result claims.

Dialogue:
"{dialogue}"

IMPORTANT: No text on picture except the original text on the product.

Negative Prompt:
{VIDEO_NEGATIVE_PROMPT}

{COMPLIANCE_RULES}

Audio: clear Thai voice only, no background music.
"audio_mode": "speech_only"
"audio_negative_prompt": "English, foreign language, music, background music, instrumental, ambient noise, sound effects, melody, wrong gender voice, male voice when female selected, female voice when male selected" """


def apply_local_prompt_fallback(data: dict) -> tuple[dict, bool]:
    data = dict(data or {})
    options = dict(data.get("options") or {})
    product_name = product_name_from_job(data)
    applied = False

    if is_blank_prompt(data.get("prompt")):
        data["prompt"] = build_local_image_prompt(product_name, options)
        applied = True

    if is_blank_prompt(options.get("promptVideo")):
        options["promptVideo"] = build_local_video_prompt(product_name, options, str(data.get("mode") or ""))
        applied = True

    if applied:
        options["localPromptFallback"] = True
        options["localPromptSource"] = "AutonimationGT-style template"
        data["options"] = options
    return data, applied


def _load_persisted_settings() -> dict:
    try:
        import server as _server
        raw = _server.get_setting(SETTINGS_KEY, "")
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    return {}


def _save_persisted_settings(payload: dict) -> None:
    try:
        import server as _server
        _server.set_setting(SETTINGS_KEY, json.dumps(payload, ensure_ascii=False))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Chrome profile discovery + launch.
#
# The UI's "เชื่อมต่อ Extension" button cannot push a socket into Chrome: this app is the
# WebSocket SERVER and the extension's service worker dials IN. So "connect" means OPEN the
# exact Chrome profile that has the extension loaded and let its worker reconnect. That is
# what ui/gtpro/app.js expects /api/connect-extension to do, and /api/open-chrome exists so
# pages that must land in Chrome specifically (extension install pages do not work in
# Edge/Firefox) actually do. Both were hardcoded stubs that reported success without
# launching anything, so the button spun for ~35s and then timed out every time.
#
# Mirrors ai_studio/server.js's findChromeExecutable/discoverChromeProfiles, which already
# implements this for the other server in this app.

CHROME_EXTENSION_NAMES = ("AutoGT Pro Extension", "AutoGT Pro TikTok Extension")
# An unpacked extension records the folder it was loaded from. Matching that too means the
# profile is still recognised if the manifest's display name is ever changed.
CHROME_EXTENSION_DIR_NAMES = ("ai_studio_extension", "ai_studio_extension_main")


def _extension_entry_matches(entry):
    name = str((entry.get("manifest") or {}).get("name") or "")
    if any(known in name for known in CHROME_EXTENSION_NAMES):
        return True
    load_path = str(entry.get("path") or "").replace("\\", "/").lower()
    return any(("/" + folder.lower()) in load_path or load_path.endswith(folder.lower())
               for folder in CHROME_EXTENSION_DIR_NAMES)


def find_chrome_executable():
    local = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("PROGRAMFILES", r"C:\Program Files")
    program_files_x86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
    candidates = [
        os.environ.get("CHROME_PATH", ""),
        os.path.join(program_files, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(program_files_x86, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(local, "Google", "Chrome", "Application", "chrome.exe") if local else "",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return shutil.which("chrome") or shutil.which("chrome.exe")


def chrome_user_data_dirs():
    local = os.environ.get("LOCALAPPDATA", "")
    if not local:
        return []
    roots = [
        Path(local) / "Google" / "Chrome" / "User Data",
        Path(local) / "Google" / "Chrome Beta" / "User Data",
        Path(local) / "Chromium" / "User Data",
    ]
    return [root for root in roots if root.is_dir()]


def _profile_has_extension(profile_dir):
    # Checks the on-disk Extensions/<id>/<version>/manifest.json first: an unpacked
    # extension is listed in Preferences even after its folder is gone, so the manifest is
    # what proves it is really loadable. Preferences is still consulted afterwards because
    # unpacked extensions usually live outside the profile directory.
    extensions_root = profile_dir / "Extensions"
    if extensions_root.is_dir():
        try:
            ext_dirs = list(extensions_root.iterdir())
        except OSError:
            ext_dirs = []
        for ext_dir in ext_dirs:
            if not ext_dir.is_dir():
                continue
            try:
                version_dirs = list(ext_dir.iterdir())
            except OSError:
                continue
            for version_dir in version_dirs:
                manifest = version_dir / "manifest.json"
                if not manifest.is_file():
                    continue
                try:
                    name = json.loads(manifest.read_text(encoding="utf-8", errors="replace")).get("name", "")
                except (OSError, ValueError):
                    continue
                if any(known in str(name) for known in CHROME_EXTENSION_NAMES):
                    return True
    for prefs_name in ("Preferences", "Secure Preferences"):
        prefs = profile_dir / prefs_name
        if not prefs.is_file():
            continue
        try:
            settings = json.loads(prefs.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        installed = (settings.get("extensions") or {}).get("settings") or {}
        for entry in installed.values():
            if isinstance(entry, dict) and _extension_entry_matches(entry):
                return True
    return False


def discover_chrome_profile_with_extension():
    # Returns (user_data_dir, profile_directory) for the profile holding our extension.
    for user_data_dir in chrome_user_data_dirs():
        try:
            entries = sorted(user_data_dir.iterdir())
        except OSError:
            continue
        for entry in entries:
            if not entry.is_dir():
                continue
            if entry.name != "Default" and not entry.name.startswith("Profile "):
                continue
            if _profile_has_extension(entry):
                return user_data_dir, entry.name
    return None, None


def launch_chrome(profile_directory=None, url=None):
    chrome = find_chrome_executable()
    if not chrome:
        raise FileNotFoundError("chrome_not_found")
    args = [chrome]
    if profile_directory:
        # Always pin the profile. A profile-less launch shows Chrome's "Who's using Chrome?"
        # picker, which lands on a different (cold) profile without our extension.
        args.append("--profile-directory=" + profile_directory)
    if url:
        args.append(url)
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    subprocess.Popen(args, close_fds=True, creationflags=creationflags)


class AppState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.ui_clients: set["WsClient"] = set()
        self.ext_clients: set["WsClient"] = set()
        self.jobs: list[dict] = []
        self.logs: list[dict] = []
        self.settings = {
            "defaultTier": "ultra",
            "downloadDir": str(BASE_DIR / "gtpro_downloads"),
            "downloadDirEffective": str(BASE_DIR / "gtpro_downloads"),
            "systemPrompts": {},
            "tiktokSettings": {
                "enabled": True,
                "showcaseEnabled": True,
                "cartEnabled": True,
                "hashtagsEnabled": True,
                "captionEnabled": True,
            },
            "rowDelayMin": 0,
            "rowDelayMax": 0,
        }
        self.keys = {
            "openai": "local-configured",
            "openrouter": "",
            "kie": "local-configured",
            "configured": {"openai": True, "openrouter": False, "kie": True},
        }
        persisted = _load_persisted_settings()
        if isinstance(persisted.get("settings"), dict):
            self.settings.update(persisted["settings"])
        if isinstance(persisted.get("keys"), dict):
            self.keys.update(persisted["keys"])
        self.accounts = [
            self.account("google_labs", "Local Google Flow", "ULTRA", 5000),
            self.account("grok", "Local SuperGrok", "SUPERGROK", 0),
            self.account("tiktok", "Local TikTok", "", 0),
        ]
        self.products = []
        self.running_modes: list[str] = []
        self.pending_tiktok_pulls: dict[str, float] = {}
        self.pending_tiktok_link_imports: dict[str, float] = {}
        self.pending_ext_requests: dict[str, dict] = {}
        self.browser_captures: dict[str, dict] = {}
        self.shopee_affiliate_captures: list[dict] = []

    def persist_settings(self) -> None:
        with self.lock:
            payload = {"settings": dict(self.settings), "keys": dict(self.keys)}
        _save_persisted_settings(payload)

    @staticmethod
    def account(provider: str, email: str, plan: str, credit: int) -> dict:
        return {
            "id": f"local-{provider}",
            "provider": provider,
            "email": email,
            "enabled": True,
            "imageEnabled": True,
            "videoEnabled": True,
            "hasCookie": True,
            "status": "active",
            "tier": "ultra",
            "plan": plan,
            "credit": credit,
            "proxy": "",
            "cookieExp": future_iso(),
            "tokenExp": future_iso(),
            "tokenCheckedAt": now_iso(),
        }

    def public_state(self) -> dict:
        with self.lock:
            return {
                "auth": {
                    "authenticated": True,
                    "email": "local@no-login",
                    "name": "Local User",
                    "role": "local",
                    "accountStatus": "active",
                    "subscriptionActive": True,
                    "subscriptionEnd": future_iso(),
                    "unlocked": True,
                },
                "extensionConnected": bool(self.ext_clients),
                "queueRunning": bool(self.running_modes),
                "runningModes": list(self.running_modes),
                "jobs": list(self.jobs),
                "accounts": list(self.accounts),
                "settings": dict(self.settings),
                "keys": dict(self.keys),
                "update": {"available": False, "current": VERSION, "latest": VERSION, "notes": ""},
                "version": VERSION,
            }

    def add_log(self, message: str, level: str = "info") -> None:
        entry = {"type": "log", "data": {"message": message, "level": level, "replay": False}}
        with self.lock:
            self.logs.append(entry)
            self.logs = self.logs[-500:]
        self.broadcast(entry)
        threading.Thread(target=self._mirror_log_to_main_db, args=(message, level), daemon=True).start()

    @staticmethod
    def _mirror_log_to_main_db(message: str, level: str) -> None:
        try:
            import server as _server
            mapped_level = {"warn": "warning"}.get(level, level)
            if mapped_level not in {"info", "success", "warning", "error"}:
                mapped_level = "info"
            _server.add_log(f"[AI Studio] {message}", level=mapped_level)
        except Exception:
            pass

    def broadcast_state(self) -> None:
        self.broadcast({"type": "ui.state", "data": self.public_state()})

    def broadcast(self, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        dead: list[WsClient] = []
        with self.lock:
            clients = list(self.ui_clients)
        for client in clients:
            try:
                client.send_text_bytes(data)
            except OSError:
                dead.append(client)
        if dead:
            with self.lock:
                for client in dead:
                    self.ui_clients.discard(client)

    def send_extension_command(self, job_id: str, action: str, data: dict | None = None) -> bool:
        payload = {
            "v": 1,
            "type": "ext.command",
            "jobId": job_id,
            "data": {"action": action, **(data or {})},
        }
        sent = False
        dead: list[WsClient] = []
        with self.lock:
            clients = list(self.ext_clients)
        for client in clients:
            try:
                client.send_text(payload)
                sent = True
            except OSError:
                dead.append(client)
        if dead:
            with self.lock:
                for client in dead:
                    self.ext_clients.discard(client)
        return sent

    def extension_request(self, action: str, data: dict | None = None, timeout: float = 60.0) -> dict:
        request_id = f"req-{uuid.uuid4().hex}"
        event = threading.Event()
        with self.lock:
            self.pending_ext_requests[request_id] = {"event": event, "data": None}
        if not self.send_extension_command(request_id, action, data):
            with self.lock:
                self.pending_ext_requests.pop(request_id, None)
            raise RuntimeError("Extension is not connected to AI Studio.")
        if not event.wait(timeout):
            with self.lock:
                self.pending_ext_requests.pop(request_id, None)
            raise TimeoutError(f"Extension action timed out: {action}")
        with self.lock:
            payload = (self.pending_ext_requests.pop(request_id, None) or {}).get("data") or {}
        if payload.get("ok") is False:
            raise RuntimeError(str(payload.get("error") or f"Extension action failed: {action}"))
        return payload

    def handle_ui(self, msg: dict) -> None:
        msg_type = msg.get("type", "")
        data = msg.get("data") or {}
        if msg_type == "ui.hello":
            return
        if msg_type == "job.submit":
            data, used_local_prompt = apply_local_prompt_fallback(data)
            with self.lock:
                logs = ["Queued."]
                if used_local_prompt:
                    logs.append("Local prompt fallback applied. No OpenAI/OpenRouter key required.")
                job = {
                    "id": str(uuid.uuid4()),
                    "createdAt": now_iso(),
                    "updatedAt": now_iso(),
                    "status": "queued",
                    "source": data.get("source", "local"),
                    "mode": data.get("mode", ""),
                    "media_type": data.get("media_type", "video"),
                    "prompt": data.get("prompt", ""),
                    "promptVideo": (data.get("options") or {}).get("promptVideo", ""),
                    "publish_mode": data.get("publish_mode", "generate_only"),
                    "target": data.get("target") or {},
                    "options": data.get("options") or {},
                    "direction": data.get("direction") or {},
                    "logs": logs,
                    "result": None,
                    "error": "",
                }
                self.jobs.insert(0, job)
            if used_local_prompt:
                self.add_log("Generated prompt locally from product data. OpenAI/OpenRouter key was not required.", "info")
            self.add_log("Queued job.", "info")
            self.broadcast_state()
            return
        if msg_type == "queue.run":
            mode = data.get("mode") or ""
            threading.Thread(target=self.run_queue, args=(mode,), daemon=True).start()
            return
        if msg_type == "job.retry":
            mode = data.get("mode") or ""
            ids = set(str(x) for x in (data.get("ids") or []))
            with self.lock:
                for job in self.jobs:
                    if job.get("status") != "failed":
                        continue
                    if ids and str(job.get("id")) not in ids:
                        continue
                    if mode and job.get("mode") != mode:
                        continue
                    job["status"] = "queued"
                    job["error"] = ""
                    job["stage"] = "queued"
                    job["progress"] = 0
                    job["logs"] = list(job.get("logs") or []) + ["Retry queued."]
                    job["updatedAt"] = now_iso()
            self.broadcast_state()
            threading.Thread(target=self.run_queue, args=(mode,), daemon=True).start()
            return
        if msg_type == "job.setDirection":
            ids = set(str(x) for x in (data.get("ids") or []))
            key = str(data.get("key") or "").strip()
            value = data.get("value") or ""
            if ids and key:
                with self.lock:
                    for job in self.jobs:
                        if str(job.get("id")) in ids and job.get("status") == "queued":
                            direction = dict(job.get("direction") or {})
                            if value:
                                direction[key] = value
                            else:
                                direction.pop(key, None)
                            job["direction"] = direction
                            job["updatedAt"] = now_iso()
                self.broadcast_state()
            return
        if msg_type == "queue.stop":
            with self.lock:
                self.running_modes.clear()
            self.add_log("Queue stopped.", "warn")
            self.broadcast_state()
            return
        if msg_type in {"jobs.clear", "tiktok.clearProducts"}:
            with self.lock:
                if msg_type == "jobs.clear":
                    ids = set(data.get("ids") or [])
                    if ids:
                        self.jobs = [j for j in self.jobs if j.get("id") not in ids]
                    else:
                        mode = data.get("mode")
                        self.jobs = [j for j in self.jobs if mode and j.get("mode") != mode]
                else:
                    self.products = []
            self.broadcast_state()
            return
        if msg_type == "settings.update":
            with self.lock:
                self.settings.update(data)
                if "downloadDir" in data:
                    self.settings["downloadDirEffective"] = data.get("downloadDir") or str(BASE_DIR / "gtpro_downloads")
            self.persist_settings()
            self.add_log("Settings saved.", "info")
            self.broadcast_state()
            return
        if msg_type == "auth.keys.save":
            with self.lock:
                for key in ("openai", "openrouter", "kie"):
                    if key in data:
                        val = data[key]
                        if key in {"openai", "openrouter"} and not val:
                            self.keys["configured"][key] = key == "openai"
                            self.keys[key] = "local-prompt-fallback" if key == "openai" else ""
                        else:
                            self.keys["configured"][key] = bool(val)
                            self.keys[key] = "local-configured" if val else ""
            self.persist_settings()
            self.add_log("API key state saved. Empty AI keys use local prompt fallback.", "info")
            self.broadcast_state()
            return
        if msg_type == "auth.keys.validate":
            self.add_log("AI Studio accepted the API key format.", "info")
            return
        if msg_type in {"account.browser", "account.refresh", "account.refreshAll", "account.toggle", "account.proxy", "account.rename"}:
            self.add_log(f"{msg_type} handled locally.", "info")
            self.broadcast_state()
            return
        if msg_type == "tiktok.pull":
            job_id = f"pull-{uuid.uuid4().hex}"
            with self.lock:
                self.pending_tiktok_pulls[job_id] = time.time()
            if self.send_extension_command(job_id, "pullProducts"):
                self.add_log("กำลังสั่ง Extension ดึงสินค้า TikTok Showcase จริง...", "info")
            else:
                with self.lock:
                    self.pending_tiktok_pulls.pop(job_id, None)
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {
                        "ok": False,
                        "connected": False,
                        "error": "Extension ยังไม่เชื่อมต่อกับ AI Studio",
                        "products": [],
                    },
                })
                self.add_log("ดึงสินค้าไม่ได้: extension ยังไม่เชื่อมต่อ", "error")
            return
        if msg_type == "tiktok.links.import":
            urls = [str(url).strip() for url in (data.get("urls") or []) if str(url).strip()]
            if not urls:
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {"ok": False, "error": "กรุณาใส่ลิงก์สินค้าอย่างน้อย 1 ลิงก์", "products": []},
                })
                return
            job_id = f"links-{uuid.uuid4().hex}"
            with self.lock:
                self.pending_tiktok_link_imports[job_id] = time.time()
            if self.send_extension_command(job_id, "checkProductLinks", {"urls": urls}):
                self.add_log(f"กำลังตรวจสอบลิงก์สินค้า TikTok {len(urls)} ลิงก์...", "info")
            else:
                with self.lock:
                    self.pending_tiktok_link_imports.pop(job_id, None)
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {
                        "ok": False,
                        "connected": False,
                        "error": "Extension ยังไม่เชื่อมต่อ กรุณาเปิด Extension และล็อกอิน TikTok Shop",
                        "products": [],
                    },
                })
                self.add_log("นำเข้าสินค้าจากลิงก์ไม่ได้: extension ยังไม่เชื่อมต่อ", "error")
            return
        self.add_log(f"AI Studio received {msg_type}.", "warn")

    def handle_extension(self, msg: dict) -> None:
        msg_type = msg.get("type", "")
        job_id = msg.get("jobId")
        data = msg.get("data") or {}
        if job_id:
            with self.lock:
                pending = self.pending_ext_requests.get(job_id)
            if pending is not None:
                if msg_type == "ext.result":
                    pending["data"] = data
                    pending["event"].set()
                    return
                if msg_type == "ext.error":
                    pending["data"] = {"ok": False, "error": data.get("message") or "Extension error"}
                    pending["event"].set()
                    return
        if msg_type == "ext.hello":
            self.add_log("Extension connected.", "info")
            self.broadcast_state()
            return
        if msg_type == "ext.status":
            message = data.get("message") or data.get("stage") or "Extension status"
            if job_id:
                with self.lock:
                    job = next((j for j in self.jobs if j.get("id") == job_id), None)
                    if job:
                        job["stage"] = data.get("stage") or job.get("stage") or ""
                        if data.get("progress") is not None:
                            job["progress"] = data.get("progress")
                        job["logs"] = list(job.get("logs") or []) + [str(message)]
                        job["updatedAt"] = now_iso()
                self.broadcast_state()
            self.add_log(str(message), "info")
            return
        if msg_type == "ext.error":
            self.add_log(str(data.get("message") or "Extension error"), "error")
            if job_id:
                self.finish_generate_job(job_id, {"ok": False, "error": data.get("message") or "Extension error"})
            if job_id in self.pending_tiktok_pulls:
                with self.lock:
                    self.pending_tiktok_pulls.pop(job_id, None)
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {
                        "ok": False,
                        "connected": True,
                        "error": str(data.get("message") or "Extension error"),
                        "products": [],
                    },
                })
            if job_id in self.pending_tiktok_link_imports:
                with self.lock:
                    self.pending_tiktok_link_imports.pop(job_id, None)
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {
                        "ok": False,
                        "connected": True,
                        "error": str(data.get("message") or "Extension error"),
                        "products": [],
                    },
                })
            return
        if msg_type == "ext.result" and data.get("action") == "pullProducts":
            with self.lock:
                pending = self.pending_tiktok_pulls.pop(job_id, None)
            if pending is None:
                return
            if data.get("ok"):
                products = data.get("products") or []
                with self.lock:
                    self.products = products
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {
                        "connected": True,
                        "ok": True,
                        "accountId": "local-tiktok",
                        "accountEmail": "Local TikTok",
                        "syncTargets": ["flow", "supergrok"],
                        **data,
                    },
                })
                self.add_log(f"ดึงสินค้า TikTok สำเร็จ: {len(products)} รายการ", "info")
            else:
                err = data.get("error") or "TikTok pull failed"
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {"connected": True, "ok": False, "error": err, "products": []},
                })
                self.add_log(f"ดึงสินค้า TikTok ไม่สำเร็จ: {err}", "error")
            return
        if msg_type == "ext.result" and data.get("action") == "checkProductLinks":
            with self.lock:
                pending = self.pending_tiktok_link_imports.pop(job_id, None)
            if pending is None:
                return
            if data.get("ok"):
                products = data.get("products") or []
                with self.lock:
                    self.products = products
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {"connected": True, "ok": True, **data},
                })
                self.add_log(f"นำเข้าสินค้าจากลิงก์สำเร็จ: {len(products)} รายการ", "info")
            else:
                err = data.get("error") or "ตรวจสอบลิงก์สินค้า TikTok ไม่สำเร็จ"
                self.broadcast({
                    "type": "tiktok.products",
                    "data": {"connected": True, "ok": False, "error": err, "products": []},
                })
                self.add_log(f"นำเข้าสินค้าจากลิงก์ไม่สำเร็จ: {err}", "error")
            return
        if msg_type == "ext.result" and data.get("action") == "generate":
            self.finish_generate_job(job_id, data)
            return
        if msg_type == "ext.result":
            self.add_log(f"Extension result: {data.get('action') or 'unknown'}", "info")

    def run_queue(self, mode: str) -> None:
        with self.lock:
            if mode and mode not in self.running_modes:
                self.running_modes.append(mode)
            targets = [j for j in self.jobs if j.get("status") == "queued" and (not mode or j.get("mode") == mode)]
            for job in targets:
                job["status"] = "generating"
                job["startedAt"] = now_iso()
                job["stage"] = "queued"
                job["progress"] = 0.05
                job["logs"] = list(job.get("logs") or []) + ["Run started."]
                job["updatedAt"] = now_iso()
        self.broadcast_state()
        if not targets:
            with self.lock:
                if mode in self.running_modes:
                    self.running_modes.remove(mode)
            self.broadcast_state()
            return
        for job in targets:
            source = job.get("source") or "google_labs"
            payload = {
                "source": source,
                "mode": job.get("mode") or "",
                "prompt": job.get("promptVideo") or job.get("prompt") or "",
                "mediaType": job.get("media_type") or job.get("mediaType") or "video",
                "count": 1,
                "options": job.get("options") or {},
            }
            if not self.send_extension_command(job["id"], "generate", payload):
                self.finish_generate_job(job["id"], {
                    "ok": False,
                    "error": "Extension is not connected. Load gtpro_extension/ unpacked in Chrome and open the target site once.",
                })
                continue
            self.add_log(f"ส่งงานไป Extension แล้ว: {job.get('mode') or job.get('source')}", "info")

    def finish_generate_job(self, job_id: str | None, data: dict) -> None:
        if not job_id:
            return
        with self.lock:
            job = next((j for j in self.jobs if j.get("id") == job_id), None)
            if not job:
                return
            logs = list(job.get("logs") or [])
            if data.get("ok"):
                media_url = data.get("mediaUrl") or data.get("url") or data.get("imageUrl")
                media_type = data.get("mediaType") or job.get("media_type") or "video"
                job["status"] = "done"
                job["mediaUrl"] = media_url
                job["mediaType"] = media_type
                job["mediaId"] = data.get("mediaId") or data.get("media_id") or job.get("mediaId")
                job["workflowId"] = data.get("workflowId") or data.get("workflow_id") or job.get("workflowId")
                job["sceneId"] = data.get("sceneId") or data.get("scene_id") or job.get("sceneId")
                if "canExtend" in data:
                    job["canExtend"] = bool(data.get("canExtend"))
                else:
                    job["canExtend"] = bool(
                        str(media_type).lower() == "video"
                        and job.get("mediaId")
                        and job.get("workflowId")
                    )
                if data.get("clips"):
                    job["clips"] = data.get("clips")
                if data.get("clipCount"):
                    job["clipCount"] = data.get("clipCount")
                job["result"] = data
                job["progress"] = 1
                job["stage"] = "done"
                job["completedAt"] = now_iso()
                logs.append("Generation complete.")
                level = "info"
                message = "สร้างเสร็จแล้วจาก Extension"
            else:
                err = str(data.get("error") or data.get("message") or "Generation failed")
                job["status"] = "failed"
                job["error"] = err
                job["result"] = data
                job["stage"] = "failed"
                logs.append(err)
                level = "error"
                message = f"สร้างไม่สำเร็จ: {err}"
            job["logs"] = logs
            job["updatedAt"] = now_iso()
            active_modes = {j.get("mode") for j in self.jobs if j.get("status") in {"queued", "generating", "publishing"}}
            self.running_modes = [m for m in self.running_modes if m in active_modes]
        self.add_log(message, level)
        self.broadcast_state()


STATE = AppState()


class WsClient:
    def __init__(self, handler: BaseHTTPRequestHandler, kind: str) -> None:
        self.handler = handler
        self.kind = kind
        self.wfile = handler.wfile
        self.lock = threading.Lock()

    def send_text(self, obj: dict) -> None:
        self.send_text_bytes(json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def send_text_bytes(self, payload: bytes) -> None:
        with self.lock:
            header = bytearray([0x81])
            n = len(payload)
            if n < 126:
                header.append(n)
            elif n < 65536:
                header.append(126)
                header.extend(struct.pack("!H", n))
            else:
                header.append(127)
                header.extend(struct.pack("!Q", n))
            self.wfile.write(header + payload)
            self.wfile.flush()

    def read_frame(self) -> str | None:
        rfile = self.handler.rfile
        head = rfile.read(2)
        if len(head) < 2:
            return None
        b1, b2 = head
        opcode = b1 & 0x0F
        masked = bool(b2 & 0x80)
        length = b2 & 0x7F
        if length == 126:
            length = struct.unpack("!H", rfile.read(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", rfile.read(8))[0]
        mask = rfile.read(4) if masked else b""
        payload = rfile.read(length) if length else b""
        if masked:
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(length))
        if opcode == 8:
            return None
        if opcode == 9:
            self.send_pong(payload)
            return ""
        if opcode != 1:
            return ""
        return payload.decode("utf-8", "replace")

    def send_pong(self, payload: bytes) -> None:
        with self.lock:
            self.wfile.write(bytes([0x8A, len(payload)]) + payload)
            self.wfile.flush()


class Handler(BaseHTTPRequestHandler):
    server_version = "AiStudioGtPro/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print("[gtpro %s] %s" % (self.log_date_time_string(), fmt % args))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/ws/ui":
            self.handle_ws("ui")
            return
        if parsed.path == "/ws/extension":
            self.handle_ws("extension")
            return
        if parsed.path == "/api/health":
            self.json_response({"ok": True, "appId": APP_ID, "version": VERSION})
            return
        if parsed.path == "/api/info":
            self.json_response({
                "ok": True,
                "device": {
                    "firstRunAt": now_iso(),
                    "isFirstRun": False,
                    "runCount": 1,
                    "deviceId": "gtpro-embedded",
                },
            })
            return
        if parsed.path == "/api/characters":
            self.json_response({"ok": True, "characters": []})
            return
        if parsed.path == "/api/product-images":
            self.json_response({"ok": True, "images": []})
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/browser-capture":
            try:
                size = min(int(self.headers.get("Content-Length", "0") or 0), 2 * 1024 * 1024)
                payload = json.loads(self.rfile.read(size).decode("utf-8")) if size else {}
                provider = str(payload.get("provider") or "unknown").strip().lower()
                with STATE.lock:
                    STATE.browser_captures[provider] = payload
                STATE.add_log(f"Extension captured browser session: {provider}", "info")
                self.json_response({"ok": True, "provider": provider})
            except (ValueError, json.JSONDecodeError) as exc:
                self.json_response({"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/shopee-affiliate-capture":
            try:
                size = min(int(self.headers.get("Content-Length", "0") or 0), 2 * 1024 * 1024)
                payload = json.loads(self.rfile.read(size).decode("utf-8")) if size else {}
                captures = payload.get("captures") or []
                with STATE.lock:
                    STATE.shopee_affiliate_captures = (STATE.shopee_affiliate_captures + captures)[-20:]
                STATE.add_log(f"Extension captured {len(captures)} Shopee affiliate API call(s)", "info")
                self.json_response({"ok": True, "received": len(captures)})
            except (ValueError, json.JSONDecodeError) as exc:
                self.json_response({"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/connect-extension":
            try:
                _user_data_dir, profile_directory = discover_chrome_profile_with_extension()
                if profile_directory:
                    launch_chrome(profile_directory)
                    STATE.add_log("Opened Chrome profile '%s' that has the extension" % profile_directory, "info")
                    self.json_response({"ok": True, "found": True, "profile": profile_directory})
                else:
                    # Nothing has it yet - open the extensions page so the user can load it.
                    launch_chrome(None, "chrome://extensions")
                    STATE.add_log("No Chrome profile has the extension; opened chrome://extensions", "warn")
                    self.json_response({"ok": True, "found": False, "profile": ""})
            except FileNotFoundError:
                self.json_response({"ok": False, "reason": "chrome_not_found"})
            except OSError as exc:
                self.json_response({"ok": False, "reason": str(exc)})
            return
        if parsed.path == "/api/open-chrome":
            try:
                size = min(int(self.headers.get("Content-Length", "0") or 0), 64 * 1024)
                raw = self.rfile.read(size).decode("utf-8", "replace") if size else ""
                if raw.strip().startswith("{"):
                    url = str(json.loads(raw).get("url") or "")
                else:
                    url = (parse_qs(raw).get("url") or [""])[0]
                if not url:
                    self.json_response({"ok": False, "error": "url is required"}, status=HTTPStatus.BAD_REQUEST)
                    return
                # Prefer the profile that has the extension, so install/auth pages land in
                # the same Chrome the rest of the flow drives.
                _user_data_dir, profile_directory = discover_chrome_profile_with_extension()
                launch_chrome(profile_directory, url)
                self.json_response({"ok": True, "profile": profile_directory or ""})
            except FileNotFoundError:
                self.json_response({"ok": False, "error": "Chrome not found"})
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                self.json_response({"ok": False, "error": str(exc)})
            return
        if parsed.path in {"/api/upload", "/api/upload-clip", "/api/product-image"}:
            size = int(self.headers.get("Content-Length", "0") or 0)
            body = self.rfile.read(size) if size else b""
            name = f"upload-{uuid.uuid4().hex}.bin"
            path = UPLOAD_DIR / name
            path.write_bytes(body)
            self.json_response({"ok": True, "url": f"/uploads/{name}", "public": f"/uploads/{name}"})
            return
        if parsed.path == "/api/open-folder":
            self.json_response({"ok": True})
            return
        if parsed.path == "/api/characters":
            self.json_response({"ok": True, "id": str(uuid.uuid4()), "url": "/static/logo.png"})
            return
        self.json_response({"ok": False, "error": "unknown endpoint"}, status=HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        self.json_response({"ok": True})

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_static(self, url_path: str) -> None:
        if url_path in {"", "/"}:
            path = WEBUI_DIR / "index.html"
        elif url_path == "/log":
            path = WEBUI_DIR / "log.html"
        elif url_path.startswith("/static/"):
            path = WEBUI_DIR / unquote(url_path[len("/static/"):])
        elif url_path.startswith("/uploads/"):
            path = UPLOAD_DIR / unquote(url_path[len("/uploads/"):])
        else:
            path = WEBUI_DIR / unquote(url_path.lstrip("/"))
        try:
            path = path.resolve()
            allowed = [WEBUI_DIR.resolve(), UPLOAD_DIR.resolve()]
            if not any(str(path).startswith(str(base)) for base in allowed):
                raise FileNotFoundError
            if not path.is_file():
                raise FileNotFoundError
            data = path.read_bytes()
            ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)

    def json_response(self, obj: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def handle_ws(self, kind: str) -> None:
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing websocket key")
            return
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(HTTPStatus.SWITCHING_PROTOCOLS)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()

        client = WsClient(self, kind)
        with STATE.lock:
            if kind == "ui":
                STATE.ui_clients.add(client)
            else:
                STATE.ext_clients.add(client)
        if kind == "ui":
            for entry in STATE.logs[-200:]:
                replay = json.loads(json.dumps(entry))
                replay["data"]["replay"] = True
                client.send_text(replay)
            client.send_text({"type": "ui.state", "data": STATE.public_state()})
        else:
            STATE.add_log("Extension connected to AI Studio.", "info")
            STATE.broadcast_state()

        try:
            while True:
                text = client.read_frame()
                if text is None:
                    break
                if not text:
                    continue
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if kind == "extension" and msg.get("type") == "ext.hello":
                    hello_app_id = str((msg.get("data") or {}).get("appId") or "")
                    if hello_app_id != APP_ID:
                        client.send_text({
                            "type": "ext.error",
                            "jobId": None,
                            "data": {"message": "Extension belongs to a different application."},
                        })
                        break
                if kind == "ui":
                    STATE.handle_ui(msg)
                else:
                    STATE.handle_extension(msg)
        finally:
            with STATE.lock:
                STATE.ui_clients.discard(client)
                STATE.ext_clients.discard(client)
            STATE.broadcast_state()


def find_port() -> int:
    for port in range(DEFAULT_PORT, DEFAULT_PORT + PORT_SCAN_SPAN + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port in {DEFAULT_PORT}-{DEFAULT_PORT + PORT_SCAN_SPAN}")


GTPRO_STARTED = False
GTPRO_PORT = None
GTPRO_LOCK = threading.Lock()


def ensure_gtpro_server_started() -> int | None:
    """Idempotent: starts the AI Studio server in a background thread once. Returns its port."""
    global GTPRO_STARTED, GTPRO_PORT
    with GTPRO_LOCK:
        if GTPRO_STARTED:
            return GTPRO_PORT
        if not (WEBUI_DIR / "index.html").is_file():
            print(f"[gtpro] webui missing at {WEBUI_DIR}, AI Studio tab will not work", file=sys.stderr)
            return None
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        try:
            port = find_port()
        except RuntimeError as exc:
            print(f"[gtpro] {exc}", file=sys.stderr)
            return None
        httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        httpd.daemon_threads = True
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        GTPRO_STARTED = True
        GTPRO_PORT = port
        print(f"AI Studio (GT Pro) running at http://127.0.0.1:{port}")
        return port


if __name__ == "__main__":
    port = ensure_gtpro_server_started()
    if port:
        threading.Timer(0.7, lambda: webbrowser.open(f"http://127.0.0.1:{port}/")).start()
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\nStopping...")
