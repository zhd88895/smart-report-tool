/**
 * 文件操作工具
 * 
 * 本模块提供安全的文件操作功能，包含路径验证、完整性校验和安全删除。
 * 用于防止路径遍历等安全漏洞。
 * 
 * @module file
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { getConfig } from '../config';
import { logger, getLogger } from './logger';

const log = getLogger('FileUtils', 'other');
import { validateFileName, validateFilePath } from '../middleware/security';

/**
 * 文件信息接口
 */
export interface FileInfo {
  /** 文件名 */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件路径 */
  path: string;
  /** 文件哈希值（SHA-256） */
  hash?: string;
  /** 创建时间 */
  createdAt?: Date;
  /** 修改时间 */
  modifiedAt?: Date;
}

/**
 * 文件管理器类
 * 提供安全的文件操作，包含路径验证和完整性校验
 */
export class FileManager {
  private dataDir: string;

  /**
   * 创建文件管理器实例
   * 
   * @throws {Error} 如果配置加载失败
   */
  constructor() {
    const config = getConfig();
    this.dataDir = config.DATA_DIR;
  }

  /**
   * 验证文件名安全性
   * 
   * @param fileName - 文件名
   * @returns 是否安全
   */
  validateFileName(fileName: string): boolean {
    return validateFileName(fileName);
  }

  /**
   * 验证文件路径安全性
   * 
   * @param filePath - 文件路径
   * @param baseDir - 基础目录（默认为数据目录）
   * @returns 是否安全
   */
  validateFilePath(filePath: string, baseDir?: string): boolean {
    return validateFilePath(filePath, baseDir || this.dataDir);
  }

  /**
   * 安全地获取完整路径
   * 
   * @param relativePath - 相对路径
   * @returns 完整路径
   * @throws {Error} 如果路径不安全
   */
  getSecurePath(relativePath: string): string {
    const fullPath = path.join(this.dataDir, relativePath);

    // 验证路径安全性
    if (!this.validateFilePath(fullPath)) {
      throw new Error(`不安全的文件路径: ${relativePath}`);
    }

    return fullPath;
  }

