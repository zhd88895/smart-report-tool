# pre-start-check.ps1
# 智能报告生成工具 - 启动前自动化检查脚本
# 版本: 1.0.0
# 编码: UTF-8 BOM (解决中文乱码问题)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ============================================================
# 配置区域
# ============================================================
$ErrorActionPreference = "Continue"
$script:CheckResults = @()
$script:AutoFixResults = @()
$script:StartTime = Get-Date
$script:LogFile = Join-Path $PSScriptRoot "logs\pre-start-check.log"
$script:RequiredNodeVersion = "18.0.0"
$script:RequiredNpmVersion = "8.0.0"
$script:DefaultPort = 3001
$script:DatabaseFile = Join-Path $PSScriptRoot "data\smart-report.db"
$script:EnvFile = Join-Path $PSScriptRoot ".env"
$script:EnvExampleFile = Join-Path $PSScriptRoot ".env.example"
$script:DistDir = Join-Path $PSScriptRoot "dist"
$script:NodeModulesDir = Join-Path $PSScriptRoot "node_modules"
$script:DataDir = Join-Path $PSScriptRoot "data"

# ============================================================
# 辅助函数
# ============================================================

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    
    # 确保日志目录存在
    $logDir = Split-Path $script:LogFile -Parent
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    
    # 写入日志文件
    Add-Content -Path $script:LogFile -Value $logEntry -Encoding UTF8
    
    # 根据级别输出到控制台
    switch ($Level) {
        "ERROR" { Write-Host $logEntry -ForegroundColor Red }
        "WARN"  { Write-Host $logEntry -ForegroundColor Yellow }
        "INFO"  { Write-Host $logEntry -ForegroundColor Green }
        "FIX"   { Write-Host $logEntry -ForegroundColor Cyan }
        default { Write-Host $logEntry }
    }
}

function Add-CheckResult {
    param(
        [string]$CheckName,
        [string]$Status,
        [string]$Message,
        [string]$AutoFixAction = "",
        [string]$AutoFixResult = ""
    )
    
    $result = @{
        CheckName = $CheckName
        Status = $Status
        Message = $Message
        AutoFixAction = $AutoFixAction
        AutoFixResult = $AutoFixResult
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    }
    
    $script:CheckResults += $result
    
    if ($Status -eq "PASS") {
        Write-Log "✅ $CheckName - $Message" -Level "INFO"
    } elseif ($Status -eq "WARN") {
        Write-Log "⚠️ $CheckName - $Message" -Level "WARN"
    } elseif ($Status -eq "FAIL") {
        Write-Log "❌ $CheckName - $Message" -Level "ERROR"
    }
    
    if ($AutoFixAction) {
        Write-Log "🔧 自动修复: $AutoFixAction" -Level "FIX"
        if ($AutoFixResult) {
            Write-Log "   修复结果: $AutoFixResult" -Level "FIX"
        }
    }
}

function Compare-Versions {
    param(
        [string]$Version1,
        [string]$Version2
    )
    
    $v1 = [version]($Version1 -replace '[^0-9.]', '')
    $v2 = [version]($Version2 -replace '[^0-9.]', '')
    
    return $v1.CompareTo($v2)
}

# ============================================================
# 检查函数
# ============================================================

function Test-NodeEnvironment {
    Write-Log "========================================" -Level "INFO"
    Write-Log "开始检查 Node.js 运行环境..." -Level "INFO"
    
    # 检查 Node.js 是否安装
    try {
        $nodeVersion = (node --version 2>&1) | Select-String -Pattern 'v[\d.]+' | ForEach-Object { $_.Matches[0].Value }
        if (-not $nodeVersion) {
            throw "Node.js 未安装或无法执行"
        }
        
        $nodeVersionNum = $nodeVersion -replace 'v', ''
        if ((Compare-Versions $nodeVersionNum $script:RequiredNodeVersion) -ge 0) {
            Add-CheckResult -CheckName "Node.js 版本" -Status "PASS" -Message "版本 $nodeVersion 满足要求 (>= v$script:RequiredNodeVersion)"
        } else {
            Add-CheckResult -CheckName "Node.js 版本" -Status "FAIL" -Message "版本 $nodeVersion 低于要求 (>= v$script:RequiredNodeVersion)"
        }
    } catch {
        Add-CheckResult -CheckName "Node.js 安装" -Status "FAIL" -Message "Node.js 未安装或无法执行: $_"
        return $false
    }
    
    # 检查 npm 是否可用
    try {
        $npmVersion = (npm --version 2>&1) | Select-String -Pattern '[\d.]+' | ForEach-Object { $_.Matches[0].Value }
        if (-not $npmVersion) {
            throw "npm 未安装或无法执行"
        }
        
        if ((Compare-Versions $npmVersion $script:RequiredNpmVersion) -ge 0) {
            Add-CheckResult -CheckName "npm 版本" -Status "PASS" -Message "版本 $npmVersion 满足要求 (>= $script:RequiredNpmVersion)"
        } else {
            Add-CheckResult -CheckName "npm 版本" -Status "WARN" -Message "版本 $npmVersion 低于建议版本 (>= $script:RequiredNpmVersion)"
        }
    } catch {
        Add-CheckResult -CheckName "npm 安装" -Status "FAIL" -Message "npm 未安装或无法执行: $_"
        return $false
    }
    
    return $true
}

