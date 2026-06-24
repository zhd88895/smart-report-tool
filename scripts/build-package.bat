@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo 智能报告生成工具 — 一键部署包构建脚本
echo ============================================
echo.

:: 读取版本号
cd /d "%~dp0.."
set ROOT=%CD%

for /f "tokens=2 delims=:" %%a in ('findstr /r /c:"""version"""" %ROOT%\smart-report-tool\package.json') do (
  for /f "tokens=*" %%b in ("%%a") do set VERSION=%%~b
)
set VERSION=%VERSION:"=%
set VERSION=%VERSION:,=%
set VERSION=%VERSION: =%

echo [1/5] 构建前端...
cd /d "%ROOT%\smart-report-tool"
if exist node_modules\.package-lock.json (
    echo 依赖已安装，跳过 npm install
) else (
    echo 安装前端依赖...
    call npm install
)
call npm run build
if %ERRORLEVEL% neq 0 (
    echo 前端构建失败！
    pause
    exit /b 1
)
echo 前端构建完成。

echo.
echo [2/5] 编译后端...
cd /d "%ROOT%\smart-report-server"
if exist node_modules\.package-lock.json (
    echo 依赖已安装，跳过 npm install
) else (
    echo 安装后端依赖...
    call npm install
)
call npx tsc
if %ERRORLEVEL% neq 0 (
    echo 后端编译失败！
    pause
    exit /b 1
)
echo 后端编译完成。

echo.
echo [3/5] 准备部署目录...
set DEPLOY_DIR=%ROOT%\smart-report-deploy-v%VERSION%
if exist "%DEPLOY_DIR%" rmdir /s /q "%DEPLOY_DIR%"
mkdir "%DEPLOY_DIR%"

:: 复制后端
mkdir "%DEPLOY_DIR%\server"
mkdir "%DEPLOY_DIR%\server\dist"
xcopy /E /I /Y "%ROOT%\smart-report-server\dist\*" "%DEPLOY_DIR%\server\dist\" >nul
copy /Y "%ROOT%\smart-report-server\package.json" "%DEPLOY_DIR%\server\" >nul

:: 复制前端编译产物到 server/public
mkdir "%DEPLOY_DIR%\server\public"
xcopy /E /I /Y "%ROOT%\smart-report-tool\dist\*" "%DEPLOY_DIR%\server\public\" >nul
echo 前端+后端文件复制完成。

echo.
echo [4/5] 生成启动脚本...

:: install.bat
(
echo @echo off
echo chcp 65001 ^>nul
echo echo ============================================
echo echo 智能报告生成工具 — 环境安装
echo echo ============================================
echo echo.
echo echo [1/3] 检查 Node.js...
echo node --version ^>nul 2^>^&1
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo 错误: 未检测到 Node.js，请先安装 Node.js 18+
echo     echo 下载地址: https://nodejs.org/
echo     pause
echo     exit /b 1
echo ^)
echo for /f "tokens=*" %%%%a in ^('node --version'^) do echo Node.js 版本: %%%%a
echo echo.
echo echo [2/3] 安装后端依赖...
echo cd /d "%%~dp0server"
echo call npm install --omit=dev
echo if %%ERRORLEVEL%% neq 0 ^(
echo     echo 依赖安装失败！
echo     pause
echo     exit /b 1
echo ^)
echo echo 依赖安装完成。
echo echo.
echo echo [3/3] 创建数据目录...
echo mkdir "%%~dp0..\智能报告生成工具" 2^>nul
echo echo.
echo echo ============================================
echo echo 安装完成！请运行 start.bat 启动服务
echo echo ============================================
echo pause
) > "%DEPLOY_DIR%\install.bat"

:: start.bat
(
echo @echo off
echo chcp 65001 ^>nul
echo title 智能报告生成工具 - APL v%VERSION%
echo echo ============================================
echo echo 智能报告生成工具 v%VERSION%
echo echo 服务启动中...
echo echo ============================================
echo echo.
echo cd /d "%%~dp0server"
echo echo ^> 启动后端服务 ^(端口 3001^)...
echo echo.
echo echo 访问地址: http://localhost:3001
echo echo 按 Ctrl+C 停止服务
echo echo ============================================
echo echo.
echo node dist\index.js
echo pause
) > "%DEPLOY_DIR%\start.bat"

:: README.txt
(
echo ============================================
echo   智能报告生成工具 v%VERSION%
echo   Windows 一键部署包
echo ============================================
echo.
echo 【部署步骤】
echo.
echo 1. 将整个文件夹复制到目标主机
echo    （建议放在 C:\ 或 D:\ 根目录）
echo.
echo 2. 双击运行 install.bat
echo    自动检查 Node.js 环境并安装依赖
echo.
echo 3. 双击运行 start.bat
echo    启动服务后，浏览器访问 http://localhost:3001
echo.
echo 【系统要求】
echo   - Windows 10/11 或 Windows Server 2016+
echo   - Node.js 18+ （https://nodejs.org/）
echo.
echo 【目录结构】
echo   server\          后端服务
echo   server\public\   前端页面（已构建）
echo   install.bat      环境安装脚本
echo   start.bat        启动脚本
echo   README.txt       本文件
echo.
echo 【默认账号】
echo   管理员: admin / admin123
echo   高级用户: senior / admin123
echo   普通用户: member / admin123
echo.
echo 【注意事项】
echo   - 首次启动会自动在用户目录创建"智能报告生成工具"数据文件夹
echo   - 所有数据（脚本/模板/报告/用户）存储在该文件夹的 db.json 中
echo   - 生产环境建议配置 Windows 防火墙允许端口 3001 入站
echo   - 如需修改端口，编辑 server\dist\index.js 中的 PORT 变量
) > "%DEPLOY_DIR%\README.txt"

echo 启动脚本生成完成。

echo.
echo [5/5] 打包...
cd /d "%ROOT%"
set ZIP_FILE=%ROOT%\smart-report-v%VERSION%-windows.zip
if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%"

:: 使用 PowerShell 打包
powershell -Command "Compress-Archive -Path '%DEPLOY_DIR%' -DestinationPath '%ZIP_FILE%' -Force"

if %ERRORLEVEL% neq 0 (
    echo ZIP 打包失败，但部署目录已就绪：%DEPLOY_DIR%
    pause
    exit /b 1
)

rmdir /s /q "%DEPLOY_DIR%"

echo.
echo ============================================
echo 构建完成！
echo 输出文件: %ZIP_FILE%
echo ============================================
echo.
echo 使用方法：
echo   1. 将 ZIP 解压到目标主机
echo   2. 运行 install.bat
echo   3. 运行 start.bat
echo.
pause