  /**
   * 确保目录存在
   * 
   * @param dirPath - 目录路径
   * @throws {Error} 如果创建目录失败
   */
  async ensureDir(dirPath: string): Promise<void> {
    try {
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
        log.info(`创建目录: ${dirPath}`);
      }
    } catch (error) {
      log.error(`创建目录失败: ${dirPath} - ${error}`);
      throw error;
    }
  }

  /**
   * 计算文件哈希值（SHA-256）
   * 
   * @param filePath - 文件路径
   * @returns 哈希值（十六进制字符串）
   */
  async computeFileHash(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);
      return createHash('sha256').update(buffer).digest('hex');
    } catch (error) {
      log.error(`计算文件哈希失败: ${filePath} - ${error}`);
      return '';
    }
  }

  /**
   * 验证文件完整性
   * 
   * @param filePath - 文件路径
   * @param expectedHash - 期望的哈希值
   * @returns 是否完整
   */
  async verifyFileIntegrity(filePath: string, expectedHash: string): Promise<boolean> {
    const actualHash = await this.computeFileHash(filePath);
    return actualHash === expectedHash;
  }

  /**
   * 获取文件信息
   * 
   * @param filePath - 文件路径
   * @returns 文件信息，如果文件不存在则返回null
   */
  async getFileInfo(filePath: string): Promise<FileInfo | null> {
    try {
      if (!existsSync(filePath)) {
        return null;
      }

      const stat = await fs.stat(filePath);
      const hash = await this.computeFileHash(filePath);

      return {
        name: path.basename(filePath),
        size: stat.size,
        path: filePath,
        hash,
        createdAt: stat.birthtime,
        modifiedAt: stat.mtime
      };
    } catch (error) {
      log.error(`获取文件信息失败: ${filePath} - ${error}`);
      return null;
    }
  }

  /**
   * 安全地删除文件
   * 
   * @param filePath - 文件路径
   * @param baseDir - 基础目录（用于验证）
   * @returns 是否删除成功
   */
  async safeDelete(filePath: string, baseDir?: string): Promise<boolean> {
    try {
      // 验证路径安全性
      if (!this.validateFilePath(filePath, baseDir)) {
        log.warn(`拒绝删除不安全路径的文件: ${filePath}`);
        return false;
      }

      if (existsSync(filePath)) {
        await fs.unlink(filePath);
        log.info(`已删除文件: ${filePath}`);
        return true;
      }
      return false;
    } catch (error) {
      log.error(`删除文件失败: ${filePath} - ${error}`);
      return false;
    }
  }

  /**
   * 列出目录下的文件
   * 
   * @param dirPath - 目录路径
   * @param recursive - 是否递归列出子目录
   * @returns 文件信息列表
   */
  async listFiles(dirPath: string, recursive: boolean = false): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    try {
      if (!existsSync(dirPath)) {
        return files;
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isFile()) {
          const info = await this.getFileInfo(fullPath);
          if (info) {
            files.push(info);
          }
        } else if (entry.isDirectory() && recursive) {
          const subFiles = await this.listFiles(fullPath, true);
          files.push(...subFiles);
        }
      }
    } catch (error) {
      log.error(`列出文件失败: ${dirPath} - ${error}`);
    }

    return files;
  }

  /**
   * 复制文件
   * 
   * @param sourcePath - 源文件路径
   * @param destPath - 目标文件路径
   * @returns 是否复制成功
   */
  async copyFile(sourcePath: string, destPath: string): Promise<boolean> {
    try {
      if (!existsSync(sourcePath)) {
        log.error(`源文件不存在: ${sourcePath}`);
        return false;
      }

      // 确保目标目录存在
      const destDir = path.dirname(destPath);
      await this.ensureDir(destDir);

      await fs.copyFile(sourcePath, destPath);
      log.info(`文件复制成功: ${sourcePath} -> ${destPath}`);
      return true;
    } catch (error) {
      log.error(`文件复制失败: ${sourcePath} -> ${destPath} - ${error}`);
      return false;
    }
  }

  /**
   * 移动文件
   * 
   * @param sourcePath - 源文件路径
   * @param destPath - 目标文件路径
   * @returns 是否移动成功
   */
  async moveFile(sourcePath: string, destPath: string): Promise<boolean> {
    try {
      if (!existsSync(sourcePath)) {
        log.error(`源文件不存在: ${sourcePath}`);
        return false;
      }

      // 确保目标目录存在
      const destDir = path.dirname(destPath);
      await this.ensureDir(destDir);

      await fs.rename(sourcePath, destPath);
      log.info(`文件移动成功: ${sourcePath} -> ${destPath}`);
      return true;
    } catch (error) {
      log.error(`文件移动失败: ${sourcePath} -> ${destPath} - ${error}`);
      return false;
    }
  }
}

/**
 * 安全移动文件（fs.rename + copy+unlink 回退）
 * 
 * 用于处理 Windows 跨盘移动等 EXDEV 错误，确保上传的临时文件能可靠地
 * 移动到目标目录。
 * 
 * @param sourcePath - 源文件路径
 * @param destPath - 目标文件路径
 * @throws {Error} 如果源文件不存在或移动失败
 */
export async function safeMoveFile(sourcePath: string, destPath: string): Promise<void> {
  if (!existsSync(sourcePath)) {
    throw new Error(`源文件不存在: ${sourcePath}`);
  }

  const destDir = path.dirname(destPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  try {
    await fs.rename(sourcePath, destPath);
  } catch (error: any) {
    // EXDEV: 跨盘/跨设备移动，回退到 copy + unlink
    if (error.code === 'EXDEV') {
      await fs.copyFile(sourcePath, destPath);
      await fs.unlink(sourcePath);
    } else {
      throw error;
    }
  }
}

/**
 * 文件管理器单例实例
 */
export const fileManager = new FileManager();