@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo   PPlus.Arz - Node 24 + React + MySQL
 echo =============================================
echo.
node --version || goto :node_error
npm --version || goto :node_error
node -e "const m=Number(process.versions.node.split('.')[0]); if(m!==24){console.error('Node.js 24 is required. Current: '+process.versions.node); process.exit(1)}" || goto :node_error

echo [1/2] Installing all frontend and backend packages...
call npm install
if errorlevel 1 goto :failed

echo [2/2] Creating MySQL database, tables and initial administrator...
call npm run db:setup
if errorlevel 1 goto :mysql_error

echo.
echo Setup completed successfully.
echo Login: admin / 12345678
echo Now run RUN-WINDOWS.bat or npm run dev
goto :end

:node_error
echo.
echo Node.js 24.x and npm 11.x are required.
goto :failed

:mysql_error
echo.
echo MySQL is not reachable. Start MySQL in XAMPP and check server\.env.
goto :failed

:failed
echo.
echo Setup failed. Read README.md for the exact steps.
pause
exit /b 1

:end
pause