function Test-Dependencies {
    Write-Log "========================================" -Level "INFO"
    Write-Log "开始检查项目依赖..." -Level "INFO"
    
    # 检查 node_modules 目录是否存在
    if (-not (Test-Path $script:NodeModulesDir)) {
        Add-CheckResult -CheckName "node_modules 目录" -Status "WARN" -Message "node_modules 目录不存在"
        
        # 自动修复：安装依赖
        Write-Log "🔧 尝试自动修复: 安装项目依赖..." -Level "FIX"
        try {
            $installResult = & npm install 2>&1
            if ($LASTEXITCODE -eq 0) {
                Add-CheckResult -CheckName "依赖安装" -Status "PASS" -Message "依赖安装成功" -AutoFixAction "npm install" -AutoFixResult "成功"
            } else {
                Add-CheckResult -CheckName "依赖安装" -Status "FAIL" -Message "依赖安装失败: $installResult" -AutoFixAction "npm install" -AutoFixResult "失败"
                return $false
            }
        } catch {
            Add-CheckResult -CheckName "依赖安装" -Status "FAIL" -Message "依赖安装异常: $_" -AutoFixAction "npm install" -AutoFixResult "异常"
            return $false
        }
    } else {
        Add-CheckResult -CheckName "node_modules 目录" -Status "PASS" -Message "node_modules 目录存在"
    }
    
    # 检查关键依赖包是否存在
    $criticalPackages = @("express", "sqlite3", "jsonwebtoken", "bcryptjs", "dotenv")
    $missingPackages = @()
    
    foreach ($pkg in $criticalPackages) {
        $pkgPath = Join-Path $script:NodeModulesDir $pkg
        if (-not (Test-Path $pkgPath)) {
            $missingPackages += $pkg
        }
    }
    
    if ($missingPackages.Count -gt 0) {
        Add-CheckResult -CheckName "关键依赖包" -Status "WARN" -Message "缺失依赖包: $($missingPackages -join ', ')"
        
        # 自动修复：安装缺失的包
        Write-Log "🔧 尝试自动修复: 安装缺失的依赖包..." -Level "FIX"
        try {
            $installResult = & npm install $($missingPackages -join ' ') 2>&1
            if ($LASTEXITCODE -eq 0) {
                Add-CheckResult -CheckName "缺失包安装" -Status "PASS" -Message "缺失包安装成功" -AutoFixAction "npm install $($missingPackages -join ' ')" -AutoFixResult "成功"
            } else {
                Add-CheckResult -CheckName "缺失包安装" -Status "FAIL" -Message "缺失包安装失败: $installResult" -AutoFixAction "npm install $($missingPackages -join ' ')" -AutoFixResult "失败"
            }
        } catch {
            Add-CheckResult -CheckName "缺失包安装" -Status "FAIL" -Message "缺失包安装异常: $_" -AutoFixAction "npm install" -AutoFixResult "异常"
        }
    } else {
        Add-CheckResult -CheckName "关键依赖包" -Status "PASS" -Message "所有关键依赖包已安装"
    }
    
    return $true
}

