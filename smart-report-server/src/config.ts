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
import crypto from 'crypto';

// ── 关键修复：路径基准 ──
// 不再依赖 __dirname（tsx 会将其指向临时目录）。
// 始终以 process.cwd()（启动脚本 cd 到的服务端根目录）为基准。
const SERVER_ROOT = process.cwd();

// 从服务端根目录加载 .env
dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

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
  /** 会话空闲超时时间（分钟），默认30 */
  SESSION_EXPIRY_MINUTES: number;
  /** "记住我"功能的有效天数，默认7 */
  REMEMBER_ME_DAYS: number;
  /** 当前服务器实例ID（每次启动自动生成） */
  SERVER_INSTANCE_ID: string;
  /** PyPI 镜像源 URL，默认使用清华镜像 */
  PIP_INDEX_URL: string;
  /** MiMo AI 模型 API Key（小米 Token Plan） */
  MIMO_API_KEY: string;
  /** MiMo AI 模型 Base URL（OpenAI 兼容协议） */
  MIMO_BASE_URL: string;
  /** MiMo AI 模型名称 */
  MIMO_MODEL: string;
  /** MiMo AI 模型最大输出 token 数 */
  MIMO_MAX_TOKENS: number;
  /** 允许访问的网站域名白名单（可选） */
  ALLOWED_WEB_DOMAINS?: string[];
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
  // DATA_DIR: 以 SERVER_ROOT (process.cwd()) 为基准，
  // 兼容绝对路径和相对路径。启动脚本会 cd 到服务端根目录。
  const dataDir = process.env.DATA_DIR || './data';
  const resolvedDataDir = path.isAbsolute(dataDir)
    ? path.resolve(dataDir)
    : path.resolve(SERVER_ROOT, dataDir);

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
    SESSION_EXPIRY_MINUTES: parseInt(process.env.SESSION_EXPIRY_MINUTES || '30', 10),
    REMEMBER_ME_DAYS: parseInt(process.env.REMEMBER_ME_DAYS || '7', 10),
    SERVER_INSTANCE_ID: generateInstanceId(),
    PIP_INDEX_URL: process.env.PYTHON_PIP_INDEX_URL || 'https://pypi.tuna.tsinghua.edu.cn/simple',
    MIMO_API_KEY: process.env.MIMO_API_KEY || '',
    MIMO_BASE_URL: process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
    MIMO_MODEL: process.env.MIMO_MODEL || 'mimo-v2.5-pro',
    MIMO_MAX_TOKENS: parseInt(process.env.MIMO_MAX_TOKENS || '4096', 10),
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

// 保存服务器启动时间，用于生成唯一实例ID
const SERVER_START_TIME = Date.now();

/**
 * 生成服务器实例ID
 */
function generateInstanceId(): string {
  return `inst_${SERVER_START_TIME}_${crypto.randomBytes(8).toString('hex')}`;
}

// 导出默认配置实例
export const config = getConfig();

/**
 * 获取当前生效的 pip 镜像源地址
 *
 * 优先读取系统设置 python.pipIndexUrl（settingsService 缓存），
 * 缓存未初始化或未设置时回落到环境变量配置 config.PIP_INDEX_URL。
 * 注意：settingsService 在 config 之后初始化，必须在使用时动态读取，
 * 因此这里延迟 require 以避免模块级循环依赖。
 *
 * @returns 当前生效的 PyPI 镜像源 URL
 */
export function getPipIndexUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { settingsService } = require('./services/settingsService');
    const fromSettings: string | undefined = settingsService.get('python.pipIndexUrl');
    if (fromSettings) return fromSettings;
  } catch {
    // 设置缓存尚未初始化（如启动早期），回落到环境变量配置
  }
  return getConfig().PIP_INDEX_URL;
}

// 导出常用子目录常量（基于 DATA_DIR 的相对路径）
export const DATA_DIR = config.DATA_DIR;
export const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');
export const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const REPORTS_DIR = path.join(DATA_DIR, 'reports');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const EMBEDDED_PYTHON = path.join(DATA_DIR, 'python-embedded', 'python.exe');

/**
 * 将数据库中存储的相对路径转为绝对路径（用于文件操作）
 * 如果传入的已经是绝对路径（兼容旧数据），直接返回。
 */
export function toAbsolutePath(storedPath: string): string {
  if (!storedPath) return storedPath;
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.resolve(DATA_DIR, storedPath);
}

/**
 * 将绝对路径转为数据库存储的相对路径
 * 必须是 DATA_DIR 下的路径，否则抛出错误防止越权。
 */
export function toRelativePath(absolutePath: string): string {
  if (!absolutePath) return absolutePath;
  const abs = path.resolve(absolutePath);
  const rel = path.relative(DATA_DIR, abs);
  if (rel.startsWith('..')) {
    throw new Error(`路径越界: ${absolutePath} 不在数据目录 ${DATA_DIR} 内`);
  }
  return rel;
}