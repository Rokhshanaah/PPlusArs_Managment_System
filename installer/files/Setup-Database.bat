@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE_DIR=%~dp0runtime\node-v24.16.0-win-x64"
set "APP_DIR=%~dp0app"

echo PPlus.Arz - Database Setup
echo MySQL must be running.
echo.

if not exist "%APP_DIR%\server\.env" (
  copy /Y "%APP_DIR%\server\.env.example" "%APP_DIR%\server\.env" >nul
)

pushd "%APP_DIR%"
call "%NODE_DIR%\npm.cmd" run db:setup
if errorlevel 1 (
  echo Setup failed. Check MySQL and app\server\.env
  popd
  pause
  exit /b 1
)
echo ok>"%APP_DIR%\server\.setup-done"
popd
echo Done. Login: admin / 12345678
pause
