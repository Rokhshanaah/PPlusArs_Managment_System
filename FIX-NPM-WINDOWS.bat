@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo PPlus.Arz - Clean npm installation
echo ================================================
echo.

echo [1/5] Configuring the public npm registry...
call npm config set registry https://registry.npmjs.org/
if errorlevel 1 goto :error

echo [2/5] Removing incomplete node_modules folders...
if exist node_modules rmdir /s /q node_modules
if exist server\node_modules rmdir /s /q server\node_modules
if exist frontend\node_modules rmdir /s /q frontend\node_modules

echo [3/5] Clearing npm cache...
call npm cache clean --force
if errorlevel 1 goto :error

echo [4/5] Installing dependencies from the public registry...
call npm install --no-audit --no-fund --registry=https://registry.npmjs.org/
if errorlevel 1 goto :error

echo [5/5] Installation completed successfully.
echo.
echo Next commands:
echo   npm run db:setup
echo   npm run dev
echo.
pause
exit /b 0

:error
echo.
echo Installation failed. Copy the error shown above.
pause
exit /b 1
