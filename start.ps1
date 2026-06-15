$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Smart Report Tool - Starting..." -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/2] Starting Backend (port 3001)..." -ForegroundColor Yellow
$backendDir = Join-Path $root "smart-report-server"
Start-Process cmd -ArgumentList "/k", "cd /d `"$backendDir`" && npx tsx src/index.ts" -WindowStyle Normal

Write-Host "[2/2] Starting Frontend (port 5173)..." -ForegroundColor Yellow
$frontendDir = Join-Path $root "smart-report-tool"
Start-Process cmd -ArgumentList "/k", "cd /d `"$frontendDir`" && npx vite --port 5173" -WindowStyle Normal

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:3001" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to close this window (services keep running)..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
