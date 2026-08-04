/**
 * Python 版本管理服务
 * 
 * 本模块提供 Python 版本的下载、安装、管理功能。
 * 支持从 python.org 下载嵌入式 Python 版本，并管理已安装的版本。
 * 
 * @module pythonVersionService
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { getConfig } from '../config';
import { logger, getLogger, generateTraceId } from '../utils/logger';
import { safeErrorMessage } from '../types';
import https from 'https';
import http from 'http';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// 模块级日志实例
const log = getLogger('PythonVersionService', 'core');

/** Python 版本信息接口 */
export interface PythonVersionInfo {
  /** 版本号，如 '3.11.9' */
  version: string;
  /** 主版本号，如 '3.11' */
  majorVersion: string;
  /** 下载 URL */
  downloadUrl: string;
  /** 是否已安装 */
  isInstalled: boolean;
  /** 安装路径（如果已安装） */
  installPath?: string;
  /** 安装日期 */
  installedAt?: string;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 安装状态 */
  installStatus: 'not_installed' | 'installed' | 'partial' | 'error';
  /** pip 是否可用 */
  pipAvailable: boolean;
  /** virtualenv 是否可用 */
  virtualenvAvailable: boolean;
  /** 错误信息（如果有） */
  error?: string;
}

/** 安装状态接口 */
export interface InstallProgress {
  /** 当前阶段 */
  stage: 'downloading' | 'extracting' | 'configuring' | 'installing_pip' | 'installing_virtualenv' | 'done' | 'error';
  /** 进度百分比 0-100 */
  progress: number;
  /** 当前状态消息 */
  message: string;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * Python 版本管理服务类
 */
export class PythonVersionService {
  private readonly pythonVersionsDir: string;
  private readonly embeddedPythonDir: string;
  
  /** 支持的 Python 版本列表（主版本号 → 最新稳定版本）
   *
   * 注意：以下版本号必须是 python.org 上真实存在 embeddable package 的补丁版本。
   * 3.7/3.8 的最终安全修复版只有源码包，因此使用最后一个提供 Windows embeddable 包的补丁。
   */
  private static readonly SUPPORTED_VERSIONS: Record<string, string> = {
    '3.14': '3.14.6',
    '3.13': '3.13.14',
    '3.12': '3.12.8',
    '3.11': '3.11.9',
    '3.10': '3.10.11',
    '3.9': '3.9.13',
    '3.8': '3.8.10',
    '3.7': '3.7.9',
    '3.6': '3.6.8',
  };
  
  /** 当前仅支持 Windows 平台（amd64 embeddable package） */
  private static readonly SUPPORTED_PLATFORM = 'win32';

  /** 各版本下载配置（pth 文件前缀、可扩展的版本特定参数） */
  private static readonly VERSION_DOWNLOAD_CONFIG: Record<string, { pthBase: string }> = {
    '3.14.6': { pthBase: 'python314' },
    '3.13.14': { pthBase: 'python313' },
    '3.12.8': { pthBase: 'python312' },
    '3.11.9': { pthBase: 'python311' },
    '3.10.11': { pthBase: 'python310' },
    '3.9.13': { pthBase: 'python39' },
    '3.8.10': { pthBase: 'python38' },
    '3.7.9': { pthBase: 'python37' },
    '3.6.8': { pthBase: 'python36' },
  };

  /** get-pip.py 下载 URL */
  private static readonly GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

  /** 通用睡眠工具 */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  constructor() {
    const config = getConfig();
    this.pythonVersionsDir = path.join(config.DATA_DIR, 'python-versions');
    this.embeddedPythonDir = path.join(config.DATA_DIR, 'python-embedded');
    
    // 确保目录存在
    if (!fsSync.existsSync(this.pythonVersionsDir)) {
      fsSync.mkdirSync(this.pythonVersionsDir, { recursive: true });
    }
  }

