Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Stopping all services..." -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan

$ports = @(3001, 5173)
foreach ($port in $ports) {
    $conns = netstat -ano | Select-String ":$port" | Select-String "LISTENING"
    foreach ($conn in $conns) {
        $pidMatch = [regex]::Match($conn, '\s+(\d+)\s*$')
        if ($pidMatch.Success) {
            $pid = $pidMatch.Groups[1].Value
            Write-Host "  Stopping PID $pid (port $port)..." -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "  All services stopped." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Start-Sleep -Seconds 2
