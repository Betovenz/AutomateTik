import json
import mimetypes
import os
import random
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

import ai_studio_server
import gtpro_server


APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
RESOURCE_DIR = Path(__file__).resolve().parent
BASE_DIR = APP_DIR
DB_PATH = BASE_DIR / "autopost.db"
UPLOAD_DIR = BASE_DIR / "uploads"
DEFAULT_LIBRARY_DIR = Path.home() / "Downloads" / "AutoGT Tiktok File"
POSTED_DIR = BASE_DIR / "posted"
BIN_DIR = BASE_DIR / "Bin"
FAILED_DIR = BASE_DIR / "failed"
BIN_RETENTION_DAYS = 7
THUMB_DIR = BASE_DIR / "thumbs"
UI_DIR = RESOURCE_DIR / "ui"
CONFIG_PATH = BASE_DIR / "config.json"
MAIN_PATH = RESOURCE_DIR / "main.py"
LIBRARY_SOURCE_PATH = BASE_DIR / "library_source.json"
LICENSE_CONFIG_PATH = RESOURCE_DIR / "license-config.js"
TIKTOK_PACKAGE = os.environ.get("AUTOPOST_TIKTOK_PACKAGE", "com.ss.android.ugc.trill")

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
ACTIVE_QUEUE_STATUSES = ("pending", "running", "transferring", "posting", "failed")
WORKERS = {}
WORKERS_LOCK = threading.Lock()
STOP_REQUESTS = set()
SCHEDULER_STARTED = False
AUTO_RANDOM_STARTED = False
DB_INITIALIZED = False
ACTIVE_PROCESSES = {}
AUTH_SESSION_LOCK = threading.Lock()
AUTH_SESSION_TOKEN = ""
AUTH_SESSION_EXPIRES_AT = 0.0
AUTH_COOKIE_NAME = "atg_program_session"
AUTH_SESSION_MAX_SECONDS = 24 * 60 * 60


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def auth_session_deadline(state):
    deadline = time.time() + AUTH_SESSION_MAX_SECONDS
    license_expiry = parse_datetime((state or {}).get("expiresAt"))
    if license_expiry is not None:
        try:
            deadline = min(deadline, license_expiry.timestamp())
        except (OSError, OverflowError, ValueError):
            pass
    return deadline


def start_auth_session(state):
    global AUTH_SESSION_TOKEN, AUTH_SESSION_EXPIRES_AT
    deadline = auth_session_deadline(state)
    token = secrets.token_urlsafe(32)
    with AUTH_SESSION_LOCK:
        AUTH_SESSION_TOKEN = token
        AUTH_SESSION_EXPIRES_AT = deadline
    return token, max(1, int(deadline - time.time()))


def refresh_auth_session(state):
    global AUTH_SESSION_EXPIRES_AT
    deadline = auth_session_deadline(state)
    with AUTH_SESSION_LOCK:
        token = AUTH_SESSION_TOKEN
        if token:
            AUTH_SESSION_EXPIRES_AT = deadline
    if not token:
        return start_auth_session(state)
    return token, max(1, int(deadline - time.time()))


def clear_auth_session():
    global AUTH_SESSION_TOKEN, AUTH_SESSION_EXPIRES_AT
    with AUTH_SESSION_LOCK:
        AUTH_SESSION_TOKEN = ""
        AUTH_SESSION_EXPIRES_AT = 0.0


def auth_cookie_header(token="", max_age=0):
    return f"{AUTH_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max(0, int(max_age))}"


def request_auth_valid(handler):
    # Serial login removed: this is a local-only app bound to 127.0.0.1, so every
    # request is allowed through. The license/session helpers above are kept so the
    # /api/license/* routes still answer (the UI no longer calls them) and so the
    # gate can be restored by putting the cookie check back here.
    return True


def parse_datetime(value):
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def read_license_config():
    project_id = os.environ.get("AUTOPOST_LICENSE_PROJECT_ID", "").strip()
    api_key = os.environ.get("AUTOPOST_LICENSE_API_KEY", "").strip()
    if LICENSE_CONFIG_PATH.exists():
        try:
            text = LICENSE_CONFIG_PATH.read_text(encoding="utf-8")
            project_match = re.search(r'projectId\s*:\s*["\']([^"\']+)["\']', text)
            api_match = re.search(r'apiKey\s*:\s*["\']([^"\']+)["\']', text)
            project_id = project_id or (project_match.group(1).strip() if project_match else "")
            api_key = api_key or (api_match.group(1).strip() if api_match else "")
        except OSError:
            pass
    return {"projectId": project_id, "apiKey": api_key}


def firestore_string(fields, key, fallback=""):
    value = fields.get(key) or {}
    return value.get("stringValue", fallback)


def firestore_number(fields, key, fallback=1):
    value = fields.get(key) or {}
    raw = value.get("integerValue", value.get("doubleValue", fallback))
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return fallback


def firestore_timestamp(fields, key):
    value = fields.get(key) or {}
    return value.get("timestampValue")


def firestore_plain_value(value):
    if not isinstance(value, dict):
        return None
    if "stringValue" in value:
        return value.get("stringValue")
    if "integerValue" in value:
        try:
            return int(value.get("integerValue"))
        except (TypeError, ValueError):
            return 0
    if "doubleValue" in value:
        try:
            return float(value.get("doubleValue"))
        except (TypeError, ValueError):
            return 0
    if "booleanValue" in value:
        return bool(value.get("booleanValue"))
    if "nullValue" in value:
        return None
    if "mapValue" in value:
        fields = value.get("mapValue", {}).get("fields", {})
        return {key: firestore_plain_value(raw) for key, raw in fields.items()}
    if "arrayValue" in value:
        values = value.get("arrayValue", {}).get("values", [])
        return [firestore_plain_value(raw) for raw in values]
    return None


def firestore_channels(fields):
    if "channels" not in fields:
        return None
    raw_channels = firestore_plain_value(fields.get("channels")) or []
    channels = []
    for index, item in enumerate(raw_channels, start=1):
        if not isinstance(item, dict):
            continue
        udid = str(item.get("udid") or "").strip()
        if not udid:
            continue
        channels.append({
            "name": str(item.get("name") or f"#{index}").strip(),
            "udid": udid,
            "sort_order": int(item.get("sort_order") or index),
        })
    return channels


def validate_license_serial(serial):
    clean_serial = str(serial or "").strip()
    if not clean_serial:
        return {"ok": False, "error": "กรุณากรอก serial"}
    config = read_license_config()
    project_id = config.get("projectId") or ""
    api_key = config.get("apiKey") or ""
    if not project_id or not api_key or api_key == "YOUR_FIREBASE_WEB_API_KEY":
        return {"ok": False, "error": "ยังไม่ได้ตั้งค่า license-config.js"}
    url = (
        f"https://firestore.googleapis.com/v1/projects/{quote(project_id)}"
        f"/databases/(default)/documents/licenses/{quote(clean_serial)}?key={quote(api_key)}"
    )
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {"ok": False, "error": "Serial ไม่ถูกต้อง"}
        try:
            data = json.loads(exc.read().decode("utf-8") or "{}")
            message = data.get("error", {}).get("message") or "ตรวจสอบ serial ไม่สำเร็จ"
        except (OSError, json.JSONDecodeError):
            message = "ตรวจสอบ serial ไม่สำเร็จ"
        return {"ok": False, "error": message}
    except urllib.error.URLError as exc:
        return {"ok": False, "error": f"เชื่อมต่อ license server ไม่สำเร็จ: {exc.reason}"}
    fields = data.get("fields") or {}
    if not fields:
        return {"ok": False, "error": "Serial ไม่ถูกต้อง"}
    status = firestore_string(fields, "status", "").strip().lower()
    if status != "active":
        return {"ok": False, "error": "License ถูกปิดการใช้งาน"}
    expires_at = firestore_timestamp(fields, "expiresAt")
    expires_time = parse_datetime(expires_at)
    if expires_at and expires_time and expires_time <= datetime.now(expires_time.tzinfo):
        return {"ok": False, "error": "License หมดอายุแล้ว"}
    return {
        "ok": True,
        "state": {
            "serial": clean_serial,
            "status": status,
            "expiresAt": expires_at or None,
            "maxDevices": firestore_number(fields, "maxDevices", 1),
            "maxUdids": firestore_number(fields, "maxUdids", None),
            "channels": firestore_channels(fields),
            "checkedAt": now_iso(),
        },
    }


def read_config():
    if not CONFIG_PATH.exists():
        return {"adb_path": "adb"}
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def read_library_source():
    if not LIBRARY_SOURCE_PATH.exists():
        return {"folder": str(DEFAULT_LIBRARY_DIR)}
    try:
        with LIBRARY_SOURCE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        folder = data.get("folder") or str(DEFAULT_LIBRARY_DIR)
        return {"folder": folder}
    except (OSError, json.JSONDecodeError):
        return {"folder": str(DEFAULT_LIBRARY_DIR)}


def set_library_folder(folder_path):
    folder = str(Path(folder_path).resolve())
    with LIBRARY_SOURCE_PATH.open("w", encoding="utf-8") as f:
        json.dump({"folder": folder}, f, ensure_ascii=False, indent=2)
    return folder


def current_library_folder():
    return Path(read_library_source()["folder"]).resolve()


def same_parent_folder(file_path, folder_path):
    try:
        parent = Path(file_path).resolve().parent
        folder = Path(folder_path).resolve()
    except OSError:
        return False
    return os.path.normcase(str(parent)) == os.path.normcase(str(folder))


def video_file_exists(file_path):
    try:
        return Path(file_path).is_file()
    except OSError:
        return False


