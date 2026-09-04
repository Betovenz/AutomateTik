@echo off
setlocal
cd /d "%~dp0"

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
        echo Python was not found. Run install.bat first.
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

echo Building TikTokManagerPro.exe...
%PY% build_desktop_exe.py
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Build complete.
echo EXE folder:
echo   %~dp0dist\TikTokManagerPro\TikTokManagerPro.exe
echo.
pause
