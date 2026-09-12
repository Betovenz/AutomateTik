import uiautomator2 as u2
import base64
import json
import os
import re
import sys
import subprocess
import time
import random
import unicodedata

for stream_name in ("stdout", "stderr"):
    stream = getattr(sys, stream_name, None)
    if stream and hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TASKS_FILE = os.environ.get("AUTOPOST_TASKS_FILE", "tasks.json")
ADB_SERIAL = os.environ.get("ADB_SERIAL", "").strip()
AUTOPOST_CAPTION = os.environ.get("AUTOPOST_CAPTION", "")
AUTOPOST_PRODUCT_NAME = os.environ.get("AUTOPOST_PRODUCT_NAME", "")
AUTOPOST_VIDEO_NAME = os.environ.get("AUTOPOST_VIDEO_NAME", "")
AUTOPOST_PRODUCT_ID = os.environ.get("AUTOPOST_PRODUCT_ID", "").strip()
AUTOPOST_SPEED = os.environ.get("AUTOPOST_SPEED", "normal").strip().lower()
CAPTION_FILE = os.environ.get("AUTOPOST_CAPTION_FILE", os.path.join(BASE_DIR, "caption", "caption.txt"))
ADD_TEXT = "\u0e40\u0e1e\u0e34\u0e48\u0e21"
CONFIRM_TEXT = "\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19"
MAX_STEP_ATTEMPTS = 3
MAX_APP_RESTARTS = 3
TIKTOK_PACKAGE = "com.ss.android.ugc.trill"
EXTRA_RANDOM_HASHTAGS = [
    "#สินค้าขายดี",
    "#ของมันต้องมี",
    "#ของดีบอกต่อ",
    "#TikTokShopTH",
    "#ฮิตติดเทรนด์",
    "#ปักตะกร้า",
    "#tiktokshop",
    "#รีวิวของดี",
    "#ป้ายยา",
    "#รีวิวสินค้า",
    "#รีวิวของใช้",
    "#ของใช้ในบ้าน",
    "#ของน่าซื้อ",
    "#ขายดี",
    "#โปรเด็ด",
    "#ราคาดี",
    "#ของถูกและดี",
    "#ช้อปเพลิน",
    "#สายช้อป",
    "#แม่ค้าออนไลน์",
    "#พร้อมส่ง",
    "#ของฮิตติดกระแส",
    "#ใช้ดีบอกต่อ",
]
_CAPTION_LIBRARY_CACHE = None
_OCR_READER_CACHE = None
LAST_ANCHOR_PRODUCT_TEXT = ""


def log(message):
    safe_message = str(message).encode("utf-8", errors="replace").decode("utf-8")
    print(safe_message, flush=True)


def human_pause(base=1.0, spread=0.8):
    if AUTOPOST_SPEED == "fast":
        factor = 0.6
    elif AUTOPOST_SPEED == "normal":
        factor = 1.0
    else:
        factor = 1.7
    delay = max(0.25, (base + random.uniform(0, spread)) * factor)
    time.sleep(delay)


def load_caption_library():
    global _CAPTION_LIBRARY_CACHE
    if _CAPTION_LIBRARY_CACHE is not None:
        return _CAPTION_LIBRARY_CACHE
    captions = []
    try:
        with open(CAPTION_FILE, "r", encoding="utf-8") as f:
            raw = f.read()
        for match in re.finditer(r'"((?:\\.|[^"\\])*)"', raw):
            try:
                text = json.loads(f'"{match.group(1)}"').strip()
            except json.JSONDecodeError:
                text = match.group(1).strip()
            if text:
                captions.append(text)
    except OSError as exc:
        log(f"Caption library unavailable: {exc}")
    _CAPTION_LIBRARY_CACHE = captions
    log(f"Caption library loaded: {len(captions)} caption(s)")
    return captions


def product_hashtags(product_name, count=3):
    tokens = re.findall(r"[0-9A-Za-z\u0E00-\u0E7F]+", product_name or "")
    clean = []
    seen = set()
    blocked = {"mp4", "mov", "webm", "m4v", "the", "and", "for", "with"}
    for token in tokens:
        token = token.strip("_-")
        if not token or token.lower() in blocked:
            continue
        if len(token) < 2 and not re.search(r"\d", token):
            continue
        key = token.lower()
        if key in seen:
            continue
        seen.add(key)
        clean.append(token)

    if len(clean) < count:
        compact = re.sub(r"[^0-9A-Za-z\u0E00-\u0E7F]+", "", product_name or "")
        if compact and compact.lower() not in seen:
            clean.append(compact[:30])

    random.shuffle(clean)
    return [f"#{token[:32]}" for token in clean[:count]]


def strip_symbol_characters(text):
    cleaned = "".join(
        ch if (ch.isspace() or unicodedata.category(ch)[0] in {"L", "N", "M"}) else " "
        for ch in text or ""
    )
    return re.sub(r"\s+", " ", cleaned).strip()


def sanitize_textbox_before_enter(textbox, fallback_text=""):
    global LAST_ANCHOR_PRODUCT_TEXT
    copied_text = textbox.text().strip()
    if not copied_text:
        copied_text = str(fallback_text or "").strip()

    clean_text = strip_symbol_characters(copied_text)
    LAST_ANCHOR_PRODUCT_TEXT = clean_text or copied_text
    if LAST_ANCHOR_PRODUCT_TEXT:
        log(f"STEP 11: copied product text for caption hashtag: {LAST_ANCHOR_PRODUCT_TEXT}")
    if clean_text == copied_text:
        log("Text box clean: no symbol characters found")
        return copied_text

    log("Text box contains symbol characters. Copied text and rewriting clean text before Enter")
    textbox.clear()
    human_pause(0.4, 0.4)
    textbox.send_keys(clean_text)
    human_pause(0.5, 0.5)
    return clean_text


def build_auto_caption(product_name, fallback_caption="", anchor_product_text=""):
    library = load_caption_library()
    base = random.choice(library) if library else (fallback_caption or "")
    anchor_tags = product_hashtags(anchor_product_text, 2)
    tag_count = min(3, len(EXTRA_RANDOM_HASHTAGS))
    tags = anchor_tags + random.sample(EXTRA_RANDOM_HASHTAGS, tag_count)
    caption = " ".join(part for part in [base.strip(), " ".join(tags)] if part).strip()
    return caption


def adb_base_args():
    args = ["adb"]
    if ADB_SERIAL:
        args.extend(["-s", ADB_SERIAL])
    return args


def hidden_subprocess_kwargs():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def adb_run(args):
    subprocess.run(adb_base_args() + args, check=False, **hidden_subprocess_kwargs())


def adb_run_capture(args):
    return subprocess.run(
        adb_base_args() + args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        **hidden_subprocess_kwargs(),
    )


def adb_keyboard_ready():
    ime_id = "com.github.uiautomator/.AdbKeyboard"
    list_proc = adb_run_capture(["shell", "ime", "list", "-s"])
    if ime_id not in (list_proc.stdout or ""):
        raise RuntimeError(f"ADB keyboard is not installed: {ime_id}")

    adb_run(["shell", "ime", "enable", ime_id])
    adb_run(["shell", "ime", "set", ime_id])
    adb_run(["shell", "settings", "put", "secure", "default_input_method", ime_id])
    human_pause(0.3, 0.2)


