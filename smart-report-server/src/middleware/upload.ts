/**
 * 文件上传中间件配置
 * 
 * 本模块基于 multer 配置脚本、模板、报告输入文件的上传处理：
 * - 临时目录与最终脚本/模板目录位于同一父目录，避免 Windows 跨盘 rename 失败
 * - 文件名安全校验复用 fileManager.validateFileName
 * - 限制单文件大小，防止恶意大文件上传
 * 
 * @module middleware/upload
 */

import multer from 'multer';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { RequestHandler } from 'express';
import { UPLOADS_DIR } from '../config';
import { fileManager } from '../utils/file';
import { getLogger } from '../utils/logger';
import { settingsService } from '../services/settingsService';

const log = getLogger('UploadMiddleware', 'other');

// ═══════════════════════════════════════════════════════
//  上传目录配置
// ═══════════════════════════════════════════════════════

/**
 * 上传临时目录
 * 放在最终脚本/模板目录的同一父目录下，确保 fs.rename 大概率在同一磁盘。
 * 即使跨盘，scriptService/templateService 也会使用 copy+unlink 回退。
 */
const UPLOAD_DIR = UPLOADS_DIR;

if (!existsSync(UPLOAD_DIR)) {
  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    log.error(`创建上传临时目录失败: ${error}`);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════
//  multer 存储与过滤
// ═══════════════════════════════════════════════════════

/**
 * 生成临时文件名
 */
function generateTempFileName(originalName: string): string {
  const ext = path.extname(originalName);
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    cb(null, generateTempFileName(file.originalname));
  },
});

/**
 * 尝试修复 multer 默认使用 latin1 解码导致的 UTF-8 文件名乱码问题。
 * 始终优先尝试 latin1→UTF-8 解码，如果解码结果不同于原始名且有效则使用解码版本。
 * 解决中文文件名在 multer latin1 解码下的乱码问题（如"模板"→"æ¨¡æ¿"）。
 *
 * @param file - multer 文件对象
 * @returns 解码后的安全文件名
 */
function decodeOriginalName(file: Express.Multer.File): string {
  const original = file.originalname;

  // 始终优先尝试 latin1→UTF-8 解码
  try {
    const decoded = Buffer.from(original, 'latin1').toString('utf8');
    // 解码结果不同且通过验证 → 使用解码后的版本
    if (decoded !== original && fileManager.validateFileName(decoded)) {
      return decoded;
    }
  } catch (error) {
    log.warn(`文件名解码失败: ${original}, 错误: ${error}`);
  }

  // 回退：直接验证原始名
  if (fileManager.validateFileName(original)) {
    return original;
  }

  return original;
}

/**
 * 文件过滤：拒绝非法文件名
 *
 * 同时对 file.originalname 进行 latin1 -> UTF-8 兼容解码，如果解码后通过校验，
 * 将解码后的名字写回 file.originalname，供后续路由和日志使用。
 */
function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  const decodedName = decodeOriginalName(file);

  if (!fileManager.validateFileName(decodedName)) {
    cb(
      new Error(
        `文件名无效或包含非法字符: ${decodedName}。只能包含字母、数字、下划线、连字符、点和空格，且长度不超过255字符。`
      )
    );
    return;
  }

  // 把解码后的 UTF-8 文件名写回，后续路由和日志可直接使用
  file.originalname = decodedName;
  cb(null, true);
}

const DEFAULT_UPLOAD_LIMIT_MB = 50;

// multer 的 fileSize 只能静态设置，这里缓存实例并在设置变化时重建，
// 使 storage.uploadLimit 系统设置（MB）调整后可即时生效
let cachedLimitMB = -1;
let cachedUpload: multer.Multer | null = null;

function getUpload(): multer.Multer {
  const limitMB = settingsService.getNumber('storage.uploadLimit', DEFAULT_UPLOAD_LIMIT_MB);
  if (!cachedUpload || cachedLimitMB !== limitMB) {
    cachedUpload = multer({
      storage,
      fileFilter,
      limits: {
        fileSize: limitMB * 1024 * 1024,
      },
    });
    if (cachedLimitMB !== -1 && cachedLimitMB !== limitMB) {
      log.info(`上传大小限制已更新: ${cachedLimitMB}MB → ${limitMB}MB`);
    }
    cachedLimitMB = limitMB;
  }
  return cachedUpload;
}

// ═══════════════════════════════════════════════════════
//  路由专用上传中间件
// ═══════════════════════════════════════════════════════

const MAX_AUX_FILES = 100;
const MAX_INPUT_FILES = 50;

const SCRIPT_FIELDS = [
  { name: 'scriptFile', maxCount: 1 },
  ...Array.from({ length: 20 }, (_, i) => ({
    name: `scriptFile${i + 1}`,
    maxCount: 1,
  })),
  ...Array.from({ length: MAX_AUX_FILES }, (_, i) => ({
    name: `auxFile${i}`,
    maxCount: 1,
  })),
];

const REPORT_INPUT_FIELDS = Array.from({ length: MAX_INPUT_FILES }, (_, i) => ({
  name: `inputFile${i}`,
  maxCount: 1,
}));

/**
 * 脚本上传 multer 中间件
 * 主文件字段：scriptFile
 * 额外多文件：scriptFile1, scriptFile2, ...
 * 辅助文件字段：auxFile0, auxFile1, ...
 */
export const uploadScriptFiles: RequestHandler = (req, res, next) =>
  getUpload().fields(SCRIPT_FIELDS)(req, res, next);

/**
 * 模板上传 multer 中间件
 * 文件字段：templateFile
 */
export const uploadTemplateFile: RequestHandler = (req, res, next) =>
  getUpload().single('templateFile')(req, res, next);

/**
 * 报告生成输入文件 multer 中间件
 * 文件字段：inputFile0, inputFile1, ...
 */
export const uploadReportInputFiles: RequestHandler = (req, res, next) =>
  getUpload().fields(REPORT_INPUT_FIELDS)(req, res, next);

/**
 * 压缩包上传 multer 中间件
 * 文件字段：file
 */
export const uploadArchiveFile: RequestHandler = (req, res, next) =>
  getUpload().single('file')(req, res, next);