  /**
   * 获取可用的 Python 版本列表
   * 
   * @returns 可用版本信息列表
   */
  async getAvailableVersions(): Promise<PythonVersionInfo[]> {
    const traceId = generateTraceId();
    log.info('获取可用 Python 版本列表', traceId);
    
    const versions: PythonVersionInfo[] = [];
    
    // 添加支持 embeddable package 的版本
    for (const [majorVersion, fullVersion] of Object.entries(PythonVersionService.SUPPORTED_VERSIONS)) {
      const installPath = this.getVersionInstallPath(fullVersion);
      const isInstalled = fsSync.existsSync(installPath);
      
      const downloadUrl = this.getVersionDownloadUrl(fullVersion);
      
      let installedAt: string | undefined;
      let fileSize: number | undefined;
      let pipAvailable = false;
      let virtualenvAvailable = false;
      let installStatus: PythonVersionInfo['installStatus'] = 'not_installed';
      let error: string | undefined;
      
      if (isInstalled) {
        try {
          const pythonExe = path.join(installPath, 'python.exe');
          const stats = await fs.stat(pythonExe);
          installedAt = stats.mtime.toISOString();
          
          // 获取目录大小
          fileSize = await this.getDirectorySize(installPath);
          
          // 检查 pip 是否可用
          pipAvailable = await this.checkPipAvailable(installPath);
          
          // 检查 virtualenv 是否可用
          virtualenvAvailable = await this.checkVirtualenvAvailable(installPath);
          
          // 确定安装状态
          if (pipAvailable && virtualenvAvailable) {
            installStatus = 'installed';
          } else if (pipAvailable || virtualenvAvailable) {
            installStatus = 'partial';
            error = `部分组件缺失: ${!pipAvailable ? 'pip' : ''} ${!virtualenvAvailable ? 'virtualenv' : ''}`.trim();
          } else {
            installStatus = 'error';
            error = 'pip 和 virtualenv 均不可用';
          }
        } catch (err) {
          installStatus = 'error';
          error = `检测失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      
      versions.push({
        version: fullVersion,
        majorVersion,
        downloadUrl,
        isInstalled,
        installPath: isInstalled ? installPath : undefined,
        installedAt,
        fileSize,
        installStatus,
        pipAvailable,
        virtualenvAvailable,
        error,
      });
    }

    log.info(`返回 ${versions.length} 个可用版本`, traceId);
    return versions;
  }

  /**
   * 获取已安装的 Python 版本列表
   * 
   * @returns 已安装版本信息列表
   */
  async getInstalledVersions(): Promise<PythonVersionInfo[]> {
    const traceId = generateTraceId();
    log.info('获取已安装 Python 版本列表', traceId);
    
    const allVersions = await this.getAvailableVersions();
    return allVersions.filter(v => v.isInstalled);
  }

  /**
   * 下载并安装指定版本的 Python
   * 
   * @param version - 版本号，如 '3.12.8' 或 '3.12'
   * @param onProgress - 进度回调函数
   * @returns 安装结果
   */
  async downloadAndInstall(
    version: string,
    onProgress?: (progress: InstallProgress) => void
  ): Promise<{ success: boolean; message: string; installPath?: string }> {
    const traceId = generateTraceId();
    log.info(`开始下载安装 Python ${version}`, traceId);
    
    const sendProgress = (stage: InstallProgress['stage'], progress: number, message: string) => {
      onProgress?.({ stage, progress, message });
    };
    
    try {
      // 解析完整版本号
      const fullVersion = this.resolveVersion(version);
      if (!fullVersion) {
        throw new Error(`不支持的 Python 版本: ${version}`);
      }
      
      const installPath = this.getVersionInstallPath(fullVersion);
      
      // 检查是否已安装
      if (fsSync.existsSync(installPath)) {
        log.info(`Python ${fullVersion} 已安装`, traceId);
        return {
          success: true,
          message: `Python ${fullVersion} 已安装`,
          installPath,
        };
      }
      
      // 步骤 1: 下载嵌入式 Python
      sendProgress('downloading', 0, `正在下载 Python ${fullVersion}...`);
      const zipPath = await this.downloadVersionPackage(fullVersion, (downloaded, total) => {
        const progress = Math.round((downloaded / total) * 40);
        sendProgress('downloading', progress, `正在下载 Python ${fullVersion}... (${Math.round(downloaded / 1024 / 1024)}MB/${Math.round(total / 1024 / 1024)}MB)`);
      });
      log.info(`Python ${fullVersion} 下载完成`, traceId);
      
      // 步骤 2: 解压（仅适用于 embeddable package）
      // 检查是否为完整安装包（.exe 文件）
      if (zipPath.endsWith('.exe')) {
        // 完整安装包需要静默安装
        sendProgress('extracting', 40, '正在安装 Python...');
        await this.installFullPython(zipPath, installPath, fullVersion);
        log.info(`Python ${fullVersion} 安装完成`, traceId);
      } else {
        // 嵌入式包直接解压
        sendProgress('extracting', 40, '正在解压文件...');
        await this.extractPythonZip(zipPath, installPath);
        log.info(`Python ${fullVersion} 解压完成`, traceId);
      }
      
      // 步骤 3: 配置
      sendProgress('configuring', 50, '正在配置环境...');
      await this.configurePythonInstallation(fullVersion, installPath);
      log.info(`Python ${fullVersion} 配置完成`, traceId);
      
      // 步骤 4: 安装 pip
      sendProgress('installing_pip', 60, '正在安装 pip...');
      const majorVersion = fullVersion.split('.').slice(0, 2).join('.'); // '3.12' 或 '3.9'
      await this.installPip(installPath, majorVersion);
      log.info(`Python ${fullVersion} pip 安装完成`, traceId);
      
      // 步骤 5: 安装 virtualenv
      sendProgress('installing_virtualenv', 80, '正在安装 virtualenv...');
      await this.installVirtualenv(installPath, fullVersion);
      log.info(`Python ${fullVersion} virtualenv 安装完成`, traceId);
      
      // 步骤 6: 验证安装
      sendProgress('done', 95, '正在验证安装...');
      await this.verifyInstallation(installPath, fullVersion);
      
      // 清理下载文件
      await fs.unlink(zipPath).catch(() => {});
      
      sendProgress('done', 100, `Python ${fullVersion} 安装成功！`);
      log.info(`✓ Python ${fullVersion} 安装成功`, traceId, { installPath });
      
      return {
        success: true,
        message: `Python ${fullVersion} 安装成功`,
        installPath,
      };
    } catch (error: unknown) {
      const errorMessage = safeErrorMessage(error);
      sendProgress('error', 0, `安装失败: ${errorMessage}`);
      log.error(`Python 安装失败: ${errorMessage}`, traceId, { error: errorMessage });
      
      return {
        success: false,
        message: `安装失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 删除已安装的 Python 版本
   * 
   * @param version - 版本号
   * @returns 是否删除成功
   */
  async deleteVersion(version: string): Promise<{ success: boolean; message: string }> {
    const traceId = generateTraceId();
    log.info(`删除 Python 版本: ${version}`, traceId);
    
    const fullVersion = this.resolveVersion(version);
    if (!fullVersion) {
      return { success: false, message: `无效的版本号: ${version}` };
    }
    
    const installPath = this.getVersionInstallPath(fullVersion);
    
    if (!fsSync.existsSync(installPath)) {
      return { success: false, message: `Python ${fullVersion} 未安装` };
    }
    
    try {
      await fs.rm(installPath, { recursive: true, force: true });
      log.info(`✓ Python ${fullVersion} 已删除`, traceId);
      return { success: true, message: `Python ${fullVersion} 已删除` };
    } catch (error: unknown) {
      const errorMessage = safeErrorMessage(error);
      log.error(`删除失败: ${errorMessage}`, traceId);
      return { success: false, message: `删除失败: ${errorMessage}` };
    }
  }

  /**
   * 获取指定版本的 Python 可执行文件路径
   * 
   * @param version - 版本号
   * @returns Python 可执行文件路径，如果未安装则返回 null
   */
  getPythonExecutable(version: string): string | null {
    const fullVersion = this.resolveVersion(version);
    if (!fullVersion) return null;
    
    const installPath = this.getVersionInstallPath(fullVersion);
    const pythonExe = path.join(installPath, 'python.exe');
    
    return fsSync.existsSync(pythonExe) ? pythonExe : null;
  }

  /**
   * 解析版本号为完整版本号
   * 
   * @param version - 版本号（可以是 '3.12' 或 '3.12.8'）
   * @returns 完整版本号
   */
  private resolveVersion(version: string): string | null {
    // 如果已经是完整版本号（主版本键映射）
    if (PythonVersionService.SUPPORTED_VERSIONS[version]) {
      return PythonVersionService.SUPPORTED_VERSIONS[version];
    }

    // 检查是否已登记为完整版本号
    for (const fullVersion of Object.values(PythonVersionService.SUPPORTED_VERSIONS)) {
      if (fullVersion === version) {
        return version;
      }
    }

    // 尝试匹配主版本号
    const majorVersion = version.split('.').slice(0, 2).join('.'); // '3.12' 或 '3.9'
    if (PythonVersionService.SUPPORTED_VERSIONS[majorVersion]) {
      return PythonVersionService.SUPPORTED_VERSIONS[majorVersion];
    }

    return null;
  }

  /**
   * 获取版本安装路径
   * 
   * @param version - 完整版本号
   * @returns 安装路径
   */
  private getVersionInstallPath(version: string): string {
    return path.join(this.pythonVersionsDir, version);
  }

  /**
   * 获取指定版本的下载 URL
   *
   * 每个版本的 URL 规则在此集中管理，方便后续针对特定版本做特殊处理。
   *
   * @param version - 完整版本号
   * @returns python.org 下载 URL
   */
  private getVersionDownloadUrl(version: string): string {
    return `https://www.python.org/ftp/python/${version}/python-${version}-embed-amd64.zip`;
  }

  /**
   * 获取指定版本的备用下载 URL
   */
  private getVersionFallbackDownloadUrl(version: string): string {
    return `https://www.python.org/ftp/python/${version}/python-${version}-embeddable-amd64.zip`;
  }

  /**
   * 版本独立下载调度器
   *
   * 根据完整版本号调用对应的专属下载方法，避免统一模板在 URL/文件名
   * 适配上的版本兼容性问题。
   */
  private async downloadVersionPackage(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    if (process.platform !== PythonVersionService.SUPPORTED_PLATFORM) {
      throw new Error(`Python 版本下载当前仅支持 ${PythonVersionService.SUPPORTED_PLATFORM} 平台`);
    }

    const fullVersion = this.resolveVersion(version);
    if (!fullVersion) {
      throw new Error(`不支持的 Python 版本: ${version}`);
    }

    switch (fullVersion) {
      case '3.14.6':
        return this.downloadPython3_14(fullVersion, onProgress);
      case '3.13.14':
        return this.downloadPython3_13(fullVersion, onProgress);
      case '3.12.8':
        return this.downloadPython3_12(fullVersion, onProgress);
      case '3.11.9':
        return this.downloadPython3_11(fullVersion, onProgress);
      case '3.10.11':
        return this.downloadPython3_10(fullVersion, onProgress);
      case '3.9.13':
        return this.downloadPython3_9(fullVersion, onProgress);
      case '3.8.10':
        return this.downloadPython3_8(fullVersion, onProgress);
      case '3.7.9':
        return this.downloadPython3_7(fullVersion, onProgress);
      case '3.6.8':
        return this.downloadPython3_6(fullVersion, onProgress);
      default:
        throw new Error(`未找到版本 ${fullVersion} 的专属下载方法`);
    }
  }

  // ====================== 各版本专属下载方法 ======================
  // 每个方法独立管理：下载 URL、文件名、备用源。后续如某版本需要特殊处理
  // （例如不同的压缩包格式、自定义解压目录、额外补丁），可直接在对应方法中修改。

  /** Python 3.14 专属下载 */
  private async downloadPython3_14(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.14] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.13 专属下载 */
  private async downloadPython3_13(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.13] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.12 专属下载 */
  private async downloadPython3_12(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.12] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.11 专属下载 */
  private async downloadPython3_11(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.11] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.10 专属下载 */
  private async downloadPython3_10(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.10] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.9 专属下载 */
  private async downloadPython3_9(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.9] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.8 专属下载
   *
   * 注意：3.8 的后续安全修复版只有源码包，这里使用最后一个提供 embeddable 包的 3.8.10。
   */
  private async downloadPython3_8(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.8] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.7 专属下载
   *
   * 注意：3.7 的后续安全修复版只有源码包，这里使用最后一个提供 embeddable 包的 3.7.9。
   */
  private async downloadPython3_7(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.7] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  /** Python 3.6 专属下载 */
  private async downloadPython3_6(
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string> {
    const filename = `python-${version}-embed-amd64.zip`;
    const url = this.getVersionDownloadUrl(version);
    const fallbackUrl = this.getVersionFallbackDownloadUrl(version);
    const destPath = path.join(this.pythonVersionsDir, filename);

    log.info(`[Python 3.6] 下载 embeddable package: ${url}`);
    await this.downloadPackageWithFallback(url, fallbackUrl, destPath, version, onProgress);
    return destPath;
  }

  // ====================== 下载辅助方法 ======================

  /**
   * 带主/备 URL 和重试的下载
   */
  private async downloadPackageWithFallback(
    primaryUrl: string,
    fallbackUrl: string,
    destPath: string,
    version: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<void> {
    const errors: string[] = [];
    for (const url of [primaryUrl, fallbackUrl]) {
      try {
        await this.downloadPackageWithRetry(url, destPath, version, onProgress);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${url}: ${msg}`);
        log.warn(`[${version}] URL 失败: ${url} - ${msg}`);
        await fs.unlink(destPath).catch(() => {});
      }
    }
    throw new Error(`所有下载 URL 都失败: ${errors.join('; ')}`);
  }

  /**
   * 带指数退避重试的单一 URL 下载
   */
  private async downloadPackageWithRetry(
    url: string,
    destPath: string,
    version: string,
    onProgress?: (downloaded: number, total: number) => void,
    maxRetries = 3
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.performDownload(url, destPath, onProgress);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          const delayMs = attempt * 1000;
          log.warn(`[${version}] 第 ${attempt} 次下载失败，${delayMs}ms 后重试...`);
          await PythonVersionService.sleep(delayMs);
          await fs.unlink(destPath).catch(() => {});
        }
      }
    }

    throw lastError;
  }

  /**
   * 执行一次 HTTP 下载
   */
  private async performDownload(
    url: string,
    destPath: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const doRequest = (reqUrl: string, redirectCount: number = 0): void => {
        if (redirectCount > 5) {
          reject(new Error('重定向次数过多'));
          return;
        }

        const client = reqUrl.startsWith('https') ? https : http;

        const req = client.get(reqUrl, { timeout: 30000 }, (response) => {
          // 处理重定向
          if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              const absoluteUrl = redirectUrl.startsWith('http')
                ? redirectUrl
                : new URL(redirectUrl, reqUrl).toString();
              log.info(`重定向到: ${absoluteUrl}`);
              doRequest(absoluteUrl, redirectCount + 1);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`下载失败，状态码: ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloadedSize = 0;

          const fileStream = createWriteStream(destPath);

          response.on('data', (chunk: Buffer) => {
            downloadedSize += chunk.length;
            onProgress?.(downloadedSize, totalSize);
          });

          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });

          fileStream.on('error', (err) => {
            fs.unlink(destPath).catch(() => {});
            reject(err);
          });

          response.on('error', (err) => {
            fileStream.close();
            fs.unlink(destPath).catch(() => {});
            reject(err);
          });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('下载请求超时'));
        });
      };

      doRequest(url);
    });
  }

