@echo off
setlocal EnableDelayedExpansion
title Smart Report Tool v0.4.0

echo.
echo ====================================================
echo        Smart Report Tool v0.4.0
echo ====================================================
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo ====================================================
echo.

REM ---- Check Node.js ----
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed. Please install Node.js 18+
    pause
    exit /b 1
)

REM ---- Check port conflicts ----
netstat -ano | findstr ":3001 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 3001 is already in use, backend may be running.
    set /p "CONT=Continue anyway? (y/N): "
    if /i not "!CONT!"=="y" exit /b 0
)
netstat -ano | findstr ":5173 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 5173 is already in use, frontend may be running.
    set /p "CONT=Continue anyway? (y/N): "
    if /i not "!CONT!"=="y" exit /b 0
)

REM ---- Install backend dependencies ----
if not exist "smart-report-server\node_modules" (
    echo [INSTALL] Installing backend dependencies...
    pushd smart-report-server
    call npm install
    popd
)

REM ---- Install frontend dependencies ----
if not exist "smart-report-tool\node_modules" (
    echo [INSTALL] Installing frontend dependencies...
    pushd smart-report-tool
    call npm install
    popd
)

REM ---- Create .env file if not exists ----
if not exist "smart-report-server\.env" (
    if exist "smart-report-server\.env.example" (
        echo [CONFIG] Creating environment config...
        copy "smart-report-server\.env.example" "smart-report-server\.env" >nul
        echo [WARN] Please edit smart-report-server/.env and set JWT_SECRET
    )
)

REM ---- Start backend ----
echo [START] Starting backend service...
start "SmartReport-Backend" cmd /c "cd smart-report-server && npx tsx src/index.ts"

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

REM ---- Wait for backend health (max 30s) ----
echo [WAIT] Waiting for backend to be ready...
set /a TRIES=0
:wait_backend
set /a TRIES+=1
if !TRIES! GTR 30 (
    echo [WARN] Backend health check timed out, starting frontend anyway...
    goto start_frontend
)
"%PS_EXE%" -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3001/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" | findstr "200" >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_backend
)
echo [OK] Backend is ready.

:start_frontend
REM ---- Start frontend ----
echo [START] Starting frontend service...
start "SmartReport-Frontend" cmd /c "cd smart-report-tool && npx vite --port 5173"

REM ---- Wait for frontend (max 30s) ----
echo [WAIT] Waiting for frontend to be ready...
set /a TRIES=0
:wait_frontend
set /a TRIES+=1
if !TRIES! GTR 30 (
    echo [WARN] Frontend check timed out. Please open http://localhost:5173 manually.
    goto done
)
"%PS_EXE%" -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" | findstr "200" >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_frontend
)

:done
echo.
echo [DONE] All services are up:
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo.
echo Opening browser...
start http://localhost:5173
echo.
echo Tip: run stop.bat to stop all services.
timeout /t 5 >nul
