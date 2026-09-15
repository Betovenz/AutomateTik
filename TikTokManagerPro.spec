# -*- mode: python ; coding: utf-8 -*-
"""Portable build for TikTok Manager Pro.

Produces dist/TikTokManagerPro/ — a self-contained folder holding the exe, a
bundled CPython, and a bundled node.exe. Copy the folder to any Windows PC and
double-click the exe; nothing has to be installed on the target machine.

Paths are resolved relative to this spec file so the build works from any
checkout (the previous spec hardcoded one developer's absolute paths).
"""
import os
import shutil
from pathlib import Path

BASE = Path(SPECPATH).resolve()


# Directories that must NEVER ride along in a portable build.
#
#   runtime/    holds this machine's API keys and TikTok cookies — shipping the
#               folder to anyone else would hand them those credentials. It is
#               recreated empty on first run.
#   Final-File, Final-File-JS, flow-results, uploads
#               are the operator's own generated clips and images (~32 MB here),
#               regenerated per install and meaningless on another PC.
#   _backup_*   is a dead source backup.
EXCLUDED_DIRS = {
    "__pycache__",
    "node_modules",
    ".git",
    "runtime",
    "final-file",
    "final-file-js",
    "flow-results",
    "uploads",
    "final-file-connect",
    "_backup_before_postweb_removal",
}

# Source archives that sit next to their own extracted copy. Nothing can load a
# .zip at runtime, and grepping the project finds no reference to this one.
EXCLUDED_FILES = {"media-core.zip"}


def data(rel_source, dest):
    """(source, dest) pair for a single FILE, skipped when it is not in the tree."""
    source = BASE / rel_source
    return (str(source), dest) if source.is_file() else None


def tree(rel_source, dest):
    """Every file under a directory, minus EXCLUDED_DIRS.

    PyInstaller copies a directory wholesale when handed one, with no way to
    leave parts out — so the tree is walked here and emitted file by file.
    """
    root = BASE / rel_source
    if not root.is_dir():
        return []
    entries = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part.lower() in EXCLUDED_DIRS for part in relative.parts[:-1]):
            continue
        if path.name.lower() in EXCLUDED_FILES:
            continue
        entries.append((str(path), str(Path(dest) / relative.parent)))
    return entries


def find_node():
    """node.exe to ship with the build; ai_studio's server runs on it."""
    override = os.environ.get("AUTOTIK_BUILD_NODE", "").strip()
    candidates = [
        override,
        shutil.which("node.exe") or shutil.which("node") or "",
        str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "nodejs" / "node.exe"),
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs" / "node.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    return ""


datas = []
for folder in (
    "ui",
    "ai_studio",
    "gtpro_extension",
    # Both Chrome extensions ride along so they can be loaded on the target PC.
    "ai_studio_extension",
    "ai_studio_extension_main",
    "assets",
    "caption",
    "lib",
):
    datas.extend(tree(folder, folder))

datas.extend(entry for entry in [
    data("tasks.json", "."),
    data("config.json", "."),
    data("library_source.json", "."),
    data("license-config.js", "."),
    data("main.py", "."),
    data("requirements.txt", "."),
    # Target-PC helper: phone posting runs main.py through the system Python,
    # so this installs Python packages + the EasyOCR model there once.
    data("install_ocr.bat", "."),
] if entry)

# Ship the Node runtime so ai_studio works without Node installed. Landed at
# runtime/node.exe, which ai_studio_server._node_executable() checks first.
node_exe = find_node()
if node_exe:
    datas.append((node_exe, "runtime"))
else:
    print("WARNING: node.exe not found — the build will need Node installed on the target PC.")

icon_file = BASE / "assets" / "app.ico"

a = Analysis(
    [str(BASE / "desktop_app.py")],
    pathex=[str(BASE)],
    binaries=[],
    datas=datas,
    hiddenimports=["uiautomator2", "webview", "clr_loader", "pythonnet"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TikTokManagerPro",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[str(icon_file)] if icon_file.exists() else None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="TikTokManagerPro",
)
