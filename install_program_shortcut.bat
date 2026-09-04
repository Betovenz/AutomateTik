@echo off
setlocal
cd /d "%~dp0"

set "EXE=%~dp0dist\TikTokManagerPro\TikTokManagerPro.exe"
if not exist "%EXE%" (
  set "EXE=%~dp0dist\TikTokManagerPro.exe"
)

if not exist "%EXE%" (
  echo TikTokManagerPro.exe was not found.
  echo Run build_exe.bat first.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$programs=[Environment]::GetFolderPath('Programs'); $dir=Join-Path $programs 'TikTok Manager Pro'; New-Item -ItemType Directory -Path $dir -Force | Out-Null; $lnk=Join-Path $dir 'TikTok Manager Pro.lnk'; $shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut($lnk); $shortcut.TargetPath='%EXE%'; $shortcut.WorkingDirectory='%~dp0'; $shortcut.IconLocation='%~dp0assets\app.ico'; $shortcut.Description='TikTok Manager Pro'; $shortcut.Save(); Write-Host 'Created shortcut:' $lnk"
if errorlevel 1 (
  echo Shortcut install failed.
  pause
  exit /b 1
)

echo.
echo Added to Start Menu / Programs.
pause
