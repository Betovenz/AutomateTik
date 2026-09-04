import subprocess
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
APP_FILE = BASE_DIR / "desktop_app.py"
ICON_FILE = BASE_DIR / "assets" / "app.ico"


def main():
    try:
        import PyInstaller.__main__
    except ImportError as exc:
        raise SystemExit(
            "PyInstaller is not installed. Install it first with: "
            "python -m pip install pyinstaller"
        ) from exc

    PyInstaller.__main__.run(
        [
            str(APP_FILE),
            "--name",
            "TikTokManagerPro",
            "--noconsole",
            "--icon",
            str(ICON_FILE),
            "--add-data",
            f"{BASE_DIR / 'ui'};ui",
            "--add-data",
            f"{BASE_DIR / 'ai_studio'};ai_studio",
            "--add-data",
            f"{BASE_DIR / 'gtpro_extension'};gtpro_extension",
            "--add-data",
            f"{BASE_DIR / 'assets'};assets",
            "--add-data",
            f"{BASE_DIR / 'caption'};caption",
            "--add-data",
            f"{BASE_DIR / 'tasks.json'};.",
            "--add-data",
            f"{BASE_DIR / 'config.json'};.",
            "--add-data",
            f"{BASE_DIR / 'library_source.json'};.",
            "--add-data",
            f"{BASE_DIR / 'license-config.js'};.",
            "--add-data",
            f"{BASE_DIR / 'lib'};lib",
            "--add-data",
            f"{BASE_DIR / 'main.py'};.",
            "--add-data",
            f"{BASE_DIR / 'requirements.txt'};.",
            "--hidden-import",
            "uiautomator2",
            "--hidden-import",
            "webview",
            "--hidden-import",
            "clr_loader",
            "--hidden-import",
            "pythonnet",
            "--clean",
        ]
    )

    dist = BASE_DIR / "dist" / "TikTokManagerPro" / "TikTokManagerPro.exe"
    if dist.exists():
        print(f"Built: {dist}")
    else:
        print(f"Build output not found. Check folder: {BASE_DIR / 'dist'}")


if __name__ == "__main__":
    main()
