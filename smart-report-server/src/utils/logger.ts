/**
 * 增强型日志模块（异步缓冲 + 日期归档 + 压缩支持）
 * 
 * 功能特性：
 * - 异步缓冲写入，不阻塞主业务流程
 * - 按日期滚动归档，核心模块30天，错误日志90天
 * - 自动压缩归档（gzip），节省磁盘空间
 * - 支持 JSON 和文本两种输出格式切换
 * - 统一日志格式：[时间戳] [级别] [模块名] [TraceID] 消息内容
 * - 业务方法装饰器，自动记录方法入口/出口/入参/返回值
 * - 模块级分类：核心业务模块使用 INFO 级别，其他模块仅 ERROR
 * 
 * @module logger
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { getConfig } from '../config';
import { randomUUID } from 'crypto';

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * 模块类型：core = 核心业务模块，other = 其他模块
 */
export type ModuleType = 'core' | 'other';

/**
 * 日志输出格式
 */
export type LogFormat = 'text' | 'json';

/**
 * 日志配置选项
 */
export interface LoggerOptions {
  /** 日志目录（绝对路径），默认取自 config.LOGS_DIR */
  logDir?: string;
  /** 输出格式：text 或 json */
  format?: LogFormat;
  /** 模块名称 */
  moduleName?: string;
  /** 模块类型：core 或 other */
  moduleType?: ModuleType;
  /** 是否输出到控制台 */
  consoleOutput?: boolean;
  /** 缓冲区最大条目数，达到后强制写入 */
  maxBufferSize?: number;
  /** 缓冲区刷新间隔（毫秒） */
  flushIntervalMs?: number;
  /** 日志最大保留天数（核心模块默认30天） */
  retentionDays?: number;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 日志条目接口
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  traceId: string;
  message: string;
  stack?: string;
  metadata?: Record<string, any>;
}

/**
 * 归档文件信息
 */
interface ArchiveFile {
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** 创建时间 */
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════════════════

/** 核心业务模块列表 */
const CORE_MODULES = new Set([
  'ScriptService',
  'ReportService',
  'UserService',
  'TemplateService',
  'ConversationService',
]);

/** 其他模块列表（仅保留 ERROR） */
const OTHER_MODULES = new Set([
  'Config',
  'UploadMiddleware',
  'AuthMiddleware',
  'SecurityMiddleware',
  'CorsMiddleware',
  'Database',
  'FileUtils',
]);

// ═══════════════════════════════════════════════════════
//  日志模块实例管理
// ═══════════════════════════════════════════════════════

const loggerInstances = new Map<string, Logger>();

/**
 * 获取或创建指定模块的日志实例
 * 
 * @param moduleName - 模块名称
 * @param moduleType - 模块类型
 * @returns Logger 实例
 */
export function getLogger(
  moduleName: string,
  moduleType: ModuleType = 'other'
): Logger {
  const key = `${moduleName}:${moduleType}`;
  if (!loggerInstances.has(key)) {
    loggerInstances.set(
      key,
      new Logger({
        moduleName,
        moduleType,
        format: getConfig().LOG_FORMAT === 'json' ? 'json' : 'text',
      })
    );
  }
  return loggerInstances.get(key)!;
}

/**
 * 关闭所有日志实例
 */
export async function closeAll(): Promise<void> {
  for (const logger of loggerInstances.values()) {
    await logger.close();
  }
  loggerInstances.clear();
}

/**
 * 强制刷新所有日志实例的缓冲区
 */
export async function flushAll(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const logger of loggerInstances.values()) {
    promises.push(logger.flush());
  }
  await Promise.allSettled(promises);
}

// ═══════════════════════════════════════════════════════
//  缓存 Logger 类
// ═══════════════════════════════════════════════════════

const pendingFlushes = new Map<string, NodeJS.Timeout>();

/**
 * 增强型日志类
 * 
 * 支持异步缓冲写入、日期滚动归档、压缩、JSON/文本格式切换
 */
export class Logger {
  private readonly logDir: string;
  private readonly format: LogFormat;
  private readonly moduleName: string;
  private readonly moduleType: ModuleType;
  private readonly consoleOutput: boolean;
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly retentionDays: number;
  private readonly enabled: boolean;

  /** 日志缓冲区 */
  private buffer: string[] = [];
  /** 是否正在写入 */
  private isFlushing = false;
  /** 刷新定时器 */
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** 当前日志写入流 */
  private writeStream: fs.WriteStream | null = null;
  /** 当前日志日期（用于检测日期变更） */
  private currentDate: string = '';
  /** 是否已关闭 */
  private closed = false;
  /** 待写入Promise */
  private flushPromise: Promise<void> = Promise.resolve();

