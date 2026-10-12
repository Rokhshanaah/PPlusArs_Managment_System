@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ===============================================
echo   PPlus.Arz - Build Windows Setup.exe
echo   Icon: zarin-logo + password-protected install
echo ===============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-installer.ps1" -SkipPortableRebuild
if errorlevel 1 (
  echo.
  echo Trying full rebuild including portable package...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-installer.ps1"
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

echo.
echo Output: release\PPlus.Arz-Setup-3.0.0.exe
echo After install, desktop shortcut name is: PPlus.Arz
pause
