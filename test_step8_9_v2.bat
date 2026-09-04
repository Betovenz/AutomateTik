@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo [!] Python was not found.
    pause
    exit /b 1
  ) else (
    set "PY=py -3"
  )
) else (
  set "PY=python"
)

echo.
echo Test STEP 8-9 v2
echo Usage:
echo   test_step8_9_v2.bat all --udid DEVICE_ID --keyword "PRODUCT_KEYWORD"
echo   test_step8_9_v2.bat 8.5 --udid DEVICE_ID
echo   test_step8_9_v2.bat 8.7 --udid DEVICE_ID
echo   test_step8_9_v2.bat 9.5 --udid DEVICE_ID --keyword "PRODUCT_KEYWORD"
echo.

%PY% test_step8_9_v2.py %*
echo.
pause
