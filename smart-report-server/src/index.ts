/**
 * 智能报告生成工具 - 主入口（重构版）
 * 
 * 本模块是应用的入口文件，负责：
 * 1. 加载配置
 * 2. 初始化中间件（CORS、安全、鉴权等）
 * 3. 挂载路由
 * 4. 启动HTTP服务器
 * 
 * 重构说明：
 * - 使用模块化的配置管理（config.ts）
 * - 使用模块化的日志系统（utils/logger.ts）
 * - 使用模块化的CORS中间件（middleware/cors.ts）
 * - 使用模块化的路由（routes/*.ts）
 * 
 * @module index
 */

import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { loadConfig, getConfig } from './config';
import { logger, getLogger, generateTraceId, LogLevel, Logger } from './utils/logger';
import { corsMiddleware, resolveAllowedOrigins } from './middleware/cors';
import { sanitizeInputMiddleware } from './middleware/security';
import { ApiResponse } from './types';
import { initializeDatabase } from './db/init';
import { sessionService } from './services/sessionService';
import { settingsService } from './services/settingsService';

// 导入路由模块
import { userRoutes } from './routes/users';
import { scriptRoutes } from './routes/scripts';
import { templateRoutes } from './routes/templates';
import { reportRoutes } from './routes/reports';
import { conversationRoutes } from './routes/conversations';
import { pythonVersionRoutes } from './routes/pythonVersions';
import { AIRoutes } from './routes/ai';
import { settingsRoutes } from './routes/settings';
import { auditLogRoutes } from './routes/auditLogs';
import { assetSupplementRoutes } from './routes/assetSupplements';
import { knowledgeBaseRoutes } from './routes/knowledgeBase';
import { aiConfigRoutes } from './routes/aiConfig';
import filesRoutes from './routes/files';
import { startFileCleanupScheduler } from './services/fileCleanupService';

// ═══════════════════════════════════════════════════════
//  配置初始化
// ═══════════════════════════════════════════════════════

/** 加载并验证应用配置 */
loadConfig();
const config = getConfig();

// 清理过期会话与数据库初始化在启动函数中执行

// ═══════════════════════════════════════════════════════
//  Express 应用初始化
// ═══════════════════════════════════════════════════════

const app = express();

// ═══════════════════════════════════════════════════════
//  全局中间件
// ═══════════════════════════════════════════════════════

/** CORS中间件 - 处理跨域请求 */
app.use(corsMiddleware);

/** Cookie解析中间件 */
app.use(cookieParser());

/** 请求体解析 - JSON格式，限制10MB */
app.use(express.json({ limit: '10mb' }));

/** 请求体解析 - URL编码格式 */
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/** 输入清理中间件 — XSS 防护（移除 HTML 标签、JS/data/vbscript 协议） */
app.use(sanitizeInputMiddleware);

/**
 * 请求日志中间件（使用增强型日志）
 * 为每个请求生成 TraceID，记录方法、路径和耗时
 */
app.use((req: Request, _res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const method = req.method;
  const pathname = req.path;
  const traceId = generateTraceId();
  
  // 将 TraceID 注入到请求对象上，供后续路由使用
  (req as any).traceId = traceId;
  
  const requestLogger = getLogger('HTTP', 'other');
  requestLogger.info(`→ ${method} ${pathname}`, traceId);
  
  // 在响应结束时记录耗时
  _res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = _res.statusCode;
    
    if (statusCode >= 500) {
      requestLogger.error(`← ${method} ${pathname} ${statusCode} (${duration}ms)`, traceId);
    } else if (statusCode >= 400) {
      requestLogger.warn(`← ${method} ${pathname} ${statusCode} (${duration}ms)`, traceId);
    } else {
      requestLogger.info(`← ${method} ${pathname} ${statusCode} (${duration}ms)`, traceId);
    }
  });
  
  next();
});

// ═══════════════════════════════════════════════════════
//  速率限制（安全加固）
// ═══════════════════════════════════════════════════════

/** 认证端点限流：登录/注册每分钟次数上限取系统设置 security.authRateLimit（默认 5，可在系统设置页调整，即时生效） */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => settingsService.getNumber('security.authRateLimit', 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 429,
    data: null,
    message: '请求过于频繁，请稍后再试',
    error: 'Too many requests',
  },
});

/** 通用 API 限流：每分钟次数上限取系统设置 security.rateLimit（默认 100，可在系统设置页调整，即时生效） */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => settingsService.getNumber('security.rateLimit', 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 429,
    data: null,
    message: '请求过于频繁，请稍后再试',
    error: 'Too many requests',
  },
});

// ═══════════════════════════════════════════════════════
//  路由挂载
// ═══════════════════════════════════════════════════════

/** 用户路由 - /api/users/*（登录/注册额外限流） */
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/users', apiLimiter, userRoutes.getRouter());

