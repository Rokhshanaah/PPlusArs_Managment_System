@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "NODE_DIR=%~dp0runtime\node-v24.16.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
set "APP_DIR=%~dp0app"
set "BRIDGE_EXE=%~dp0bridge\ZKTecoBridge.exe"
set "SETUP_FLAG=%APP_DIR%\server\.setup-done"

title PPlus.Arz
echo ===============================================
echo   PPlus.Arz
echo ===============================================
echo.

if not exist "%NODE_DIR%\node.exe" (
  echo [ERROR] Embedded Node.js missing.
  pause
  exit /b 1
)

if not exist "%APP_DIR%\server\.env" (
  echo First run: creating settings...
  copy /Y "%APP_DIR%\server\.env.example" "%APP_DIR%\server\.env" >nul
)

if not exist "%SETUP_FLAG%" (
  echo.
  echo MySQL must be running (XAMPP - Start MySQL).
  echo If MySQL root has a password, edit:
  echo   %APP_DIR%\server\.env
  echo.
  pause
  pushd "%APP_DIR%"
  call "%NODE_DIR%\npm.cmd" run db:setup
  if errorlevel 1 (
    echo Database setup failed.
    popd
    pause
    exit /b 1
  )
  popd
  echo ok>"%SETUP_FLAG%"
)

if exist "%BRIDGE_EXE%" (
  start "" /D "%~dp0bridge" "%BRIDGE_EXE%"
)

echo.
echo Opening http://localhost:5001
echo Keep this window open while using the app.
echo ===============================================
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:5001/"

pushd "%APP_DIR%"
"%NODE_DIR%\node.exe" server\src\server.js
set "ERR=%ERRORLEVEL%"
popd
echo.
echo Stopped.
pause
exit /b %ERR%
