@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo ZKTeco ZK4500 Bridge - Build (.NET 4 / C# 5)
echo ============================================

if not exist "Program.cs" (
  echo ERROR: Program.cs not found.
  pause
  exit /b 1
)

if not exist "sdk\libzkfpcsharp.dll" (
  echo ERROR: sdk\libzkfpcsharp.dll not found.
  pause
  exit /b 1
)

set "MSBUILD=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\MSBuild.exe"

"%MSBUILD%" "ZKTecoBridge.csproj" /t:Rebuild /p:Configuration=Release /p:Platform=x86

if errorlevel 1 (
  echo.
  echo BUILD FAILED
  pause
  exit /b 1
)

if exist "sdk\*.dll" copy /Y "sdk\*.dll" "bin\Release\" >nul

echo.
echo BUILD SUCCESS
echo EXE: %CD%\bin\Release\ZKTecoBridge.exe
echo.
pause
