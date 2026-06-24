[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Stopping all services..." -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan

$ports = @(3001, 5173)
$stopped = 0

foreach ($port in $ports) {
    $lines = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
    foreach ($l in $lines) {
        $m = [regex]::Match($l, '\s+(\d+)\s*$')
        if ($m.Success) {
            $pid = [int]$m.Groups[1].Value
            Write-Host "  Stopping PID $pid (port $port)" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            $stopped++
        }
    }
}

if ($stopped -eq 0) {
    Write-Host "  No running services found." -ForegroundColor Gray
} else {
    Write-Host "  Stopped $stopped process(es)." -ForegroundColor Green
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