  /**
   * 解压 Python 嵌入式压缩包
   *
   * @param zipPath - 压缩包路径
   * @param installPath - 安装路径
   */
  private async extractPythonZip(zipPath: string, installPath: string): Promise<void> {
    // 创建安装目录
    await fs.mkdir(installPath, { recursive: true });
    
    // 使用 PowerShell 解压（Windows 自带）
    return new Promise((resolve, reject) => {
      const command = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${installPath}' -Force"`;
      
      execSync(command, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 60000,
      });
      
      resolve();
    });
  }

  /**
   * 配置 Python 安装
   * 
   * @param version - 版本号
   * @param installPath - 安装路径
   */
  private async configurePythonInstallation(version: string, installPath: string): Promise<void> {
    // 从版本配置中读取 pth 文件前缀，找不到时按旧规则推导
    const config = PythonVersionService.VERSION_DOWNLOAD_CONFIG[version];
    const pthBase = config?.pthBase ?? `python${version.replace(/\./g, '').substring(0, 3)}`;
    const pthFileName = `${pthBase}._pth`;
    const pthPath = path.join(installPath, pthFileName);
    
    if (fsSync.existsSync(pthPath)) {
      let content = await fs.readFile(pthPath, 'utf-8');
      
      // 取消注释 import site（如果已注释）
      if (content.includes('#import site')) {
        content = content.replace('#import site', 'import site');
      } else if (!content.includes('import site')) {
        content += '\nimport site\n';
      }
      
      await fs.writeFile(pthPath, content, 'utf-8');
      log.info(`已配置 ${pthFileName}: 启用 site 模块`);
    }
  }

