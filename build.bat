@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo   TikTok Manager Pro - Portable Build
echo ============================================================
echo.

rem ---- 1. locate Python -------------------------------------------------
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (
  where py >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  if exist "%LocalAppData%\Python\pythoncore-3.14-64\python.exe" set "PY=%LocalAppData%\Python\pythoncore-3.14-64\python.exe"
)
if not defined PY (
  if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
)
if not defined PY (
  echo [X] Python was not found on this PC.
  echo     Install Python 3.11+ from https://www.python.org/downloads/
  echo     ^(tick "Add python.exe to PATH" during setup^), then run this again.
  echo.
  pause
  exit /b 1
)
echo [1/5] Python: %PY%

rem ---- 2. locate Node (bundled into the build) --------------------------
set "NODE_FOUND="
where node >nul 2>nul && set "NODE_FOUND=1"
if not defined NODE_FOUND if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_FOUND=1"
if not defined NODE_FOUND if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_FOUND=1"
if defined NODE_FOUND (
  echo [2/5] Node.js found - it will be bundled into the build.
) else (
  echo [2/5] WARNING: Node.js not found on this PC.
  echo       The build will still work, but the target PC will need Node installed
  echo       for the AI Studio / POST WEB features. Install Node.js and rebuild
  echo       to make the output fully self-contained.
)

rem ---- 3. dependencies --------------------------------------------------
echo [3/5] Installing build dependencies...
%PY% -m pip install --upgrade pip >nul 2>nul
%PY% -m pip install --upgrade pyinstaller >nul 2>nul
if errorlevel 1 (
  echo [X] Could not install PyInstaller. Check your internet connection.
  echo.
  pause
  exit /b 1
)
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo [!] Some packages in requirements.txt failed to install.
  echo     The build will continue, but features needing them may not work.
  echo.
)

rem ---- 4. build ---------------------------------------------------------
echo.
echo [4/5] Building... this takes a few minutes.
echo.
%PY% -m PyInstaller TikTokManagerPro.spec --noconfirm --clean
if errorlevel 1 (
  echo.
  echo [X] Build failed. Scroll up for the PyInstaller error.
  echo.
  pause
  exit /b 1
)

rem ---- 5. verify + finish ----------------------------------------------
set "OUT=%~dp0dist\TikTokManagerPro"
if not exist "%OUT%\TikTokManagerPro.exe" (
  echo.
  echo [X] Build finished but the exe is missing. Check the dist folder.
  echo.
  pause
  exit /b 1
)

rem Ship a short readme next to the exe so whoever receives the folder knows what to do.
> "%OUT%\READ ME.txt" (
  echo TikTok Manager Pro - Portable
  echo ==============================
  echo.
  echo HOW TO USE
  echo   1. Copy this whole TikTokManagerPro folder anywhere you like
  echo      ^(Desktop, another PC, a USB drive^).
  echo   2. Double-click TikTokManagerPro.exe
  echo.
  echo Nothing needs to be installed - Python and Node.js are included.
  echo No login or serial is required.
  echo.
  echo FIRST RUN - LOAD THE 2 CHROME EXTENSIONS
  echo   Posting to TikTok and AI Studio both need them.
  echo   1. Open Chrome and go to  chrome://extensions
  echo   2. Turn on "Developer mode" ^(top right^)
  echo   3. Click "Load unpacked" and pick EACH of these folders:
  echo        _internal\ai_studio_extension_main    ^(AutoGT Pro Extension^)
  echo        _internal\ai_studio_extension         ^(AutoGT Pro TikTok Extension^)
  echo   4. Sign in to TikTok and to Google Flow in that same Chrome profile.
  echo.
  echo PHONE POSTING ^(optional^)
  echo   Posting from an Android phone needs Python + the OCR model on this PC.
  echo   Run install_ocr.bat ^(next to the exe^) once - it installs everything.
  echo   Then plug in the phone with USB debugging on.
  echo.
  echo NOTES
  echo   - Keep the folder together. Moving the .exe out on its own will not work.
  echo   - Your data ^(autopost.db, settings, generated clips^) is created inside
  echo     this folder on first run, so copying the folder carries your work.
  echo   - This build ships with NO API keys and NO TikTok cookies. Set your own
  echo     under POST WEB ^> "ตั้งค่า API".
  echo   - Phone features still need ADB ^(Android Platform Tools on PATH^).
)

echo.
echo ============================================================
echo   [5/5] DONE
echo ============================================================
echo.
echo   Portable folder:
echo     %OUT%
echo.
echo   Copy that whole folder to any Windows PC and double-click
echo   TikTokManagerPro.exe - no install, no login.
echo.
choice /C YN /N /M "Open the folder now? [Y/N] "
if errorlevel 2 goto :end
start "" "%OUT%"

:end
echo.
pause