def adb_keyboard_broadcast(action, extras=None):
    args = ["shell", "am", "broadcast", "-a", action]
    for key, value in (extras or {}).items():
        args.extend(["--es", key, str(value)])
    proc = adb_run_capture(args)
    output = f"{proc.stdout or ''}{proc.stderr or ''}"
    if proc.returncode != 0 or "result=-1" not in output:
        raise RuntimeError(f"{action} failed: {output.strip()}")
    return output


def paste_text_by_adb_keyboard(text):
    adb_keyboard_ready()
    adb_keyboard_broadcast("ADB_KEYBOARD_CLEAR_TEXT")
    encoded_text = base64.b64encode(str(text).encode("utf-8")).decode("ascii")
    adb_keyboard_broadcast("ADB_KEYBOARD_INPUT_TEXT", {"text": encoded_text})


def paste_text_by_android_clipboard(text):
    value = re.sub(r"\s+", " ", str(text)).strip()
    proc = adb_run_capture(["shell", "cmd", "clipboard", "set", "text", value])
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "cmd clipboard set failed").strip()
        raise RuntimeError(detail)
    human_pause(0.25, 0.15)
    adb_run(["shell", "input", "keyevent", "KEYCODE_PASTE"])


def paste_text_by_fastinput(text):
    device = u2.connect(ADB_SERIAL or None)
    device.set_fastinput_ime(True)
    device.clear_text()
    device.send_keys(str(text))


def adb_back():
    adb_run(["shell", "input", "keyevent", "KEYCODE_BACK"])
    human_pause(1.0, 0.8)


def force_stop_app(package=TIKTOK_PACKAGE):
    log(f"Force stopping app: {package}")
    adb_run(["shell", "am", "force-stop", package])
    human_pause(1.5, 1.0)


def set_device_network(enabled):
    state = "enable" if enabled else "disable"
    label = "เปิด" if enabled else "ปิด"
    log(f"{label}เน็ตด้วย ADB ก่อนทำงานต่อ")
    for service in ("wifi", "data"):
        try:
            adb_run(["shell", "svc", service, state])
        except Exception as exc:
            log(f"Network {service} {state} warning: {exc}")
    human_pause(1.0, 0.5)


def wait_for_device_internet(timeout=20):
    log("ตรวจสอบว่าเน็ตมือถือเชื่อมต่อแล้ว")
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        try:
            adb_run(["shell", "ping", "-c", "1", "-W", "2", "8.8.8.8"])
            log("Internet ready")
            return True
        except Exception as exc:
            last_error = str(exc)
            time.sleep(2)
    raise RuntimeError(f"เปิดเน็ตแล้วแต่ยังเชื่อมต่อไม่ได้: {last_error}")


