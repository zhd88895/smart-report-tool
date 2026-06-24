/**
 * 安全认证中间件模块（Cookie 版）
 *
 * 使用 HttpOnly Secure Cookie 替代 localStorage 存储会话标识，
 * 配合后端会话管理实现安全的认证机制。
 * 改造后符合 OWASP 安全最佳实践：
 * - 使用 HttpOnly、Secure、SameSite 属性的短期会话 Cookie
 * - 服务端重启后非持久会话自动失效
 * - 支持"记住我"长期持久 Cookie
 * - 空闲超时自动退出机制
 *
 * @module auth
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config';
import { sessionService } from '../services/sessionService';
import { ApiResponse } from '../types';
import { getLogger } from '../utils/logger';

const log = getLogger('AuthMiddleware', 'other');

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

export type UserRole = 'admin' | 'senior' | 'member';

export interface User {
  userId: string;
  username: string;
  role: UserRole;
}

export interface SessionUser extends User {
  sessionId: string;
}

// 扩展 Express Request 接口
declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

// ═══════════════════════════════════════════════════════
//  Cookie 名称常量
// ═══════════════════════════════════════════════════════

const COOKIE_NAME = 'sid';           // 短期会话 Cookie
const REMEMBER_COOKIE_NAME = 'sid_r'; // 长期"记住我" Cookie

// ═══════════════════════════════════════════════════════
//  Cookie 配置
// ═══════════════════════════════════════════════════════

/**
 * 获取 Cookie 选项
 * 开发环境下 Secure=false（本地 HTTP），生产环境 Secure=true
 */
function getCookieOptions(rememberMe: boolean = false): any {
  const config = getConfig();
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,                    // 禁止 JS 访问
    secure: isProduction,              // 仅 HTTPS 传输（开发环境允许 HTTP）
    sameSite: isProduction ? 'strict' as const : 'lax' as const, // CSRF 防护
    path: '/',
    // 短期会话：不设置 maxAge → 关闭浏览器即失效
    // 记住我：设定过期时间
    ...(rememberMe ? { maxAge: config.REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000 } : {}),
  };
}

// ═══════════════════════════════════════════════════════
//  认证中间件
// ═══════════════════════════════════════════════════════

/**
 * 基于 Cookie 的会话认证中间件
 *
 * 从 Cookie 中读取会话 ID，验证会话有效性，将用户信息注入 req.user。
 * 同时更新会话的最后活动时间（实现空闲超时检测）。
 * 支持两种 Cookie 优先级：
 *   1. 优先检查短期 Cookie（sid）
 *   2. 短期无效时尝试长期 Cookie（sid_r）
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const config = getConfig();
    const sessionId = req.cookies?.[COOKIE_NAME];
    const rememberSessionId = req.cookies?.[REMEMBER_COOKIE_NAME];

    const sid = sessionId || rememberSessionId;

    if (!sid) {
      sendUnauthorized(res, '未登录');
      return;
    }

    // 验证会话
    const session = await sessionService.getValidSession(
      sid,
      config.SERVER_INSTANCE_ID
    );

    if (!session) {
      // 会话无效，清除 Cookie
      clearAuthCookies(res);
      sendUnauthorized(res, '会话已过期，请重新登录');
      return;
    }

    // 更新非持久会话的活动时间（空闲超时续期）
    if (!session.isPersistent) {
      await sessionService.touchSession(sid, config.SESSION_EXPIRY_MINUTES);
    }

    // 注入用户信息到请求
    req.user = {
      userId: session.userId,
      username: session.username,
      role: session.role as UserRole,
    };
    req.sessionId = sid;

    next();
  } catch (error) {
    log.error(`认证中间件异常: ${error instanceof Error ? error.message : String(error)}`);
    sendUnauthorized(res, '认证服务异常');
  }
}

// ═══════════════════════════════════════════════════════
//  登录辅助函数（供路由调用）
// ═══════════════════════════════════════════════════════

/**
 * 创建登录会话并设置 Cookie
 *
 * @param res - Express 响应对象
 * @param userId - 用户 ID
 * @param username - 用户名
 * @param role - 角色
 * @param rememberMe - 是否启用"记住我"
 * @returns 包含会话信息的对象
 */
export async function createLoginSession(
  res: Response,
  userId: string,
  username: string,
  role: string,
  rememberMe: boolean = false
): Promise<{ sessionId: string }> {
  const config = getConfig();

  const { sessionId } = await sessionService.createSession(
    userId,
    username,
    role,
    rememberMe ? null : config.SERVER_INSTANCE_ID,
    rememberMe ? undefined : config.SESSION_EXPIRY_MINUTES
  );

  if (rememberMe) {
    // 设置长期"记住我" Cookie
    res.cookie(REMEMBER_COOKIE_NAME, sessionId, getCookieOptions(true));
  } else {
    // 设置短期会话 Cookie（关闭浏览器即失效）
    res.cookie(COOKIE_NAME, sessionId, getCookieOptions(false));
  }

  log.info(`登录会话已创建: user=${username}, rememberMe=${rememberMe}`);
  return { sessionId };
}

/**
 * 清除所有认证 Cookie
 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(REMEMBER_COOKIE_NAME, { path: '/' });
}

// ═══════════════════════════════════════════════════════
//  角色授权中间件
// ═══════════════════════════════════════════════════════

export function authorize(
  roles: UserRole[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendUnauthorized(res, '用户未认证');
      return;
    }

    if (!roles.includes(req.user.role)) {
      const response: ApiResponse<null> = {
        code: 403,
        data: null,
        message: '权限不足',
        error: `需要角色: ${roles.join(', ')}`,
      };
      res.status(403).json(response);
      return;
    }

    next();
  };
}

// ═══════════════════════════════════════════════════════
//  内部工具函数
// ═══════════════════════════════════════════════════════

function sendUnauthorized(res: Response, message: string): void {
  const response: ApiResponse<null> = {
    code: 401,
    data: null,
    message,
    error: message,
  };
  res.status(401).json(response);
}