function Test-Database {
    Write-Log "========================================" -Level "INFO"
    Write-Log "开始检查数据库..." -Level "INFO"
    
    # 检查 data 目录是否存在
    if (-not (Test-Path $script:DataDir)) {
        Add-CheckResult -CheckName "data 目录" -Status "WARN" -Message "data 目录不存在"
        
        # 自动修复：创建 data 目录
        Write-Log "🔧 尝试自动修复: 创建 data 目录..." -Level "FIX"
        try {
            New-Item -ItemType Directory -Path $script:DataDir -Force | Out-Null
            Add-CheckResult -CheckName "data 目录" -Status "PASS" -Message "data 目录已创建" -AutoFixAction "创建 data 目录" -AutoFixResult "成功"
        } catch {
            Add-CheckResult -CheckName "data 目录" -Status "FAIL" -Message "data 目录创建失败: $_" -AutoFixAction "创建 data 目录" -AutoFixResult "失败"
            return $false
        }
    } else {
        Add-CheckResult -CheckName "data 目录" -Status "PASS" -Message "data 目录存在"
    }
    
    # 检查 SQLite 数据库文件是否存在
    if (Test-Path $script:DatabaseFile) {
        Add-CheckResult -CheckName "SQLite 数据库" -Status "PASS" -Message "数据库文件存在: $script:DatabaseFile"
        
        # 检查数据库文件大小
        $dbSize = (Get-Item $script:DatabaseFile).Length
        $dbSizeMB = [math]::Round($dbSize / 1MB, 2)
        Add-CheckResult -CheckName "数据库大小" -Status "PASS" -Message "数据库大小: $dbSizeMB MB"
        
        # 检查数据库是否可访问（使用 sqlite3 命令行工具）
        try {
            $sqlitePath = Get-Command sqlite3 -ErrorAction SilentlyContinue
            if ($sqlitePath) {
                $tables = & sqlite3 $script:DatabaseFile ".tables" 2>&1
                if ($tables -match "users|scripts|templates|reports") {
                    Add-CheckResult -CheckName "数据库表结构" -Status "PASS" -Message "必要的数据表已存在"
                } else {
                    Add-CheckResult -CheckName "数据库表结构" -Status "WARN" -Message "可能缺少必要的数据表，将在启动时自动创建"
                }
            } else {
                Add-CheckResult -CheckName "sqlite3 工具" -Status "WARN" -Message "sqlite3 命令行工具未安装，跳过表结构检查"
            }
        } catch {
            Add-CheckResult -CheckName "数据库访问" -Status "WARN" -Message "数据库访问检查失败: $_"
        }
    } else {
        Add-CheckResult -CheckName "SQLite 数据库" -Status "WARN" -Message "数据库文件不存在，将在首次启动时自动创建"
    }
    
    return $true
}

function Test-Configuration {
    Write-Log "========================================" -Level "INFO"
    Write-Log "开始检查配置文件..." -Level "INFO"
    
    # 检查 .env 文件是否存在
    if (-not (Test-Path $script:EnvFile)) {
        Add-CheckResult -CheckName ".env 文件" -Status "WARN" -Message ".env 配置文件不存在"
        
        # 自动修复：从 .env.example 复制
        if (Test-Path $script:EnvExampleFile) {
            Write-Log "🔧 尝试自动修复: 从 .env.example 创建 .env 文件..." -Level "FIX"
            try {
                Copy-Item -Path $script:EnvExampleFile -Destination $script:EnvFile -Force
                Add-CheckResult -CheckName ".env 文件" -Status "PASS" -Message ".env 文件已从 .env.example 创建" -AutoFixAction "复制 .env.example" -AutoFixResult "成功"
            } catch {
                Add-CheckResult -CheckName ".env 文件" -Status "FAIL" -Message ".env 文件创建失败: $_" -AutoFixAction "复制 .env.example" -AutoFixResult "失败"
                return $false
            }
        } else {
            # 创建默认的 .env 文件
            Write-Log "🔧 尝试自动修复: 创建默认 .env 文件..." -Level "FIX"
            $defaultEnv = @"
# 智能报告生成工具 - 环境配置文件
# 此文件由启动检查脚本自动生成

# 服务器配置
PORT=3001
NODE_ENV=development

# JWT 配置
JWT_SECRET=$(New-Guid).ToString().Replace('-', '')
JWT_EXPIRES_IN=24h

# 数据库配置
DATA_DIR=./data

# 日志配置
LOG_MAX_SIZE=10485760
LOG_MAX_FILES=10

# 安全配置
BCRYPT_ROUNDS=12

# CORS 配置
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
"@
            try {
                $defaultEnv | Out-File -FilePath $script:EnvFile -Encoding UTF8
                Add-CheckResult -CheckName ".env 文件" -Status "PASS" -Message "默认 .env 文件已创建" -AutoFixAction "创建默认 .env 文件" -AutoFixResult "成功"
            } catch {
                Add-CheckResult -CheckName ".env 文件" -Status "FAIL" -Message "默认 .env 文件创建失败: $_" -AutoFixAction "创建默认 .env 文件" -AutoFixResult "失败"
                return $false
            }
        }
    } else {
        Add-CheckResult -CheckName ".env 文件" -Status "PASS" -Message ".env 配置文件存在"
    }
    
    # 检查关键环境变量
    $requiredVars = @("JWT_SECRET", "DATA_DIR", "PORT")
    $envContent = Get-Content $script:EnvFile -ErrorAction SilentlyContinue
    
    foreach ($var in $requiredVars) {
        if ($envContent -match "^$var=(.+)$") {
            $value = $matches[1]
            if ($value -and $value.Trim()) {
                Add-CheckResult -CheckName "环境变量 $var" -Status "PASS" -Message "$var 已配置"
            } else {
                Add-CheckResult -CheckName "环境变量 $var" -Status "WARN" -Message "$var 值为空"
            }
        } else {
            Add-CheckResult -CheckName "环境变量 $var" -Status "WARN" -Message "$var 未配置"
        }
    }
    
    # 检查 TypeScript 配置
    $tsConfigPath = Join-Path $PSScriptRoot "tsconfig.json"
    if (Test-Path $tsConfigPath) {
        Add-CheckResult -CheckName "TypeScript 配置" -Status "PASS" -Message "tsconfig.json 存在"
    } else {
        Add-CheckResult -CheckName "TypeScript 配置" -Status "WARN" -Message "tsconfig.json 不存在，可能需要创建"
    }
    
    return $true
}

