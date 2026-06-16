# ============================================================
#  智能报告生成工具 - 停止服务
# ============================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  停止所有服务..." -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan

$ports = @(3001, 5173)
$stopped = 0

foreach ($port in $ports) {
    $lines = netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING"
    foreach ($l in $lines) {
        $m = [regex]::Match($l, '\s+(\d+)\s*$')
        if ($m.Success) {
            $pid = [int]$m.Groups[1].Value
            Write-Host "  停止 PID $pid (端口 $port)" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            $stopped++
        }
    }
}

if ($stopped -eq 0) {
    Write-Host "  未发现正在运行的服务。" -ForegroundColor Gray
} else {
    Write-Host "  已停止 $stopped 个进程。" -ForegroundColor Green
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
