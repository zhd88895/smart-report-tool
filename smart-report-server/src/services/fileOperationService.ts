/**
 * 文件操作服务模块
 * 
 * 提供本地文件系统的操作能力，包括：
 * 1. 压缩包解压
 * 2. 目录浏览
 * 3. 文件读取
 * 4. 命令执行（安全限制）
 * 
 * @module fileOperationService
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { getLogger, generateTraceId } from '../utils/logger';
import { getConfig } from '../config';
import { ToolResult } from './agentTools';

const execFileAsync = promisify(execFile);
const log = getLogger('FileOperationService', 'core');

// 允许执行的命令白名单
const ALLOWED_COMMANDS = new Set([
  'ls', 'dir', 'find', 'grep', 'cat', 'head', 'tail', 'wc', 'file', 'stat',
  'unzip', 'tar', 'gzip', 'gunzip', '7z', 'python', 'node'
]);

// 禁止的命令（危险操作）
const FORBIDDEN_COMMANDS = new Set([
  'rm', 'del', 'rmdir', 'rd', 'format', 'mkfs', 'fdisk', 'mount', 'umount',
  'chmod', 'chown', 'chgrp', 'kill', 'killall', 'shutdown', 'reboot', 'halt'
]);

/**
 * 文件操作服务类
 */
export class FileOperationService {
  private dataDir: string;

  constructor() {
    const config = getConfig();
    this.dataDir = config.DATA_DIR;
  }

