/**
 * 用户路由模块（Cookie 认证版）
 *
 * 登录成功后通过 HttpOnly Cookie 传递会话标识，不再返回 JWT Token。
 * 新增：
 * - POST /logout 登出
 * - GET /me 获取当前登录用户
 * - 登录支持 rememberMe 选项
 *
 * @module routes/users
 */

import { Router, Request, Response } from 'express';
import { userService } from '../services/userService';
import {
  authenticate,
  authorize,
  createLoginSession,
  clearAuthCookies,
} from '../middleware/auth';
import { sessionService } from '../services/sessionService';
import { auditLogService } from '../services/auditLogService';
import { getAsync } from '../db/database';
import { ApiResponse, safeErrorMessage } from '../types';
import { getLogger } from '../utils/logger';

const log = getLogger('UserRoutes', 'other');

/** 从请求中取客户端 IP（含代理头） */
function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || '';
}

export class UserRoutes {
  private router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // 注册用户
    this.router.post('/register', this.register.bind(this));

    // 用户登录（支持 rememberMe）
    this.router.post('/login', this.login.bind(this));

    // 用户登出
    this.router.post('/logout', this.logout.bind(this));

    // 获取当前登录用户
    this.router.get('/me', authenticate, this.getCurrentUser.bind(this));

    // 会话心跳（authenticate 内已完成滑动续期，成功返回 204 无 body）
    this.router.post('/heartbeat', authenticate, this.heartbeat.bind(this));

    // 获取用户列表（需要认证）
    this.router.get('/', authenticate, this.getUsers.bind(this));

    // 删除用户
    this.router.delete('/:id', authenticate, authorize(['admin']), this.deleteUser.bind(this));

    // 更新用户状态
    this.router.patch('/:id/status', authenticate, authorize(['admin']), this.updateUserStatus.bind(this));

    // 更新用户角色
    this.router.patch('/:id/role', authenticate, authorize(['admin']), this.updateUserRole.bind(this));

    // 更新个人资料
    this.router.patch('/:id/profile', authenticate, this.updateProfile.bind(this));

    // 用户自己修改密码
    this.router.post('/change-password', authenticate, this.changePassword.bind(this));

