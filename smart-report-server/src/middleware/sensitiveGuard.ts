/**
 * 高危操作二次验证中间件
 *
 * 对删除脚本、删除知识库文件等不可逆操作，要求当前用户在请求体中
 * 携带 `adminPassword`（本人登录密码）进行二次验证：
 * - 未携带 → 400 + `PASSWORD_REQUIRED`，前端据此弹出安全验证框
 * - 密码错误 → 403，并写入安全审计日志（result=failed）
 * - 验证通过 → next()，由业务路由执行操作并写入成功审计
 *
 * 与用户管理路由中的 checkAdminAction 同源，但适用于任意已登录用户
 * 对共享资源（脚本库、知识库等）的破坏性操作。
 *
 * @module middleware/sensitiveGuard
 */

import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/userService';
import { auditLogService } from '../services/auditLogService';

/** 从请求中取客户端 IP（含代理头） */
function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || '';
}

/**
 * 生成高危操作密码验证中间件。
 * @param action      审计动作标识，如 'script.delete'
 * @param actionLabel 审计详情中展示的操作名，如 '删除脚本'
 */
export function requirePasswordConfirm(action: string, actionLabel: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ code: 401, data: null, message: '未登录或会话已过期' });
      return;
    }

    const password = req.body?.adminPassword;
    if (!password || typeof password !== 'string') {
      res.status(400).json({
        code: 400,
        data: null,
        message: `${actionLabel}需要输入您的登录密码进行验证`,
        error: 'PASSWORD_REQUIRED',
      });
      return;
    }

    try {
      const ok = await userService.verifyPassword(actor.userId, password);
      if (!ok) {
        auditLogService.record({
          category: 'security',
          action,
          actorId: actor.userId,
          actorName: actor.username,
          target: req.params.id ? String(req.params.id) : undefined,
          detail: `${actionLabel}失败：登录密码验证未通过`,
          result: 'failed',
          ip: clientIp(req),
        }).catch(() => {});
        res.status(403).json({ code: 403, data: null, message: '密码错误，操作已取消' });
        return;
      }
    } catch {
      res.status(500).json({ code: 500, data: null, message: '密码校验服务异常，请稍后重试' });
      return;
    }

    next();
  };
}

/**
 * 高危操作成功后的审计记录便捷方法（在业务路由中调用）。
 */
export function auditSensitiveSuccess(
  req: Request,
  action: string,
  detail: string,
  target?: string
): void {
  const actor = req.user;
  auditLogService.record({
    category: 'security',
    action,
    actorId: actor?.userId,
    actorName: actor?.username,
    target,
    detail,
    result: 'success',
    ip: clientIp(req),
  }).catch(() => {});
}
