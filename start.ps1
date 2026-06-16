# ============================================================
#  智能报告生成工具 - 一键启动脚本
#  前后端在同一窗口并行运行，Ctrl+C 同时停止
# ============================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Write-Banner {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   智能报告生成工具  v0.1.0" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  后端:   http://localhost:3001" -ForegroundColor Green
    Write-Host "  前端:   http://localhost:5173" -ForegroundColor Green
    Write-Host "  Ctrl+C 退出，前后端同时停止" -ForegroundColor Gray
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

# 启动前检查端口是否已占用
function Test-PortFree([int]$port) {
    $used = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
    return ($null -eq $used)
}

if (-not (Test-PortFree 3001)) {
    Write-Host "[WARN] 端口 3001 已被占用，后端可能已在运行。" -ForegroundColor Yellow
}
if (-not (Test-PortFree 5173)) {
    Write-Host "[WARN] 端口 5173 已被占用，前端可能已在运行。" -ForegroundColor Yellow
}

Write-Banner

$backendDir  = Join-Path $root "smart-report-server"
$frontendDir = Join-Path $root "smart-report-tool"

# 用 ScriptBlock + Job 并行跑两个进程，输出带前缀区分
$backendJob = Start-Job -Name "Backend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    & npx tsx src/index.ts 2>&1
} -ArgumentList $backendDir

$frontendJob = Start-Job -Name "Frontend" -ScriptBlock {
    param($dir)
    Set-Location $dir
    & npx vite --port 5173 2>&1
} -ArgumentList $frontendDir

Write-Host "[INFO] 服务启动中，稍候..." -ForegroundColor DarkGray
Write-Host ""

# 实时轮询两个 Job 的输出，加彩色前缀后打印
try {
    while ($true) {
        # 后端输出 - 绿色前缀
        $backendOutput = Receive-Job -Job $backendJob 2>&1
        foreach ($line in $backendOutput) {
            if ($line -match "ERROR|error|Error") {
                Write-Host "[BACK] $line" -ForegroundColor Red
            } elseif ($line -match "warn|WARN|Warn") {
                Write-Host "[BACK] $line" -ForegroundColor Yellow
            } else {
                Write-Host "[BACK] $line" -ForegroundColor Green
            }
        }

        # 前端输出 - 蓝色前缀
        $frontendOutput = Receive-Job -Job $frontendJob 2>&1
        foreach ($line in $frontendOutput) {
            if ($line -match "ERROR|error|Error") {
                Write-Host "[FRONT] $line" -ForegroundColor Red
            } elseif ($line -match "warn|WARN|Warn") {
                Write-Host "[FRONT] $line" -ForegroundColor Yellow
            } else {
                Write-Host "[FRONT] $line" -ForegroundColor Blue
            }
        }

        # 检查 Job 是否意外退出
        if ($backendJob.State -eq "Failed" -or $backendJob.State -eq "Completed") {
            Write-Host "[ERROR] 后端意外停止！请检查端口 3001 或依赖是否正确安装。" -ForegroundColor Red
            break
        }
        if ($frontendJob.State -eq "Failed" -or $frontendJob.State -eq "Completed") {
            Write-Host "[ERROR] 前端意外停止！请检查端口 5173 或 node_modules 是否已安装。" -ForegroundColor Red
            break
        }

        Start-Sleep -Milliseconds 300
    }
}
finally {
    # Ctrl+C 或意外退出时，清理两个 Job
    Write-Host ""
    Write-Host "[INFO] 正在停止所有服务..." -ForegroundColor Yellow
    Stop-Job  -Job $backendJob  -ErrorAction SilentlyContinue
    Remove-Job -Job $backendJob  -ErrorAction SilentlyContinue
    Stop-Job  -Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job -Job $frontendJob -ErrorAction SilentlyContinue

    # 保险起见用端口号也 kill 一次
    foreach ($port in @(3001, 5173)) {
        $lines = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
        foreach ($l in $lines) {
            $m = [regex]::Match($l, '\s+(\d+)\s*$')
            if ($m.Success) {
                Stop-Process -Id ([int]$m.Groups[1].Value) -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Write-Host "[INFO] 所有服务已停止。" -ForegroundColor Green
    Write-Host ""
}
