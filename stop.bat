@echo off
title 停止服务

cls
echo.
echo ============================================
echo   停止智能报告生成工具
echo ============================================
echo.

echo 停止后端 (端口 3001)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING" 2^>nul') do (
    echo   终止 PID: %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo 停止前端 (端口 5173)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING" 2^>nul') do (
    echo   终止 PID: %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo 所有服务已停止
echo.
timeout /t 2 /nobreak >nul