  /**
   * 创建日志实例
   */
  constructor(options: LoggerOptions = {}) {
    const config = getConfig();

    this.logDir = options.logDir || config.LOGS_DIR;
    this.format = options.format || 'text';
    this.moduleName = options.moduleName || 'App';
    this.moduleType = options.moduleType || 'other';
    this.consoleOutput = options.consoleOutput ?? true;
    this.maxBufferSize = options.maxBufferSize || 100;
    this.flushIntervalMs = options.flushIntervalMs || 2000;
    this.retentionDays = options.retentionDays || 30;
    this.enabled = options.enabled ?? true;

    // 确保日志目录存在
    this.ensureLogDir();

    // 获取当前日期并打开写入流
    this.currentDate = this.getDateString();
    this.openStream(this.currentDate);

    // 启动定时刷新
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('[Logger] 定时刷新失败:', err);
      });
    }, this.flushIntervalMs);

    // 注册进程退出时的清理
    const cleanupKey = `logger_${this.moduleName}`;
    if (!pendingFlushes.has(cleanupKey)) {
      pendingFlushes.set(cleanupKey, setTimeout(() => {}));
    }
  }

  /**
   * 核心模块访问装饰器
   * 
   * 用于自动记录方法的入口、出口、入参、返回值和耗时
   * 
   * @example
   * ```typescript
   * class ScriptService {
   *   @logMethod()
   *   async uploadScript(file: FileInfo): Promise<Script> { ... }
   * }
   * ```
   */
  static logMethod(): MethodDecorator {
    return (
      target: any,
      propertyKey: string | symbol,
      descriptor: PropertyDescriptor
    ) => {
      const originalMethod = descriptor.value;
      const className = target.constructor?.name || 'UnknownClass';
      const methodName = String(propertyKey);

      descriptor.value = async function (...args: any[]) {
        const logger = getLogger(className, 'core');
        const traceId = generateTraceId();

        // 安全序列化入参（避免循环引用、敏感字段）
        const safeArgs = args.map((arg) => sanitizeArg(arg));

        logger.info(
          `⇢ ${methodName} 调用开始`,
          traceId,
          safeArgs.length > 0 ? { args: safeArgs } : undefined
        );

        const startTime = Date.now();

        try {
          const result = await originalMethod.apply(this, args);

          const duration = Date.now() - startTime;
          const safeResult = sanitizeArg(result);

          logger.info(
            `✓ ${methodName} 调用完成 (${duration}ms)`,
            traceId,
            { duration, result: safeResult }
          );

          return result;
        } catch (error: any) {
          const duration = Date.now() - startTime;
          logger.error(
            `✗ ${methodName} 调用异常 (${duration}ms): ${error.message}`,
            traceId,
            {
              duration,
              error: error.message,
              stack: error.stack,
            }
          );

          throw error;
        }
      };

      return descriptor;
    };
  }

  /**
   * 记录 DEBUG 日志
   */
  debug(message: string, traceId?: string, metadata?: Record<string, any>): void {
    this.write(LogLevel.DEBUG, message, traceId, metadata);
  }

  /**
   * 记录 INFO 日志（核心业务模块主级别）
   */
  info(message: string, traceId?: string, metadata?: Record<string, any>): void {
    this.write(LogLevel.INFO, message, traceId, metadata);
  }

  /**
   * 记录 WARN 日志
   */
  warn(message: string, traceId?: string, metadata?: Record<string, any>): void {
    this.write(LogLevel.WARN, message, traceId, metadata);
  }

  /**
   * 记录 ERROR 日志（包含完整堆栈）
   */
  error(message: string, traceId?: string, metadata?: Record<string, any>): void {
    const enhancedMeta = { ...metadata };

    // 如果没有传入 stack，尝试自动捕获
    if (!enhancedMeta.stack) {
      const err = new Error();
      const stackLines = (err.stack || '').split('\n');
      // 跳过当前帧，保留调用者的堆栈
      if (stackLines.length > 2) {
        enhancedMeta.stack = stackLines.slice(2).join('\n');
      }
    }

    this.write(LogLevel.ERROR, message, traceId, enhancedMeta);
  }

  /**
   * 记录关键业务决策点（INFO 级别，带标记）
   */
  decision(
    message: string,
    traceId?: string,
    metadata?: Record<string, any>
  ): void {
    this.info(`[决策] ${message}`, traceId, metadata);
  }

  /**
   * 记录数据库操作（INFO 级别，包含耗时）
   */
  dbOperation(
    operation: string,
    table: string,
    durationMs: number,
    traceId?: string,
    metadata?: Record<string, any>
  ): void {
    this.info(
      `[DB] ${operation} ${table} (${durationMs}ms)`,
      traceId,
      { dbOperation: operation, dbTable: table, dbDuration: durationMs, ...metadata }
    );
  }

  /**
   * 记录外部服务调用（INFO 级别，包含请求/响应信息）
   */
  externalCall(
    service: string,
    action: string,
    durationMs: number,
    traceId?: string,
    metadata?: Record<string, any>
  ): void {
    this.info(
      `[外部] ${service}.${action} (${durationMs}ms)`,
      traceId,
      { externalService: service, externalAction: action, externalDuration: durationMs, ...metadata }
    );
  }

  /**
   * 刷新缓冲区到磁盘
   */
  async flush(): Promise<void> {
    if (this.closed || this.buffer.length === 0 || this.isFlushing) {
      return;
    }

    this.isFlushing = true;
    const batch = this.buffer.splice(0, this.maxBufferSize);

    try {
      await this.writeBatch(batch);
    } catch (err) {
      // 写入失败时重新放回缓冲区
      this.buffer.unshift(...batch);
      console.error(`[Logger] 批量写入失败: ${err}`);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * 关闭日志实例
   */
  async close(): Promise<void> {
    this.closed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();

    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }

  // ═══════════════════════════════════════════════════
  //  内部方法
  // ═══════════════════════════════════════════════════

  /**
   * 核心写入方法
   */
  private write(
    level: LogLevel,
    message: string,
    traceId?: string,
    metadata?: Record<string, any>
  ): void {
    if (!this.enabled) return;

    // 级别过滤：其他模块仅保留 ERROR
    if (this.moduleType === 'other' && level !== LogLevel.ERROR) return;

    const tid = traceId || '-';

    // 构建日志条目
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.moduleName,
      traceId: tid,
      message,
      ...(metadata ? { metadata } : {}),
    };

    // 检查是否需要切换日志文件（日期变更）
    const today = this.getDateString();
    if (today !== this.currentDate) {
      // 异步切换，不阻塞
      this.rotateDate(today).catch((err) => {
        console.error('[Logger] 日期切换失败:', err);
      });
    }

    // 格式化
    const line = this.format === 'json'
      ? JSON.stringify(entry) + '\n'
      : this.formatText(entry);

    // 输出到控制台
    if (this.consoleOutput) {
      this.consoleLog(level, line);
    }

    // 加入缓冲区
    this.buffer.push(line);

    // 缓冲区满时立即刷新
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush().catch((err) => {
        console.error('[Logger] 自动刷新失败:', err);
      });
    }
  }

  /**
   * 文本格式输出
   */
  private formatText(entry: LogEntry): string {
    const parts = [
      `[${entry.timestamp}]`,
      `[${entry.level}]`,
      `[${entry.module}]`,
      `[${entry.traceId}]`,
      entry.message,
    ];

    let line = parts.join(' ');

    if (entry.metadata?.stack) {
      line += '\n' + entry.metadata.stack;
    }

    return line + '\n';
  }

  /**
   * 控制台输出（带颜色）
   */
  private consoleLog(level: LogLevel, line: string): void {
    const colorMap: Record<string, string> = {
      DEBUG: '\x1b[90m',      // 灰色
      INFO: '\x1b[36m',       // 青色
      WARN: '\x1b[33m',       // 黄色
      ERROR: '\x1b[31m',      // 红色
    };
    const reset = '\x1b[0m';
    const color = colorMap[level] || '';

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(color + line.trimEnd() + reset);
        break;
      case LogLevel.INFO:
        console.info(color + line.trimEnd() + reset);
        break;
      case LogLevel.WARN:
        console.warn(color + line.trimEnd() + reset);
        break;
      case LogLevel.ERROR:
        console.error('\x1b[41;97m ERROR \x1b[0m ' + color + line.trimEnd() + reset);
        break;
    }
  }

  /**
   * 批量写入
   */
  private async writeBatch(lines: string[]): Promise<void> {
    if (lines.length === 0 || !this.writeStream) return;

    const content = lines.join('');

    return new Promise((resolve, reject) => {
      this.writeStream!.write(content, 'utf-8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 日期滚动：关闭旧文件，打开新文件
   */
  private async rotateDate(newDate: string): Promise<void> {
    // 关闭当前流
    if (this.writeStream) {
      await new Promise<void>((resolve) => {
        this.writeStream!.end(resolve);
      });
      this.writeStream = null;

      // 压缩前一天的日志
      const oldDate = this.currentDate;
      this.compressOldLog(oldDate).catch((err) => {
        console.error(`[Logger] 压缩日志失败 ${oldDate}:`, err);
      });
    }

    this.currentDate = newDate;
    this.openStream(newDate);

    // 清理过期日志
    this.cleanupOldLogs().catch((err) => {
      console.error('[Logger] 清理过期日志失败:', err);
    });
  }

  /**
   * 打开日志文件写入流
   */
  private openStream(dateStr: string): void {
    const logFileName = `${this.moduleName}_${dateStr}.log`;
    const logFilePath = path.join(this.logDir, logFileName);

    try {
      this.writeStream = fs.createWriteStream(logFilePath, {
        flags: 'a',
        encoding: 'utf-8',
      });

      this.writeStream.on('error', (err) => {
        console.error(`[Logger] 写入流错误 [${logFilePath}]:`, err);
      });
    } catch (err) {
      console.error(`[Logger] 打开日志文件失败 [${logFilePath}]:`, err);
    }
  }

  /**
   * 压缩旧日志文件
   */
  private async compressOldLog(dateStr: string): Promise<void> {
    const logFileName = `${this.moduleName}_${dateStr}.log`;
    const logFilePath = path.join(this.logDir, logFileName);
    const gzFilePath = logFilePath + '.gz';

    // 检查源文件是否存在
    if (!fs.existsSync(logFilePath)) return;

    // 如果压缩包已存在，跳过
    if (fs.existsSync(gzFilePath)) {
      // 删除未压缩的源文件
      try {
        await fsp.unlink(logFilePath);
      } catch {}
      return;
    }

    return new Promise((resolve, reject) => {
      const gzip = zlib.createGzip({ level: 6 });
      const source = fs.createReadStream(logFilePath);
      const dest = fs.createWriteStream(gzFilePath);

      source
        .pipe(gzip)
        .pipe(dest)
        .on('finish', () => {
          // 压缩完成后删除源文件
          fs.unlink(logFilePath, (err) => {
            if (err) console.error('[Logger] 删除源日志失败:', err);
          });
          resolve();
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }

  /**
   * 清理过期日志
   * 核心模块保留 retentionDays，错误日志保留90天
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await fsp.readdir(this.logDir);
      const now = Date.now();
      const errorRetentionMs = 90 * 24 * 60 * 60 * 1000; // 90天
      const normalRetentionMs = this.retentionDays * 24 * 60 * 60 * 1000; // 配置的天数

      for (const file of files) {
        const filePath = path.join(this.logDir, file);

        try {
          const stat = await fsp.stat(filePath);
          const age = now - stat.mtime.getTime();

          // 错误日志保留90天
          if (file.includes('ERROR') || file.includes('error')) {
            if (age > errorRetentionMs) {
              await fsp.unlink(filePath);
            }
            continue;
          }

          // 普通日志按配置的天数保留
          if (age > normalRetentionMs && file.endsWith('.log') || file.endsWith('.log.gz')) {
            await fsp.unlink(filePath);
          }
        } catch {
          // 单个文件处理失败不中断
        }
      }
    } catch (err) {
      console.error('[Logger] 清理过期日志失败:', err);
    }
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 获取当前日期字符串（用于日志文件名）
   */
  private getDateString(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

// ═══════════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════════

/**
 * 生成 TraceID（用于请求追踪）
 */
export function generateTraceId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * 安全序列化参数（避免循环引用和敏感信息）
 */
function sanitizeArg(arg: any): any {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === 'string') {
    // 截断过长的字符串
    return arg.length > 500 ? arg.slice(0, 500) + '...' : arg;
  }
  if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
  if (Buffer.isBuffer(arg)) return `[Buffer ${arg.length} bytes]`;
  if (arg instanceof Error) return { message: arg.message, stack: arg.stack?.slice(0, 300) };

  try {
    const str = JSON.stringify(arg, (key, value) => {
      // 排除敏感字段
      if (['password', 'token', 'secret', 'authorization'].includes(key.toLowerCase())) {
        return '***';
      }
      // 排除函数
      if (typeof value === 'function') return undefined;
      return value;
    });
    return str.length > 1000 ? str.slice(0, 1000) + '...' : JSON.parse(str);
  } catch {
    return String(arg).slice(0, 200);
  }
}

// ═══════════════════════════════════════════════════════
//  便捷 API（兼容旧接口）
// ═══════════════════════════════════════════════════════

/**
 * 默认日志实例（模块名: App，类型: other）
 */
const defaultLogger = getLogger('App', 'other');

export const logger = {
  debug: (message: string) => defaultLogger.debug(message),
  info: (message: string) => defaultLogger.info(message),
  warn: (message: string) => defaultLogger.warn(message),
  error: (message: string) => defaultLogger.error(message),
  close: async () => { await defaultLogger.flush(); },
  getLogger,
  closeAll,
  flushAll,
  LogLevel,
  generateTraceId,
  Logger,
};
