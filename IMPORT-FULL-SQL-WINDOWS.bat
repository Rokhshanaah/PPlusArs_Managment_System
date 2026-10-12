@echo off
cd /d "%~dp0"
echo This imports database\zarin_hesab_full.sql into MySQL.
choice /M "Continue"
if errorlevel 2 exit /b 0
call npm run db:import-sql
pause