    // 管理员重置密码
    this.router.post('/:id/change-password', authenticate, authorize(['admin']), this.adminResetPassword.bind(this));
  }

  /**
   * 注册
   */
  private async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, password, displayName, region } = req.body;
      const user = await userService.register(username, password, displayName, region);
      const response: ApiResponse<typeof user> = {
        code: 201,
        data: user,
        message: '用户注册成功',
      };
      res.status(201).json(response);
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '用户注册失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 登录（使用 HttpOnly Cookie 设置会话）
   */
  private async login(req: Request, res: Response): Promise<void> {
    const ip = clientIp(req);
    const username = String(req.body?.username || '');
    try {
      const { password, rememberMe } = req.body;

      const result = await userService.login(username, password);

      // 创建会话并设置 Cookie
      await createLoginSession(
        res,
        result.user.id,
        result.user.username,
        result.user.role,
        rememberMe === true
      );

      // 登录日志：成功
      auditLogService.record({
        category: 'auth', action: 'auth.login',
        actorId: result.user.id, actorName: result.user.displayName || result.user.username,
        target: result.user.username, detail: `登录成功（${rememberMe === true ? '记住登录' : '普通会话'}）`,
        result: 'success', ip,
      }).catch(() => {});

      // 不再返回 token，只返回用户信息
      const response: ApiResponse<{ user: typeof result.user }> = {
        code: 200,
        data: { user: result.user },
        message: '登录成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      log.warn(`登录失败: ${safeErrorMessage(error)}`);
      // 登录日志：失败
      auditLogService.record({
        category: 'auth', action: 'auth.login',
        actorName: username || null, target: username || null,
        detail: `登录失败：${safeErrorMessage(error)}`,
        result: 'failed', ip,
      }).catch(() => {});
      res.status(401).json({ code: 401, data: null, message: '登录失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 登出（清除会话和 Cookie）
   */
  private async logout(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.cookies?.sid || req.cookies?.sid_r;

      if (sessionId) {
        // 登出前解析会话属主，用于登录日志记录
        const row = await getAsync('SELECT username FROM sessions WHERE id = ?', [sessionId]).catch(() => undefined);
        await sessionService.deleteSession(sessionId);
        log.info(`会话已销毁: ${sessionId.slice(0, 8)}...`);
        auditLogService.record({
          category: 'auth', action: 'auth.logout',
          actorName: (row as any)?.username || null, target: (row as any)?.username || null,
          detail: '退出登录', result: 'success', ip: clientIp(req),
        }).catch(() => {});
      }

      clearAuthCookies(res);

      res.status(200).json({ code: 200, data: { success: true }, message: '已退出登录' });
    } catch (error: any) {
      clearAuthCookies(res);
      res.status(200).json({ code: 200, data: { success: true }, message: '已退出登录' });
    }
  }

  /**
   * 获取当前登录用户信息（用于前端校验会话状态）
   */
  private async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user!;

      // 从数据库获取完整用户信息
      const users = await userService.getUsers({});
      const fullUser = users.find((u) => u.id === user.userId);

      if (!fullUser) {
        clearAuthCookies(res);
        res.status(401).json({ code: 401, data: null, message: '用户不存在' });
        return;
      }

      res.status(200).json({
        code: 200,
        data: { user: fullUser },
        message: '获取成功',
      });
    } catch (error: any) {
      res.status(500).json({ code: 500, data: null, message: '获取用户信息失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 会话心跳
   *
   * authenticate 中间件已验证会话并对非持久会话执行滑动续期（touchSession），
   * 此处直接返回 204 无 body，供前端用户活动监听节流调用。
   */
  private async heartbeat(_req: Request, res: Response): Promise<void> {
    res.status(204).end();
  }

  /**
   * 获取用户列表
   */
  private async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const { status, region, role } = req.query;
      const users = await userService.getUsers({
        status: status as string,
        region: region as string,
        role: role as string,
      });
      res.status(200).json({ code: 200, data: { users }, message: '获取用户列表成功' });
    } catch (error: any) {
      res.status(500).json({ code: 500, data: null, message: '获取用户列表失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 管理员敏感操作前置校验
   *
   * 规则：
   * 1. 目标用户必须存在
   * 2. 不能对自己的账户执行删除/角色变更（防止管理员把自己锁死）
   * 3. 目标是其他管理员 → 拒绝（管理员不能编辑/删除其他管理员；
   *    opts.allowAdminTarget=true 时放行，目前仅「重置密码」使用）
   * 4. 操作对象是其他用户 → 必须在请求体携带 adminPassword，
   *    并用当前管理员本人的密码通过验证
   *
   * 校验失败时直接写响应并记录安全审计日志，返回 null；通过则返回目标用户。
   */
  private async checkAdminAction(
    req: Request,
    res: Response,
    targetId: string,
    action: string,
    actionLabel: string,
    opts: { allowAdminTarget?: boolean; forbidSelf?: boolean } = {}
  ): Promise<any | null> {
    const actor = req.user!;
    const ip = clientIp(req);
    const audit = (result: 'success' | 'failed' | 'denied', detail: string, targetName?: string) =>
      auditLogService.record({
        category: 'security', action,
        actorId: actor.userId, actorName: actor.username,
        target: targetName || targetId, detail, result, ip,
      }).catch(() => {});

    const target = await userService.getUserById(targetId);
    if (!target) {
      res.status(404).json({ code: 404, data: null, message: '用户不存在' });
      return null;
    }
    const targetName = target.displayName || target.username;

    if (opts.forbidSelf && target.id === actor.userId) {
      await audit('denied', `${actionLabel}被拒绝：不能对自己的账户执行此操作`, targetName);
      res.status(400).json({ code: 400, data: null, message: `不能对自己的账户执行${actionLabel}操作` });
      return null;
    }

    if (target.role === 'admin' && target.id !== actor.userId && !opts.allowAdminTarget) {
      await audit('denied', `${actionLabel}被拒绝：目标是管理员账户`, targetName);
      res.status(403).json({ code: 403, data: null, message: `不能${actionLabel}其他管理员账户` });
      return null;
    }

    // 操作其他用户：验证当前管理员本人密码
    if (target.id !== actor.userId) {
      const adminPassword = req.body?.adminPassword;
      if (!adminPassword) {
        res.status(400).json({ code: 400, data: null, message: '需要输入当前管理员密码进行验证', error: 'ADMIN_PASSWORD_REQUIRED' });
        return null;
      }
      const ok = await userService.verifyPassword(actor.userId, adminPassword);
      if (!ok) {
        await audit('failed', `${actionLabel}失败：管理员密码验证未通过`, targetName);
        res.status(403).json({ code: 403, data: null, message: '管理员密码错误，操作已取消' });
        return null;
      }
    }

    return target;
  }

  /**
   * 删除用户
   */
  private async deleteUser(req: Request, res: Response): Promise<void> {
    const target = await this.checkAdminAction(req, res, req.params.id as string, 'user.delete', '删除', { forbidSelf: true });
    if (!target) return;
    try {
      await userService.deleteUser(target.id);
      auditLogService.record({
        category: 'security', action: 'user.delete',
        actorId: req.user!.userId, actorName: req.user!.username,
        target: target.displayName || target.username,
        detail: `已删除用户 ${target.username}（角色：${target.role}）`,
        result: 'success', ip: clientIp(req),
      }).catch(() => {});
      res.status(200).json({ code: 200, data: { success: true }, message: '用户删除成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '用户删除失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 更新用户状态
   */
  private async updateUserStatus(req: Request, res: Response): Promise<void> {
    const newStatus = req.body.status;
    // 状态变更不强制密码验证（审批流程高频操作），但管理员账户的状态不允许被其他管理员修改
    const target = await userService.getUserById(req.params.id as string);
    if (!target) {
      res.status(404).json({ code: 404, data: null, message: '用户不存在' });
      return;
    }
    const targetName = target.displayName || target.username;
    if (target.role === 'admin' && target.id !== req.user!.userId) {
      auditLogService.record({
        category: 'security', action: 'user.status_change',
        actorId: req.user!.userId, actorName: req.user!.username,
        target: targetName, detail: `状态变更被拒绝：目标是管理员账户`, result: 'denied', ip: clientIp(req),
      }).catch(() => {});
      res.status(403).json({ code: 403, data: null, message: '不能修改其他管理员账户的状态' });
      return;
    }
    try {
      const user = await userService.updateUserStatus(target.id, newStatus);
      auditLogService.record({
        category: 'security', action: 'user.status_change',
        actorId: req.user!.userId, actorName: req.user!.username,
        target: targetName, detail: `状态：${target.status} → ${newStatus}`,
        result: 'success', ip: clientIp(req),
      }).catch(() => {});
      res.status(200).json({ code: 200, data: user, message: '用户状态更新成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '用户状态更新失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 更新用户角色
   */
  private async updateUserRole(req: Request, res: Response): Promise<void> {
    const target = await this.checkAdminAction(req, res, req.params.id as string, 'user.role_change', '修改角色', { forbidSelf: true });
    if (!target) return;
    const newRole = req.body.role;
    try {
      const user = await userService.updateUserRole(target.id, newRole);
      auditLogService.record({
        category: 'security', action: 'user.role_change',
        actorId: req.user!.userId, actorName: req.user!.username,
        target: target.displayName || target.username,
        detail: `角色：${target.role} → ${newRole}`,
        result: 'success', ip: clientIp(req),
      }).catch(() => {});
      res.status(200).json({ code: 200, data: user, message: '用户角色更新成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '用户角色更新失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 更新个人资料
   */
  private async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { displayName, region } = req.body;
      const currentUser = req.user;

      if (currentUser?.userId !== id && currentUser?.role !== 'admin') {
        res.status(403).json({ code: 403, data: null, message: '权限不足', error: '只有本人或管理员可以修改个人资料' });
        return;
      }

      // 管理员编辑其他用户：需要密码验证，且目标不能是其他管理员
      if (currentUser?.userId !== id) {
        const target = await this.checkAdminAction(req, res, id, 'user.update', '编辑用户资料');
        if (!target) return;
        const user = await userService.updateProfile(id, { displayName, region }, true);
        auditLogService.record({
          category: 'security', action: 'user.update',
          actorId: currentUser!.userId, actorName: currentUser!.username,
          target: target.displayName || target.username,
          detail: `编辑用户资料（显示名称/区域）`,
          result: 'success', ip: clientIp(req),
        }).catch(() => {});
        res.status(200).json({ code: 200, data: user, message: '个人资料更新成功' });
        return;
      }

      const user = await userService.updateProfile(id, { displayName, region }, false);
      res.status(200).json({ code: 200, data: user, message: '个人资料更新成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '个人资料更新失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 修改密码
   */
  private async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const { userId, currentPassword, newPassword } = req.body;
      if (req.user?.userId !== userId) {
        res.status(403).json({ code: 403, data: null, message: '权限不足', error: '只能修改自己的密码' });
        return;
      }
      await userService.changePassword(userId, currentPassword, newPassword);
      res.status(200).json({ code: 200, data: { success: true }, message: '密码修改成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '密码修改失败', error: safeErrorMessage(error) });
    }
  }

  /**
   * 管理员重置密码（可重置任何用户含其他管理员，但必须验证当前管理员本人密码）
   */
  private async adminResetPassword(req: Request, res: Response): Promise<void> {
    const target = await this.checkAdminAction(
      req, res, req.params.id as string,
      'user.reset_password', '重置密码',
      { allowAdminTarget: true, forbidSelf: true }
    );
    if (!target) return;
    try {
      await userService.adminResetPassword(target.id, req.body.newPassword);
      auditLogService.record({
        category: 'security', action: 'user.reset_password',
        actorId: req.user!.userId, actorName: req.user!.username,
        target: target.displayName || target.username,
        detail: `已重置用户 ${target.username} 的密码`,
        result: 'success', ip: clientIp(req),
      }).catch(() => {});
      res.status(200).json({ code: 200, data: { success: true }, message: '密码重置成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '密码重置失败', error: safeErrorMessage(error) });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}

export const userRoutes = new UserRoutes();
