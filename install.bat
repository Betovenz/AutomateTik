@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo  TikTok Manager Pro - New Machine Install
echo ============================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    if exist "%LocalAppData%\Python\pythoncore-3.14-64\python.exe" (
      set "PY=%LocalAppData%\Python\pythoncore-3.14-64\python.exe"
    ) else (
      if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
        set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
      ) else (
        echo [!] Python was not found.
        echo     Install Python 3.12+ first, then run this file again.
        echo     Download: https://www.python.org/downloads/windows/
        echo.
        pause
        exit /b 1
      )
    )
  ) else (
    set "PY=py -3"
  )
) else (
  set "PY=python"
)

echo [1/4] Python:
%PY% --version
if errorlevel 1 (
  echo [!] Python exists but failed to run.
  pause
  exit /b 1
)

echo.
echo [2/4] Upgrading pip...
%PY% -m pip install --upgrade pip
if errorlevel 1 goto :pip_failed

echo.
echo [3/4] Installing Python packages...
%PY% -m pip install -r requirements.txt
if errorlevel 1 goto :pip_failed

echo.
echo Preloading OCR model...
%PY% -c "import easyocr; easyocr.Reader(['th','en'], gpu=False, verbose=False); print('OCR model ready')"
if errorlevel 1 (
  echo [!] OCR model preload failed. The program can still run,
  echo     but the first OCR step may be slow or may need internet.
)

echo.
echo [4/4] Checking ADB...
where adb >nul 2>nul
if errorlevel 1 (
  echo [!] ADB was not found in PATH.
  echo     Install Android Platform Tools and add platform-tools to PATH.
  echo     After install, run: adb devices
) else (
  adb version
)

echo.
echo Checking scrcpy for Open Screen button...
where scrcpy >nul 2>nul
if errorlevel 1 (
  if exist "%~dp0scrcpy.exe" (
    echo scrcpy found next to this program.
  ) else (
    if exist "%~dp0scrcpy\scrcpy.exe" (
      echo scrcpy found in scrcpy folder.
    ) else (
      echo scrcpy was not found. Trying to install with winget...
      where winget >nul 2>nul
      if errorlevel 1 (
        echo [!] winget was not found.
        echo     To use the Open Screen button, install scrcpy manually,
        echo     or put scrcpy.exe next to TikTokManagerPro.exe.
      ) else (
        winget install --id Genymobile.scrcpy -e --accept-package-agreements --accept-source-agreements
        where scrcpy >nul 2>nul
        if errorlevel 1 (
          echo [!] scrcpy install finished but scrcpy is still not in PATH.
          echo     Restart this computer, then run install.bat again,
          echo     or put scrcpy.exe next to TikTokManagerPro.exe.
        ) else (
          scrcpy --version
        )
      )
    )
  )
) else (
  scrcpy --version
)

echo.
echo Install finished.
echo Next:
echo   1. Run build_exe.bat to create the EXE.
echo   2. Run install_program_shortcut.bat to add it to Programs.
echo.
pause
exit /b 0

:pip_failed
echo.
echo [!] Python package installation failed.
echo     Check internet connection, then run install.bat again.
pause
exit /b 1