/** 脚本路由 - /api/scripts/* */
app.use('/api/scripts', scriptRoutes.getRouter());

/** 模板路由 - /api/templates/* */
app.use('/api/templates', templateRoutes.getRouter());

/** 报告路由 - /api/reports/* */
app.use('/api/reports', reportRoutes.getRouter());

/** Python 版本管理路由 - /api/python-versions/* */
app.use('/api/python-versions', pythonVersionRoutes.getRouter());

/** 对话路由 - /api/conversations/* */
app.use('/api/conversations', conversationRoutes);

/** AI 聊天路由 - /api/ai/* */
const aiRoutes = new AIRoutes();
app.use('/api/ai', aiRoutes.getRouter());

/** 系统设置路由 - /api/settings */
app.use('/api/settings', settingsRoutes.getRouter());

/** 资产补充信息路由 - /api/asset-supplements */
app.use('/api/asset-supplements', assetSupplementRoutes);

/** 知识库路由 - /api/knowledge-base */
app.use('/api/knowledge-base', knowledgeBaseRoutes);

/** 用户级 AI 配置路由 - /api/ai-config/* */
app.use('/api/ai-config', aiConfigRoutes.getRouter());

/** 文件路由 - /api/files/*（上传前 hash 预检查/秒传判定） */
app.use('/api/files', apiLimiter, filesRoutes);

/** 系统日志路由 - /api/audit-logs/*（审计/登录/设置/运行日志，仅管理员） */
app.use('/api/audit-logs', auditLogRoutes.getRouter());

// ═══════════════════════════════════════════════════════
//  特殊端点
// ═══════════════════════════════════════════════════════

/**
 * 健康检查端点
 * GET /api/health
 * 
 * 返回服务状态、时间戳和版本信息
 * 不需要认证
 */
app.get('/api/health', (_req: Request, res: Response): void => {
  const response: ApiResponse<{
    status: string;
    timestamp: string;
    version: string;
    uptime: number;
  }> = {
    code: 200,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.3.2',
      uptime: process.uptime(),
    },
    message: '服务运行正常',
  };
  res.json(response);
});

/**
 * GET /api/public-config
 *
 * 返回无需认证的公开运行配置，供前端调整本地行为。
 * 当前仅包含会话空闲超时（前端空闲登出倒计时略早于此值）。
 */
app.get('/api/public-config', (_req: Request, res: Response): void => {
  // 从设置读取扩展名列表，逗号分隔 → 数组
  const extList = (key: string, fallback: string): string[] => {
    const raw = settingsService.get(key) || fallback;
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  };
  const response: ApiResponse<{
    sessionTimeoutMinutes: number;
    archiveExtensions: string[];
    textExtensions: string[];
  }> = {
    code: 200,
    data: {
      sessionTimeoutMinutes: settingsService.getNumber(
        'system.sessionTimeout',
        getConfig().SESSION_EXPIRY_MINUTES
      ),
      archiveExtensions: extList('storage.archiveExtensions', '.zip,.tar,.gz,.tgz,.tar.gz,.tar.bz2,.tar.xz'),
      textExtensions: extList('storage.textExtensions', '.txt,.log,.conf,.csv,.xml,.json,.yml,.yaml,.out,.err,.md,.xlsx,.xls'),
    },
    message: 'success',
  };
  res.json(response);
});

// ═══════════════════════════════════════════════════════
//  404 处理
// ═══════════════════════════════════════════════════════

/**
 * 404未找到处理中间件
 * 捕获所有未匹配的路由
 */
app.use((req: Request, res: Response): void => {
  const response: ApiResponse<null> = {
    code: 404,
    data: null,
    message: '未找到请求的资源',
    error: `路径 ${req.method} ${req.path} 不存在`,
  };
  res.status(404).json(response);
});

// ═══════════════════════════════════════════════════════
//  全局错误处理
// ═══════════════════════════════════════════════════════

/**
 * 全局错误处理中间件
 * 使用增强型日志记录完整堆栈和请求上下文
 */
app.use((err: Error, req: Request, res: Response, _next: NextFunction): void => {
  const traceId = (req as any).traceId || '-';
  const errLogger = getLogger('ErrorHandler', 'core');
  
  errLogger.error(`服务器错误: ${err.message}`, traceId, {
    path: req.path,
    method: req.method,
    errorMessage: err.message,
    stack: err.stack || '无堆栈信息',
  });
  
  // 如果响应头已发送，交给Express默认处理器
  if (res.headersSent) {
    return;
  }
  
  const response: ApiResponse<null> = {
    code: 500,
    data: null,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  };
  
  res.status(500).json(response);
});

// ═══════════════════════════════════════════════════════
//  服务器启动（数据库就绪后再监听）
// ═══════════════════════════════════════════════════════

