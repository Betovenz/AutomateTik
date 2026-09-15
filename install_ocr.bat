@echo off
setlocal
cd /d "%~dp0"
title TikTok Manager Pro - Install OCR (phone posting)

echo ============================================================
echo   TikTok Manager Pro - Install OCR for phone posting
echo ============================================================
echo.
echo   The app itself is portable and needs nothing installed.
echo   Posting from a PHONE (uiautomator2 + OCR) runs through the
echo   system Python, so this PC needs Python + the OCR model once.
echo   Run this file once on each PC that will post from a phone.
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
  echo [1/4] Python was not found. Trying to install Python 3.12 with winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [X] winget is not available on this PC.
    echo     Install Python 3.12+ from https://www.python.org/downloads/
    echo     ^(tick "Add python.exe to PATH" during setup^), then run this again.
    echo.
    pause
    exit /b 1
  )
  winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
  if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
  if not defined PY (
    where python >nul 2>nul && set "PY=python"
  )
  if not defined PY (
    echo [X] Python was installed but is not on PATH yet.
    echo     Close this window, open a new one, and run install_ocr.bat again.
    echo.
    pause
    exit /b 1
  )
)
echo [1/4] Python: %PY%
%PY% --version
if errorlevel 1 (
  echo [X] Python exists but failed to run.
  pause
  exit /b 1
)

rem ---- 2. packages used by main.py (phone automation + OCR) --------------
echo.
echo [2/4] Installing phone-automation packages (uiautomator2, adbutils, opencv, easyocr)...
%PY% -m pip install --upgrade pip >nul 2>nul
%PY% -m pip install "uiautomator2>=3.0.0" "adbutils[apk]>=2.8.0" "opencv-python>=4.8.0" "easyocr>=1.7.2"
if errorlevel 1 (
  echo.
  echo [X] Package installation failed. Check the internet connection and run this again.
  echo.
  pause
  exit /b 1
)

rem ---- 3. download the OCR model (Thai + English) ------------------------
echo.
echo [3/4] Downloading the OCR model (Thai + English, ~100 MB, one time)...
%PY% -c "import easyocr; easyocr.Reader(['th','en'], gpu=False, verbose=False); print('OCR model ready')"
if errorlevel 1 (
  echo.
  echo [X] OCR model download failed. Check the internet connection and run this again.
  echo     The model is stored in %USERPROFILE%\.EasyOCR
  echo.
  pause
  exit /b 1
)

rem ---- 4. ADB -----------------------------------------------------------
echo.
echo [4/4] Checking ADB...
where adb >nul 2>nul
if errorlevel 1 (
  echo [!] ADB was not found in PATH.
  echo     Install Android Platform Tools and add platform-tools to PATH,
  echo     then check with: adb devices
) else (
  adb version
)

echo.
echo ============================================================
echo   DONE - phone posting is ready on this PC.
echo ============================================================
echo.
pause
exit /b 0
