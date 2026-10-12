@echo off
setlocal
cd /d "%~dp0"

echo ===============================================
echo PPlus.Arz + ZKTeco ZK4500
echo ===============================================

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js پيدا نشد.
  echo Node.js نسخه مورد نياز پروژه را نصب كنيد.
  pause
  exit /b 1
)

echo.
echo [1/2] Installing project dependencies...
call npm install
if errorlevel 1 (
  echo npm install ناموفق بود.
  pause
  exit /b 1
)

echo.
echo [2/2] Starting PPlus.Arz...
echo براي اثر انگشت، ZKTeco Bridge هم بايد در پنجره جداگانه اجرا باشد.
call npm run dev
pause