  /**
   * 解析路径（支持相对路径和绝对路径）
   */
  private resolvePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }
    return path.join(this.dataDir, inputPath);
  }

  /**
   * 验证路径安全性
   */
  private validatePath(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    // 确保路径在允许的目录内
    const allowedDirs = [
      this.dataDir,
      path.join(this.dataDir, 'uploads'),
      path.join(this.dataDir, 'scripts'),
      path.join(this.dataDir, 'reports'),
      path.join(this.dataDir, 'temp'),
    ];
    
    return allowedDirs.some(dir => resolved.startsWith(dir));
  }

  /**
   * 解压压缩包
   */
  async extractArchive(
    archivePath: string,
    targetDir?: string,
    password?: string
  ): Promise<ToolResult> {
    const traceId = generateTraceId();
    log.info(`解压压缩包: ${archivePath}`, traceId);

    try {
      const resolvedArchivePath = this.resolvePath(archivePath);
      
      // 检查文件是否存在
      if (!existsSync(resolvedArchivePath)) {
        return {
          success: false,
          error: `压缩包文件不存在: ${archivePath}`,
        };
      }

      // 确定解压目标目录
      const resolvedTargetDir = targetDir 
        ? this.resolvePath(targetDir)
        : path.join(path.dirname(resolvedArchivePath), 'extracted');

      // 确保目标目录存在
      if (!existsSync(resolvedTargetDir)) {
        mkdirSync(resolvedTargetDir, { recursive: true });
      }

      // 根据文件类型选择解压命令
      const ext = path.extname(resolvedArchivePath).toLowerCase();
      let command = '';
      let args: string[] = [];

      switch (ext) {
        case '.zip':
          command = 'unzip';
          args = ['-o', resolvedArchivePath, '-d', resolvedTargetDir];
          if (password) {
            args.push('-P', password);
          }
          break;
        case '.tar':
          command = 'tar';
          args = ['-xf', resolvedArchivePath, '-C', resolvedTargetDir];
          break;
        case '.gz':
        case '.tgz':
          if (resolvedArchivePath.endsWith('.tar.gz') || resolvedArchivePath.endsWith('.tgz')) {
            command = 'tar';
            args = ['-xzf', resolvedArchivePath, '-C', resolvedTargetDir];
          } else {
            command = 'gunzip';
            args = ['-k', resolvedArchivePath]; // -k 保留原文件
          }
          break;
        case '.rar':
          command = '7z';
          args = ['x', resolvedArchivePath, `-o${resolvedTargetDir}`, '-y'];
          if (password) {
            args.push(`-p${password}`);
          }
          break;
        case '.7z':
          command = '7z';
          args = ['x', resolvedArchivePath, `-o${resolvedTargetDir}`, '-y'];
          if (password) {
            args.push(`-p${password}`);
          }
          break;
        default:
          return {
            success: false,
            error: `不支持的压缩格式: ${ext}`,
          };
      }

      // 执行解压命令
      log.info(`执行解压命令: ${command} ${args.join(' ')}`, traceId);
      const { stdout, stderr } = await execFileAsync(command, args);
      
      // 获取解压后的文件列表
      const extractedFiles = await this.listDirectory(resolvedTargetDir, true);
      
      return {
        success: true,
        data: {
          archivePath: resolvedArchivePath,
          targetDir: resolvedTargetDir,
          extractedFiles: extractedFiles.data,
          command: `${command} ${args.join(' ')}`,
          output: stdout,
          errors: stderr,
        },
        message: `成功解压 ${ext} 文件到 ${resolvedTargetDir}`,
      };
    } catch (error: any) {
      log.error(`解压失败: ${error.message}`, traceId);
      return {
        success: false,
        error: `解压失败: ${error.message}`,
      };
    }
  }

  /**
   * 浏览目录结构
   */
  async listDirectory(
    dirPath: string,
    recursive: boolean = false,
    pattern?: string,
    maxDepth: number = 3
  ): Promise<ToolResult> {
    const traceId = generateTraceId();
    log.info(`浏览目录: ${dirPath}`, traceId);

    try {
      const resolvedDirPath = this.resolvePath(dirPath);
      
      // 检查目录是否存在
      if (!existsSync(resolvedDirPath)) {
        return {
          success: false,
          error: `目录不存在: ${dirPath}`,
        };
      }

      // 验证路径安全性
      if (!this.validatePath(resolvedDirPath)) {
        return {
          success: false,
          error: '路径安全验证失败：不允许访问该目录',
        };
      }

      // 递归读取目录
      const result = await this.readDirectoryRecursive(resolvedDirPath, recursive, pattern, maxDepth, 0);
      
      return {
        success: true,
        data: result,
        message: `成功读取目录 ${dirPath}`,
      };
    } catch (error: any) {
      log.error(`目录浏览失败: ${error.message}`, traceId);
      return {
        success: false,
        error: `目录浏览失败: ${error.message}`,
      };
    }
  }

  /**
   * 递归读取目录
   */
  private async readDirectoryRecursive(
    dirPath: string,
    recursive: boolean,
    pattern?: string,
    maxDepth: number = 3,
    currentDepth: number = 0
  ): Promise<any> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result: any[] = [];

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(this.dataDir, entryPath);

      // 应用模式过滤（简单匹配）
      if (pattern) {
        const regex = new RegExp(
          pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.')
        );
        if (!regex.test(entry.name)) {
          continue;
        }
      }

      if (entry.isDirectory()) {
        const dirInfo: any = {
          type: 'directory',
          name: entry.name,
          path: relativePath,
        };

        // 递归读取子目录
        if (recursive && currentDepth < maxDepth) {
          dirInfo.children = await this.readDirectoryRecursive(
            entryPath,
            recursive,
            pattern,
            maxDepth,
            currentDepth + 1
          );
        }

        result.push(dirInfo);
      } else {
        // 获取文件信息
       const stats = await fs.stat(entryPath);
        result.push({
          type: 'file',
          name: entry.name,
          path: relativePath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
      }
    }

    return result;
  }

  /**
   * 读取文件内容
   */
  async readFile(
    filePath: string,
    encoding: string = 'utf-8',
    maxLines: number = 1000,
    startLine: number = 1
  ): Promise<ToolResult> {
    const traceId = generateTraceId();
    log.info(`读取文件: ${filePath}`, traceId);

    try {
      const resolvedFilePath = this.resolvePath(filePath);
      
      // 检查文件是否存在
      if (!existsSync(resolvedFilePath)) {
        return {
          success: false,
          error: `文件不存在: ${filePath}`,
        };
      }

      // 验证路径安全性
      if (!this.validatePath(resolvedFilePath)) {
        return {
          success: false,
          error: '路径安全验证失败：不允许访问该文件',
        };
      }

      // 获取文件信息
      const stats = await fs.stat(resolvedFilePath);
      const fileSize = stats.size;

      // 读取文件内容
      let content = await fs.readFile(resolvedFilePath, encoding as any);
      
      // 处理换行符
      const contentStr = typeof content === 'string' ? content : content.toString('utf-8');
      const lines = contentStr.split('\n');
      const totalLines = lines.length;

      // 应用行号过滤
      const startIdx = Math.max(0, startLine - 1);
      const endIdx = Math.min(lines.length, startIdx + maxLines);
      const selectedLines = lines.slice(startIdx, endIdx);

      // 截断长内容
      const MAX_CONTENT_LENGTH = 100_000; // 100K字符
      let truncatedContent = selectedLines.join('\n');
      let truncated = false;
      
      if (truncatedContent.length > MAX_CONTENT_LENGTH) {
        truncatedContent = truncatedContent.substring(0, MAX_CONTENT_LENGTH) + '\n... (内容已截断)';
        truncated = true;
      }

      return {
        success: true,
        data: {
          filePath: resolvedFilePath,
          fileName: path.basename(resolvedFilePath),
          fileSize,
          encoding,
          totalLines,
          selectedLines: selectedLines.length,
          startLine,
          endLine: Math.min(startLine + maxLines - 1, totalLines),
          content: truncatedContent,
          truncated,
        },
        message: `成功读取文件 ${filePath}，共 ${totalLines} 行`,
      };
    } catch (error: any) {
      log.error(`文件读取失败: ${error.message}`, traceId);
      return {
        success: false,
        error: `文件读取失败: ${error.message}`,
      };
    }
  }

  /**
   * 执行系统命令（安全限制）
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    workDir?: string,
    timeout: number = 30000
  ): Promise<ToolResult> {
    const traceId = generateTraceId();
    log.info(`执行命令: ${command} ${args.join(' ')}`, traceId);

    try {
      // 安全检查
      if (FORBIDDEN_COMMANDS.has(command)) {
        return {
          success: false,
          error: `禁止执行命令: ${command}`,
        };
      }

      if (!ALLOWED_COMMANDS.has(command)) {
        return {
          success: false,
          error: `不允许执行命令: ${command}。允许的命令: ${Array.from(ALLOWED_COMMANDS).join(', ')}`,
        };
      }

      // 确定工作目录
      const resolvedWorkDir = workDir ? this.resolvePath(workDir) : this.dataDir;
      
      // 验证工作目录
      if (!this.validatePath(resolvedWorkDir)) {
        return {
          success: false,
          error: '工作目录安全验证失败',
        };
      }

      // 执行命令
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: resolvedWorkDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        success: true,
        data: {
          command: `${command} ${args.join(' ')}`,
          workDir: resolvedWorkDir,
          stdout,
          stderr,
          exitCode: 0,
        },
        message: `命令执行成功`,
      };
    } catch (error: any) {
      log.error(`命令执行失败: ${error.message}`, traceId);
      
      // 处理超时
      if (error.killed) {
        return {
          success: false,
          error: `命令执行超时（${timeout}ms）`,
        };
      }

      return {
        success: false,
        error: `命令执行失败: ${error.message}`,
        data: {
          command: `${command} ${args.join(' ')}`,
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.code,
        },
      };
    }
  }
}

// 导出单例实例
export const fileOperationService = new FileOperationService();