# ============================================================
#  Smart Report Tool - One-Click Start Script (PowerShell)
#  Version: v0.4.0
#  Description: Start both frontend and backend services
# ============================================================

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

# ---- Version Info ----
$VERSION = "0.4.0"

function Write-Banner {
    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "        Smart Report Tool v$VERSION" -ForegroundColor White
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "  Backend:   http://localhost:3001" -ForegroundColor Green
    Write-Host "  Frontend:  http://localhost:5173" -ForegroundColor Green
    Write-Host "  Health:    http://localhost:3001/api/health" -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Yellow
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Test-PortFree([int]$port) {
    $used = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
    return ($null -eq $used)
}

function Test-Dependencies {
    Write-Host "[CHECK] Verifying dependencies..." -ForegroundColor Cyan

    # Check Node.js
    try {
        $nodeVersion = node --version 2>&1
        Write-Host "  OK Node.js: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Host "  FAIL Node.js is not installed" -ForegroundColor Red
        exit 1
    }

    # Check backend dependencies
    $backendModules = Join-Path $root "smart-report-server\node_modules"
    if (-not (Test-Path $backendModules)) {
        Write-Host "[INSTALL] Installing backend dependencies..." -ForegroundColor Yellow
        Push-Location (Join-Path $root "smart-report-server")
        npm install
        Pop-Location
    } else {
        Write-Host "  OK Backend dependencies installed" -ForegroundColor Green
    }

    # Check frontend dependencies
    $frontendModules = Join-Path $root "smart-report-tool\node_modules"
    if (-not (Test-Path $frontendModules)) {
        Write-Host "[INSTALL] Installing frontend dependencies..." -ForegroundColor Yellow
        Push-Location (Join-Path $root "smart-report-tool")
        npm install
        Pop-Location
    } else {
        Write-Host "  OK Frontend dependencies installed" -ForegroundColor Green
    }

    # Check .env file
    $envFile = Join-Path $root "smart-report-server\.env"
    if (-not (Test-Path $envFile)) {
        Write-Host "[CONFIG] Creating .env file..." -ForegroundColor Yellow
        $envExample = Join-Path $root "smart-report-server\.env.example"
        if (Test-Path $envExample) {
            Copy-Item $envExample $envFile
            Write-Host "  WARN Please edit smart-report-server/.env and set JWT_SECRET" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  OK Environment config exists" -ForegroundColor Green
    }

    Write-Host ""
}

# ---- Main Flow ----

# Check port usage
if (-not (Test-PortFree 3001)) {
    Write-Host "[WARN] Port 3001 is already in use, backend may be running" -ForegroundColor Yellow
    $continue = Read-Host "Continue? (y/N)"
    if ($continue -ne "y") { exit 0 }
}
if (-not (Test-PortFree 5173)) {
    Write-Host "[WARN] Port 5173 is already in use, frontend may be running" -ForegroundColor Yellow
    $continue = Read-Host "Continue? (y/N)"
    if ($continue -ne "y") { exit 0 }
}

# Check dependencies
Test-Dependencies

# Show banner
Write-Banner

$backendDir  = Join-Path $root "smart-report-server"
$frontendDir = Join-Path $root "smart-report-tool"

# Init block: set UTF-8
$initBlock = {
    $u8 = [System.Text.Encoding]::UTF8
    [Console]::OutputEncoding = $u8
    [Console]::InputEncoding  = $u8
    $OutputEncoding = $u8
}

# Backend job
Write-Host "[START] Starting backend service..." -ForegroundColor Cyan
$backendJob = Start-Job -Name "Backend" -InitializationScript $initBlock -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env:NODE_OPTIONS = "--no-warnings"
    $env:FORCE_COLOR = "1"
    & npx tsx src/index.ts 2>&1
} -ArgumentList $backendDir

# Frontend job
Write-Host "[START] Starting frontend service..." -ForegroundColor Cyan
$frontendJob = Start-Job -Name "Frontend" -InitializationScript $initBlock -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env:NODE_OPTIONS = "--no-warnings"
    $env:FORCE_COLOR = "1"
    & npx vite --port 5173 2>&1
} -ArgumentList $frontendDir

Write-Host ""
Write-Host "[DONE] Services are starting, please wait..." -ForegroundColor Green
Write-Host ""

try {
    while ($true) {
        # Backend output
        $backendOutput = Receive-Job -Job $backendJob 2>&1
        foreach ($line in $backendOutput) {
            $str = if ($line -is [string]) { $line } else { "$line" }
            if ($str -match "(?i)error|fail|ERR]") {
                Write-Host "[Backend] $str" -ForegroundColor Red
            } elseif ($str -match "(?i)warn") {
                Write-Host "[Backend] $str" -ForegroundColor Yellow
            } else {
                Write-Host "[Backend] $str" -ForegroundColor Green
            }
        }

        # Frontend output
        $frontendOutput = Receive-Job -Job $frontendJob 2>&1
        foreach ($line in $frontendOutput) {
            $str = if ($line -is [string]) { $line } else { "$line" }
            if ($str -match "(?i)error|fail") {
                Write-Host "[Frontend] $str" -ForegroundColor Red
            } elseif ($str -match "(?i)warn") {
                Write-Host "[Frontend] $str" -ForegroundColor Yellow
            } else {
                Write-Host "[Frontend] $str" -ForegroundColor Blue
            }
        }

        # Check for unexpected exit
        if ($backendJob.State -in @("Failed","Completed")) {
            Write-Host "[ERROR] Backend service stopped unexpectedly! Check port 3001" -ForegroundColor Red
            break
        }
        if ($frontendJob.State -in @("Failed","Completed")) {
            Write-Host "[ERROR] Frontend service stopped unexpectedly! Check port 5173" -ForegroundColor Red
            break
        }

        Start-Sleep -Milliseconds 300
    }
}
finally {
    Write-Host ""
    Write-Host "[STOP] Stopping all services..." -ForegroundColor Yellow
    Stop-Job  -Job $backendJob  -ErrorAction SilentlyContinue
    Remove-Job -Job $backendJob  -ErrorAction SilentlyContinue
    Stop-Job  -Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job -Job $frontendJob -ErrorAction SilentlyContinue

    foreach ($port in @(3001, 5173)) {
        $lines = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
        foreach ($l in $lines) {
            $m = [regex]::Match($l, '\s+(\d+)\s*$')
            if ($m.Success) {
                Stop-Process -Id ([int]$m.Groups[1].Value) -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Write-Host "[DONE] All services stopped" -ForegroundColor Green
    Write-Host ""
}
