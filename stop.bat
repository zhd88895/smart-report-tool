@echo off
setlocal

echo.
echo [STOP] Stopping Smart Report Tool...
echo.

REM Stop backend (port 3001)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do (
    echo Stopping backend process: %%a
    taskkill /PID %%a /F >nul 2>&1
)

REM Stop frontend (port 5173)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    echo Stopping frontend process: %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo [DONE] All services stopped
echo.
pause
