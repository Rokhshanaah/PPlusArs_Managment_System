@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title PPlus.Arz - START ALL
echo ===============================================
echo   PPlus.Arz - Start All
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found.
  pause
  exit /b 1
)

set "ROOT=%CD%"
set "BRIDGE_DIR=%ROOT%\bridge\ZKTecoBridge"
set "BRIDGE_BIN=%BRIDGE_DIR%\bin\Release"
set "BRIDGE_EXE=%BRIDGE_BIN%\ZKTecoBridge.exe"
set "BRIDGE_SDK=%BRIDGE_DIR%\sdk"

echo [0/3] Freeing ports 5001 / 5173 if busy...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach($p in 5001,5173,5174){" ^
  "  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |" ^
  "    ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} }" ^
  "}"

echo.
echo [1/3] ZKTeco fingerprint bridge...
if not exist "%BRIDGE_EXE%" (
  echo     Building bridge...
  if exist "%ROOT%\BUILD-ZK4500-BRIDGE.bat" call "%ROOT%\BUILD-ZK4500-BRIDGE.bat"
)

if not exist "%BRIDGE_EXE%" (
  echo [WARN] Bridge EXE missing. Fingerprint will not work.
) else (
  if exist "%BRIDGE_SDK%\*.dll" copy /Y "%BRIDGE_SDK%\*.dll" "%BRIDGE_BIN%\" >nul 2>nul

  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ok=$false; try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:18181/health' -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -eq 200){$ok=$true} } catch {};" ^
    "if($ok){ Write-Host '    Bridge already running.'; exit 0 };" ^
    "Start-Process -FilePath '%BRIDGE_EXE%' -WorkingDirectory '%BRIDGE_BIN%';" ^
    "Start-Sleep -Seconds 2;" ^
    "try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:18181/health' -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -eq 200){ Write-Host '    Bridge started OK.'; exit 0 } } catch {};" ^
    "Write-Host '    [WARN] Bridge started but health check failed.'; exit 0"
)

echo.
echo [2/3] Dependencies...
if not exist "%ROOT%\node_modules\" (
  echo     Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo     node_modules OK
)

echo.
echo [3/3] Starting API + Web...
echo     Web:  http://localhost:5173
echo     API:  http://localhost:5001
echo     FP:   http://127.0.0.1:18181/health
echo.
echo Keep Bridge window open. Press Ctrl+C to stop app.
echo ===============================================
echo.

start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:5173/"

call npm run dev
echo.
echo Stopped.
pause
