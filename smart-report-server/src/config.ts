/**
 * 配置常量和环境变量管理模块
 * 
 * 本模块负责从环境变量加载配置，提供应用所需的所有配置项。
 * 使用dotenv加载.env文件中的环境变量。
 * 
 * @module config
 */

import path from 'path';
import dotenv from 'dotenv';

// 加载.env文件中的环境变量
dotenv.config();

/**
 * 应用配置接口定义
 */
export interface AppConfig {
  /** 服务端口，默认3001 */
  PORT: number;
  /** 数据目录路径，默认'./data' */
  DATA_DIR: string;
  /** JWT签名密钥（必须从环境变量读取） */
  JWT_SECRET: string;
  /** JWT Token过期时间，默认'24h' */
  JWT_EXPIRES_IN: string;
  /** 允许的CORS来源列表，逗号分隔 */
  ALLOWED_ORIGINS: string[];
  /** 日志文件最大大小（字节），默认10MB */
  LOG_MAX_SIZE: number;
  /** 保留的日志文件数量，默认10 */
  LOG_MAX_FILES: number;
  /** bcrypt加密轮数，默认12 */
  BCRYPT_ROUNDS: number;
  /** 日志存储目录 */
  LOGS_DIR: string;
  /** 日志输出格式：text 或 json */
  LOG_FORMAT: string;
}

/**
 * 验证必需的环境变量是否存在
 * 
 * @throws {Error} 如果必需的环境变量缺失则抛出错误
 */
function validateRequiredEnvVars(): void {
  const requiredVars = ['JWT_SECRET'];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`必需的环境变量 ${varName} 未设置。请在.env文件或系统环境变量中配置。`);
    }
  }
}

/**
 * 解析允许的CORS来源字符串
 * 
 * @param originsString - 逗号分隔的来源字符串
 * @returns 解析后的来源数组
 */
function parseAllowedOrigins(originsString?: string): string[] {
  if (!originsString) {
    return ['http://localhost:5173', 'http://localhost:3000'];
  }
  
  return originsString
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
}

/**
 * 加载并验证应用配置
 * 
 * @returns 应用配置对象
 */
export function loadConfig(): AppConfig {
  // 验证必需的环境变量
  validateRequiredEnvVars();
  
  // 解析配置值
  // DATA_DIR: 使用 path.resolve 确保路径正确解析（相对于后端目录）
  const dataDir = process.env.DATA_DIR || './data';
  const resolvedDataDir = path.resolve(__dirname, '..', dataDir);

  const config: AppConfig = {
    PORT: parseInt(process.env.PORT || '3001', 10),
    DATA_DIR: resolvedDataDir,
    JWT_SECRET: process.env.JWT_SECRET || '',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
    ALLOWED_ORIGINS: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
    LOG_MAX_SIZE: parseInt(process.env.LOG_MAX_SIZE || '10485760', 10), // 10MB
    LOG_MAX_FILES: parseInt(process.env.LOG_MAX_FILES || '10', 10),
    BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    LOGS_DIR: path.join(resolvedDataDir, 'logs'),
    LOG_FORMAT: process.env.LOG_FORMAT || 'text',
  };
  
  // 验证数值范围
  if (config.PORT < 1 || config.PORT > 65535) {
    throw new Error(`端口号必须在1-65535之间，当前值: ${config.PORT}`);
  }
  
  if (config.BCRYPT_ROUNDS < 4 || config.BCRYPT_ROUNDS > 31) {
    throw new Error(`BCRYPT_ROUNDS必须在4-31之间，当前值: ${config.BCRYPT_ROUNDS}`);
  }
  
  if (config.LOG_MAX_SIZE < 1024) {
    throw new Error(`LOG_MAX_SIZE必须大于1KB，当前值: ${config.LOG_MAX_SIZE}`);
  }
  
  return config;
}

/**
 * 获取单例配置实例
 * 
 * @returns 应用配置对象
 */
export function getConfig(): AppConfig {
  // 简单的单例模式，避免重复加载
  if (!_configInstance) {
    _configInstance = loadConfig();
  }
  return _configInstance;
}

// 模块级配置实例
let _configInstance: AppConfig | null = null;

// 导出默认配置实例
export const config = getConfig();

// 导出常用子目录常量（基于 DATA_DIR 的相对路径）
export const DATA_DIR = config.DATA_DIR;
export const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');
export const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const REPORTS_DIR = path.join(DATA_DIR, 'reports');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const VENV_PYTHON = path.join(DATA_DIR, 'venv', 'Scripts', 'python.exe');
export const EMBEDDED_PYTHON = path.join(DATA_DIR, 'python-embedded', 'python.exe');