  /**
   * 安装 pip
   * 
   * @param installPath - Python 安装路径
   * @param majorVersion - 主版本号，如 '3.12'
   */
  private async installPip(installPath: string, majorVersion: string): Promise<void> {
    const pythonExe = path.join(installPath, 'python.exe');
    const getpipPath = path.join(installPath, 'get-pip.py');
    
    // 根据 Python 版本选择合适的 get-pip.py URL
    // Python 3.9 及更早版本使用版本专用 get-pip；Python 3.10+ 使用通用版本
    const minor = parseInt(majorVersion.split('.')[1] || '0', 10);
    const getpipUrls: string[] = [];
    if (minor <= 9) {
      getpipUrls.push(`https://bootstrap.pypa.io/pip/${majorVersion}/get-pip.py`);
    }
    getpipUrls.push(PythonVersionService.GET_PIP_URL);

    let lastError: Error | undefined;
    for (const getpipUrl of getpipUrls) {
      log.info(`下载 get-pip.py (${getpipUrl})...`);
      try {
        await this.downloadPackageWithRetry(getpipUrl, getpipPath, majorVersion);
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        log.warn(`get-pip.py 下载失败: ${lastError.message}`);
      }
    }
    if (lastError) {
      throw lastError;
    }
    
    // 运行 get-pip.py
    // 使用较长的超时和重试，避免网络波动导致 pip 安装失败
    // 默认使用国内 PyPI 镜像（清华），避免 pypi.org 在部分网络环境下 SSL 握手失败
    log.info('运行 get-pip.py...');
    const pipIndexUrl = getConfig().PIP_INDEX_URL;
    const pipEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PIP_DEFAULT_TIMEOUT: '120',
      PIP_RETRIES: '5',
    };
    // get-pip.py 只接受 --no-setuptools/--no-wheel，超时/重试通过环境变量控制
    const getPipArgs = [getpipPath, '--index-url', pipIndexUrl];

