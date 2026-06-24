/**
 * 安全校验中间件模块
 * 
 * 本模块提供文件名、文件路径验证，输入清理和命令注入检测等安全功能。
 * 用于防止路径遍历、命令注入等安全漏洞。
 * 
 * @module security
 */

import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';

/**
 * 验证文件名是否符合安全规则
 *
 * 允许的字符：
 * - Unicode 字母/数字（含中文、日文、韩文等）
 * - 空格、下划线、连字符、点（. 不能在开头）
 *
 * 禁止的内容：
 * - 空字符串或空字符 \0
 * - 路径分隔符 / 和 \
 * - 路径遍历 ..
 * - Windows 保留字符 < > : " | ? *
 * - 控制字符
 * - 以 . 开头
 * - Windows 危险设备名（con/prn/aux/nul/com1-9/lpt1-9，大小写不敏感）
 *
 * @param fileName - 要验证的文件名
 * @returns 是否符合安全规则
 */
export function validateFileName(fileName: string): boolean {
  // 检查是否为空
  if (!fileName || fileName.trim().length === 0) {
    return false;
  }

  // 检查长度限制（255字符）
  if (fileName.length > 255) {
    return false;
  }

  // 禁止空字符
  if (fileName.includes('\0')) {
    return false;
  }

  // 禁止路径分隔符和路径遍历
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return false;
  }

  // 禁止 Windows 保留字符
  if (/[<>:"|?*]/.test(fileName)) {
    return false;
  }

  // 禁止控制字符（包括换行、回车、制表符等不可见字符）
  if (/[\x00-\x1f\x7f]/.test(fileName)) {
    return false;
  }

  // 禁止以 . 开头（隐藏文件）
  if (fileName.startsWith('.')) {
    return false;
  }

  // 检查字符：允许 Unicode 字母/数字、中文/日文/韩文、空格、下划线、连字符、点
  const fileNameRegex = /^(?! )[\p{L}\p{N}\p{Ideographic} _\-.]+(?<! )$/u;
  if (!fileNameRegex.test(fileName)) {
    return false;
  }

  // 检查是否包含危险文件名（仅检查纯文件名，不含扩展名）
  const dangerousNames = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
  ]);

  const baseName = path.parse(fileName).name.toLowerCase();
  if (dangerousNames.has(baseName)) {
    return false;
  }

  return true;
}

/**
 * 验证文件路径是否在允许的目录内
 * 
 * @param filePath - 要验证的文件路径
 * @param baseDir - 基础目录（白名单目录）
 * @returns 是否在允许的目录内
 */
export function validateFilePath(filePath: string, baseDir: string): boolean {
  try {
    // 标准化路径
    const normalizedBase = path.resolve(baseDir);
    const normalizedPath = path.resolve(filePath);
    
    // 检查是否包含路径遍历（..）
    if (filePath.includes('..')) {
      return false;
    }
    
    // 检查是否在基础目录内
    if (!normalizedPath.startsWith(normalizedBase)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理用户输入，移除潜在危险字符
 * 
 * @param input - 原始输入字符串
 * @returns 清理后的安全字符串
 */
export function sanitizeInput(input: string): string {
  if (!input) {
    return '';
  }
  
  // 移除控制字符（保留换行和制表符）
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // 移除潜在的HTML标签（防止XSS）
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  // 移除JavaScript协议
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  
  // 移除data协议
  sanitized = sanitized.replace(/data\s*:/gi, '');
  
  // 移除vbscript协议
  sanitized = sanitized.replace(/vbscript\s*:/gi, '');
  
  // 转义HTML实体中的特殊字符
  const htmlEscapeMap: Record<string, string> = {
    '&': '\u0026',
    '<': '\u003c',
    '>': '\u003e',
    '"': '\u0022',
    "'": '\u0027',
  };
  
  for (const [char, escaped] of Object.entries(htmlEscapeMap)) {
    sanitized = sanitized.replace(new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), escaped);
  }
  
  return sanitized;
}

/**
 * 检查命令注入风险
 * 
 * @param args - 命令参数数组
 * @returns 是否存在命令注入风险
 */
export function checkCommandInjection(args: string[]): boolean {
  // 危险命令和模式列表
  const dangerousPatterns = [
    // 命令分隔符
    /[;&|`$(){}[\]!#]/,
    // 重定向
    /[<>]/,
    // 管道
    /\|/,
    // 后台执行
    /&/,
    // 子shell
    /\$\(/,
    /`[^`]*`/,
    // 命令替换
    /\$\{[^}]*\}/,
    // 路径遍历
    /\.\./,
    // 绝对路径
    /^\/|^[A-Za-z]:\\/,
    // 环境变量
    /\$[A-Za-z_][A-Za-z0-9_]*/,
  ];
  
  for (const arg of args) {
    if (!arg) continue;
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(arg)) {
        return true; // 发现命令注入风险
      }
    }
  }
  
  return false; // 未发现命令注入风险
}

/**
 * 验证邮箱格式
 * 
 * @param email - 邮箱地址
 * @returns 是否符合邮箱格式
 */
export function validateEmail(email: string): boolean {
  if (!email) return false;
  
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
}

/**
 * 验证密码强度
 * 
 * @param password - 密码
 * @returns 是否符合强度要求
 */
export function validatePasswordStrength(password: string): boolean {
  if (!password) return false;
  
  // 最小长度8位
  if (password.length < 8) return false;
  
  // 最大长度128位
  if (password.length > 128) return false;
  
  // 必须包含至少一个大写字母
  if (!/[A-Z]/.test(password)) return false;
  
  // 必须包含至少一个小写字母
  if (!/[a-z]/.test(password)) return false;
  
  // 必须包含至少一个数字
  if (!/[0-9]/.test(password)) return false;
  
  return true;
}

/**
 * 验证用户名格式
 * 
 * @param username - 用户名
 * @returns 是否符合格式要求
 */
export function validateUsername(username: string): boolean {
  if (!username) return false;
  
  // 长度限制：3-50个字符
  if (username.length < 3 || username.length > 50) return false;
  
  // 只允许字母、数字、下划线
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  return usernameRegex.test(username);
}

/**
 * 文件名安全验证中间件
 * 
 * 验证请求体中的fileName字段是否符合安全规则
 */
export function validateFileNameMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const { fileName } = req.body;
    
    if (fileName && !validateFileName(fileName)) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '文件名不符合安全规则',
        error: '文件名只能包含字母、数字、下划线、连字符和点，长度不超过255字符',
      };
      res.status(400).json(response);
      return;
    }
    
    next();
  } catch (error) {
    console.error('文件名验证失败:', error);
    
    const response: ApiResponse<null> = {
      code: 400,
      data: null,
      message: '请求验证失败',
      error: error instanceof Error ? error.message : '未知错误',
    };
    
    res.status(400).json(response);
  }
}

/**
 * 输入清理中间件
 * 
 * 清理请求体中的字符串字段
 */
export function sanitizeInputMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === 'object') {
      sanitizeObject(req.body);
    }
    
    next();
  } catch (error) {
    console.error('输入清理失败:', error);
    
    const response: ApiResponse<null> = {
      code: 400,
      data: null,
      message: '输入清理失败',
      error: error instanceof Error ? error.message : '未知错误',
    };
    
    res.status(400).json(response);
  }
}

/**
 * 递归清理对象中的字符串字段
 * 
 * @param obj - 要清理的对象
 */
function sanitizeObject(obj: Record<string, any>): void {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      
      if (typeof value === 'string') {
        obj[key] = sanitizeInput(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitizeObject(value);
      }
    }
  }
}