@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ===============================================
echo   PPlus.Arz - Build Portable Installer
echo ===============================================
echo.
echo This downloads portable Node.js 24 into release\
echo and builds a customer package that does NOT
echo depend on the system Node.js version.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-portable.ps1"
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Package ready in release\PPlusArz-Portable\
echo Zip: release\PPlusArz-Portable.zip
pause