function Test-Network {
    Write-Log "========================================" -Level "INFO"
    Write-Log "开始检查网络配置..." -Level "INFO"
    
    # 读取端口配置
    $port = $script:DefaultPort
    if (Test-Path $script:EnvFile) {
        $envContent = Get-Content $script:EnvFile -ErrorAction SilentlyContinue
        if ($envContent -match "^PORT=(\d+)$") {
            $port = [int]$matches[1]
        }
    }
    
    # 检查端口是否被占用
    try {
        $portCheck = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($portCheck) {
            $processId = $portCheck[0].OwningProcess
            $processName = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
            Add-CheckResult -CheckName "端口 $port" -Status "WARN" -Message "端口 $port 已被占用 (进程: $processName, PID: $processId)"
            
            # 尝试终止占用进程
            Write-Log "🔧 尝试自动修复: 终止占用端口的进程..." -Level "FIX"
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Start-Sleep -Seconds 1
                Add-CheckResult -CheckName "端口 $port" -Status "PASS" -Message "端口 $port 已释放" -AutoFixAction "终止进程 $processName" -AutoFixResult "成功"
            } catch {
                Add-CheckResult -CheckName "端口 $port" -Status "FAIL" -Message "无法终止占用端口的进程: $_" -AutoFixAction "终止进程" -AutoFixResult "失败"
            }
        } else {
            Add-CheckResult -CheckName "端口 $port" -Status "PASS" -Message "端口 $port 可用"
        }
    } catch {
        Add-CheckResult -CheckName "端口检查" -Status "WARN" -Message "端口检查失败: $_"
    }
    
    return $true
}

function Test-BuildStatus {
    Write-Log "========================================" -Level "INFO"
    Write-Log "开始检查构建状态..." -Level "INFO"
    
    # 检查 dist 目录是否存在
    if (-not (Test-Path $script:DistDir)) {
        Add-CheckResult -CheckName "dist 目录" -Status "WARN" -Message "dist 目录不存在"
        
        # 自动修复：构建项目
        Write-Log "🔧 尝试自动修复: 构建项目..." -Level "FIX"
        try {
            $buildResult = & npm run build 2>&1
            if ($LASTEXITCODE -eq 0) {
                Add-CheckResult -CheckName "项目构建" -Status "PASS" -Message "项目构建成功" -AutoFixAction "npm run build" -AutoFixResult "成功"
            } else {
                Add-CheckResult -CheckName "项目构建" -Status "FAIL" -Message "项目构建失败: $buildResult" -AutoFixAction "npm run build" -AutoFixResult "失败"
                return $false
            }
        } catch {
            Add-CheckResult -CheckName "项目构建" -Status "FAIL" -Message "项目构建异常: $_" -AutoFixAction "npm run build" -AutoFixResult "异常"
            return $false
        }
    } else {
        Add-CheckResult -CheckName "dist 目录" -Status "PASS" -Message "dist 目录存在"
        
        # 检查入口文件是否存在
        $entryFile = Join-Path $script:DistDir "index.js"
        if (Test-Path $entryFile) {
            Add-CheckResult -CheckName "入口文件" -Status "PASS" -Message "入口文件 dist/index.js 存在"
        } else {
            Add-CheckResult -CheckName "入口文件" -Status "FAIL" -Message "入口文件 dist/index.js 不存在"
            return $false
        }
    }
    
    return $true
}

