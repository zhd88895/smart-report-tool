@echo off
setlocal

echo.
echo ====================================================
echo        Smart Report Tool v0.4.0
echo ====================================================
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo ====================================================
echo.

REM Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed. Please install Node.js 18+
    pause
    exit /b 1
)

REM Install backend dependencies
if not exist "smart-report-server\node_modules" (
    echo [INSTALL] Installing backend dependencies...
    cd smart-report-server
    call npm install
    cd ..
)

REM Install frontend dependencies
if not exist "smart-report-tool\node_modules" (
    echo [INSTALL] Installing frontend dependencies...
    cd smart-report-tool
    call npm install
    cd ..
)

REM Create .env file if not exists
if not exist "smart-report-server\.env" (
    if exist "smart-report-server\.env.example" (
        echo [CONFIG] Creating environment config...
        copy "smart-report-server\.env.example" "smart-report-server\.env" >nul
        echo [WARN] Please edit smart-report-server/.env and set JWT_SECRET
    )
)

echo [START] Starting backend service...
start "SmartReport-Backend" cmd /c "cd smart-report-server && npx tsx src/index.ts"

timeout /t 3 /nobreak >nul

echo [START] Starting frontend service...
start "SmartReport-Frontend" cmd /c "cd smart-report-tool && npx vite --port 5173"

echo.
echo [DONE] Services are starting...
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo.
echo Press any key to open browser...
pause >nul

start http://localhost:5173

echo.
echo To stop services, run stop.bat
pause
