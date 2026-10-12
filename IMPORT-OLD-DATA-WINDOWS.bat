@echo off
cd /d "%~dp0"
echo This replaces matching tables with the old Laravel data.
choice /M "Continue"
if errorlevel 2 exit /b 0
call npm run db:import-legacy:force
pause