# ============================================================
# 主执行流程
# ============================================================

function Start-PreCheck {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  智能报告生成工具 - 启动前自动化检查" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Log "启动前检查开始..." -Level "INFO"
    
    # 执行所有检查
    $nodeOk = Test-NodeEnvironment
    if ($nodeOk) {
        Test-Dependencies | Out-Null
    }
    Test-Database | Out-Null
    Test-Configuration | Out-Null
    Test-Network | Out-Null
    Test-BuildStatus | Out-Null
    
    # 输出检查摘要
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  检查结果摘要" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    
    $passCount = ($script:CheckResults | Where-Object { $_.Status -eq "PASS" }).Count
    $warnCount = ($script:CheckResults | Where-Object { $_.Status -eq "WARN" }).Count
    $failCount = ($script:CheckResults | Where-Object { $_.Status -eq "FAIL" }).Count
    
    Write-Host "✅ 通过: $passCount" -ForegroundColor Green
    Write-Host "⚠️  警告: $warnCount" -ForegroundColor Yellow
    Write-Host "❌ 失败: $failCount" -ForegroundColor Red
    Write-Host ""
    
    # 输出失败项详情
    if ($failCount -gt 0) {
        Write-Host "失败项详情:" -ForegroundColor Red
        Write-Host "--------------------------------------------" -ForegroundColor Red
        
        $script:CheckResults | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object {
            Write-Host "  ❌ $($_.CheckName)" -ForegroundColor Red
            Write-Host "     原因: $($_.Message)" -ForegroundColor Gray
            if ($_.AutoFixAction) {
                Write-Host "     尝试修复: $($_.AutoFixAction)" -ForegroundColor Gray
                Write-Host "     修复结果: $($_.AutoFixResult)" -ForegroundColor Gray
            }
            Write-Host ""
        }
    }
    
    # 计算执行时间
    $endTime = Get-Date
    $duration = $endTime - $script:StartTime
    $durationStr = "{0:mm\:ss}" -f $duration
    
    Write-Host "检查耗时: $durationStr" -ForegroundColor Gray
    Write-Host ""
    
    # 决定是否继续启动
    if ($failCount -gt 0) {
        Write-Host "❌ 存在失败的检查项，请解决上述问题后重试" -ForegroundColor Red
        Write-Host "   日志文件: $script:LogFile" -ForegroundColor Gray
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Red
        Write-Host "  启动前检查失败，服务无法启动" -ForegroundColor Red
        Write-Host "============================================" -ForegroundColor Red
        Write-Host ""
        
        Write-Log "启动前检查失败，存在 $failCount 个失败项" -Level "ERROR"
        exit 1
    } elseif ($warnCount -gt 0) {
        Write-Host "⚠️  存在警告项，但不影响启动" -ForegroundColor Yellow
        Write-Host "   日志文件: $script:LogFile" -ForegroundColor Gray
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Yellow
        Write-Host "  启动前检查通过 (有警告)" -ForegroundColor Yellow
        Write-Host "============================================" -ForegroundColor Yellow
        Write-Host ""
        
        Write-Log "启动前检查通过 (有 $warnCount 个警告)" -Level "WARN"
        exit 0
    } else {
        Write-Host "============================================" -ForegroundColor Green
        Write-Host "  启动前检查全部通过" -ForegroundColor Green
        Write-Host "============================================" -ForegroundColor Green
        Write-Host ""
        
        Write-Log "启动前检查全部通过" -Level "INFO"
        exit 0
    }
}

# 执行检查
Start-PreCheck
