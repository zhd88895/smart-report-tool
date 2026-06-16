# ============================================================
#  智能报告生成工具 - 一键启动脚本
#  前后端在同一窗口并行运行，Ctrl+C 同时停止
# ============================================================

# ---- 编码修复：解决中文乱码 ----
$ConsoleEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding   = $ConsoleEncoding
[Console]::InputEncoding    = $ConsoleEncoding
$OutputEncoding             = $ConsoleEncoding
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Write-Banner {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   Smart Report Tool  v0.1.0" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   Backend:  http://localhost:3001" -ForegroundColor Green
    Write-Host "   Frontend: http://localhost:5173" -ForegroundColor Green
    Write-Host "   Ctrl+C to stop all services" -ForegroundColor Gray
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Test-PortFree([int]$port) {
    $used = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
    return ($null -eq $used)
}

if (-not (Test-PortFree 3001)) {
    Write-Host "[WARN] Port 3001 is in use, backend may already be running." -ForegroundColor Yellow
}
if (-not (Test-PortFree 5173)) {
    Write-Host "[WARN] Port 5173 is in use, frontend may already be running." -ForegroundColor Yellow
}

Write-Banner

$backendDir  = Join-Path $root "smart-report-server"
$frontendDir = Join-Path $root "smart-report-tool"

# ---- 初始化代码块：确保子进程也使用 UTF-8 编码 ----
$initBlock = {
    $u8 = [System.Text.Encoding]::UTF8
    [Console]::OutputEncoding = $u8
    [Console]::InputEncoding  = $u8
    $OutputEncoding = $u8
}

# 后端 Job
$backendJob = Start-Job -Name "Backend" -InitializationScript $initBlock -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env:NODE_OPTIONS = "--no-warnings"
    $env.FORCE_COLOR = "1"
    & npx tsx src/index.ts 2>&1
} -ArgumentList $backendDir

# 前端 Job
$frontendJob = Start-Job -Name "Frontend" -InitializationScript $initBlock -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env.NODE_OPTIONS = "--no-warnings"
    $env.FORCE_COLOR = "1"
    & npx vite --port 5173 2>&1
} -ArgumentList $frontendDir

Write-Host "[INFO] Starting services..." -ForegroundColor DarkGray
Write-Host ""

try {
    while ($true) {
        # 后端输出
        $backendOutput = Receive-Job -Job $backendJob 2>&1
        foreach ($line in $backendOutput) {
            $str = if ($line -is [string]) { $line } else { "$line" }
            if ($str -match "(?i)error|fail|ERR]") {
                Write-Host "[BACK] $str" -ForegroundColor Red
            } elseif ($str -match "(?i)warn") {
                Write-Host "[BACK] $str" -ForegroundColor Yellow
            } else {
                Write-Host "[BACK] $str" -ForegroundColor Green
            }
        }

        # 前端输出
        $frontendOutput = Receive-Job -Job $frontendJob 2>&1
        foreach ($line in $frontendOutput) {
            $str = if ($line -is [string]) { $line } else { "$line" }
            if ($str -match "(?i)error|fail") {
                Write-Host "[FRONT] $str" -ForegroundColor Red
            } elseif ($str -match "(?i)warn") {
                Write-Host "[FRONT] $str" -ForegroundColor Yellow
            } else {
                Write-Host "[FRONT] $str" -ForegroundColor Blue
            }
        }

        # 检查 Job 是否意外退出
        if ($backendJob.State -in @("Failed","Completed")) {
            Write-Host "[ERROR] Backend stopped unexpectedly! Check port 3001." -ForegroundColor Red
            break
        }
        if ($frontendJob.State -in @("Failed","Completed")) {
            Write-Host "[ERROR] Frontend stopped unexpectedly! Check port 5173." -ForegroundColor Red
            break
        }

        Start-Sleep -Milliseconds 300
    }
}
finally {
    # 清理
    Write-Host ""
    Write-Host "[INFO] Stopping all services..." -ForegroundColor Yellow
    Stop-Job  -Job $backendJob  -ErrorAction SilentlyContinue
    Remove-Job -Job $backendJob  -ErrorAction SilentlyContinue
    Stop-Job  -Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job -Job $frontendJob -ErrorAction SilentlyContinue

    # 按端口 kill
    foreach ($port in @(3001, 5173)) {
        $lines = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
        foreach ($l in $lines) {
            $m = [regex]::Match($l, '\s+(\d+)\s*$')
            if ($m.Success) {
                Stop-Process -Id ([int]$m.Groups[1].Value) -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Write-Host "[INFO] All services stopped." -ForegroundColor Green
    Write-Host ""
}