def ensure_dirs():
    for path in [UPLOAD_DIR, DEFAULT_LIBRARY_DIR, POSTED_DIR, BIN_DIR, FAILED_DIR, THUMB_DIR, UI_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def db_connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def db_init():
    global DB_INITIALIZED
    if DB_INITIALIZED:
        return
    ensure_dirs()
    with db_connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS channels (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              udid TEXT NOT NULL UNIQUE,
              status TEXT NOT NULL DEFAULT 'idle',
              scheduler_enabled INTEGER NOT NULL DEFAULT 0,
              schedule_interval_minutes INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0,
              license_serial TEXT,
              current_item_id INTEGER,
              last_error TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS videos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              filename TEXT NOT NULL,
              file_path TEXT NOT NULL UNIQUE,
              product_name TEXT NOT NULL DEFAULT '',
              caption TEXT NOT NULL DEFAULT '',
              product_url TEXT NOT NULL DEFAULT '',
              source TEXT NOT NULL DEFAULT 'manual',
              status TEXT NOT NULL DEFAULT 'library',
              created_at TEXT NOT NULL,
              deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS queue_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              video_id INTEGER NOT NULL,
              channel_id INTEGER NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending',
              scheduled_at TEXT,
              interval_minutes INTEGER,
              sort_order INTEGER NOT NULL DEFAULT 0,
              batch_id TEXT,
              error_message TEXT,
              created_at TEXT NOT NULL,
              started_at TEXT,
              finished_at TEXT,
              FOREIGN KEY(video_id) REFERENCES videos(id),
              FOREIGN KEY(channel_id) REFERENCES channels(id)
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              channel_id INTEGER,
              queue_item_id INTEGER,
              level TEXT NOT NULL DEFAULT 'info',
              message TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            """
        )
        existing_columns = [row["name"] for row in conn.execute("PRAGMA table_info(channels)").fetchall()]
        if "scheduler_enabled" not in existing_columns:
            conn.execute("ALTER TABLE channels ADD COLUMN scheduler_enabled INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        if "schedule_interval_minutes" not in existing_columns:
            conn.execute("ALTER TABLE channels ADD COLUMN schedule_interval_minutes INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        if "sort_order" not in existing_columns:
            conn.execute("ALTER TABLE channels ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE channels SET sort_order = id WHERE sort_order = 0")
            conn.commit()
        else:
            conn.execute("UPDATE channels SET sort_order = id WHERE sort_order = 0")
            conn.commit()
        if "license_serial" not in existing_columns:
            conn.execute("ALTER TABLE channels ADD COLUMN license_serial TEXT")
            conn.commit()
        queue_columns = [row["name"] for row in conn.execute("PRAGMA table_info(queue_items)").fetchall()]
        if "batch_id" not in queue_columns:
            conn.execute("ALTER TABLE queue_items ADD COLUMN batch_id TEXT")
            conn.commit()
    DB_INITIALIZED = True


def row_to_dict(row):
    return dict(row) if row else None


def query_all(sql, params=()):
    conn = db_connect()
    try:
        return [row_to_dict(row) for row in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def execute(sql, params=()):
    conn = db_connect()
    try:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_setting(key, fallback=""):
    db_init()
    rows = query_all("SELECT value FROM app_settings WHERE key = ?", (key,))
    return rows[0]["value"] if rows else fallback


def set_setting(key, value):
    db_init()
    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO app_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, str(value)),
        )
        conn.commit()


def current_license_serial():
    return get_setting("current_license_serial", "").strip()


def firestore_license_url(serial):
    config = read_license_config()
    project_id = config.get("projectId") or ""
    api_key = config.get("apiKey") or ""
    if not project_id or not api_key or api_key == "YOUR_FIREBASE_WEB_API_KEY":
        raise ValueError("ยังไม่ได้ตั้งค่า license-config.js")
    return (
        f"https://firestore.googleapis.com/v1/projects/{quote(project_id)}"
        f"/databases/(default)/documents/licenses/{quote(serial)}?key={quote(api_key)}"
    )


def firestore_channel_value(channel):
    return {
        "mapValue": {
            "fields": {
                "name": {"stringValue": str(channel.get("name") or "")},
                "udid": {"stringValue": str(channel.get("udid") or "")},
                "sort_order": {"integerValue": str(int(channel.get("sort_order") or 0))},
            }
        }
    }


def local_channels_for_serial(serial):
    if not serial:
        return []
    rows = query_all(
        """
        SELECT name, udid, sort_order
        FROM channels
        WHERE license_serial = ?
        ORDER BY sort_order ASC, id ASC
        """,
        (serial,),
    )
    return [
        {
            "name": row["name"],
            "udid": row["udid"],
            "sort_order": int(row["sort_order"] or index),
        }
        for index, row in enumerate(rows, start=1)
    ]


def sync_license_channels_to_firestore(serial):
    serial = str(serial or "").strip()
    if not serial:
        return False
    channels = local_channels_for_serial(serial)
    body = {
        "fields": {
            "channels": {
                "arrayValue": {
                    "values": [firestore_channel_value(channel) for channel in channels]
                }
            }
        }
    }
    url = f"{firestore_license_url(serial)}&updateMask.fieldPaths=channels"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        resp.read()
    return True


def sync_license_channels_to_firestore_async(serial):
    serial = str(serial or "").strip()
    if not serial:
        return

    def worker():
        try:
            sync_license_channels_to_firestore(serial)
        except Exception as exc:
            add_log(f"License channel sync warning: {exc}", level="warning")

    threading.Thread(target=worker, daemon=True).start()


def sync_license_channels_to_local(serial, channels):
    serial = str(serial or "").strip()
    if not serial or channels is None:
        return 0
    with db_connect() as conn:
        for index, channel in enumerate(channels, start=1):
            udid = str(channel.get("udid") or "").strip()
            if not udid:
                continue
            name = str(channel.get("name") or f"#{index}").strip()
            sort_order = int(channel.get("sort_order") or index)
            existing = conn.execute("SELECT id FROM channels WHERE udid = ?", (udid,)).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE channels
                    SET name = ?, sort_order = ?, license_serial = ?
                    WHERE id = ?
                    """,
                    (name, sort_order, serial, existing["id"]),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO channels (name, udid, status, sort_order, license_serial, created_at)
                    VALUES (?, ?, 'idle', ?, ?, ?)
                    """,
                    (name, udid, sort_order, serial, now_iso()),
                )
        conn.commit()
    return len(channels)


def adopt_unclaimed_channels_for_license(serial):
    serial = str(serial or "").strip()
    if not serial:
        return 0
    with db_connect() as conn:
        cur = conn.execute(
            "UPDATE channels SET license_serial = ? WHERE license_serial IS NULL OR license_serial = ''",
            (serial,),
        )
        conn.commit()
        return cur.rowcount or 0


def save_current_license_context(state):
    serial = str((state or {}).get("serial") or "").strip()
    if not serial:
        return
    set_setting("current_license_serial", serial)
    max_udids = (state or {}).get("maxUdids")
    set_setting("current_license_max_udids", "" if max_udids is None else str(max_udids))
    remote_channels = (state or {}).get("channels")
    if remote_channels:
        sync_license_channels_to_local(serial, remote_channels)
    else:
        adopt_unclaimed_channels_for_license(serial)
        sync_license_channels_to_firestore_async(serial)


def current_license_max_udids():
    raw = get_setting("current_license_max_udids", "").strip()
    if not raw:
        return None
    try:
        return max(1, int(raw))
    except ValueError:
        return None


def ensure_can_add_udid_for_current_license():
    serial = current_license_serial()
    max_udids = current_license_max_udids()
    if not serial or max_udids is None:
        return
    rows = query_all("SELECT COUNT(*) AS count FROM channels WHERE license_serial = ?", (serial,))
    current_count = int(rows[0]["count"] or 0) if rows else 0
    if current_count >= max_udids:
        raise ValueError(f"License นี้เพิ่ม UDID ได้สูงสุด {max_udids} ช่อง")


def auto_random_state():
    return {
        "enabled": get_setting("auto_random_enabled", "0") == "1",
        "interval_minutes": int(get_setting("auto_random_interval_minutes", "0") or 0),
        "scheduled_at": get_setting("auto_random_scheduled_at", "") or None,
    }


def add_log(message, channel_id=None, queue_item_id=None, level="info"):
    db_init()
    execute(
        """
        INSERT INTO activity_logs (channel_id, queue_item_id, level, message, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (channel_id, queue_item_id, level, message, now_iso()),
    )


def resolve_existing_executable(candidate):
    if not candidate:
        return None
    resolved = shutil.which(candidate) if "\\" not in candidate and "/" not in candidate else candidate
    if resolved and Path(resolved).exists():
        return str(Path(resolved))
    return None


def common_adb_candidates():
    names = ["adb.exe"] if os.name == "nt" else ["adb"]
    roots = [
        Path.home() / "AppData" / "Local" / "Android" / "Sdk" / "platform-tools",
        BASE_DIR / "platform-tools",
        BASE_DIR.parent / "platform-tools",
    ]
    if os.name == "nt":
        for drive in ["C:", "D:", "E:", "F:"]:
            roots.extend([
                Path(drive) / "platform-tools",
                Path(drive) / "Android" / "Sdk" / "platform-tools",
            ])
    for root in roots:
        for name in names:
            yield str(root / name)


def common_scrcpy_candidates():
    names = ["scrcpy.exe"] if os.name == "nt" else ["scrcpy"]
    roots = [
        BASE_DIR,
        BASE_DIR / "scrcpy",
        BASE_DIR.parent / "scrcpy",
        RESOURCE_DIR,
        RESOURCE_DIR / "scrcpy",
        RESOURCE_DIR.parent / "scrcpy",
    ]
    if os.name == "nt":
        for drive in ["C:", "D:", "E:", "F:"]:
            roots.extend([
                Path(drive) / "scrcpy",
                Path(drive) / "platform-tools",
                Path(drive) / "Program Files" / "scrcpy",
                Path(drive) / "Program Files (x86)" / "scrcpy",
            ])
    for root in roots:
        for name in names:
            yield str(root / name)


def find_adb_executable():
    config = read_config()
    candidates = [
        os.environ.get("AUTOPOST_ADB_PATH", "").strip(),
        str(config.get("adb_path", "")).strip(),
        shutil.which("adb.exe"),
        shutil.which("adb"),
        *common_adb_candidates(),
    ]
    for candidate in candidates:
        found = resolve_existing_executable(candidate)
        if found:
            return found
    return "adb"


def find_scrcpy_executable():
    config = read_config()
    candidates = [
        os.environ.get("AUTOPOST_SCRCPY_PATH", "").strip(),
        str(config.get("scrcpy_path", "")).strip(),
        shutil.which("scrcpy.exe"),
        shutil.which("scrcpy"),
        *common_scrcpy_candidates(),
    ]
    for candidate in candidates:
        found = resolve_existing_executable(candidate)
        if found:
            return found
    return None


def common_python_candidates():
    names = ["python.exe", "python"] if os.name == "nt" else ["python3", "python"]
    roots = [
        Path.home() / "AppData" / "Local" / "Python" / "pythoncore-3.14-64",
        Path.home() / "AppData" / "Local" / "Programs" / "Python" / "Python314",
        Path.home() / "AppData" / "Local" / "Programs" / "Python" / "Python313",
        Path.home() / "AppData" / "Local" / "Programs" / "Python" / "Python312",
        Path.home() / "AppData" / "Local" / "Programs" / "Python" / "Python311",
    ]
    if os.name == "nt":
        for drive in ["C:", "D:", "E:", "F:"]:
            roots.extend([
                Path(drive) / "Python314",
                Path(drive) / "Python313",
                Path(drive) / "Python312",
                Path(drive) / "Python311",
            ])
    for root in roots:
        for name in names:
            yield str(root / name)


def find_python_executable():
    config = read_config()
    candidates = [
        os.environ.get("AUTOPOST_PYTHON_PATH", "").strip(),
        str(config.get("python_path", "")).strip(),
    ]
    if not getattr(sys, "frozen", False):
        candidates.append(sys.executable)
    candidates.extend([
        shutil.which("python.exe"),
        shutil.which("python"),
        shutil.which("python3"),
        *common_python_candidates(),
    ])
    for candidate in candidates:
        found = resolve_existing_executable(candidate)
        if found:
            return found
    return None


def python_command_for_main():
    py_launcher = resolve_existing_executable(os.environ.get("AUTOPOST_PY_LAUNCHER", "").strip())
    if not py_launcher:
        py_launcher = resolve_existing_executable(shutil.which("py.exe") or shutil.which("py"))

    python_path = find_python_executable()
    if python_path:
        return [python_path, str(MAIN_PATH)]
    if py_launcher:
        return [py_launcher, "-3", str(MAIN_PATH)]
    raise RuntimeError("ไม่พบ Python สำหรับรัน automation: ให้ติดตั้ง Python 3.12+ หรือรัน install.bat ก่อนใช้งาน")


def adb_command(*args):
    return [find_adb_executable(), *args]


def hidden_subprocess_kwargs():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def open_device_screen(channel_id):
    rows = query_all("SELECT id, name, udid FROM channels WHERE id = ?", (channel_id,))
    if not rows:
        raise ValueError("Channel not found")

    channel = rows[0]
    udid = (channel["udid"] or "").strip()
    if not udid:
        raise ValueError("Channel has no UDID")

    scrcpy_path = find_scrcpy_executable()
    if not scrcpy_path:
        raise RuntimeError("ไม่พบ scrcpy.exe: ติดตั้ง scrcpy หรือวาง scrcpy.exe ไว้ข้างโปรแกรม")

    args = [
        scrcpy_path,
        "-s",
        udid,
        "--window-title",
        f"TikTok Device {channel['name']} ({udid})",
    ]
    subprocess.Popen(
        args,
        cwd=str(Path(scrcpy_path).resolve().parent),
        env=automation_env(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **hidden_subprocess_kwargs(),
    )
    add_log(f"Opened device screen with scrcpy: {udid}", channel_id=channel_id, level="success")
    return {"udid": udid, "scrcpy": scrcpy_path}


def find_android_sdk_root():
    config = read_config()
    candidates = [
        os.environ.get("ANDROID_SDK_ROOT", "").strip(),
        os.environ.get("ANDROID_HOME", "").strip(),
        str(config.get("android_sdk_root", "")).strip(),
    ]
    adb_candidates = [
        os.environ.get("AUTOPOST_ADB_PATH", "").strip(),
        str(config.get("adb_path", "")).strip(),
        shutil.which("adb.exe"),
        shutil.which("adb"),
        *common_adb_candidates(),
    ]
    for adb_candidate in adb_candidates:
        resolved = resolve_existing_executable(adb_candidate)
        if not resolved:
            continue
        adb_path = Path(resolved)
        if adb_path.exists() and adb_path.parent.name.lower() == "platform-tools":
            candidates.append(str(adb_path.parent.parent))

    for candidate in candidates:
        if not candidate:
            continue
        sdk_root = Path(candidate)
        adb_exe = sdk_root / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
        if adb_exe.exists():
            return str(sdk_root)
    return None


def automation_env():
    env = os.environ.copy()
    sdk_root = find_android_sdk_root()
    if sdk_root:
        env["ANDROID_HOME"] = sdk_root
        env["ANDROID_SDK_ROOT"] = sdk_root
        platform_tools = str(Path(sdk_root) / "platform-tools")
        env["PATH"] = platform_tools + os.pathsep + env.get("PATH", "")
    return env


def scan_adb_devices():
    proc = subprocess.run(
        adb_command("devices"),
        capture_output=True,
        text=True,
        check=False,
        cwd=str(BASE_DIR),
        **hidden_subprocess_kwargs(),
    )
    devices = []
    for line in proc.stdout.splitlines()[1:]:
        parts = line.strip().split()
        if len(parts) >= 2:
            devices.append({"udid": parts[0], "state": parts[1]})
    return {"devices": devices, "raw": proc.stdout, "error": proc.stderr}


def online_adb_udids():
    return {
        device["udid"]
        for device in scan_adb_devices().get("devices", [])
        if device.get("state") == "device"
    }


def scan_video_directory(directory, source="scan"):
    created = 0
    directory = Path(directory).resolve()
    active_paths = {
        str(path.resolve())
        for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    }
    existing_rows = query_all(
        "SELECT id, file_path FROM videos WHERE status != 'deleted'"
    )
    for row in existing_rows:
        if same_parent_folder(row["file_path"], directory) and str(Path(row["file_path"]).resolve()) not in active_paths:
            execute("UPDATE videos SET status = 'deleted', deleted_at = ? WHERE id = ?", (now_iso(), row["id"]))
    for path in Path(directory).iterdir():
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        filename = path.name
        product_name = path.stem
        try:
            execute(
                """
                INSERT INTO videos
                (filename, file_path, product_name, caption, source, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'library', ?)
                """,
                (filename, str(path), product_name, product_name, source, now_iso()),
            )
            created += 1
        except sqlite3.IntegrityError:
            execute(
                """
                UPDATE videos
                SET status = CASE WHEN status = 'deleted' THEN 'library' ELSE status END,
                    deleted_at = NULL,
                    filename = ?,
                    product_name = CASE WHEN product_name = '' THEN ? ELSE product_name END,
                    caption = CASE WHEN caption = '' THEN ? ELSE caption END
                WHERE file_path = ?
                """,
                (filename, product_name, product_name, str(path)),
            )
            continue
    return created


def scan_bin_directory():
    cleanup_expired_bin_videos()
    created = 0
    directory = BIN_DIR.resolve()
    active_paths = {
        str(path.resolve())
        for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    }
    existing_rows = query_all(
        "SELECT id, file_path FROM videos WHERE status = 'posted'"
    )
    for row in existing_rows:
        if same_parent_folder(row["file_path"], directory) and str(Path(row["file_path"]).resolve()) not in active_paths:
            execute("UPDATE videos SET status = 'deleted', deleted_at = ? WHERE id = ?", (now_iso(), row["id"]))
    for path in directory.iterdir():
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        filename = path.name
        product_name = path.stem
        try:
            execute(
                """
                INSERT INTO videos
                (filename, file_path, product_name, caption, source, status, created_at, deleted_at)
                VALUES (?, ?, ?, ?, 'bin', 'posted', ?, ?)
                """,
                (filename, str(path), product_name, product_name, now_iso(), now_iso()),
            )
            created += 1
        except sqlite3.IntegrityError:
            execute(
                """
                UPDATE videos
                SET status = 'posted',
                    deleted_at = COALESCE(deleted_at, ?),
                    filename = ?,
                    product_name = CASE WHEN product_name = '' THEN ? ELSE product_name END,
                    caption = CASE WHEN caption = '' THEN ? ELSE caption END
                WHERE file_path = ?
                """,
                (now_iso(), filename, product_name, product_name, str(path)),
            )
    return created


def cleanup_expired_bin_videos():
    cutoff = datetime.now() - timedelta(days=BIN_RETENTION_DAYS)
    undated_rows = query_all(
        """
        SELECT id, file_path
        FROM videos
        WHERE status = 'posted'
          AND deleted_at IS NULL
        """
    )
    for row in undated_rows:
        if same_parent_folder(row["file_path"], BIN_DIR):
            execute("UPDATE videos SET deleted_at = ? WHERE id = ?", (now_iso(), row["id"]))
    rows = query_all(
        """
        SELECT id, file_path, deleted_at
        FROM videos
        WHERE status = 'posted'
          AND deleted_at IS NOT NULL
        """
    )
    removed = 0
    for row in rows:
        if not same_parent_folder(row["file_path"], BIN_DIR):
            continue
        entered_at = parse_datetime(row["deleted_at"])
        if not entered_at or entered_at.timestamp() > cutoff.timestamp():
            continue
        path = Path(row["file_path"])
        if path.exists() and path.is_file():
            try:
                path.unlink()
                removed += 1
            except OSError as exc:
                add_log(f"Bin auto-clean failed for {path.name}: {exc}", level="error")
                continue
        execute("UPDATE videos SET status = 'deleted', deleted_at = ? WHERE id = ?", (now_iso(), row["id"]))
        add_log(f"Auto deleted expired Bin video after {BIN_RETENTION_DAYS} days: {path.name}", level="warning")
    return removed


def path_in_allowed_video_root(file_path):
    try:
        path = Path(file_path).resolve()
        allowed_roots = [
            current_library_folder(),
            BIN_DIR.resolve(),
            UPLOAD_DIR.resolve(),
            POSTED_DIR.resolve(),
            FAILED_DIR.resolve(),
        ]
        path_text = os.path.normcase(str(path))
        for root in allowed_roots:
            root_text = os.path.normcase(str(Path(root).resolve()))
            try:
                if os.path.commonpath([path_text, root_text]) == root_text:
                    return True
            except ValueError:
                continue
    except OSError:
        return False
    return False


def send_file_to_recycle_bin(path):
    path = Path(path).resolve()
    if not path.is_file():
        return False
    if os.name != "nt":
        raise RuntimeError("Recycle Bin is only supported on Windows")
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    FO_DELETE = 3
    FOF_ALLOWUNDO = 0x0040
    FOF_NOCONFIRMATION = 0x0010
    FOF_SILENT = 0x0004
    FOF_NOERRORUI = 0x0400

    operation = SHFILEOPSTRUCTW()
    operation.wFunc = FO_DELETE
    operation.pFrom = str(path) + "\0\0"
    operation.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    if result != 0 or operation.fAnyOperationsAborted:
        raise RuntimeError(f"Move to Recycle Bin failed: {result}")
    return True


def delete_video_record(video_id):
    rows = query_all("SELECT id, file_path FROM videos WHERE id = ?", (video_id,))
    if not rows:
        return {"deleted_file": False}
    file_path = rows[0]["file_path"]
    deleted_file = False
    if file_path and path_in_allowed_video_root(file_path):
        path = Path(file_path)
        if path.is_file():
            send_file_to_recycle_bin(path)
            deleted_file = True
    execute("UPDATE videos SET status = 'deleted', deleted_at = ? WHERE id = ?", (now_iso(), video_id))
    execute(
        "UPDATE queue_items SET status = 'skipped', finished_at = ? WHERE video_id = ? AND status = 'pending'",
        (now_iso(), video_id),
    )
    return {"deleted_file": deleted_file}


def thumbnail_svg(video_id):
    rows = query_all("SELECT product_name, filename, status FROM videos WHERE id = ? AND status != 'deleted'", (video_id,))
    if not rows:
        return None
    title = (rows[0].get("product_name") or rows[0].get("filename") or "Video").strip()
    status = (rows[0].get("status") or "video").strip()
    initials = "".join(part[:1] for part in re.findall(r"[\w\u0E00-\u0E7F]+", title)[:2]) or "V"
    palette = [
        ("#0f172a", "#14b8a6"),
        ("#111827", "#60a5fa"),
        ("#1f2937", "#f59e0b"),
        ("#172554", "#a7f3d0"),
        ("#312e81", "#f0abfc"),
    ][int(video_id) % 5]
    safe_title = (
        title.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    safe_status = (
        status.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    safe_initials = (
        initials.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="{palette[0]}"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="320" height="320" rx="28" fill="url(#bg)"/>
  <circle cx="250" cy="70" r="42" fill="{palette[1]}" opacity=".22"/>
  <circle cx="70" cy="252" r="54" fill="{palette[1]}" opacity=".16"/>
  <path d="M132 112v96l78-48-78-48z" fill="{palette[1]}" opacity=".92"/>
  <text x="24" y="48" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="24" font-weight="800">{safe_initials}</text>
  <text x="24" y="268" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="17" font-weight="700">{safe_status}</text>
  <title>{safe_title}</title>
</svg>"""


def thumbnail_cache_path(video_id, file_path):
    try:
        stat = Path(file_path).stat()
        stamp = f"{int(stat.st_mtime)}_{int(stat.st_size)}"
    except OSError:
        stamp = "missing"
    return THUMB_DIR / f"{int(video_id)}_{stamp}.jpg"


def cleanup_old_thumbnails(video_id, keep_path):
    for path in THUMB_DIR.glob(f"{int(video_id)}_*.jpg"):
        if path.resolve() != keep_path.resolve():
            try:
                path.unlink()
            except OSError:
                pass


def generate_video_thumbnail(video_id, file_path):
    src = Path(file_path)
    if not src.is_file():
        return None
    target = thumbnail_cache_path(video_id, src)
    if target.is_file():
        return target
    ensure_dirs()
    try:
        import cv2

        capture = cv2.VideoCapture(str(src))
        if not capture.isOpened():
            return None
        capture.set(cv2.CAP_PROP_POS_MSEC, 500)
        ok, frame = capture.read()
        if not ok or frame is None:
            capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = capture.read()
        capture.release()
        if not ok or frame is None:
            return None

        height, width = frame.shape[:2]
        side = min(width, height)
        left = max(0, (width - side) // 2)
        top = max(0, (height - side) // 2)
        frame = frame[top:top + side, left:left + side]
        frame = cv2.resize(frame, (320, 320), interpolation=cv2.INTER_AREA)
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ok:
            return None
        target.write_bytes(encoded.tobytes())
        cleanup_old_thumbnails(video_id, target)
        return target
    except Exception as exc:
        add_log(f"Thumbnail generation failed for video {video_id}: {exc}", level="warning")
        return None


def scan_uploads():
    return scan_video_directory(current_library_folder(), source="scan")


def safe_upload_name(filename):
    name = Path(filename or "video.mp4").name
    safe = "".join(ch if ch.isalnum() or ch in " ._-()" else "_" for ch in name).strip()
    return safe or "video.mp4"


def product_id_from_video_name(value):
    """Return the leading TikTok Product ID from ProductID-title filenames."""
    stem = Path(str(value or "")).stem.strip()
    match = re.match(r"^(\d{6,})(?:[-_\s]|$)", stem)
    return match.group(1) if match else ""


def unique_upload_path(filename):
    base_name = safe_upload_name(filename)
    candidate = UPLOAD_DIR / base_name
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    index = 1
    while True:
        candidate = UPLOAD_DIR / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def choose_video_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise RuntimeError(f"Folder picker unavailable: {exc}") from exc

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        selected = filedialog.askdirectory(title="Select video folder")
    finally:
        root.destroy()
    return selected


def get_state():
    db_init()
    cleanup_expired_bin_videos()
    library_folder = current_library_folder()
    serial = current_license_serial()
    channel_sql = """
        SELECT c.*,
          (SELECT COUNT(*) FROM queue_items qi WHERE qi.channel_id = c.id AND qi.status IN ('pending','running')) AS queue_count
        FROM channels c
    """
    channel_params = ()
    if serial:
        channel_sql += " WHERE c.license_serial = ?"
        channel_params = (serial,)
    channel_sql += " ORDER BY c.sort_order ASC, c.created_at ASC, c.id ASC"
    channels = query_all(channel_sql, channel_params)
    videos_all = query_all(
        """
        SELECT v.*,
          (SELECT COUNT(*) FROM queue_items qi WHERE qi.video_id = v.id AND qi.status IN ('pending','running')) AS active_queue_count
        FROM videos v
        WHERE v.status != 'deleted'
        ORDER BY v.created_at DESC
        """
    )
    videos = [
        video for video in videos_all
        if same_parent_folder(video["file_path"], library_folder) and video_file_exists(video["file_path"])
    ]
    bin_videos = [
        video for video in videos_all
        if video["status"] == "posted" and same_parent_folder(video["file_path"], BIN_DIR) and video_file_exists(video["file_path"])
    ]
    queue = query_all(
        """
        SELECT qi.*, v.filename, v.product_name, v.caption, v.file_path, v.product_url,
               c.name AS channel_name, c.udid
        FROM queue_items qi
        JOIN videos v ON v.id = qi.video_id
        JOIN channels c ON c.id = qi.channel_id
        WHERE qi.status IN ('pending','transferring','posting','running','failed')
        ORDER BY qi.channel_id, qi.sort_order, qi.id
        """
    )
    logs = query_all(
        """
        SELECT l.*, c.name AS channel_name
        FROM activity_logs l
        LEFT JOIN channels c ON c.id = l.channel_id
        ORDER BY l.id DESC
        LIMIT 120
        """
    )
    latest_batch = query_all(
        """
        SELECT batch_id
        FROM queue_items
        WHERE batch_id IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
        """
    )
    active_batch = query_all(
        """
        SELECT MIN(created_at) AS batch_start
        FROM queue_items
        WHERE status IN ('pending','running','transferring','posting','failed')
        """
    )
    if latest_batch:
        queue_stats_rows = query_all(
            """
            SELECT status, COUNT(*) AS count
            FROM queue_items
            WHERE batch_id = ?
              AND status != 'skipped'
            GROUP BY status
            """,
            (latest_batch[0]["batch_id"],),
        )
    elif active_batch and active_batch[0].get("batch_start"):
        queue_stats_rows = query_all(
            """
            SELECT status, COUNT(*) AS count
            FROM queue_items
            WHERE created_at >= ?
              AND status != 'skipped'
            GROUP BY status
            """,
            (active_batch[0]["batch_start"],),
        )
    else:
        queue_stats_rows = []
    queue_stats = {str(row["status"]): int(row["count"]) for row in queue_stats_rows}
    queued_count = sum(queue_stats.get(status, 0) for status in ["pending", "running", "transferring", "posting"])
    return {
        "channels": channels,
        "videos": videos,
        "bin_videos": bin_videos,
        "queue": queue,
        "logs": logs,
        "stats": {
            "channels": len(channels),
            "queued": queued_count,
            "complete": queue_stats.get("posted", 0),
            "failed": queue_stats.get("failed", 0),
        },
        "workers": list_running_workers(),
        "auto_random": auto_random_state(),
        "paths": {
            "uploads": str(UPLOAD_DIR),
            "default_library": str(DEFAULT_LIBRARY_DIR),
            "library": str(library_folder),
            "posted": str(POSTED_DIR),
            "bin": str(BIN_DIR),
            "failed": str(FAILED_DIR),
        },
    }


def list_running_workers():
    with WORKERS_LOCK:
        return [
            {"channel_id": channel_id, "running": thread.is_alive()}
            for channel_id, thread in WORKERS.items()
        ]


def parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def next_queue_item(channel_id):
    with db_connect() as conn:
        rows = conn.execute(
            """
            SELECT qi.*, v.file_path, v.filename, v.product_name, v.caption
            FROM queue_items qi
            JOIN videos v ON v.id = qi.video_id
            WHERE qi.channel_id = ?
              AND qi.status = 'pending'
              AND v.status != 'deleted'
            ORDER BY qi.sort_order, qi.id
            """,
            (channel_id,),
        ).fetchall()

    now = datetime.now()
    for row in rows:
        scheduled = parse_datetime(row["scheduled_at"])
        if scheduled and scheduled > now:
            continue
        return row_to_dict(row)
    return None


def channel_scheduler_state(channel_id):
    rows = query_all(
        "SELECT scheduler_enabled, schedule_interval_minutes FROM channels WHERE id = ?",
        (channel_id,),
    )
    if not rows:
        return {"enabled": False, "interval_minutes": 0}
    row = rows[0]
    return {
        "enabled": bool(int(row.get("scheduler_enabled") or 0)),
        "interval_minutes": int(row.get("schedule_interval_minutes") or 0),
    }


def latest_channel_schedule_time(conn, channel_id):
    rows = conn.execute(
        """
        SELECT scheduled_at
        FROM queue_items
        WHERE channel_id = ?
          AND scheduled_at IS NOT NULL
          AND status IN ('pending','running','transferring','posting','failed')
        ORDER BY scheduled_at DESC
        LIMIT 1
        """,
        (channel_id,),
    ).fetchall()
    for row in rows:
        parsed = parse_datetime(row["scheduled_at"])
        if parsed:
            return parsed
    return None


def push_video_to_device(udid, file_path):
    src = Path(file_path)
    if not src.exists():
        raise FileNotFoundError(f"Video not found: {src}")
    safe_name = f"autopost_{int(time.time())}{src.suffix.lower() or '.mp4'}"
    remote = f"/sdcard/DCIM/AutoPost/{safe_name}"
    mkdir_proc = subprocess.run(
        adb_command("-s", udid, "shell", "mkdir", "-p", "/sdcard/DCIM/AutoPost"),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    if mkdir_proc.returncode != 0:
        detail = (mkdir_proc.stderr or mkdir_proc.stdout or "adb mkdir failed").strip()
        raise RuntimeError(f"adb mkdir failed: {detail}")
    proc = subprocess.run(
        adb_command("-s", udid, "push", str(src), remote),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "adb push failed").strip()
        raise RuntimeError(f"adb push failed: {detail}")
    scan_proc = subprocess.run(
        adb_command(
            "-s",
            udid,
            "shell",
            "am",
            "broadcast",
            "-a",
            "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d",
            f"file://{remote}",
        ),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    if scan_proc.returncode != 0:
        detail = (scan_proc.stderr or scan_proc.stdout or "media scan failed").strip()
        raise RuntimeError(f"media scan failed: {detail}")
    return remote


def delete_remote_video_from_device(udid, remote_path):
    remote_path = str(remote_path or "").strip()
    allowed_prefix = "/sdcard/DCIM/AutoPost/"
    if not remote_path.startswith(allowed_prefix):
        raise ValueError(f"Refusing to delete unsafe device path: {remote_path}")

    proc = subprocess.run(
        adb_command("-s", udid, "shell", "rm", "-f", remote_path),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "adb rm failed").strip()
        raise RuntimeError(f"delete remote video failed: {detail}")

    subprocess.run(
        adb_command(
            "-s",
            udid,
            "shell",
            "content",
            "delete",
            "--uri",
            "content://media/external/video/media",
            "--where",
            f"_data='{remote_path}'",
        ),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    subprocess.run(
        adb_command(
            "-s",
            udid,
            "shell",
            "am",
            "broadcast",
            "-a",
            "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d",
            f"file://{remote_path}",
        ),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    return True


def force_stop_device_app(udid, package=TIKTOK_PACKAGE):
    proc = subprocess.run(
        adb_command("-s", udid, "shell", "am", "force-stop", package),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "adb force-stop failed").strip()
        raise RuntimeError(detail)


def set_device_network(udid, enabled):
    state = "enable" if enabled else "disable"
    for service in ("wifi", "data"):
        proc = subprocess.run(
            adb_command("-s", udid, "shell", "svc", service, state),
            capture_output=True,
            text=True,
            check=False,
            **hidden_subprocess_kwargs(),
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or f"svc {service} {state} failed").strip()
            raise RuntimeError(detail)


def device_screen_size(udid):
    proc = subprocess.run(
        adb_command("-s", udid, "shell", "wm", "size"),
        capture_output=True,
        text=True,
        check=False,
        **hidden_subprocess_kwargs(),
    )
    match = re.search(r"(\d+)x(\d+)", proc.stdout or "")
    if match:
        return int(match.group(1)), int(match.group(2))
    return 1080, 2400


def swipe_up_after_post(udid, duration_seconds=180, max_interval_seconds=20):
    width, height = device_screen_size(udid)
    x = width // 2
    start_y = int(height * 0.78)
    end_y = int(height * 0.24)
    deadline = time.time() + duration_seconds
    swipes = 0

    while time.time() < deadline:
        remaining = deadline - time.time()
        delay = min(random.uniform(5, max_interval_seconds), max(0, remaining))
        if delay > 0:
            time.sleep(delay)
        if time.time() >= deadline:
            break
        duration_ms = random.randint(350, 850)
        subprocess.run(
            adb_command(
                "-s",
                udid,
                "shell",
                "input",
                "swipe",
                str(x + random.randint(-80, 80)),
                str(start_y + random.randint(-80, 80)),
                str(x + random.randint(-80, 80)),
                str(end_y + random.randint(-80, 80)),
                str(duration_ms),
            ),
            capture_output=True,
            text=True,
            check=False,
            **hidden_subprocess_kwargs(),
        )
        swipes += 1

    return swipes


def post_warmup_delete_and_stop(udid, remote_video_path=None, channel_id=None, queue_item_id=None):
    add_log("Post complete. Disabling device internet.", channel_id=channel_id, queue_item_id=queue_item_id)
    try:
        set_device_network(udid, False)
    except Exception as exc:
        add_log(f"Disable internet warning: {exc}", channel_id=channel_id, queue_item_id=queue_item_id, level="warning")

    add_log("STEP 14: swipe up for 1 minute before deleting phone video", channel_id=channel_id, queue_item_id=queue_item_id)
    first_swipes = swipe_up_after_post(udid, duration_seconds=60)
    add_log(f"STEP 14: completed first {first_swipes} swipe(s)", channel_id=channel_id, queue_item_id=queue_item_id)

    if remote_video_path:
        delete_remote_video_from_device(udid, remote_video_path)
        add_log(
            f"Deleted transferred phone video: {Path(remote_video_path).name}",
            channel_id=channel_id,
            queue_item_id=queue_item_id,
            level="success",
        )

    add_log("STEP 14: continue swiping for 2 minutes before force-stop", channel_id=channel_id, queue_item_id=queue_item_id)
    second_swipes = swipe_up_after_post(udid, duration_seconds=120)
    add_log(f"STEP 14: completed second {second_swipes} swipe(s)", channel_id=channel_id, queue_item_id=queue_item_id)
    add_log(f"Force stopping app: {TIKTOK_PACKAGE}", channel_id=channel_id, queue_item_id=queue_item_id)
    force_stop_device_app(udid, TIKTOK_PACKAGE)
    return first_swipes + second_swipes


def port_is_open(host, port, timeout=1):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def finalize_posted_item(item, channel_id=None, queue_item_id=None):
    rows = query_all("SELECT status FROM queue_items WHERE id = ?", (item["id"],))
    if rows and rows[0]["status"] == "posted":
        return True

    execute(
        "UPDATE queue_items SET status = 'posted', finished_at = ? WHERE id = ?",
        (now_iso(), item["id"]),
    )
    add_log(f"Posted: {item['product_name'] or item['filename']}", channel_id=channel_id, queue_item_id=queue_item_id, level="success")

    src = Path(item["file_path"])
    final_path = str(src)
    if src.exists():
        target = BIN_DIR / src.name
        if target.exists():
            target = BIN_DIR / f"{src.stem}_{int(time.time())}{src.suffix}"
        shutil.move(str(src), str(target))
        final_path = str(target)
        add_log(f"Moved completed video to Bin: {target.name}", channel_id=channel_id, queue_item_id=queue_item_id, level="success")
    execute("UPDATE videos SET status = 'posted', file_path = ?, deleted_at = ? WHERE id = ?", (final_path, now_iso(), item["video_id"]))
    return True


def run_main_for_item(udid, item, channel_id=None, queue_item_id=None):
    env = automation_env()
    video_name = Path(item.get("filename") or item.get("file_path") or "").stem
    product_id = product_id_from_video_name(video_name)
    if not product_id:
        raise RuntimeError(
            "ไม่พบ Product ID ที่หน้าชื่อวิดีโอ กรุณาใช้ชื่อไฟล์รูปแบบ ProductID-ชื่อสินค้า.mp4"
        )
    env["ADB_SERIAL"] = udid
    env["AUTOPOST_CAPTION"] = ""
    env["AUTOPOST_PRODUCT_NAME"] = item.get("product_name") or ""
    env["AUTOPOST_VIDEO_NAME"] = video_name
    env["AUTOPOST_PRODUCT_ID"] = product_id
    env["AUTOPOST_SPEED"] = os.environ.get("AUTOPOST_SPEED", "normal")
    env["PYTHONIOENCODING"] = "utf-8"
    add_log(
        f"ADB Showcase: กำลังเพิ่ม Product ID {product_id} เข้า Showcase ก่อนจับคู่",
        channel_id=channel_id,
        queue_item_id=queue_item_id,
    )
    command = python_command_for_main()
    proc = subprocess.Popen(
        command,
        cwd=str(BASE_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        **hidden_subprocess_kwargs(),
    )
    if channel_id is not None:
        ACTIVE_PROCESSES[channel_id] = proc
    stdout_lines = []
    posted_finalized = False
    try:
        if proc.stdout:
            for line in proc.stdout:
                text = line.strip()
                if not text:
                    continue
                stdout_lines.append(text)
                level = "warning" if "error attempt" in text or "failed after" in text else "info"
                add_log(text, channel_id=channel_id, queue_item_id=queue_item_id, level=level)
                if not posted_finalized and text == "STEP 13: success":
                    posted_finalized = finalize_posted_item(item, channel_id=channel_id, queue_item_id=queue_item_id)
        proc.wait()
        if channel_id in STOP_REQUESTS:
            if posted_finalized:
                add_log("Stop requested after STEP 13 complete; keeping item as complete.", channel_id=channel_id, queue_item_id=queue_item_id, level="warning")
                return "\n".join(stdout_lines)
            raise RuntimeError("Stopped by user")
        if proc.returncode != 0:
            if posted_finalized:
                detail = ("\n".join(stdout_lines) or "post-warmup failed")[-800:]
                add_log(f"STEP 14 warning after complete: {detail}", channel_id=channel_id, queue_item_id=queue_item_id, level="warning")
                return "\n".join(stdout_lines)
            detail = ("\n".join(stdout_lines) or "main.py failed")[-2000:]
            raise RuntimeError(detail)
        if not posted_finalized:
            finalize_posted_item(item, channel_id=channel_id, queue_item_id=queue_item_id)
        return "\n".join(stdout_lines)
    finally:
        if channel_id is not None and ACTIVE_PROCESSES.get(channel_id) is proc:
            ACTIVE_PROCESSES.pop(channel_id, None)


def worker_loop(channel_id):
    channel = row_to_dict(query_all("SELECT * FROM channels WHERE id = ?", (channel_id,))[0])
    udid = channel["udid"]
    execute("UPDATE channels SET status = 'running', last_error = NULL WHERE id = ?", (channel_id,))
    add_log(f"Start channel {channel['name']} ({udid})", channel_id=channel_id)
    last_wait_log = 0
    try:
        while True:
            if channel_id in STOP_REQUESTS:
                add_log("Stop requested. Worker will not pick the next queue item.", channel_id=channel_id, level="warning")
                break
            item = next_queue_item(channel_id)
            if not item:
                scheduler_state = channel_scheduler_state(channel_id)
                if scheduler_state["enabled"]:
                    if time.time() - last_wait_log >= 60:
                        add_log("No due queue items. Waiting for next scheduled or new queue item.", channel_id=channel_id)
                        last_wait_log = time.time()
                    execute(
                        "UPDATE channels SET status = 'running', current_item_id = NULL WHERE id = ?",
                        (channel_id,),
                    )
                    time.sleep(5)
                    continue
                add_log("No pending queue items.", channel_id=channel_id)
                break
            execute(
                "UPDATE queue_items SET status = 'transferring', started_at = ? WHERE id = ?",
                (now_iso(), item["id"]),
            )
            execute(
                "UPDATE channels SET current_item_id = ?, status = 'transferring' WHERE id = ?",
                (item["id"], channel_id),
            )
            remote_video_path = None
            try:
                add_log(f"Transferring {item['filename']} to {udid}", channel_id=channel_id, queue_item_id=item["id"])
                remote_video_path = push_video_to_device(udid, item["file_path"])
                add_log(f"Transfer completed: {item['filename']}", channel_id=channel_id, queue_item_id=item["id"], level="success")
                execute(
                    "UPDATE queue_items SET status = 'posting' WHERE id = ?",
                    (item["id"],),
                )
                execute(
                    "UPDATE channels SET status = 'posting' WHERE id = ?",
                    (channel_id,),
                )
                time.sleep(2)
                add_log(f"Posting started: {item['product_name'] or item['filename']}", channel_id=channel_id, queue_item_id=item["id"])
                run_main_for_item(udid, item, channel_id=channel_id, queue_item_id=item["id"])
                post_warmup_delete_and_stop(
                    udid,
                    remote_video_path=remote_video_path,
                    channel_id=channel_id,
                    queue_item_id=item["id"],
                )
                remote_video_path = None
            except Exception as exc:
                if channel_id in STOP_REQUESTS:
                    execute(
                        """
                        UPDATE queue_items
                        SET status = 'pending', error_message = NULL, started_at = NULL, finished_at = NULL
                        WHERE id = ?
                        """,
                        (item["id"],),
                    )
                    add_log("Stopped. Current posting item returned to pending.", channel_id=channel_id, queue_item_id=item["id"], level="warning")
                    break
                execute(
                    "UPDATE queue_items SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?",
                    (str(exc), now_iso(), item["id"]),
                )
                execute(
                    "UPDATE channels SET last_error = ?, status = 'running', current_item_id = NULL WHERE id = ?",
                    (str(exc), channel_id),
                )
                add_log(f"Failed: {exc}", channel_id=channel_id, queue_item_id=item["id"], level="error")
                add_log("Queue item marked failed. Skipping to the next pending item.", channel_id=channel_id, queue_item_id=item["id"], level="warning")
                continue
            finally:
                if remote_video_path:
                    try:
                        delete_remote_video_from_device(udid, remote_video_path)
                        add_log(
                            f"Deleted transferred phone video: {Path(remote_video_path).name}",
                            channel_id=channel_id,
                            queue_item_id=item["id"],
                            level="success",
                        )
                    except Exception as cleanup_exc:
                        add_log(
                            f"Phone video cleanup warning: {cleanup_exc}",
                            channel_id=channel_id,
                            queue_item_id=item["id"],
                            level="warning",
                        )
    finally:
        execute(
            "UPDATE channels SET status = 'idle', current_item_id = NULL WHERE id = ? AND status != 'error'",
            (channel_id,),
        )
        STOP_REQUESTS.discard(channel_id)
        with WORKERS_LOCK:
            WORKERS.pop(channel_id, None)


def start_channel_worker(channel_id):
    with WORKERS_LOCK:
        thread = WORKERS.get(channel_id)
        if thread and thread.is_alive():
            return False
    with WORKERS_LOCK:
        thread = WORKERS.get(channel_id)
        if thread and thread.is_alive():
            return False
        thread = threading.Thread(target=worker_loop, args=(channel_id,), daemon=True)
        WORKERS[channel_id] = thread
        thread.start()
        return True


def stop_channel(channel_id):
    channel_id = int(channel_id)
    STOP_REQUESTS.add(channel_id)
    proc = ACTIVE_PROCESSES.get(channel_id)
    if proc and proc.poll() is None:
        proc.terminate()
    execute(
        """
        UPDATE queue_items
        SET status = 'pending', error_message = NULL, started_at = NULL, finished_at = NULL
        WHERE channel_id = ?
          AND status IN ('posting','running','transferring')
        """,
        (channel_id,),
    )
    execute(
        "UPDATE channels SET status = 'idle', scheduler_enabled = 0, current_item_id = NULL WHERE id = ?",
        (channel_id,),
    )
    add_log("Stop requested. Active item returned to pending.", channel_id=channel_id, level="warning")


def stop_all_channels():
    serial = current_license_serial()
    if serial:
        rows = query_all("SELECT id FROM channels WHERE license_serial = ? ORDER BY sort_order ASC, id ASC", (serial,))
    else:
        rows = query_all("SELECT id FROM channels ORDER BY sort_order ASC, id ASC")
    for row in rows:
        stop_channel(int(row["id"]))
    return len(rows)


def start_all_channels():
    serial = current_license_serial()
    if serial:
        rows = query_all("SELECT id FROM channels WHERE license_serial = ? ORDER BY sort_order ASC, id ASC", (serial,))
    else:
        rows = query_all("SELECT id FROM channels ORDER BY sort_order ASC, id ASC")
    started = 0
    for row in rows:
        channel_id = int(row["id"])
        STOP_REQUESTS.discard(channel_id)
        execute("UPDATE channels SET scheduler_enabled = 1 WHERE id = ?", (channel_id,))
        if start_channel_worker(channel_id):
            started += 1
    return {"count": len(rows), "started": started}


def release_video_if_no_active_queue(conn, video_id):
    active_count = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM queue_items
        WHERE video_id = ?
          AND status IN ('pending','running','transferring','posting','failed')
        """,
        (video_id,),
    ).fetchone()["count"]
    if int(active_count or 0) == 0:
        conn.execute(
            """
            UPDATE videos
            SET status = 'library'
            WHERE id = ?
              AND status IN ('queued','failed')
              AND deleted_at IS NULL
            """,
            (video_id,),
        )


def remove_queue_item(queue_id):
    queue_id = int(queue_id)
    with db_connect() as conn:
        row = conn.execute(
            """
            SELECT id, video_id, channel_id, status
            FROM queue_items
            WHERE id = ?
              AND status IN ('pending','failed')
            """,
            (queue_id,),
        ).fetchone()
        if not row:
            return {"removed": 0, "released_video": False, "channel_id": None}
        conn.execute(
            "UPDATE queue_items SET status = 'skipped', finished_at = ? WHERE id = ?",
            (now_iso(), queue_id),
        )
        release_video_if_no_active_queue(conn, int(row["video_id"]))
        video_row = conn.execute("SELECT status FROM videos WHERE id = ?", (int(row["video_id"]),)).fetchone()
        conn.commit()
        return {
            "removed": 1,
            "released_video": bool(video_row and video_row["status"] == "library"),
            "channel_id": int(row["channel_id"]),
        }


def clear_channel_queue(channel_id):
    channel_id = int(channel_id)
    with db_connect() as conn:
        rows = conn.execute(
            """
            SELECT id, video_id
            FROM queue_items
            WHERE channel_id = ?
              AND status IN ('pending','failed')
            """,
            (channel_id,),
        ).fetchall()
        conn.execute(
            """
            UPDATE queue_items
            SET status = 'skipped', finished_at = ?
            WHERE channel_id = ?
              AND status IN ('pending','failed')
            """,
            (now_iso(), channel_id),
        )
        for row in rows:
            release_video_if_no_active_queue(conn, int(row["video_id"]))
        conn.commit()
    return len(rows)


def due_channel_ids():
    rows = query_all(
        """
        SELECT DISTINCT c.id
        FROM channels c
        JOIN queue_items qi ON qi.channel_id = c.id
        WHERE c.status = 'idle'
          AND c.scheduler_enabled = 1
          AND qi.status = 'pending'
          AND qi.scheduled_at IS NOT NULL
          AND qi.scheduled_at <= ?
        ORDER BY c.sort_order ASC, c.id ASC
        """,
        (now_iso(),),
    )
    return [int(row["id"]) for row in rows]


def scheduler_loop():
    add_log("Scheduler started.")
    while True:
        try:
            for channel_id in due_channel_ids():
                with WORKERS_LOCK:
                    thread = WORKERS.get(channel_id)
                    already_running = bool(thread and thread.is_alive())
                if already_running:
                    continue
                add_log("ถึงเวลาโพสต์แล้ว เริ่มโพสต์อัตโนมัติ", channel_id=channel_id, level="success")
                start_channel_worker(channel_id)
        except Exception as exc:
            add_log(f"Scheduler error: {exc}", level="error")
        time.sleep(10)


def ensure_scheduler_started():
    global SCHEDULER_STARTED
    if SCHEDULER_STARTED:
        return
    SCHEDULER_STARTED = True
    thread = threading.Thread(target=scheduler_loop, daemon=True)
    thread.start()


def library_video_ids_for_auto_random():
    library_folder = current_library_folder()
    videos = query_all(
        """
        SELECT id, file_path
        FROM videos
        WHERE status = 'library'
          AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        """
    )
    return [
        int(video["id"])
        for video in videos
        if same_parent_folder(video["file_path"], library_folder) and video_file_exists(video["file_path"])
    ]


def run_auto_random_once(interval_minutes=0, scheduled_at=None):
    folder_path = current_library_folder()
    scan_video_directory(folder_path, source="folder")
    video_ids = library_video_ids_for_auto_random()
    channel_ids = [int(row["id"]) for row in query_all("SELECT id FROM channels ORDER BY sort_order ASC, id ASC")]
    if not video_ids:
        return {"assigned": 0, "skipped": 0, "reason": "no_videos"}
    if not channel_ids:
        return {"assigned": 0, "skipped": 0, "reason": "no_channels"}
    return random_distribute({
        "channel_ids": channel_ids,
        "video_ids": video_ids,
        "interval_minutes": interval_minutes,
        "scheduled_at": scheduled_at,
    })


def auto_random_loop():
    add_log("Auto random watcher started.")
    last_error = ""
    while True:
        try:
            state = auto_random_state()
            if state["enabled"]:
                try:
                    result = run_auto_random_once(state["interval_minutes"], state.get("scheduled_at"))
                    if result.get("assigned"):
                        add_log(
                            f"Auto random assigned {result['assigned']} video(s); skipped {result['skipped']} duplicate(s).",
                            level="success",
                        )
                    last_error = ""
                except Exception as exc:
                    message = str(exc)
                    if message != last_error:
                        add_log(f"Auto random waiting: {message}", level="warning")
                        last_error = message
        except Exception as exc:
            message = str(exc)
            if message != last_error:
                add_log(f"Auto random error: {message}", level="error")
                last_error = message
        time.sleep(60)


def ensure_auto_random_started():
    global AUTO_RANDOM_STARTED
    if AUTO_RANDOM_STARTED:
        return
    AUTO_RANDOM_STARTED = True
    thread = threading.Thread(target=auto_random_loop, daemon=True)
    thread.start()


def assign_videos(payload):
    channel_id = int(payload["channel_id"])
    video_ids = list(dict.fromkeys(int(video_id) for video_id in payload.get("video_ids", [])))
    scheduled_at = payload.get("scheduled_at") or None
    interval_minutes = int(payload.get("interval_minutes") or 0)
    batch_id = payload.get("batch_id") or f"batch-{int(time.time())}"
    assigned = 0
    skipped = 0
    with db_connect() as conn:
        channel_row = conn.execute(
            "SELECT scheduler_enabled, schedule_interval_minutes FROM channels WHERE id = ?",
            (channel_id,),
        ).fetchone()
        channel_interval = int(channel_row["schedule_interval_minutes"] or 0) if channel_row else 0
        inherit_schedule = (
            not scheduled_at
            and channel_row
            and int(channel_row["scheduler_enabled"] or 0) == 1
            and channel_interval > 0
        )
        effective_interval = interval_minutes or (channel_interval if inherit_schedule else 0)
        next_scheduled_base = None
        latest_scheduled = None
        if effective_interval > 0:
            latest_scheduled = latest_channel_schedule_time(conn, channel_id)
        if not scheduled_at and effective_interval > 0:
            next_scheduled_base = max(latest_scheduled or datetime.now(), datetime.now())
        current_max = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM queue_items WHERE channel_id = ?",
            (channel_id,),
        ).fetchone()[0]
        existing_video_ids = set()
        if video_ids:
            placeholders = ",".join("?" for _ in video_ids)
            status_placeholders = ",".join("?" for _ in ACTIVE_QUEUE_STATUSES)
            rows = conn.execute(
                f"""
                SELECT DISTINCT video_id
                FROM queue_items
                WHERE video_id IN ({placeholders})
                  AND status IN ({status_placeholders})
                """,
                (*video_ids, *ACTIVE_QUEUE_STATUSES),
            ).fetchall()
            existing_video_ids = {int(row["video_id"]) for row in rows}
        for video_id in video_ids:
            if video_id in existing_video_ids:
                skipped += 1
                continue
            item_time = scheduled_at
            if scheduled_at and interval_minutes > 0:
                base = parse_datetime(scheduled_at)
                if base:
                    if latest_scheduled and latest_scheduled >= base:
                        item_time = (latest_scheduled + timedelta(minutes=interval_minutes * (assigned + 1))).isoformat(timespec="seconds")
                    else:
                        item_time = (base + timedelta(minutes=interval_minutes * assigned)).isoformat(timespec="seconds")
            elif next_scheduled_base and effective_interval > 0:
                item_time = (next_scheduled_base + timedelta(minutes=effective_interval * (assigned + 1))).isoformat(timespec="seconds")
            assigned += 1
            conn.execute(
                """
                INSERT INTO queue_items
                (video_id, channel_id, status, scheduled_at, interval_minutes, sort_order, batch_id, created_at)
                VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
                """,
                (
                    video_id,
                    channel_id,
                    item_time,
                    effective_interval or None,
                    current_max + assigned,
                    batch_id,
                    now_iso(),
                ),
            )
            conn.execute("UPDATE videos SET status = 'queued' WHERE id = ?", (video_id,))
        if assigned > 0 and (scheduled_at or effective_interval > 0):
            conn.execute(
                "UPDATE channels SET scheduler_enabled = 1, schedule_interval_minutes = ? WHERE id = ?",
                (effective_interval or 0, channel_id),
            )
        conn.commit()
    return {"assigned": assigned, "skipped": skipped}


def random_distribute(payload):
    requested_channel_ids = [int(value) for value in payload.get("channel_ids", [])]
    video_ids = list(dict.fromkeys(int(value) for value in payload.get("video_ids", [])))
    interval_minutes = int(payload.get("interval_minutes") or 0)
    scheduled_at = payload.get("scheduled_at") or None
    if not requested_channel_ids:
        raise ValueError("No channels selected")
    placeholders = ",".join("?" for _ in requested_channel_ids)
    online_udids = online_adb_udids()
    if not online_udids:
        raise ValueError("ไม่มีเครื่องที่ online อยู่ในขณะนี้")
    channel_rows = query_all(
        f"""
        SELECT id, udid
        FROM channels
        WHERE id IN ({placeholders})
        ORDER BY sort_order ASC, id ASC
        """,
        tuple(requested_channel_ids),
    )
    channel_ids = [int(row["id"]) for row in channel_rows if row["udid"] in online_udids]
    if not channel_ids:
        raise ValueError("ไม่มีเครื่องที่ online อยู่ในขณะนี้")
    if scheduled_at or interval_minutes > 0:
        update_placeholders = ",".join("?" for _ in channel_ids)
        execute(
            f"UPDATE channels SET scheduler_enabled = 1, schedule_interval_minutes = ? WHERE id IN ({update_placeholders})",
            (interval_minutes, *channel_ids),
        )
    batch_id = f"batch-{int(time.time())}"
    buckets = {channel_id: [] for channel_id in channel_ids}
    for index, video_id in enumerate(video_ids):
        buckets[channel_ids[index % len(channel_ids)]].append(video_id)
    result = {"assigned": 0, "skipped": 0}
    for channel_id, ids in buckets.items():
        if ids:
            assigned = assign_videos({
                "channel_id": channel_id,
                "video_ids": ids,
                "batch_id": batch_id,
                "interval_minutes": interval_minutes,
                "scheduled_at": scheduled_at,
            })
            result["assigned"] += assigned["assigned"]
            result["skipped"] += assigned["skipped"]
    return result


def reorder_channels(channel_ids):
    ids = [int(value) for value in channel_ids]
    if not ids:
        raise ValueError("No channel order provided")
    serial = current_license_serial()
    with db_connect() as conn:
        if serial:
            rows = conn.execute("SELECT id FROM channels WHERE license_serial = ?", (serial,)).fetchall()
        else:
            rows = conn.execute("SELECT id FROM channels").fetchall()
        existing_ids = {int(row["id"]) for row in rows}
        ordered = []
        seen = set()
        for channel_id in ids:
            if channel_id in existing_ids and channel_id not in seen:
                ordered.append(channel_id)
                seen.add(channel_id)
        ordered.extend(sorted(existing_ids - seen))
        for index, channel_id in enumerate(ordered, start=1):
            conn.execute("UPDATE channels SET sort_order = ? WHERE id = ?", (index, channel_id))
        conn.commit()
    if serial:
        sync_license_channels_to_firestore_async(serial)
    return {"count": len(ordered)}


def set_channel_schedule(channel_id, payload):
    scheduled_at = payload.get("scheduled_at") or None
    interval_minutes = int(payload.get("interval_minutes") or 0)
    queue_item_ids = [int(value) for value in payload.get("queue_item_ids", [])]
    base = parse_datetime(scheduled_at) if scheduled_at else None
    if base is None and interval_minutes > 0:
        base = datetime.now() + timedelta(minutes=interval_minutes)
    elif base is None and payload.get("set_from_now"):
        base = datetime.now()
    with db_connect() as conn:
        if queue_item_ids:
            placeholders = ",".join("?" for _ in queue_item_ids)
            rows = conn.execute(
                f"""
                SELECT id, status
                FROM queue_items
                WHERE channel_id = ?
                  AND status NOT IN ('posted','skipped')
                  AND id IN ({placeholders})
                ORDER BY sort_order, id
                """,
                (channel_id, *queue_item_ids),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, status
                FROM queue_items
                WHERE channel_id = ?
                  AND status NOT IN ('posted','skipped')
                ORDER BY sort_order, id
                """,
                (channel_id,),
            ).fetchall()
        for index, row in enumerate(rows):
            item_time = None
            if base and interval_minutes > 0:
                item_time = (base + timedelta(minutes=interval_minutes * index)).isoformat(timespec="seconds")
            elif base:
                item_time = base.isoformat(timespec="seconds")
            next_status = "pending" if row["status"] in ("failed", "error") else row["status"]
            conn.execute(
                "UPDATE queue_items SET scheduled_at = ?, interval_minutes = ?, status = ? WHERE id = ?",
                (item_time, interval_minutes or None, next_status, row["id"]),
            )
        conn.execute(
            "UPDATE channels SET scheduler_enabled = 0, schedule_interval_minutes = ? WHERE id = ?",
            (interval_minutes or 0, channel_id),
        )
        conn.commit()
    return len(rows)


def set_all_channel_schedules(payload):
    serial = current_license_serial()
    if serial:
        rows = query_all("SELECT id FROM channels WHERE license_serial = ? ORDER BY sort_order ASC, id ASC", (serial,))
    else:
        rows = query_all("SELECT id FROM channels ORDER BY sort_order ASC, id ASC")
    total = 0
    for row in rows:
        channel_payload = dict(payload)
        channel_payload["queue_item_ids"] = []
        total += set_channel_schedule(int(row["id"]), channel_payload)
    return {"channels": len(rows), "count": total}


def clear_all_time_sets():
    serial = current_license_serial()
    if serial:
        rows = query_all("SELECT id FROM channels WHERE license_serial = ? ORDER BY sort_order ASC, id ASC", (serial,))
    else:
        rows = query_all("SELECT id FROM channels ORDER BY sort_order ASC, id ASC")
    channel_ids = [int(row["id"]) for row in rows]
    if not channel_ids:
        return {"channels": 0, "count": 0}
    placeholders = ",".join("?" for _ in channel_ids)
    with db_connect() as conn:
        count_row = conn.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM queue_items
            WHERE channel_id IN ({placeholders})
              AND status NOT IN ('posted','skipped')
              AND (scheduled_at IS NOT NULL OR interval_minutes IS NOT NULL)
            """,
            tuple(channel_ids),
        ).fetchone()
        updated_count = int(count_row["count"] or 0)
        conn.execute(
            f"""
            UPDATE queue_items
            SET scheduled_at = NULL,
                interval_minutes = NULL
            WHERE channel_id IN ({placeholders})
              AND status NOT IN ('posted','skipped')
            """,
            tuple(channel_ids),
        )
        conn.execute(
            f"""
            UPDATE channels
            SET scheduler_enabled = 0,
                schedule_interval_minutes = 0
            WHERE id IN ({placeholders})
            """,
            tuple(channel_ids),
        )
        conn.commit()
    return {"channels": len(channel_ids), "count": updated_count}


def json_response(handler, data, status=200, headers=None):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    for key, value in (headers or {}).items():
        handler.send_header(str(key), str(value))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            json_response(self, {"ok": True, "status": "ready"})
            return
        if parsed.path.startswith("/api/") and not request_auth_valid(self):
            json_response(self, {"ok": False, "error": "กรุณาเข้าสู่ระบบก่อนใช้งาน"}, 401)
            return
        if parsed.path == "/api/state":
            json_response(self, {"ok": True, "data": get_state()})
            return
        if parsed.path == "/api/adb/devices":
            try:
                json_response(self, {"ok": True, "data": scan_adb_devices()})
            except Exception as exc:
                json_response(self, {"ok": False, "error": str(exc)}, 500)
            return
        if parsed.path in {"/api/ai-studio/info", "/api/gtpro/info"}:
            port = ai_studio_server.ensure_ai_studio_server_started()
            json_response(self, {"ok": bool(port), "port": port})
            return
        if parsed.path.startswith("/api/videos/") and parsed.path.endswith("/thumb"):
            self.serve_video_thumb(parsed.path)
            return
        if parsed.path.startswith("/api/videos/") and parsed.path.endswith("/media"):
            self.serve_video_media(parsed.path)
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/license/validate" and not request_auth_valid(self):
            json_response(self, {"ok": False, "error": "กรุณาเข้าสู่ระบบก่อนใช้งาน"}, 401)
            return
        try:
            if parsed.path == "/api/videos/upload":
                query = parse_qs(parsed.query)
                filename = query.get("filename", ["video.mp4"])[0]
                suffix = Path(filename).suffix.lower()
                if suffix not in VIDEO_EXTENSIONS:
                    json_response(self, {"ok": False, "error": "Unsupported video type"}, 400)
                    return
                length = int(self.headers.get("Content-Length", "0") or "0")
                if length <= 0:
                    json_response(self, {"ok": False, "error": "Empty upload"}, 400)
                    return
                ensure_dirs()
                target = unique_upload_path(filename)
                with target.open("wb") as f:
                    remaining = length
                    while remaining > 0:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        f.write(chunk)
                        remaining -= len(chunk)
                json_response(self, {"ok": True, "file": str(target)})
                return
            payload = self.read_json()
            if parsed.path == "/api/channels":
                name = (payload.get("name") or "").strip()
                udid = (payload.get("udid") or "").strip()
                if not name or not udid:
                    json_response(self, {"ok": False, "error": "Channel name and UDID are required"}, 400)
                    return
                serial = current_license_serial()
                ensure_can_add_udid_for_current_license()
                exists = query_all("SELECT id FROM channels WHERE udid = ?", (udid,))
                if exists:
                    json_response(self, {"ok": False, "error": "UDID นี้ถูกเพิ่มเป็น Device Channel แล้ว"}, 409)
                    return
                if serial:
                    order_row = query_all("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM channels WHERE license_serial = ?", (serial,))
                else:
                    order_row = query_all("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM channels")
                sort_order = int(order_row[0]["max_order"] or 0) + 1
                channel_id = execute(
                    "INSERT INTO channels (name, udid, status, sort_order, license_serial, created_at) VALUES (?, ?, 'idle', ?, ?, ?)",
                    (name, udid, sort_order, serial or None, now_iso()),
                )
                if serial:
                    sync_license_channels_to_firestore_async(serial)
                json_response(self, {"ok": True, "id": channel_id})
                return
            if parsed.path == "/api/channels/reorder":
                result = reorder_channels(payload.get("channel_ids", []))
                json_response(self, {"ok": True, **result})
                return
            if parsed.path == "/api/videos/scan":
                count = scan_uploads()
                add_log(f"Scanned uploads. Added {count} new video(s).")
                json_response(self, {"ok": True, "count": count})
                return
            if parsed.path == "/api/videos/scan-library":
                folder_path = current_library_folder()
                count = scan_video_directory(folder_path, source="folder")
                if count:
                    add_log(f"Auto scanned folder {folder_path}. Added {count} new video(s).")
                json_response(self, {"ok": True, "count": count, "folder": str(folder_path)})
                return
            if parsed.path == "/api/videos/scan-bin":
                count = scan_bin_directory()
                if count:
                    add_log(f"Scanned Bin folder. Added {count} posted video(s).")
                json_response(self, {"ok": True, "count": count, "folder": str(BIN_DIR)})
                return
            if parsed.path == "/api/videos/scan-folder":
                folder_path = Path(payload.get("folder_path", "")).expanduser().resolve()
                if not folder_path.exists() or not folder_path.is_dir():
                    json_response(self, {"ok": False, "error": "Folder not found"}, 400)
                    return
                set_library_folder(folder_path)
                count = scan_video_directory(folder_path, source="folder")
                add_log(f"Scanned folder {folder_path}. Added {count} new video(s).")
                json_response(self, {"ok": True, "count": count, "folder": str(folder_path)})
                return
            if parsed.path == "/api/videos/browse-folder":
                selected = choose_video_folder()
                if not selected:
                    json_response(self, {"ok": True, "cancelled": True, "count": 0})
                    return
                folder_path = Path(selected).resolve()
                set_library_folder(folder_path)
                count = scan_video_directory(folder_path, source="folder")
                add_log(f"Scanned folder {folder_path}. Added {count} new video(s).")
                json_response(self, {"ok": True, "count": count, "folder": str(folder_path)})
                return
            if parsed.path == "/api/license/validate":
                had_auth = request_auth_valid(self)
                result = validate_license_serial(payload.get("serial"))
                if result.get("ok"):
                    state = result.get("state") or {}
                    save_current_license_context(state)
                    token, max_age = refresh_auth_session(state) if had_auth else start_auth_session(state)
                    headers = {"Set-Cookie": auth_cookie_header(token, max_age)}
                else:
                    clear_auth_session()
                    headers = {"Set-Cookie": auth_cookie_header()}
                json_response(self, result, 200 if result.get("ok") else 401, headers)
                return
            if parsed.path == "/api/license/logout":
                clear_auth_session()
                json_response(self, {"ok": True}, headers={"Set-Cookie": auth_cookie_header()})
                return
            if parsed.path == "/api/auto-random":
                ensure_auto_random_started()
                enabled = bool(payload.get("enabled"))
                interval_minutes = max(0, int(payload.get("interval_minutes") or 0))
                scheduled_at = payload.get("scheduled_at") or None
                set_setting("auto_random_enabled", "1" if enabled else "0")
                set_setting("auto_random_interval_minutes", interval_minutes)
                set_setting("auto_random_scheduled_at", scheduled_at or "")
                add_log(
                    f"Auto random: {'ON' if enabled else 'OFF'}"
                    + (f" (start {scheduled_at})" if enabled and scheduled_at else "")
                    + (f" (interval {interval_minutes} min)" if enabled and interval_minutes else ""),
                    level="success" if enabled else "warning",
                )
                assigned = 0
                skipped = 0
                if enabled:
                    result = run_auto_random_once(interval_minutes, scheduled_at)
                    assigned = int(result.get("assigned") or 0)
                    skipped = int(result.get("skipped") or 0)
                    if assigned:
                        add_log(
                            f"Auto random assigned {assigned} video(s); skipped {skipped} duplicate(s).",
                            level="success",
                        )
                json_response(self, {"ok": True, "auto_random": auto_random_state()})
                return
            if parsed.path == "/api/videos/register":
                file_path = Path(payload["file_path"]).resolve()
                video_id = execute(
                    """
                    INSERT INTO videos
                    (filename, file_path, product_name, caption, product_url, source, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'library', ?)
                    """,
                    (
                        file_path.name,
                        str(file_path),
                        payload.get("product_name") or file_path.stem,
                        payload.get("caption") or payload.get("product_name") or file_path.stem,
                        payload.get("product_url") or "",
                        payload.get("source") or "extension",
                        now_iso(),
                    ),
                )
                json_response(self, {"ok": True, "id": video_id})
                return
            if parsed.path == "/api/queue/assign":
                result = assign_videos(payload)
                add_log(
                    f"Assigned {result['assigned']} video(s) to channel {payload.get('channel_id')}; skipped {result['skipped']} duplicate(s)",
                    channel_id=int(payload["channel_id"]),
                )
                json_response(self, {"ok": True, **result})
                return
            if parsed.path == "/api/queue/random":
                result = random_distribute(payload)
                add_log(
                    f"Random distributed {result['assigned']} video(s) across {len(payload.get('channel_ids', []))} channel(s); skipped {result['skipped']} duplicate(s)."
                )
                json_response(self, {"ok": True, **result})
                return
            if parsed.path.startswith("/api/queue/") and parsed.path.endswith("/retry"):
                queue_id = int(parsed.path.split("/")[3])
                rows = query_all("SELECT channel_id FROM queue_items WHERE id = ? AND status = 'failed'", (queue_id,))
                if not rows:
                    json_response(self, {"ok": False, "error": "Failed queue item not found"}, 404)
                    return
                channel_id = int(rows[0]["channel_id"])
                min_order_rows = query_all(
                    "SELECT COALESCE(MIN(sort_order), 0) AS min_order FROM queue_items WHERE channel_id = ? AND status IN ('pending','failed')",
                    (channel_id,),
                )
                retry_order = int(min_order_rows[0]["min_order"] or 0) - 1
                execute(
                    """
                    UPDATE queue_items
                    SET status = 'pending', error_message = NULL, started_at = NULL, finished_at = NULL, sort_order = ?
                    WHERE id = ?
                    """,
                    (retry_order, queue_id),
                )
                execute(
                    "UPDATE channels SET status = 'idle', last_error = NULL, scheduler_enabled = 1 WHERE id = ?",
                    (channel_id,),
                )
                add_log(f"Retry queue item {queue_id}.", channel_id=channel_id, queue_item_id=queue_id, level="warning")
                started = start_channel_worker(channel_id)
                json_response(self, {"ok": True, "started": started})
                return
            if parsed.path == "/api/queue/schedule-all":
                result = set_all_channel_schedules(payload)
                interval_minutes = int(payload.get("interval_minutes") or 0)
                scheduled_at = payload.get("scheduled_at") or None
                if interval_minutes > 0 and scheduled_at:
                    message = f"Schedule all channels from {scheduled_at} every {interval_minutes} min. Updated {result['count']} queue item(s)."
                elif interval_minutes > 0:
                    message = f"Schedule all channels every {interval_minutes} min. Updated {result['count']} queue item(s)."
                else:
                    message = f"Schedule all channels. Updated {result['count']} queue item(s)."
                add_log(message, level="success")
                json_response(self, {"ok": True, **result})
                return
            if parsed.path == "/api/queue/clear-time-sets":
                result = clear_all_time_sets()
                add_log(
                    f"Cleared time set for all channels. Updated {result['count']} queue item(s) across {result['channels']} channel(s).",
                    level="warning",
                )
                json_response(self, {"ok": True, **result})
                return
            if parsed.path.startswith("/api/queue/") and parsed.path.endswith("/schedule"):
                channel_id = int(parsed.path.split("/")[3])
                count = set_channel_schedule(channel_id, payload)
                interval_minutes = int(payload.get("interval_minutes") or 0)
                scheduled_at = payload.get("scheduled_at") or None
                if interval_minutes > 0 and not scheduled_at:
                    message = f"ตั้งเวลาโพสต์ทุกๆ {interval_minutes} นาที จำนวน {count} คิว"
                elif interval_minutes > 0:
                    message = f"ตั้งเวลาโพสต์เริ่ม {scheduled_at} ทุกๆ {interval_minutes} นาที จำนวน {count} คิว"
                else:
                    message = f"ตั้งเวลาโพสต์จำนวน {count} คิว"
                add_log(
                    message,
                    channel_id=channel_id,
                    level="success",
                )
                json_response(self, {"ok": True, "count": count})
                return
            if parsed.path == "/api/channels/start-all":
                result = start_all_channels()
                add_log(f"Start All requested. Started {result['started']} of {result['count']} channel(s).", level="success")
                json_response(self, {"ok": True, **result})
                return
            if parsed.path.startswith("/api/channels/") and parsed.path.endswith("/start"):
                channel_id = int(parsed.path.split("/")[3])
                STOP_REQUESTS.discard(channel_id)
                execute("UPDATE channels SET scheduler_enabled = 1 WHERE id = ?", (channel_id,))
                started = start_channel_worker(channel_id)
                json_response(self, {"ok": True, "started": started})
                return
            if parsed.path == "/api/channels/stop-all":
                count = stop_all_channels()
                add_log(f"Stop All requested for {count} channel(s).", level="warning")
                json_response(self, {"ok": True, "count": count})
                return
            if parsed.path.startswith("/api/channels/") and parsed.path.endswith("/screen"):
                channel_id = int(parsed.path.split("/")[3])
                result = open_device_screen(channel_id)
                json_response(self, {"ok": True, "data": result})
                return
            if parsed.path.startswith("/api/channels/") and parsed.path.endswith("/rename"):
                channel_id = int(parsed.path.split("/")[3])
                name = (payload.get("name") or "").strip()
                if not name:
                    json_response(self, {"ok": False, "error": "Channel name is required"}, 400)
                    return
                rows = query_all("SELECT id FROM channels WHERE id = ?", (channel_id,))
                if not rows:
                    json_response(self, {"ok": False, "error": "Channel not found"}, 404)
                    return
                execute("UPDATE channels SET name = ? WHERE id = ?", (name, channel_id))
                serial = current_license_serial()
                if serial:
                    sync_license_channels_to_firestore_async(serial)
                add_log(f"Renamed channel {channel_id} to {name}.", channel_id=channel_id)
                json_response(self, {"ok": True})
                return
            if parsed.path.startswith("/api/channels/") and parsed.path.endswith("/stop"):
                channel_id = int(parsed.path.split("/")[3])
                stop_channel(channel_id)
                json_response(self, {"ok": True})
                return
            json_response(self, {"ok": False, "error": "Unknown route"}, 404)
        except Exception as exc:
            json_response(self, {"ok": False, "error": str(exc)}, 500)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not request_auth_valid(self):
            json_response(self, {"ok": False, "error": "กรุณาเข้าสู่ระบบก่อนใช้งาน"}, 401)
            return
        try:
            parts = parsed.path.strip("/").split("/")
            if parts == ["api", "logs", "clear"]:
                execute("DELETE FROM activity_logs")
                json_response(self, {"ok": True})
                return
            if parts == ["api", "history", "clear"]:
                with WORKERS_LOCK:
                    active_channel_ids = list(ACTIVE_PROCESSES.keys())
                    active_processes = list(ACTIVE_PROCESSES.values())
                for channel_id in active_channel_ids:
                    STOP_REQUESTS.add(channel_id)
                for proc in active_processes:
                    if proc and proc.poll() is None:
                        proc.terminate()
                with db_connect() as conn:
                    conn.execute("DELETE FROM queue_items")
                    conn.execute("DELETE FROM activity_logs")
                    conn.execute(
                        """
                        UPDATE videos
                        SET status = 'library'
                        WHERE status IN ('queued','failed')
                          AND deleted_at IS NULL
                        """
                    )
                    conn.execute(
                        """
                        UPDATE channels
                        SET status = 'idle',
                            scheduler_enabled = 0,
                            current_item_id = NULL,
                            last_error = NULL
                        """
                    )
                    conn.commit()
                json_response(self, {"ok": True})
                return
            if parts[:2] == ["api", "queue"] and len(parts) == 4 and parts[3] == "clear":
                count = clear_channel_queue(int(parts[2]))
                add_log("Cleared queue.", channel_id=int(parts[2]), level="warning")
                json_response(self, {"ok": True, "count": count})
                return
            if parts[:2] == ["api", "channels"] and len(parts) == 3:
                serial = current_license_serial()
                execute("DELETE FROM channels WHERE id = ?", (int(parts[2]),))
                if serial:
                    sync_license_channels_to_firestore_async(serial)
                json_response(self, {"ok": True})
                return
            if parts[:2] == ["api", "videos"] and len(parts) == 3:
                result = delete_video_record(int(parts[2]))
                add_log(
                    f"Deleted video {parts[2]}{' and file' if result.get('deleted_file') else ''}.",
                    level="warning",
                )
                json_response(self, {"ok": True, **result})
                return
            if parts[:2] == ["api", "queue"] and len(parts) == 3:
                result = remove_queue_item(int(parts[2]))
                channel_id = result.get("channel_id")
                add_log(f"Removed queue item {parts[2]}.", channel_id=channel_id, level="warning")
                json_response(self, {"ok": True, **result})
                return
            json_response(self, {"ok": False, "error": "Unknown route"}, 404)
        except Exception as exc:
            json_response(self, {"ok": False, "error": str(exc)}, 500)

    def serve_static(self, request_path):
        # Login removed: "/" opens the app directly, and /login is redirected to it
        # so old shortcuts and the desktop shell's saved URL still land somewhere real.
        route_map = {
            "": "/index.html",
            "/": "/index.html",
            "/app": "/index.html",
        }
        if request_path in {"/login", "/login.html"}:
            self.send_response(302)
            self.send_header("Location", "/app")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        path = route_map.get(request_path, request_path)
        file_path = (UI_DIR / path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(UI_DIR.resolve())) or not file_path.exists():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        # UI files are edited in place while the app runs; without this, browsers can
        # cache app.js/index.html/style.css indefinitely and keep serving a stale UI
        # after a fix even on a normal refresh.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def serve_video_media(self, request_path):
        parts = request_path.strip("/").split("/")
        if len(parts) != 4:
            self.send_error(404)
            return
        try:
            video_id = int(parts[2])
        except ValueError:
            self.send_error(404)
            return
        rows = query_all("SELECT file_path FROM videos WHERE id = ? AND status != 'deleted'", (video_id,))
        if not rows:
            self.send_error(404)
            return
        file_path = Path(rows[0]["file_path"])
        if not file_path.exists():
            self.send_error(404)
            return
        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "video/mp4"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def serve_video_thumb(self, request_path):
        parts = request_path.strip("/").split("/")
        if len(parts) != 4:
            self.send_error(404)
            return
        try:
            video_id = int(parts[2])
        except ValueError:
            self.send_error(404)
            return
        rows = query_all("SELECT file_path FROM videos WHERE id = ? AND status != 'deleted'", (video_id,))
        if not rows:
            self.send_error(404)
            return
        thumb_path = generate_video_thumbnail(video_id, rows[0]["file_path"])
        if thumb_path and thumb_path.is_file():
            data = thumb_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        svg = thumbnail_svg(video_id)
        if svg is None:
            self.send_error(404)
            return
        data = svg.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    db_init()
    cleanup_expired_bin_videos()
    ensure_scheduler_started()
    ensure_auto_random_started()
    ai_studio_server.ensure_ai_studio_server_started()
    gtpro_server.ensure_gtpro_server_started()
    host = "127.0.0.1"
    port = int(os.environ.get("AUTOPOST_PORT", "3300"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"AutoPost Manager running at http://{host}:{port}")
    print(f"Upload inbox: {UPLOAD_DIR}")
    try:
        server.serve_forever()
    finally:
        ai_studio_server.stop_ai_studio_server()


if __name__ == "__main__":
    main()
