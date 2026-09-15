"""Build dist/TikTokManagerPro/ from TikTokManagerPro.spec.

The spec is the single source of truth for what ships: it bundles both Chrome
extensions (ai_studio_extension_main, ai_studio_extension), the node.exe
runtime for the AI Studio server, and skips runtime/ (this machine's API keys
and cookies) plus the operator's generated clips. This script used to carry
its own --add-data list, which had drifted from the spec — it shipped no
extensions and no node, and did ship runtime/.
"""
import subprocess
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
SPEC_FILE = BASE_DIR / "TikTokManagerPro.spec"
DIST_EXE = BASE_DIR / "dist" / "TikTokManagerPro" / "TikTokManagerPro.exe"


def main():
    try:
        import PyInstaller  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "PyInstaller is not installed. Install it first with: "
            "python -m pip install pyinstaller"
        ) from exc
    if not SPEC_FILE.is_file():
        raise SystemExit(f"Spec file is missing: {SPEC_FILE}")

    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller", str(SPEC_FILE), "--noconfirm", "--clean"],
        cwd=str(BASE_DIR),
    )
    if result.returncode != 0:
        raise SystemExit(result.returncode)

    if DIST_EXE.exists():
        print(f"Built: {DIST_EXE}")
    else:
        raise SystemExit(f"Build output not found. Check folder: {BASE_DIR / 'dist'}")


if __name__ == "__main__":
    main()