    return new Promise((resolve, reject) => {
      const p = spawn(pythonExe, getPipArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: installPath,
        env: pipEnv,
      });
      
      let output = '';
      
      p.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      p.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      p.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pip 安装失败，退出码: ${code}\n${output.slice(-500)}`));
        }
      });
      
      p.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 安装 virtualenv
   *
   * 注意：virtualenv 最新版对 Python 版本有要求，需为旧版本指定兼容版本。
   * - Python 3.6 → virtualenv==20.17.1
   * - Python 3.7 → virtualenv<20.27
   * - Python 3.8 → virtualenv<20.30
   *
   * @param installPath - Python 安装路径
   * @param version - 完整版本号，如 '3.11.9'
   */
  private async installVirtualenv(installPath: string, version: string): Promise<void> {
    const pythonExe = path.join(installPath, 'python.exe');
    const pipExe = path.join(installPath, 'Scripts', 'pip.exe');

    // 根据 Python 版本选择 virtualenv 兼容版本
    const [major, minor] = version.split('.').map(v => parseInt(v, 10));
    let virtualenvSpec = 'virtualenv';
    if (major === 3 && minor === 6) {
      virtualenvSpec = 'virtualenv==20.17.1';
    } else if (major === 3 && minor === 7) {
      virtualenvSpec = 'virtualenv<20.27';
    } else if (major === 3 && minor === 8) {
      virtualenvSpec = 'virtualenv<20.30';
    }

    // 如果 pip 不存在，使用 python -m pip
    const pipIndexUrl = getConfig().PIP_INDEX_URL;
    const pipCmd = fsSync.existsSync(pipExe) ? pipExe : pythonExe;
    const pipArgs = fsSync.existsSync(pipExe)
      ? ['install', virtualenvSpec, '--index-url', pipIndexUrl, '--timeout', '120', '--retries', '5']
      : ['-m', 'pip', 'install', virtualenvSpec, '--index-url', pipIndexUrl, '--timeout', '120', '--retries', '5'];

    const pipEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PIP_DEFAULT_TIMEOUT: '120',
      PIP_RETRIES: '5',
    };

    return new Promise((resolve, reject) => {
      const p = spawn(pipCmd, pipArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: installPath,
        env: pipEnv,
      });
      
      let output = '';
      
      p.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      p.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      p.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`virtualenv 安装失败，退出码: ${code}\n${output.slice(-500)}`));
        }
      });
      
      p.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 验证 Python 安装
   * 
   * @param installPath - 安装路径
   * @param expectedVersion - 期望的版本号
   */
  private async verifyInstallation(installPath: string, expectedVersion: string): Promise<void> {
    const pythonExe = path.join(installPath, 'python.exe');
    
    if (!fsSync.existsSync(pythonExe)) {
      throw new Error('Python 可执行文件不存在');
    }
    
    return new Promise((resolve, reject) => {
      const p = spawn(pythonExe, ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let output = '';
      
      p.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      p.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      p.on('close', (code) => {
        if (code === 0 && output.includes(expectedVersion)) {
          resolve();
        } else {
          reject(new Error(`版本验证失败，期望: ${expectedVersion}，实际: ${output.trim()}`));
        }
      });
      
      p.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 获取目录大小
   * 
   * @param dirPath - 目录路径
   * @returns 目录大小（字节）
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let size = 0;
    
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        size += await this.getDirectorySize(itemPath);
      } else {
        const stats = await fs.stat(itemPath);
        size += stats.size;
      }
    }
    
    return size;
  }

  /**
   * 检查 pip 是否可用
   * 
   * @param installPath - Python 安装路径
   * @returns pip 是否可用
   */
  private async checkPipAvailable(installPath: string): Promise<boolean> {
    try {
      const pythonExe = path.join(installPath, 'python.exe');
      const pipExe = path.join(installPath, 'Scripts', 'pip.exe');
      
      // 检查 pip.exe 是否存在
      if (fsSync.existsSync(pipExe)) {
        return true;
      }
      
      // 检查 python -m pip 是否可用
      return new Promise((resolve) => {
        const p = spawn(pythonExe, ['-m', 'pip', '--version'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        });
        
        let output = '';
        p.stdout.on('data', (data) => { output += data.toString(); });
        p.stderr.on('data', (data) => { output += data.toString(); });
        
        p.on('close', (code) => {
          resolve(code === 0 && output.includes('pip'));
        });
        
        p.on('error', () => {
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * 检查 virtualenv 是否可用
   * 
   * @param installPath - Python 安装路径
   * @returns virtualenv 是否可用
   */
  private async checkVirtualenvAvailable(installPath: string): Promise<boolean> {
    try {
      const pythonExe = path.join(installPath, 'python.exe');
      const virtualenvExe = path.join(installPath, 'Scripts', 'virtualenv.exe');
      
      // 检查 virtualenv.exe 是否存在
      if (fsSync.existsSync(virtualenvExe)) {
        return true;
      }
      
      // 检查 python -m virtualenv 是否可用
      return new Promise((resolve) => {
        const p = spawn(pythonExe, ['-m', 'virtualenv', '--version'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        });
        
        let output = '';
        p.stdout.on('data', (data) => { output += data.toString(); });
        p.stderr.on('data', (data) => { output += data.toString(); });
        
        p.on('close', (code) => {
          resolve(code === 0 && output.includes('virtualenv'));
        });
        
        p.on('error', () => {
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * 安装完整 Python 安装包（.exe 文件）
   * 
   * @param exePath - 安装包路径
   * @param installPath - 安装路径
   * @param version - 版本号
   */
  private async installFullPython(exePath: string, installPath: string, version: string): Promise<void> {
    log.info(`开始安装 Python ${version} 到 ${installPath}`);
    
    // 使用静默安装模式
    // /quiet - 静默安装
    // InstallAllUsers=0 - 仅当前用户
    // TargetDir=<path> - 安装目录
    // PrependPath=0 - 不添加到 PATH
    // Include_test=0 - 不安装测试模块
    const command = `"${exePath}" /quiet InstallAllUsers=0 TargetDir="${installPath}" PrependPath=0 Include_test=0 Include_launcher=0`;
    
    return new Promise((resolve, reject) => {
      try {
        execSync(command, {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
          timeout: 300000, // 5 分钟超时
        });
        
        // 验证安装是否成功
        const pythonExe = path.join(installPath, 'python.exe');
        if (fsSync.existsSync(pythonExe)) {
          log.info(`Python ${version} 安装成功`);
          resolve();
        } else {
          reject(new Error('Python 安装失败：找不到 python.exe'));
        }
      } catch (error) {
        reject(new Error(`Python 安装失败: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }
}

/**
 * Python 版本管理服务单例实例
 */
export const pythonVersionService = new PythonVersionService();