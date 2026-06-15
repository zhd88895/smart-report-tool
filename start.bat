@echo off
echo ============================================
echo   Smart Report Tool - Starting...
echo ============================================
echo.
echo Starting Backend (port 3001)...
start "Backend-3001" cmd /c "cd /d %~dp0smart-report-server && npx tsx src/index.ts && pause"
echo.
echo Starting Frontend (port 5173)...
start "Frontend-5173" cmd /c "cd /d %~dp0smart-report-tool && npx vite --port 5173 && pause"
echo.
echo ============================================
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo ============================================
echo.
pause
