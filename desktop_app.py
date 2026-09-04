import os
import subprocess
import sys
import threading
import time
import ctypes
import urllib.error
import urllib.request
from ctypes import wintypes
from http.server import ThreadingHTTPServer
from pathlib import Path

import server


APP_HOST = "127.0.0.1"
APP_PORT = int(os.environ.get("AUTOPOST_PORT", "3300"))
APP_URL = f"http://{APP_HOST}:{APP_PORT}"
DESKTOP_URL = f"{APP_URL}/app?desktop=1&nativebar=1"
HEALTH_URL = f"{APP_URL}/api/health"
DEFAULT_WINDOW_WIDTH = 1220
DEFAULT_WINDOW_HEIGHT = 720
MIN_WINDOW_WIDTH = 900
MIN_WINDOW_HEIGHT = 640
LOGIN_ASPECT_WIDTH = 9
LOGIN_ASPECT_HEIGHT = 16
LOGIN_MAX_HEIGHT = 800
LOGIN_MIN_WIDTH = 360
LOGIN_MIN_HEIGHT = 640


def hidden_subprocess_kwargs():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


# The pywebview window, deliberately NOT stored on DesktopApi.
#
# pywebview walks the public attributes of whatever is passed as `js_api` to
# build the JS-side proxy. Holding the Window there made it walk into
# window.native.AccessibilityObject.Bounds.Empty.Empty.Empty… — a WinForms
# property that returns itself forever — and it died with "maximum recursion
# depth exceeded" while the GUI thread sat blocked, which is the hang that
# looked like "the app opens then freezes and nothing is clickable".
_window = None


