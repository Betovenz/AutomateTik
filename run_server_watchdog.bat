@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title Automate Tik - Python Server Watchdog

if not exist "%~dp0server.py" (
    echo [ERROR] server.py was not found in:
    echo         %~dp0
    pause
    exit /b 1
)

if not exist "%~dp0watchdog.ps1" (
    echo [ERROR] watchdog.ps1 was not found in:
    echo         %~dp0
    pause
    exit /b 1
)

if /i "%~1"=="--check" (
    echo [OK] Watchdog launcher is ready.
    exit /b 0
)

echo ========================================
echo   Automate Tik - Server Watchdog
echo ========================================
echo Keep this window open while using the app.
echo Press Ctrl+C to stop the watchdog and server.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1"
set "WATCHDOG_EXIT=%ERRORLEVEL%"

echo.
echo [watchdog] Stopped with exit code %WATCHDOG_EXIT%.
pause
exit /b %WATCHDOG_EXIT%
