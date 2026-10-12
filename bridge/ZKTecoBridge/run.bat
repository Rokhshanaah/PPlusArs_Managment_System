@echo off
setlocal
cd /d "%~dp0"

if not exist "bin\Release\ZKTecoBridge.exe" (
  echo ZKTecoBridge.exe not found. Run build.bat first.
  pause
  exit /b 1
)

copy /Y "sdk\*.dll" "bin\Release\" >nul 2>nul

echo Starting ZKTeco ZK4500 Bridge...
echo Keep this window open while using Card Reader.
echo Health: http://127.0.0.1:18181/health
echo.

"bin\Release\ZKTecoBridge.exe"
pause
