# ═══════════════════════════════════════════════════════
#  智能报告生成工具 API 测试脚本 (PowerShell)
# ═══════════════════════════════════════════════════════
#
# 使用方法：
#   1. 确保服务器已启动：npm run dev
#   2. 运行测试：.\test-api.ps1
#
# 注意：需要 PowerShell 5.1+ (Windows 10 自带)
# ═══════════════════════════════════════════════════════

$BASE_URL = "http://localhost:3001"
$TOKEN = ""
$PASS_COUNT = 0
$FAIL_COUNT = 0

# 辅助函数：发送HTTP请求并检查结果
function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Path,
        [string]$Body = "",
        [int]$ExpectedStatus = 200,
        [switch]$NoAuth
    )
    
    Write-Host "`n--- $Name ---" -ForegroundColor Cyan
    
    $headers = @{ "Content-Type" = "application/json" }
    if (-not $NoAuth -and $TOKEN) {
        $headers["Authorization"] = "Bearer $TOKEN"
    }
    
    $uri = "$BASE_URL$Path"
    
    try {
        if ($Method -eq "GET") {
            $response = Invoke-WebRequest -Uri $uri -Headers $headers -Method Get -UseBasicParsing -ErrorAction SilentlyContinue
        }
        elseif ($Method -eq "POST") {
            $response = Invoke-WebRequest -Uri $uri -Headers $headers -Method Post -Body $body -UseBasicParsing -ErrorAction SilentlyContinue
        }
        elseif ($Method -eq "DELETE") {
            $response = Invoke-WebRequest -Uri $uri -Headers $headers -Method Delete -UseBasicParsing -ErrorAction SilentlyContinue
        }
        
        $statusCode = $response.StatusCode
        $responseBody = $response.Content | ConvertFrom-Json
        
        if ($statusCode -eq $ExpectedStatus) {
            Write-Host "  [PASS] 状态码: $statusCode" -ForegroundColor Green
            $script:PASS_COUNT++
        } else {
            Write-Host "  [FAIL] 期望状态码 $ExpectedStatus，实际 $statusCode" -ForegroundColor Red
            $script:FAIL_COUNT++
        }
        
        Write-Host "  响应: $($response.Content | ConvertFrom-Json | ConvertTo-Json -Compress)" -ForegroundColor Gray
        return $responseBody
        
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq $ExpectedStatus) {
            Write-Host "  [PASS] 状态码: $statusCode (预期错误)" -ForegroundColor Green
            $script:PASS_COUNT++
        } else {
            Write-Host "  [FAIL] 期望状态码 $ExpectedStatus，实际 $statusCode" -ForegroundColor Red
            Write-Host "  错误: $($_.Exception.Message)" -ForegroundColor Red
            $script:FAIL_COUNT++
        }
        return $null
    }
}

# ═══════════════════════════════════════════════════════
#  测试开始
# ═══════════════════════════════════════════════════════

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  智能报告生成工具 API 测试" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Yellow

# ═══════════════════════════════════════════════════════
#  1. 健康检查（不需要认证）
# ═══════════════════════════════════════════════════════

Write-Host "`n[1/7] 健康检查" -ForegroundColor Yellow
Test-Endpoint -Name "GET /api/health" -Method "GET" -Path "/api/health" -NoAuth

# ═══════════════════════════════════════════════════════
#  2. 用户注册
# ═══════════════════════════════════════════════════════

Write-Host "`n[2/7] 用户注册" -ForegroundColor Yellow
$registerBody = @{
    username = "testuser_$(Get-Random -Maximum 9999)"
    password = "Test1234"
    displayName = "Test User"
    region = "华东区"
} | ConvertTo-Json

Test-Endpoint -Name "POST /api/users/register" -Method "POST" -Path "/api/users/register" -Body $registerBody -NoAuth

# ═══════════════════════════════════════════════════════
#  3. 用户登录（获取Token）
# ═══════════════════════════════════════════════════════

Write-Host "`n[3/7] 用户登录" -ForegroundColor Yellow
$loginBody = @{
    username = "ZHD"
    password = "Aa123456"
} | ConvertTo-Json

$loginResult = Test-Endpoint -Name "POST /api/users/login" -Method "POST" -Path "/api/users/login" -Body $loginBody -NoAuth

if ($loginResult -and $loginResult.data -and $loginResult.data.token) {
    $TOKEN = $loginResult.data.token
    Write-Host "  Token获取成功" -ForegroundColor Green
} else {
    Write-Host "  [WARN] 未获取到Token，后续认证测试可能失败" -ForegroundColor Magenta
}

# ═══════════════════════════════════════════════════════
#  4. 获取脚本列表（需要认证）
# ═══════════════════════════════════════════════════════

Write-Host "`n[4/7] 获取脚本列表" -ForegroundColor Yellow
Test-Endpoint -Name "GET /api/scripts" -Method "GET" -Path "/api/scripts"

# ═══════════════════════════════════════════════════════
#  5. 获取模板列表（需要认证）
# ═══════════════════════════════════════════════════════

Write-Host "`n[5/7] 获取模板列表" -ForegroundColor Yellow
Test-Endpoint -Name "GET /api/templates" -Method "GET" -Path "/api/templates"

# ═══════════════════════════════════════════════════════
#  6. 获取报告列表（需要认证）
# ═══════════════════════════════════════════════════════

Write-Host "`n[6/7] 获取报告列表" -ForegroundColor Yellow
Test-Endpoint -Name "GET /api/reports" -Method "GET" -Path "/api/reports"

# ═══════════════════════════════════════════════════════
#  7. 测试未认证访问（应返回401）
# ═══════════════════════════════════════════════════════

Write-Host "`n[7/7] 测试未认证访问" -ForegroundColor Yellow
$oldToken = $TOKEN
$TOKEN = ""
Test-Endpoint -Name "GET /api/scripts (无Token)" -Method "GET" -Path "/api/scripts" -ExpectedStatus 401
$TOKEN = $oldToken

# ═══════════════════════════════════════════════════════
#  404 测试
# ═══════════════════════════════════════════════════════

Write-Host "`n[附加] 404测试" -ForegroundColor Yellow
Test-Endpoint -Name "GET /api/nonexistent" -Method "GET" -Path "/api/nonexistent" -ExpectedStatus 404 -NoAuth

# ═══════════════════════════════════════════════════════
#  测试结果汇总
# ═══════════════════════════════════════════════════════

Write-Host "`n═══════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  测试结果汇总" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  通过: $PASS_COUNT" -ForegroundColor Green
Write-Host "  失败: $FAIL_COUNT" -ForegroundColor Red
Write-Host "  总计: $($PASS_COUNT + $FAIL_COUNT)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Yellow

if ($FAIL_COUNT -eq 0) {
    Write-Host "`n所有测试通过！" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n有测试失败，请检查服务器日志。" -ForegroundColor Red
    exit 1
}
