import subprocess
import sys
from pathlib import Path


def find_base_dir():
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates = [exe_dir, exe_dir / "_internal", exe_dir.parent]
    else:
        candidates = [Path(__file__).resolve().parent]

    for candidate in candidates:
        if (candidate / "desktop_app.py").is_file():
            return candidate
    return candidates[0]


BASE_DIR = find_base_dir()
APP = BASE_DIR / "desktop_app.py"


def python_candidates():
    return [
        BASE_DIR / ".venv" / "Scripts" / "pythonw.exe",
        BASE_DIR / ".venv" / "Scripts" / "python.exe",
        Path.home() / "AppData" / "Local" / "Python" / "pythoncore-3.14-64" / "pythonw.exe",
        Path.home() / "AppData" / "Local" / "Python" / "pythoncore-3.14-64" / "python.exe",
        Path("pythonw.exe"),
        Path("python.exe"),
    ]


def main():
    for candidate in python_candidates():
        try:
            if candidate.is_absolute() and not candidate.exists():
                continue
            subprocess.Popen(
                [str(candidate), str(APP)],
                cwd=str(BASE_DIR),
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            return
        except OSError:
            continue
    raise RuntimeError("Python was not found.")


if __name__ == "__main__":
    main()