/** HTTP 服务实例（模块级，供优雅关闭引用） */
let server: ReturnType<typeof app.listen>;

/**
 * 启动应用：先初始化数据库，再启动 HTTP 服务器
 */
async function start(): Promise<void> {
  // 1. 数据库初始化（必须等待完成）
  await initializeDatabase();
  logger.info('数据库已就绪');

  // 2. 初始化系统设置缓存
  try {
    await settingsService.initCache();
    logger.info('系统设置缓存已就绪');
  } catch (err) {
    logger.warn(`系统设置缓存初始化失败（不影响核心功能）: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. 启动临时上传文件保留清理调度（每 6 小时，天数取 storage.retentionDays）
  startFileCleanupScheduler();

  // 3.1 恢复 AI 分析任务队列：中断的 running 标记为 error，queued 任务恢复调度
  try {
    const { analysisTaskService } = await import('./services/analysisTaskService');
    await analysisTaskService.init();
    logger.info('分析任务队列已恢复');
  } catch (err) {
    logger.warn(`分析任务队列恢复失败（不影响核心功能）: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. 清理过期会话（后台执行）
  setTimeout(async () => {
    try {
      const cleaned = await sessionService.cleanupExpiredSessions(config.SERVER_INSTANCE_ID);
      logger.info(`启动时清理了 ${cleaned} 个过期会话`);
    } catch (err) {
      logger.warn(`清理过期会话失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 1000);

  // 4. 启动 HTTP 服务器
  server = app.listen(config.PORT, () => {
  const startupLogger = getLogger('Startup', 'core');
  startupLogger.info('═══════════════════════════════════════════════════════');
  startupLogger.info('  智能报告生成工具 - 后端服务 (重构版)');
  startupLogger.info('═══════════════════════════════════════════════════════');
  startupLogger.info(`  端口: ${config.PORT}`);
  startupLogger.info(`  数据目录: ${config.DATA_DIR}`);
  startupLogger.info(`  日志目录: ${config.LOGS_DIR}`);
  startupLogger.info(`  日志格式: ${config.LOG_FORMAT}`);
  startupLogger.info(`  允许来源: ${resolveAllowedOrigins(config.ALLOWED_ORIGINS).join(', ')}`);
  startupLogger.info(`  JWT过期: ${config.JWT_EXPIRES_IN}`);
  startupLogger.info(`  会话超时: ${settingsService.getNumber('system.sessionTimeout', config.SESSION_EXPIRY_MINUTES)}分钟`);
  startupLogger.info(`  记住我天数: ${settingsService.getNumber('system.rememberMeDays', 7)}天`);
  startupLogger.info(`  实例ID: ${config.SERVER_INSTANCE_ID.slice(0, 20)}...`);
  startupLogger.info(`  bcrypt轮数: ${config.BCRYPT_ROUNDS}`);
  startupLogger.info(`  环境: ${process.env.NODE_ENV || 'development'}`);
  startupLogger.info('═══════════════════════════════════════════════════════');
  });
}

// 启动应用
start().catch((error) => {
  logger.error(`启动失败: ${error.message}`);
  process.exit(1);
});

/**
 * 优雅关闭处理
 * 收到SIGTERM/SIGINT信号时，关闭服务器和日志
 */
function gracefulShutdown(signal: string): void {
  const shutdownLogger = getLogger('Shutdown', 'core');
  shutdownLogger.info(`收到 ${signal} 信号，正在优雅关闭...`);

  if (!server) {
    shutdownLogger.info('服务器尚未启动，直接退出');
    process.exit(0);
    return;
  }
  
  server.close(async () => {
    shutdownLogger.info('HTTP服务器已关闭');
    
    // 强制刷新所有日志缓冲区后再退出
    await (await import('./utils/logger')).flushAll();
    
    shutdownLogger.close();
    process.exit(0);
  });
  
  // 10秒后强制关闭（比原来多5秒，确保日志刷完）
  setTimeout(() => {
    const errLogger = getLogger('Shutdown', 'core');
    errLogger.error('强制关闭服务器（日志可能未完全写入）');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/** 未捕获异常处理 */
process.on('uncaughtException', async (error: Error) => {
  const errLogger = getLogger('Process', 'core');
  errLogger.error(`未捕获异常: ${error.message}`, '-', {
    errorMessage: error.message,
    stack: error.stack || '无堆栈信息',
  });
  
  // 尝试刷新日志后再退出
  await (await import('./utils/logger')).flushAll();
  gracefulShutdown('uncaughtException');
});

/** 未处理Promise拒绝 */
process.on('unhandledRejection', (reason: unknown) => {
  const errLogger = getLogger('Process', 'core');
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  errLogger.error(`未处理Promise拒绝: ${message}`, '-', {
    reason,
    stack,
  });
});

export default server!;