class DesktopApi:
    def __init__(self):
        _window = None
        self.maximized = False
        self.restore_bounds = None
        self.program_mode = False

    def close(self):
        if _window:
            _window.destroy()

    def minimize(self):
        if _window:
            _window.minimize()

    def open_program(self):
        if not _window or self.program_mode:
            return True
        from webview.window import FixPoint

        work_x, work_y, work_width, work_height = get_work_area()
        width = max(MIN_WINDOW_WIDTH, min(DEFAULT_WINDOW_WIDTH, work_width - 48))
        height = max(MIN_WINDOW_HEIGHT, min(DEFAULT_WINDOW_HEIGHT, work_height - 48))
        _window.resize(width, height, fix_point=FixPoint.NORTH | FixPoint.WEST)
        _window.move(
            work_x + max(0, (work_width - width) // 2),
            work_y + max(0, (work_height - height) // 2),
        )
        self.program_mode = True
        self.maximized = False
        self.restore_bounds = None
        return True

    def open_login(self):
        if not _window:
            return True
        from webview.window import FixPoint

        work_x, work_y, work_width, work_height = get_work_area()
        height = max(LOGIN_MIN_HEIGHT, min(LOGIN_MAX_HEIGHT, work_height - 48))
        width = max(LOGIN_MIN_WIDTH, round(height * LOGIN_ASPECT_WIDTH / LOGIN_ASPECT_HEIGHT))
        width = min(width, work_width - 48)
        _window.resize(width, height, fix_point=FixPoint.NORTH | FixPoint.WEST)
        _window.move(
            work_x + max(0, (work_width - width) // 2),
            work_y + max(0, (work_height - height) // 2),
        )
        self.program_mode = False
        self.maximized = False
        self.restore_bounds = None
        return True

    def toggle_maximize(self):
        from webview.window import FixPoint

        if not _window:
            return
        if self.maximized:
            bounds = self.restore_bounds
            if bounds:
                x, y, width, height = bounds
                _window.move(x, y)
                _window.resize(width, height, fix_point=FixPoint.NORTH | FixPoint.WEST)
            self.maximized = False
        else:
            self.restore_bounds = (
                int(_window.x or 0),
                int(_window.y or 0),
                int(_window.width or DEFAULT_WINDOW_WIDTH),
                int(_window.height or DEFAULT_WINDOW_HEIGHT),
            )
            work_x, work_y, work_width, work_height = get_work_area()
            _window.move(work_x, work_y)
            _window.resize(work_width, work_height, fix_point=FixPoint.NORTH | FixPoint.WEST)
            self.maximized = True

    def resize_from_edge(self, edge, delta_x, delta_y):
        from webview.window import FixPoint

        if not _window or self.maximized:
            return
        edge = str(edge or "")
        dx = int(delta_x or 0)
        dy = int(delta_y or 0)
        width = int(_window.width or DEFAULT_WINDOW_WIDTH)
        height = int(_window.height or DEFAULT_WINDOW_HEIGHT)

        next_width = width
        next_height = height
        if "e" in edge:
            next_width = width + dx
        elif "w" in edge:
            next_width = width - dx
        if "s" in edge:
            next_height = height + dy
        elif "n" in edge:
            next_height = height - dy

        next_width = max(MIN_WINDOW_WIDTH, next_width)
        next_height = max(MIN_WINDOW_HEIGHT, next_height)
        fix_point = FixPoint.EAST if "w" in edge else FixPoint.WEST
        fix_point |= FixPoint.SOUTH if "n" in edge else FixPoint.NORTH
        _window.resize(next_width, next_height, fix_point=fix_point)


def get_work_area():
    rect = wintypes.RECT()
    SPI_GETWORKAREA = 0x0030
    ok = ctypes.windll.user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0)
    if not ok:
        return (0, 0, DEFAULT_WINDOW_WIDTH, 720)
    return (rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)


def find_browser():
    candidates = [
        os.environ.get("AUTOPOST_BROWSER"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def server_health_ok(timeout=0.8):
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def wait_for_server_ready(timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if server_health_ok(timeout=0.6):
            return True
        time.sleep(0.2)
    return False


def start_side_servers():
    """Warm up AI Studio and GT Pro off the launch path. Failures are logged and
    left alone: the on-demand start in server.py retries when a request needs
    them, and reporting here would only be noise on a machine that never opens
    those tabs."""
    for label, start in (
        ("AI Studio", server.ai_studio_server.ensure_ai_studio_server_started),
        ("GT Pro", server.gtpro_server.ensure_gtpro_server_started),
    ):
        try:
            start()
        except Exception as exc:  # noqa: BLE001 - background warm-up must not kill the app
            print(f"{label} did not start yet: {exc}", file=sys.stderr)


def start_server():
    if server.port_is_open(APP_HOST, APP_PORT, timeout=0.4):
        if server_health_ok(timeout=0.8):
            return None
        raise RuntimeError(
            f"Port {APP_PORT} is already open, but TikTok Manager Pro is not responding. "
            "Close the old process or change AUTOPOST_PORT."
        )
    server.db_init()
    server.ensure_scheduler_started()
    server.ensure_auto_random_started()
    # The AI Studio and GT Pro side servers each spawn a process and then POLL
    # for it to answer — ai_studio waits up to 15s on its own. Doing that here
    # held up the whole launch before a single pixel was drawn, which is what
    # made the app look frozen on startup. Neither is needed to render the UI,
    # and server.py starts whichever one a request actually needs
    # (ensure_ai_studio_server_started is idempotent and lock-guarded), so they
    # warm up in the background instead.
    threading.Thread(target=start_side_servers, daemon=True).start()
    httpd = ThreadingHTTPServer((APP_HOST, APP_PORT), server.Handler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    if not wait_for_server_ready():
        httpd.shutdown()
        raise RuntimeError("Server started but did not become ready in time.")
    return httpd


def open_app_window():
    try:
        import webview

        api = DesktopApi()
        # Open filling the screen. This used to size itself from the LOGIN_*
        # constants — a 9:16 portrait window sized for the login card — which is
        # why the app kept opening as a narrow strip long after login was removed
        # (open_program(), the only thing that resized it afterwards, is called
        # from ui/login.js and no longer runs).
        window_x, window_y, window_width, window_height = get_work_area()
        api.program_mode = True
        api.maximized = True
        # What the maximize button restores DOWN to on its first press.
        api.restore_bounds = (
            window_x + max(0, (window_width - DEFAULT_WINDOW_WIDTH) // 2),
            window_y + max(0, (window_height - DEFAULT_WINDOW_HEIGHT) // 2),
            min(DEFAULT_WINDOW_WIDTH, window_width),
            min(DEFAULT_WINDOW_HEIGHT, window_height),
        )
        window = webview.create_window(
            "TikTok Manager Pro",
            DESKTOP_URL,
            width=window_width,
            height=window_height,
            x=window_x,
            y=window_y,
            min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
            resizable=True,
            frameless=False,
            easy_drag=True,
            js_api=api,
            background_color="#f8fafc",
        )
        globals()["_window"] = window
        webview.start(debug=False, gui="edgechromium")
        return None
    except Exception as exc:
        print(f"pywebview unavailable, falling back to browser app mode: {exc}", file=sys.stderr)

    browser = find_browser()
    if not browser:
        raise RuntimeError("Microsoft Edge or Google Chrome was not found.")
    user_data_dir = server.BASE_DIR / ".desktop-browser"
    user_data_dir.mkdir(parents=True, exist_ok=True)
    args = [
        browser,
        f"--app={DESKTOP_URL}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--disable-background-mode",
        "--window-size=450,800",
    ]
    return subprocess.Popen(args, cwd=str(server.BASE_DIR), **hidden_subprocess_kwargs())


def main():
    os.chdir(server.BASE_DIR)
    httpd = start_server()
    proc = open_app_window()
    try:
        if proc:
            proc.wait()
    finally:
        if httpd:
            httpd.shutdown()
        server.ai_studio_server.stop_ai_studio_server()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"TikTok Manager Pro failed to start: {exc}", file=sys.stderr)
        input("Press Enter to exit...")
