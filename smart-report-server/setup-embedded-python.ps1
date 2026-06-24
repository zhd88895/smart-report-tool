# setup-embedded-python.ps1
# 下载并配置内嵌 Python 环境
# 此脚本会在 data/python-embedded 目录下创建一个完整的 Python 环境

$ErrorActionPreference = "Stop"

# Python 版本配置
$PYTHON_VERSION = "3.11.9"
$PYTHON_DIR = Join-Path $PSScriptRoot "data\python-embedded"
$PYTHON_EXE = Join-Path $PYTHON_DIR "python.exe"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  内嵌 Python 环境配置工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否已存在
if (Test-Path $PYTHON_EXE) {
    Write-Host "[OK] 内嵌 Python 已存在: $PYTHON_EXE" -ForegroundColor Green
    & $PYTHON_EXE --version
    Write-Host ""
    Write-Host "如需重新安装，请先删除目录: $PYTHON_DIR" -ForegroundColor Yellow
    exit 0
}

# 创建目录
Write-Host "[1/4] 创建目录: $PYTHON_DIR" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $PYTHON_DIR | Out-Null

# 下载 Python 嵌入式包
$ARCH = if ([System.Environment]::Is64BitOperatingSystem) { "amd64" } else { "win32" }
$ZIP_URL = "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-embed-$ARCH.zip"
$ZIP_FILE = Join-Path $PYTHON_DIR "python-embed.zip"

Write-Host "[2/4] 下载 Python $PYTHON_VERSION ($ARCH)..." -ForegroundColor Yellow
Write-Host "  URL: $ZIP_URL" -ForegroundColor Gray

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $ZIP_URL -OutFile $ZIP_FILE -UseBasicParsing
    Write-Host "  下载完成" -ForegroundColor Green
} catch {
    Write-Host "  下载失败: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "请手动下载 Python 嵌入式包并解压到: $PYTHON_DIR" -ForegroundColor Yellow
    Write-Host "下载地址: https://www.python.org/downloads/embeddable/" -ForegroundColor Yellow
    exit 1
}

# 解压
Write-Host "[3/4] 解压文件..." -ForegroundColor Yellow
try {
    Expand-Archive -Path $ZIP_FILE -DestinationPath $PYTHON_DIR -Force
    Remove-Item $ZIP_FILE -Force
    Write-Host "  解压完成" -ForegroundColor Green
} catch {
    Write-Host "  解压失败: $_" -ForegroundColor Red
    exit 1
}

# 配置 pip（嵌入式版本默认不带 pip）
Write-Host "[4/4] 配置 pip..." -ForegroundColor Yellow

# 下载 get-pip.py
$GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
$GET_PIP_FILE = Join-Path $PYTHON_DIR "get-pip.py"

try {
    Invoke-WebRequest -Uri $GET_PIP_URL -OutFile $GET_PIP_FILE -UseBasicParsing
    
    # 修改 python311._pth 文件以启用 site-packages
    $PTH_FILE = Join-Path $PYTHON_DIR "python311._pth"
    if (Test-Path $PTH_FILE) {
        $content = Get-Content $PTH_FILE -Raw
        $content = $content -replace "#import site", "import site"
        Set-Content -Path $PTH_FILE -Value $content
    }
    
    # 安装 pip
    & $PYTHON_EXE $GET_PIP_FILE --no-warn-script-location
    Remove-Item $GET_PIP_FILE -Force
    
    Write-Host "  pip 配置完成" -ForegroundColor Green
    
    # 安装 virtualenv（嵌入式 Python 不支持 venv 模块）
    Write-Host "  正在安装 virtualenv..." -ForegroundColor Gray
    & $PYTHON_EXE -m pip install virtualenv --no-warn-script-location 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  virtualenv 安装完成" -ForegroundColor Green
    } else {
        Write-Host "  virtualenv 安装失败（可稍后手动安装）" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  pip 配置失败（可稍后手动配置）: $_" -ForegroundColor Yellow
}

# 验证安装
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if (Test-Path $PYTHON_EXE) {
    Write-Host "[SUCCESS] 内嵌 Python 环境配置成功！" -ForegroundColor Green
    Write-Host ""
    & $PYTHON_EXE --version
    Write-Host ""
    Write-Host "安装位置: $PYTHON_DIR" -ForegroundColor Gray
} else {
    Write-Host "[FAILED] 配置失败，请检查错误信息" -ForegroundColor Red
    exit 1
}
Write-Host "========================================" -ForegroundColor Cyan