def wake_unlock_to_home(driver):
    log("Preparing device before STEP 1: wake, unlock, and go Home")
    adb_run(["shell", "input", "keyevent", "KEYCODE_WAKEUP"])
    human_pause(0.8, 0.4)
    adb_run(["shell", "wm", "dismiss-keyguard"])
    human_pause(0.5, 0.3)

    try:
        size = driver.get_window_size()
        screen_w = size["width"]
        screen_h = size["height"]
    except Exception:
        screen_w, screen_h = 1080, 2400

    adb_run([
        "shell",
        "input",
        "swipe",
        str(screen_w // 2),
        str(int(screen_h * 0.82)),
        str(screen_w // 2),
        str(int(screen_h * 0.28)),
        "450",
    ])
    human_pause(0.8, 0.4)
    adb_run(["shell", "input", "keyevent", "KEYCODE_HOME"])
    human_pause(1.0, 0.4)


def adb_tap_rect(rect):
    """Tap center of an element using its runtime rect. No fixed coordinate."""
    x = int(rect["x"] + rect["width"] / 2)
    y = int(rect["y"] + rect["height"] / 2)
    human_pause(0.25, 0.45)
    adb_run(["shell", "input", "tap", str(x), str(y)])
    human_pause(0.65, 0.75)


def normalize_ocr_text(value):
    return re.sub(r"\s+", "", str(value or "")).strip()


def ocr_reader():
    global _OCR_READER_CACHE
    if _OCR_READER_CACHE is None:
        try:
            import easyocr
        except ImportError as exc:
            raise RuntimeError("easyocr is not installed; run install.bat first") from exc
        log("OCR loading model for the first time...")
        _OCR_READER_CACHE = easyocr.Reader(["th", "en"], gpu=False, verbose=False)
        log("OCR model ready")
    return _OCR_READER_CACHE


def crop_ocr_image(image, region):
    if not region:
        return image, 0, 0
    screen_w, screen_h = image.size
    left = max(0, min(screen_w, int(screen_w * region[0])))
    top = max(0, min(screen_h, int(screen_h * region[1])))
    right = max(left + 1, min(screen_w, int(screen_w * region[2])))
    bottom = max(top + 1, min(screen_h, int(screen_h * region[3])))
    return image.crop((left, top, right, bottom)), left, top


def tap_text_by_ocr(driver, targets, timeout=12, region=None):
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("numpy is not installed; run install.bat first") from exc

    normalized_targets = [normalize_ocr_text(target) for target in targets if target]
    deadline = time.time() + timeout
    last_seen = []

    while time.time() < deadline:
        image = driver.device.screenshot()
        ocr_image, offset_x, offset_y = crop_ocr_image(image, region)
        if not last_seen:
            log(f"OCR reading screenshot for {targets}")
        results = ocr_reader().readtext(np.array(ocr_image))
        last_seen = []
        for box, text, confidence in results:
            normalized = normalize_ocr_text(text)
            if normalized:
                last_seen.append(normalized)
            if not any(target in normalized for target in normalized_targets):
                continue
            xs = [int(point[0]) for point in box]
            ys = [int(point[1]) for point in box]
            x = offset_x + sum(xs) // len(xs)
            y = offset_y + sum(ys) // len(ys)
            log(f"OCR found {text!r} confidence={confidence:.2f}; tapping center")
            adb_run(["shell", "input", "tap", str(x), str(y)])
            human_pause(0.7, 0.5)
            return True
        human_pause(0.6, 0.4)

    raise RuntimeError(f"OCR could not find {targets}; seen={last_seen[:20]}")


def tap_first_text_by_ocr(driver, targets, timeout=8, region=None, exact=False):
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("numpy is not installed; run install.bat first") from exc

    normalized_targets = [normalize_ocr_text(target) for target in targets if target]
    deadline = time.time() + timeout
    last_seen = []

    while time.time() < deadline:
        image = driver.device.screenshot()
        ocr_image, offset_x, offset_y = crop_ocr_image(image, region)
        if not last_seen:
            log(f"OCR reading screenshot for first {targets}")
        results = ocr_reader().readtext(np.array(ocr_image))
        matches = []
        last_seen = []
        for box, text, confidence in results:
            normalized = normalize_ocr_text(text)
            if normalized:
                last_seen.append(normalized)
            if exact:
                is_match = any(target == normalized for target in normalized_targets)
            else:
                is_match = any(target in normalized for target in normalized_targets)
            if not is_match:
                continue
            xs = [int(point[0]) for point in box]
            ys = [int(point[1]) for point in box]
            x = offset_x + sum(xs) // len(xs)
            y = offset_y + sum(ys) // len(ys)
            matches.append((offset_y + min(ys), offset_x + min(xs), x, y, text, confidence))
        if matches:
            _, _, x, y, text, confidence = sorted(matches, key=lambda item: (item[0], item[1]))[0]
            log(f"OCR found first {text!r} confidence={confidence:.2f}; tapping center")
            adb_run(["shell", "input", "tap", str(x), str(y)])
            human_pause(0.7, 0.5)
            return True
        human_pause(0.6, 0.4)

    raise RuntimeError(f"OCR could not find first {targets}; seen={last_seen[:20]}")


def adb_swipe_up_random(driver):
    size = driver.get_window_size()
    screen_w = size["width"]
    screen_h = size["height"]

    x = screen_w // 2
    start_y = int(screen_h * 0.78)
    end_y = int(screen_h * 0.24)
    adb_run([
        "shell",
        "input",
        "swipe",
        str(x + random.randint(-80, 80)),
        str(start_y + random.randint(-80, 80)),
        str(x + random.randint(-80, 80)),
        str(end_y + random.randint(-80, 80)),
        str(random.randint(350, 850)),
    ])


def rect_center(rect):
    return (
        rect["x"] + rect["width"] / 2,
        rect["y"] + rect["height"] / 2,
    )


class By:
    ACCESSIBILITY_ID = "accessibility_id"
    ANDROID_UIAUTOMATOR = "android_uiautomator"
    CLASS_NAME = "class_name"
    XPATH = "xpath"


class WebDriverWait:
    def __init__(self, driver, timeout):
        self.driver = driver
        self.timeout = timeout

    def until(self, predicate):
        end_time = time.time() + self.timeout
        last_error = None
        while time.time() < end_time:
            try:
                value = predicate(self.driver)
                if value:
                    return value
            except Exception as exc:
                last_error = exc
            time.sleep(0.5)
        raise RuntimeError(f"wait timeout after {self.timeout}s: {last_error or predicate}")


def rect_from_bounds(bounds):
    if isinstance(bounds, str):
        nums = [int(value) for value in re.findall(r"\d+", bounds)]
        if len(nums) >= 4:
            bounds = nums[:4]
    if isinstance(bounds, dict):
        left = int(bounds.get("left", bounds.get("x", 0)))
        top = int(bounds.get("top", bounds.get("y", 0)))
        right = int(bounds.get("right", left + bounds.get("width", 0)))
        bottom = int(bounds.get("bottom", top + bounds.get("height", 0)))
    else:
        left, top, right, bottom = [int(value) for value in bounds]
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


class U2Element:
    def __init__(self, raw, driver):
        self.raw = raw
        self.driver = driver

    @property
    def rect(self):
        info = self.info
        bounds = info.get("bounds") or getattr(self.raw, "bounds", None)
        return rect_from_bounds(bounds or (0, 0, 0, 0))

    @property
    def info(self):
        value = getattr(self.raw, "info", {})
        if callable(value):
            value = value()
        if not isinstance(value, dict):
            value = {}
        attrib = getattr(self.raw, "attrib", None)
        if isinstance(attrib, dict):
            value = {**attrib, **value}
        return value

    def get_attribute(self, name):
        info = self.info
        if name == "clickable":
            return str(info.get("clickable", False)).lower()
        if name == "enabled":
            return str(info.get("enabled", True)).lower()
        if name in ("content-desc", "description"):
            return info.get("contentDescription") or info.get("content-desc") or info.get("contentDescription".lower()) or ""
        return info.get(name, "")

    def text(self):
        info_text = self.info.get("text")
        if info_text:
            return str(info_text)
        try:
            value = self.raw.get_text()
            return "" if value is None else str(value)
        except Exception:
            return ""

    def find_elements(self, by, value):
        own = self.rect
        found = []
        for el in self.driver.find_elements(by, value):
            rect = el.rect
            inside = (
                rect["x"] >= own["x"]
                and rect["y"] >= own["y"]
                and rect["x"] + rect["width"] <= own["x"] + own["width"]
                and rect["y"] + rect["height"] <= own["y"] + own["height"]
            )
            if inside:
                found.append(el)
        return found

    def clear(self):
        adb_tap_rect(self.rect)
        human_pause(0.2, 0.2)
        try:
            self.driver.device.clear_text()
            return
        except Exception:
            pass
        try:
            self.raw.clear_text()
            return
        except Exception:
            pass
        adb_run(["shell", "input", "keyevent", "KEYCODE_CTRL_A"])
        adb_run(["shell", "input", "keyevent", "KEYCODE_DEL"])

    def send_keys(self, text):
        adb_tap_rect(self.rect)
        human_pause(0.2, 0.2)

        try:
            focused = self.driver.device(focused=True)
            if focused.exists:
                focused.set_text(str(text))
                return
        except Exception as exc:
            log(f"Focused uiautomator text input failed, fallback to Android clipboard: {exc}")

        try:
            paste_text_by_android_clipboard(text)
            return
        except Exception as exc:
            log(f"Android clipboard paste failed, fallback to raw.set_text: {exc}")

        try:
            self.raw.set_text(str(text))
            return
        except Exception as exc:
            log(f"raw.set_text failed, fallback to adb input text: {exc}")

        safe_text = str(text).replace(" ", "%s")
        adb_run(["shell", "input", "text", safe_text])

class U2Driver:
    def __init__(self):
        self.device = u2.connect(ADB_SERIAL) if ADB_SERIAL else u2.connect()
        self.device.implicitly_wait(0)

    def activate_app(self, package):
        self.device.app_start(package, use_monkey=True)

    def get_window_size(self):
        width, height = self.device.window_size()
        return {"width": width, "height": height}

    def find_element(self, by, value):
        elements = self.find_elements(by, value)
        if not elements:
            raise RuntimeError(f"element not found: {by}={value}")
        return elements[0]

    def find_elements(self, by, value):
        if by == By.XPATH:
            try:
                return [U2Element(el, self) for el in self.device.xpath(value).all()]
            except Exception:
                return []
        if by == By.ACCESSIBILITY_ID:
            obj = self.device(description=value)
            return [U2Element(obj, self)] if obj.exists else []
        if by == By.CLASS_NAME:
            obj = self.device(className=value)
            count = obj.count() if callable(obj.count) else obj.count
            return [U2Element(obj[index], self) for index in range(count)]
        if by == By.ANDROID_UIAUTOMATOR:
            parsed = parse_ui_selector(value)
            obj = self.device(**parsed) if parsed else None
            if not obj:
                return []
            count = obj.count() if callable(obj.count) else obj.count
            return [U2Element(obj[index], self) for index in range(count)]
        return []

    def quit(self):
        return None


def parse_ui_selector(selector):
    parsed = {}
    class_match = re.search(r'className\("([^"]+)"\)', selector)
    text_contains_match = re.search(r'textContains\("([^"]+)"\)', selector)
    text_match = re.search(r'text\("([^"]+)"\)', selector)
    if class_match:
        parsed["className"] = class_match.group(1)
    if text_contains_match:
        parsed["textContains"] = text_contains_match.group(1)
    elif text_match:
        parsed["text"] = text_match.group(1)
    return parsed


def start_driver():
    return U2Driver()
# loding
def is_product_loading(driver):
    try:
        loaders = driver.find_elements(
            By.XPATH,
            '//android.view.ViewGroup'
            '/android.widget.ScrollView'
            '/android.widget.HorizontalScrollView'
            '/android.widget.LinearLayout'
            '/android.widget.ImageView'
        )
        return len(loaders) > 0
    except Exception:
        return False


def wait_until_not_loading(driver, timeout=30):
    end_time = time.time() + timeout

    while time.time() < end_time:
        if not is_product_loading(driver):
            return True

        log("กำลังโหลดสินค้า... รอ")
        time.sleep(1)

    raise RuntimeError("รอ loading นานเกินไป")

# STEP 1
def open_app(driver, package):
    wake_unlock_to_home(driver)
    set_device_network(True)
    wait_for_device_internet()
    log(f"Force stopping app before STEP 1: {package}")
    force_stop_app(package)
    human_pause(1.0, 0.4)
    driver.activate_app(package)


# STEP 2
def tap_create_button(driver):
    wait = WebDriverWait(driver, 15)

    def find_create(d):
        for by, value in [
            (By.ACCESSIBILITY_ID, "สร้าง"),
            (By.XPATH, '//*[contains(@content-desc, "สร้าง") or contains(@text, "สร้าง")]'),
        ]:
            elements = d.find_elements(by, value)
            if elements:
                return elements[0]

        screen = d.get_window_size()
        screen_w = screen["width"]
        screen_h = screen["height"]
        candidates = []
        for el in d.find_elements(By.CLASS_NAME, "android.widget.FrameLayout"):
            try:
                rect = el.rect
                cx = rect["x"] + rect["width"] / 2
                cy = rect["y"] + rect["height"] / 2
                if screen_w * 0.35 <= cx <= screen_w * 0.65 and cy > screen_h * 0.72:
                    candidates.append((abs(cx - screen_w / 2), -cy, el))
            except Exception:
                continue
        if candidates:
            return sorted(candidates, key=lambda item: (item[0], item[1]))[0][2]
        return None

    create_button = wait.until(find_create)

    adb_tap_rect(create_button.rect)


# STEP 3
def tap_upload_button(driver):
    wait = WebDriverWait(driver, 15)

    # Wait for the record screen by checking a stable semantic button.
    wait.until(lambda d: d.find_element(
        By.ACCESSIBILITY_ID,
        "เพิ่มเสียง"
    ))

    screen = driver.get_window_size()
    screen_w = screen["width"]
    screen_h = screen["height"]

    elements = driver.find_elements(
        By.CLASS_NAME,
        "android.widget.FrameLayout"
    )

    candidates = []

    for el in elements:
        try:
            if el.get_attribute("clickable") != "true":
                continue

            rect = el.rect
            cx = rect["x"] + rect["width"] / 2
            cy = rect["y"] + rect["height"] / 2

            # relative rule, not fixed coordinate:
            # Upload is in the lower-left zone of the record screen.
            if cx < screen_w * 0.35 and cy > screen_h * 0.70:
                candidates.append((cy - cx, el))

        except Exception:
            continue

    if not candidates:
        raise RuntimeError("ไม่พบปุ่ม upload แบบไม่ใช้ id/dump/coordinate")

    upload_button = sorted(candidates, key=lambda x: x[0], reverse=True)[0][1]
    adb_tap_rect(upload_button.rect)
#4
def tap_first_media_select_button(driver):
    wait = WebDriverWait(driver, 15)

    # Wait for the gallery screen by using semantic text.
    wait.until(lambda d: d.find_element(
        By.ACCESSIBILITY_ID,
        "ทั้งหมด"
    ))

    screen = driver.get_window_size()
    screen_w = screen["width"]
    screen_h = screen["height"]

    tiles = driver.find_elements(
        By.CLASS_NAME,
        "android.widget.FrameLayout"
    )

    candidates = []

    for tile in tiles:
        try:
            if tile.get_attribute("clickable") != "true":
                continue

            rect = tile.rect

            # The first media tile is in the gallery grid, below the tabs and above the bottom bar.
            if rect["y"] < screen_h * 0.15:
                continue

            if rect["y"] > screen_h * 0.75:
                continue

            if rect["width"] < screen_w * 0.20:
                continue

            if rect["height"] < screen_h * 0.10:
                continue

            candidates.append(tile)

        except Exception:
            continue

    if not candidates:
        raise RuntimeError("ไม่พบ media tile ตัวแรก")

    # Pick the top-left tile from runtime geometry.
    first_tile = sorted(
        candidates,
        key=lambda el: (el.rect["y"], el.rect["x"])
    )[0]

    buttons = first_tile.find_elements(
        By.CLASS_NAME,
        "android.widget.Button"
    )

    if not buttons:
        raise RuntimeError("ไม่พบปุ่มเลือกใน media tile แรก")

    tile_rect = first_tile.rect
    top_right_buttons = []
    for button in buttons:
        rect = button.rect
        cx = rect["x"] + rect["width"] / 2
        cy = rect["y"] + rect["height"] / 2
        in_top_right = (
            cx >= tile_rect["x"] + tile_rect["width"] * 0.55
            and cy <= tile_rect["y"] + tile_rect["height"] * 0.45
        )
        if in_top_right:
            top_right_buttons.append(button)

    # This targets the select button in the first media tile, equivalent to the
    # provided reference XPath's Button[1], without relying on resource-id.
    select_button = sorted(
        top_right_buttons or buttons,
        key=lambda el: (el.rect["y"], -el.rect["x"])
    )[0]

    adb_tap_rect(select_button.rect)
#5
def tap_next_button(driver):
    wait = WebDriverWait(driver, 15)

    next_btn = wait.until(lambda d: d.find_element(
        By.ANDROID_UIAUTOMATOR,
        'new UiSelector().className("android.widget.Button").textContains("ถัดไป")'
    ))

    adb_tap_rect(next_btn.rect)
#6
def tap_final_next_button(driver):
    wait = WebDriverWait(driver, 15)

    next_parent = wait.until(lambda d: d.find_element(
        By.XPATH,
        '//*[@text="ถัดไป"]/ancestor::*[@clickable="true"][1]'
    ))

    adb_tap_rect(next_parent.rect)
#7
def tap_add_link_button(driver):
    wait = WebDriverWait(driver, 15)

    add_link = wait.until(lambda d: d.find_element(
        By.ACCESSIBILITY_ID,
        "เพิ่มลิงก์"
    ))

    adb_tap_rect(add_link.rect)
#8
def tap_product_link_option(driver):
    wait = WebDriverWait(driver, 4)

    try:
        product_option = wait.until(lambda d: d.find_element(
            By.XPATH,
            '//*[normalize-space(@text)="สินค้า" or normalize-space(@content-desc)="สินค้า"]/ancestor::*[@clickable="true"][1]'
        ))
        log("STEP 8: กดตัวเลือกสินค้า")
        adb_tap_rect(product_option.rect)
        return
    except Exception as exc:
        log(f"STEP 8: semantic selector unavailable, using OCR for สินค้า: {exc}")

    tap_text_by_ocr(driver, ["สินค้า"], timeout=8)
#9


def tap_second_bottom_sheet_option(driver):
    screen = driver.get_window_size()
    screen_w = screen["width"]
    screen_h = screen["height"]
    candidates = []
    seen = set()

    for class_name in ("android.view.ViewGroup", "android.widget.FrameLayout"):
        for el in driver.find_elements(By.CLASS_NAME, class_name):
            try:
                rect = el.rect
                if rect["width"] <= 0 or rect["height"] <= 0:
                    continue
                key = (rect["x"], rect["y"], rect["width"], rect["height"])
                if key in seen:
                    continue
                seen.add(key)

                cx = rect["x"] + rect["width"] / 2
                cy = rect["y"] + rect["height"] / 2
                is_sheet_row = (
                    rect["width"] >= screen_w * 0.45
                    and 42 <= rect["height"] <= screen_h * 0.18
                    and screen_h * 0.35 <= cy <= screen_h * 0.92
                    and screen_w * 0.08 <= cx <= screen_w * 0.92
                )
                if is_sheet_row:
                    candidates.append(el)
            except Exception:
                continue

    if candidates:
        rows = sorted(candidates, key=lambda el: (el.rect["y"], el.rect["x"]))
        filtered_rows = []
        last_y = None
        for row in rows:
            y = row.rect["y"]
            if last_y is not None and abs(y - last_y) < 16:
                continue
            filtered_rows.append(row)
            last_y = y
        if len(filtered_rows) >= 2:
            target = filtered_rows[1]
            log("STEP 8.7: fast layout tap marketplace row")
            adb_tap_rect(target.rect)
            return True

    # Last fast fallback: the marketplace option is the second item in this bottom sheet.
    log("STEP 8.7: fast layout row unavailable, tapping second bottom-sheet slot")
    adb_run([
        "shell",
        "input",
        "tap",
        str(screen_w // 2),
        str(int(screen_h * 0.58)),
    ])
    human_pause(0.7, 0.5)
    return True


def tap_marketplace_option(driver):
    try:
        log("STEP 8.7: waiting 8s for ตลาดสินค้า bottom sheet before lower-half OCR")
        time.sleep(8.0)
        log("STEP 8.7: using lower-half OCR to tap ตลาดสินค้า")
        tap_text_by_ocr(driver, ["ตลาดสินค้า"], timeout=10, region=(0.0, 0.5, 1.0, 1.0))
        return
    except Exception as exc:
        log(f"STEP 8.7: OCR unavailable, using selector/layout fallback for ตลาดสินค้า: {exc}")

    wait = WebDriverWait(driver, 2)
    try:
        market = wait.until(lambda d: d.find_element(
            By.XPATH,
            '//*[normalize-space(@text)="ตลาดสินค้า" or normalize-space(@content-desc)="ตลาดสินค้า"]/ancestor::*[@clickable="true"][1]'
        ))
        log("STEP 8.7: กดตลาดสินค้า")
        adb_tap_rect(market.rect)
        return
    except Exception as exc:
        log(f"STEP 8.7: semantic selector unavailable, using fast layout for ตลาดสินค้า: {exc}")

    try:
        if tap_second_bottom_sheet_option(driver):
            return
    except Exception as exc:
        log(f"STEP 8.7: fast layout unavailable, using OCR for ตลาดสินค้า: {exc}")

    raise RuntimeError("STEP 8.7: cannot tap ตลาดสินค้า by OCR, selector, or layout")


def tap_add_product_entry_before_search(driver):
    try:
        log("STEP 8.5: waiting 10s for เพิ่มสินค้า before lower-half OCR")
        time.sleep(10.0)
        log("STEP 8.5: using lower-half OCR to tap เพิ่มสินค้า")
        tap_first_text_by_ocr(
            driver,
            ["เพิ่มสินค้า", "เพิมสินค้า"],
            timeout=8,
            region=(0.0, 0.5, 1.0, 1.0),
        )
        return
    except Exception as exc:
        log(f"STEP 8.5: OCR unavailable, using selector fallback for เพิ่มสินค้า: {exc}")

    wait = WebDriverWait(driver, 3)

    def find_add_product_entry(d):
        xpaths = [
            '//*[normalize-space(@text)="เพิ่มสินค้า" or normalize-space(@content-desc)="เพิ่มสินค้า"]/ancestor::*[@clickable="true"][1]',
            '//*[contains(normalize-space(@text), "เพิ่มสินค้า") or contains(normalize-space(@content-desc), "เพิ่มสินค้า")]/ancestor::*[@clickable="true"][1]',
            '//androidx.recyclerview.widget.RecyclerView/android.widget.FrameLayout[1]/android.view.ViewGroup[1]/android.view.ViewGroup[5]/android.view.ViewGroup[1]/android.view.ViewGroup[1]/android.view.ViewGroup[1]',
        ]
        for xpath in xpaths:
            elements = d.find_elements(By.XPATH, xpath)
            if elements:
                return elements[0]
        return None

    try:
        add_product_entry = wait.until(lambda d: find_add_product_entry(d))
        log("STEP 8.5: กดเพิ่มสินค้า")
        adb_tap_rect(add_product_entry.rect)
        return
    except Exception as exc:
        raise RuntimeError(f"STEP 8.5: cannot tap เพิ่มสินค้า by OCR or selector: {exc}") from exc


def tap_product_viewpager_image(driver, keyword=None):
    wait = WebDriverWait(driver, 12)

    def find_viewpager_image(d):
        xpaths = [
            '//androidx.viewpager.widget.ViewPager/android.view.ViewGroup[1]/android.view.ViewGroup[1]/android.view.ViewGroup[1]/android.widget.ImageView[1]',
            '//androidx.viewpager.widget.ViewPager//android.widget.ImageView[1]',
        ]
        for xpath in xpaths:
            elements = d.find_elements(By.XPATH, xpath)
            if elements:
                return elements[0]

        viewpagers = d.find_elements(By.CLASS_NAME, "androidx.viewpager.widget.ViewPager")
        if not viewpagers:
            return None
        pager_rect = viewpagers[0].rect
        images = []
        for image in d.find_elements(By.CLASS_NAME, "android.widget.ImageView"):
            try:
                rect = image.rect
                if rect["width"] <= 0 or rect["height"] <= 0:
                    continue
                inside_pager = (
                    pager_rect["x"] <= rect["x"] <= pager_rect["x"] + pager_rect["width"]
                    and pager_rect["y"] <= rect["y"] <= pager_rect["y"] + pager_rect["height"]
                )
                if inside_pager:
                    images.append(image)
            except Exception:
                continue
        return sorted(images, key=lambda el: (el.rect["y"], el.rect["x"]))[0] if images else None

    image = wait.until(lambda d: find_viewpager_image(d))
    log("STEP 9: กดรูปสินค้าใน ViewPager")
    adb_tap_rect(image.rect)
    if keyword is not None:
        time.sleep(1)
        search_product_keyword(driver, keyword)


def search_product_keyword(driver, keyword):
    wait = WebDriverWait(driver, 15)

    def find_search_box(d):
        xpaths = [
            '//android.widget.EditText[@text="ค้นหาสินค้า" or @hint="ค้นหาสินค้า"]',
            '//android.widget.EditText[contains(@text, "ค้นหา") or contains(@hint, "ค้นหา")]',
        ]
        for xpath in xpaths:
            elements = d.find_elements(By.XPATH, xpath)
            if elements:
                return elements[0]

        edit_boxes = d.find_elements(By.CLASS_NAME, "android.widget.EditText")
        return edit_boxes[0] if edit_boxes else None

    search_box = wait.until(lambda d: find_search_box(d))
    log("STEP 9: found search textbox or fallback EditText")

    # 1) tap ช่องค้นหาก่อน
    adb_tap_rect(search_box.rect)
    log("STEP 9: tapped search textbox")
    human_pause(1.0, 0.5)

    # 2) รอ focus แล้วอ่าน EditText ที่ active ใหม่
    focused_boxes = driver.find_elements(By.XPATH, '//android.widget.EditText[@focused="true"]')
    if focused_boxes:
        search_box = focused_boxes[0]
    else:
        search_box = wait.until(lambda d: find_search_box(d))

    # 3) clear ช่อง แล้ววางชื่อคลิปด้วยลำดับ fallback เดียวกับ caption
    try:
        search_box.clear()
        human_pause(0.4, 0.3)
    except Exception as clear_exc:
        log(f"STEP 9: clear textbox failed: {clear_exc}")

    search_box.send_keys(str(keyword))
    log(f"STEP 9: entered keyword: {keyword}")

    human_pause(0.8, 0.5)

    # 4) กด Enter เพื่อค้นหา
    adb_run(["shell", "input", "keyevent", "KEYCODE_ENTER"])
    log("STEP 9: pressed KEYCODE_ENTER")
#10
def tap_first_add_product_button(driver):
    def find_add_buttons():
        found = []
        seen = set()
        elements = driver.find_elements(
            By.XPATH,
            '//android.view.ViewGroup[@content-desc=" เพิ่ม"]',
        )
        for el in elements:
            try:
                if el.get_attribute("enabled") != "true":
                    continue
                rect = el.rect
                key = (rect["x"], rect["y"], rect["width"], rect["height"])
                if rect["width"] <= 0 or rect["height"] <= 0 or key in seen:
                    continue
                seen.add(key)
                found.append(el)
            except Exception:
                continue
        return sorted(found, key=lambda el: (el.rect["y"], el.rect["x"]))

    clicked = 0
    while True:
        add_buttons = find_add_buttons()
        log(f"STEP 10: พบปุ่มเพิ่ม {len(add_buttons)} ตัว")

        if add_buttons:
            adb_tap_rect(add_buttons[0].rect)
            clicked += 1
            human_pause(2.0, 1.2)
        elif clicked <= 0:
            raise RuntimeError("STEP 10: no เพิ่ม button found")
        else:
            break

        try:
            log('STEP 10: checking popup by OCR for another "เพิ่ม" button')
            tap_first_text_by_ocr(
                driver,
                ["เพิ่ม", "เพิม"],
                timeout=3,
                region=(0.18, 0.45, 0.88, 0.66),
                exact=True,
            )
            clicked += 1
            human_pause(2.0, 1.2)
        except Exception as exc:
            log(f'STEP 10: no more "เพิ่ม" found by OCR: {exc}')
            break

    log(f"STEP 10: กดเพิ่มทั้งหมด {clicked} ครั้ง")


def tap_all_add_product_buttons(driver):
    clicked = 0

    while True:
        btn = driver.device(description=" เพิ่ม,button")

        if not btn.exists:
            break

        log('STEP 10: found d(description=" เพิ่ม,button")')
        btn.click()
        clicked += 1
        human_pause(2.0, 1.2)

    if clicked <= 0:
        raise RuntimeError("STEP 10: no เพิ่ม button found")

    log(f"STEP 10: กดเพิ่มสินค้าทั้งหมด {clicked} ครั้ง")
#11
def confirm_anchor_add_button(driver):
    wait = WebDriverWait(driver, 15)

    text_boxes = driver.find_elements(By.CLASS_NAME, "android.widget.EditText")
    if text_boxes:
        sanitize_textbox_before_enter(text_boxes[0])

    adb_run(["shell", "input", "keyevent", "KEYCODE_ENTER"])

    human_pause(1.0, 0.8)

    def find_confirm_button(d):
        candidates = [
            '//android.view.ViewGroup[normalize-space(@content-desc)="เพิ่ม" and @enabled="true"]',
            '//*[normalize-space(@text)="เพิ่ม"]/ancestor::*[@enabled="true"][1]',
            '//*[contains(@text, "ยืนยัน")]/ancestor::*[@enabled="true"][1]',
        ]
        for xpath in candidates:
            els = d.find_elements(By.XPATH, xpath)
            if els:
                return els[0]
        fallback = d.find_elements(By.ACCESSIBILITY_ID, " edit_anchor_add_button")
        if fallback:
            return fallback[0]
        return None

    add_button = None
    end_time = time.time() + 8
    while time.time() < end_time:
        add_button = find_confirm_button(driver)
        if add_button:
            break
        human_pause(0.5, 0.4)

    if not add_button:
        add_button = wait.until(lambda d: find_confirm_button(d))

    adb_tap_rect(add_button.rect)
#12
def input_caption(driver, text):
    wait = WebDriverWait(driver, 15)

    caption_box = wait.until(lambda d: d.find_element(
        By.XPATH,
        '//android.widget.EditText[@text="เพิ่มคำอธิบาย..." or @hint="เพิ่มคำอธิบาย..."]'
    ))

    adb_tap_rect(caption_box.rect)

    # Use the same input path as product search: focus first, then re-read the active EditText.
    time.sleep(5)
    caption_box = wait.until(lambda d: d.find_element(
        By.CLASS_NAME,
        "android.widget.EditText"
    ))

    adb_tap_rect(caption_box.rect)
    human_pause(1.0, 0.8)

    caption_box.clear()
    human_pause(0.5, 0.5)
    caption_box.send_keys(text)
    human_pause(1.0, 1.0)
#13


def is_post_processing_popup_present(driver):
    screen = driver.get_window_size()
    screen_w = max(1, screen["width"])
    screen_h = max(1, screen["height"])

    for el in driver.find_elements(By.CLASS_NAME, "android.widget.FrameLayout"):
        try:
            info = el.info
            if info.get("package") != TIKTOK_PACKAGE:
                continue
            if str(info.get("visible-to-user", "true")).lower() == "false":
                continue
            if info.get("resource-id"):
                continue
            if str(info.get("clickable", "false")).lower() == "true":
                continue

            rect = el.rect
            if rect["width"] <= 0 or rect["height"] <= 0:
                continue

            cx, cy = rect_center(rect)
            width_ratio = rect["width"] / screen_w
            height_ratio = rect["height"] / screen_h
            cx_ratio = cx / screen_w
            cy_ratio = cy / screen_h

            if not (0.18 <= width_ratio <= 0.55):
                continue
            if not (0.07 <= height_ratio <= 0.35):
                continue
            if not (0.08 <= cx_ratio <= 0.45):
                continue
            if not (0.22 <= cy_ratio <= 0.75):
                continue

            log(f"Post processing popup still visible at {rect}")
            return True
        except Exception:
            continue

    return False


def wait_post_processing_popup_gone(driver, appear_timeout=20, gone_timeout=240):
    appear_deadline = time.time() + appear_timeout
    seen_popup = False

    while time.time() < appear_deadline:
        if is_post_processing_popup_present(driver):
            seen_popup = True
            break
        time.sleep(1)

    if not seen_popup:
        log("Post processing popup not detected; continuing")
        return True

    log("Post processing popup detected. Waiting until it disappears")
    gone_deadline = time.time() + gone_timeout
    while time.time() < gone_deadline:
        if not is_post_processing_popup_present(driver):
            log("Post processing popup disappeared")
            return True
        time.sleep(2)

    raise RuntimeError("Post processing popup did not disappear before timeout")


def tap_post_button(driver):
    wait = WebDriverWait(driver, 15)

    def find_post_button(d):
        # วิธีหลักเดิม: หา Button ที่มี text=โพสต์ โดยไม่ใช้ resource-id
        try:
            elements = d.find_elements(
                By.XPATH,
                '//android.widget.Button[@text="โพสต์"]'
            )
            if elements:
                return elements[0]
        except Exception:
            pass

        # วิธีสำรอง: หา element ตามคุณสมบัติจากหน้าจอ
        # className=android.widget.Button, text=โพสต์, clickable=true, enabled=true
        # ไม่ใช้ resource-id และไม่ใช้ index
        for el in d.find_elements(By.CLASS_NAME, "android.widget.Button"):
            try:
                if el.text().strip() != "โพสต์":
                    continue
                if el.get_attribute("clickable") != "true":
                    continue
                if el.get_attribute("enabled") != "true":
                    continue
                return el
            except Exception:
                continue

        # วิธีสำรองสุดท้าย: ใช้ uiautomator2 selector โดยไม่ใช้ resource-id
        try:
            obj = d.device(className="android.widget.Button", text="โพสต์")
            if obj.exists:
                return U2Element(obj, d)
        except Exception:
            pass

        return None

    post_button = wait.until(find_post_button)
    log("STEP 13: กดปุ่มโพสต์")
    adb_tap_rect(post_button.rect)
    wait_post_processing_popup_gone(driver)


def post_warmup_and_stop(driver):
    log("STEP 14: handed off to server for swipe/delete/force-stop")


########################
def task_index_for_action(tasks, action):
    for idx, task in enumerate(tasks):
        if task.get("action") == action:
            return idx
    return None


def element_exists(driver, by, value):
    try:
        return bool(driver.find_elements(by, value))
    except Exception:
        return False


def handle_blocking_overlay(driver):
    return False


def detect_current_step_index(driver, tasks, fallback_index):
    checks = [
        (
            "tap_post_button",
            lambda d: element_exists(
                d,
                By.XPATH,
                '//android.widget.Button[@text="โพสต์"]',
            ),
        ),
        (
            "input_caption",
            lambda d: element_exists(
                d,
                By.XPATH,
                '//android.widget.EditText[@text="เพิ่มคำอธิบาย..." or @hint="เพิ่มคำอธิบาย..."]',
            ),
        ),
        (
            "confirm_anchor_add_button",
            lambda d: element_exists(d, By.XPATH, '//*[contains(@text, "ยืนยัน")]'),
        ),
        (
            "tap_first_add_product_button",
            lambda d: element_exists(
                d,
                By.XPATH,
                '//android.view.ViewGroup[@content-desc=" เพิ่ม" and @enabled="true"]',
            ),
        ),
        (
            "tap_all_add_product_buttons",
            lambda d: element_exists(
                d,
                By.XPATH,
                '//android.view.ViewGroup[@content-desc=" เพิ่ม" and @enabled="true"]',
            ),
        ),
        (
            "search_product_keyword",
            lambda d: element_exists(
                d,
                By.XPATH,
                '//android.widget.EditText[@text="ค้นหาสินค้า" or @hint="ค้นหาสินค้า"]',
            ),
        ),
        (
            "tap_product_link_option",
            lambda d: element_exists(d, By.XPATH, '//*[@text="สินค้า"]'),
        ),
        (
            "tap_add_link_button",
            lambda d: element_exists(d, By.ACCESSIBILITY_ID, "เพิ่มลิงก์"),
        ),
        (
            "tap_first_media_select_button",
            lambda d: element_exists(d, By.ACCESSIBILITY_ID, "ทั้งหมด"),
        ),
        (
            "tap_upload_button",
            lambda d: element_exists(d, By.ACCESSIBILITY_ID, "เพิ่มเสียง"),
        ),
        (
            "tap_create_button",
            lambda d: element_exists(d, By.ACCESSIBILITY_ID, "สร้าง"),
        ),
    ]

    for action, predicate in checks:
        try:
            if predicate(driver):
                idx = task_index_for_action(tasks, action)
                if idx is not None:
                    return idx, action
        except Exception:
            continue

    next_idx = task_index_for_action(tasks, "tap_next_button")
    final_next_idx = task_index_for_action(tasks, "tap_final_next_button")
    if element_exists(
        driver,
        By.ANDROID_UIAUTOMATOR,
        'new UiSelector().className("android.widget.Button").textContains("ถัดไป")',
    ):
        if final_next_idx is not None and fallback_index >= final_next_idx:
            return final_next_idx, "tap_final_next_button"
        if next_idx is not None:
            return next_idx, "tap_next_button"

    return fallback_index, "fallback"


def verify_step_changed(driver, tasks, current_index):
    if current_index >= len(tasks) - 1:
        return True, current_index, "final_step"

    current_action = tasks[current_index].get("action", "")
    if current_action in {"tap_first_media_select_button", "tap_first_add_product_button"}:
        next_index = min(current_index + 1, len(tasks) - 1)
        return True, next_index, "same_screen_action"

    fallback_index = min(current_index + 1, len(tasks) - 1)
    detected_index, detected_action = detect_current_step_index(driver, tasks, fallback_index)
    detected_step = tasks[detected_index].get("step", detected_index + 1)

    if detected_index == current_index:
        return False, detected_index, detected_action

    log(f"Detected current step after action: STEP {detected_step} ({detected_action})")
    return True, detected_index, detected_action


def load_tasks():
    tasks_path = TASKS_FILE
    if not os.path.isabs(tasks_path):
        tasks_path = os.path.join(BASE_DIR, tasks_path)

    with open(tasks_path, "r", encoding="utf-8") as f:
        raw = f.read()

    # tasks.json is edited by humans and may contain // notes. Keep it friendly.
    raw = re.sub(r"^\s*//.*$", "", raw, flags=re.MULTILINE)
    return json.loads(raw)


def resolve_template(value):
    if not isinstance(value, str):
        return value
    return (
        value
        .replace("{{product_name}}", AUTOPOST_PRODUCT_NAME)
        .replace("{{product_id}}", AUTOPOST_PRODUCT_ID)
        .replace("{{รหัสสินค้า}}", AUTOPOST_PRODUCT_ID)
        .replace("{{caption}}", AUTOPOST_CAPTION)
        .replace("{{video_name}}", AUTOPOST_VIDEO_NAME or AUTOPOST_PRODUCT_NAME)
        .replace("{{ชื่อวิดีโอ}}", AUTOPOST_VIDEO_NAME or AUTOPOST_PRODUCT_NAME)
    )


def execute_task(driver, task):
    action = task["action"]

    if action == "open_app":
        open_app(driver, task["package"])
    elif action == "tap_create_button":
        tap_create_button(driver)
    elif action == "tap_upload_button":
        tap_upload_button(driver)
    elif action == "tap_first_media_select_button":
        tap_first_media_select_button(driver)
    elif action == "tap_next_button":
        tap_next_button(driver)
    elif action == "tap_final_next_button":
        tap_final_next_button(driver)
    elif action == "tap_add_link_button":
        tap_add_link_button(driver)
    elif action == "tap_product_link_option":
        tap_product_link_option(driver)
    elif action == "tap_add_product_entry_before_search":
        tap_add_product_entry_before_search(driver)
    elif action == "tap_marketplace_option":
        tap_marketplace_option(driver)
    elif action == "tap_product_viewpager_image":
        tap_product_viewpager_image(driver, resolve_template(task.get("keyword", "{{product_id}}")))
    elif action == "search_product_keyword":
        search_product_keyword(driver, resolve_template(task["keyword"]))
    elif action == "tap_first_add_product_button":
        tap_first_add_product_button(driver)
    elif action == "tap_all_add_product_buttons":
        tap_all_add_product_buttons(driver)
    elif action == "confirm_anchor_add_button":
        confirm_anchor_add_button(driver)
    elif action == "input_caption":
        caption_text = build_auto_caption(
            AUTOPOST_PRODUCT_NAME or resolve_template("{{ชื่อวิดีโอ}}"),
            "",
            LAST_ANCHOR_PRODUCT_TEXT,
        )
        log(f"STEP 12: generated random caption with {len(product_hashtags(LAST_ANCHOR_PRODUCT_TEXT, 2))} product hashtag(s) and 3 random hashtag(s)")
        input_caption(driver, caption_text)
    elif action == "tap_post_button":
        tap_post_button(driver)
    elif action == "post_warmup_and_stop":
        post_warmup_and_stop(driver)
    else:
        log(f"Unknown action: {action}")


def run_flow():
    if not AUTOPOST_PRODUCT_ID:
        raise RuntimeError("ไม่มี Product ID สำหรับค้นหาสินค้าใน ADB")
    log(
        f"ADB Showcase-first: จะเพิ่มและค้นหาด้วย Product ID {AUTOPOST_PRODUCT_ID} เท่านั้น "
        "(ไม่ใช้ชื่อสินค้า)"
    )
    driver = start_driver()
    tasks = load_tasks()
    app_package = next(
        (task.get("package") for task in tasks if task.get("action") == "open_app" and task.get("package")),
        TIKTOK_PACKAGE,
    )

    flow_completed = False
    try:
        index = 0
        app_restarts = 0
        # Go straight through เพิ่มสินค้า -> ตลาดสินค้า. The old path searched
        # the existing Showcase first and only added after three failed retries.
        product_flow_mode = "new"
        old_product_actions = {"search_product_keyword", "tap_first_add_product_button"}
        new_product_actions = {
            "tap_add_product_entry_before_search",
            "tap_marketplace_option",
            "tap_product_viewpager_image",
            "tap_all_add_product_buttons",
        }

        while index < len(tasks):
            if handle_blocking_overlay(driver):
                detected_index, detected_action = detect_current_step_index(driver, tasks, index)
                detected_step = tasks[detected_index].get("step", detected_index + 1)
                log(f"Detected current step after overlay close: STEP {detected_step} ({detected_action})")
                index = detected_index
                continue

            task = tasks[index]
            step = task.get("step", index + 1)
            description = task.get("description", "")
            action = task.get("action", "")

            if product_flow_mode == "old" and action in new_product_actions:
                index += 1
                continue
            if product_flow_mode == "new" and action in old_product_actions:
                index += 1
                continue

            log(f"STEP {step}: {description} ({action})")

            success = False
            last_error = None
            redirect_index = None
            next_index = None

            for attempt in range(1, MAX_STEP_ATTEMPTS + 1):
                try:
                    if handle_blocking_overlay(driver):
                        detected_index, detected_action = detect_current_step_index(driver, tasks, index)
                        detected_step = tasks[detected_index].get("step", detected_index + 1)
                        log(f"Detected current step after overlay close: STEP {detected_step} ({detected_action})")
                        redirect_index = detected_index
                        break

                    log(f"STEP {step}: attempt {attempt}/{MAX_STEP_ATTEMPTS}")
                    execute_task(driver, task)
                    wait_seconds = float(task.get("wait", 2) or 2)
                    human_pause(wait_seconds, 1.4)
                    changed, detected_index, detected_action = verify_step_changed(driver, tasks, index)
                    if not changed:
                        raise RuntimeError(
                            f"step did not change after action; still detected STEP {step} ({detected_action})"
                        )
                    log(f"STEP {step}: success")
                    next_index = index + 1
                    success = True
                    break
                except Exception as exc:
                    last_error = exc
                    log(f"STEP {step}: error attempt {attempt}/{MAX_STEP_ATTEMPTS}: {exc}")
                    human_pause(1.0, 0.8)

            if redirect_index is not None:
                index = redirect_index
                continue

            if success:
                index = next_index if next_index is not None else index + 1
                continue

            if product_flow_mode == "old" and action in old_product_actions:
                product_flow_mode = "new"
                app_restarts = 0
                log(
                    f"STEP {step}: old product flow failed after {MAX_STEP_ATTEMPTS} attempts. "
                    "Switching to new product flow: force stop then restart from STEP 1"
                )
                force_stop_app(app_package)
                index = 0
                continue

            if app_restarts < MAX_APP_RESTARTS:
                app_restarts += 1
                log(
                    f"STEP {step}: failed after {MAX_STEP_ATTEMPTS} attempts. "
                    f"App restart {app_restarts}/{MAX_APP_RESTARTS}: force stop then restart from STEP 1"
                )
                force_stop_app(app_package)
                index = 0
                continue

            raise RuntimeError(
                f"STEP {step} failed after {MAX_STEP_ATTEMPTS} attempts "
                f"and {app_restarts} app restarts: {last_error}"
            )
        flow_completed = True
    finally:
        if not flow_completed:
            force_stop_app(app_package)
        # Keep the automation connection clean.
        driver.quit()


if __name__ == "__main__":
    run_flow()
