@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo Run this file as Administrator.
  pause
  exit /b 1
)

netsh http delete urlacl url=http://127.0.0.1:18181/ >nul 2>&1
netsh http add urlacl url=http://127.0.0.1:18181/ user="%USERNAME%"

call build.bat
if errorlevel 1 exit /b 1

call run.bat
