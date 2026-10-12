@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "DEST=%CD%\bridge\ZKTecoBridge\sdk\libzkfpcsharp.dll"

if exist "%DEST%" (
  echo libzkfpcsharp.dll already exists:
  echo %DEST%
  pause
  exit /b 0
)

echo Searching Downloads for the official x86 libzkfpcsharp.dll...
set "FOUND="
for /r "%USERPROFILE%\Downloads" %%F in (libzkfpcsharp.dll) do (
  echo %%~dpF | findstr /i "\\x86\\" >nul
  if not errorlevel 1 if not defined FOUND set "FOUND=%%F"
)

if not defined FOUND (
  echo.
  echo x86 libzkfpcsharp.dll was not found automatically.
  echo Copy it manually from your ZKFinger SDK C#\lib\x86 folder to:
  echo %CD%\bridge\ZKTecoBridge\sdk\
  pause
  exit /b 1
)

copy /Y "!FOUND!" "%DEST%" >nul
if errorlevel 1 (
  echo Copy failed.
  pause
  exit /b 1
)

echo.
echo Copied successfully from:
echo !FOUND!
echo To:
echo %DEST%
pause
