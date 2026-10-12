@echo off
setlocal
cd /d "%~dp0"

echo ===============================================
echo PPlus.Arz - ZKTeco ZK4500 setup for this PC
echo ===============================================

if not exist "bridge\ZKTecoBridge\sdk\libzkfpcsharp.dll" (
  echo.
  echo ERROR: libzkfpcsharp.dll not found.
  echo Copy the official x86 DLL to:
  echo %CD%\bridge\ZKTecoBridge\sdk\
  echo.
  pause
  exit /b 1
)

if not exist "bridge\ZKTecoBridge\bin\Release\ZKTecoBridge.exe" (
  echo [1/2] Building local fingerprint bridge...
  call BUILD-ZK4500-BRIDGE.bat
  if errorlevel 1 exit /b 1
) else (
  echo [1/2] Bridge already built.
)

echo [2/2] Starting ZK4500 bridge in a separate window...
start "ZKTeco ZK4500 Bridge" cmd /k "cd /d \"%CD%\bridge\ZKTecoBridge\" && run.bat"

echo.
echo Bridge started. Test in browser:
echo http://127.0.0.1:18181/health
echo.
echo Keep the Bridge window open while using fingerprint features.
pause
