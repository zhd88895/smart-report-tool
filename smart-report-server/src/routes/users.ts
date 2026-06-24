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
import { ApiResponse } from '../types';
import { getLogger } from '../utils/logger';

const log = getLogger('UserRoutes', 'other');

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
      res.status(400).json({ code: 400, data: null, message: '用户注册失败', error: error.message });
    }
  }

  /**
   * 登录（使用 HttpOnly Cookie 设置会话）
   */
  private async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password, rememberMe } = req.body;

      const result = await userService.login(username, password);

      // 创建会话并设置 Cookie
      await createLoginSession(
        res,
        result.user.id,
        result.user.username,
        result.user.role,
        rememberMe === true
      );

      // 不再返回 token，只返回用户信息
      const response: ApiResponse<{ user: typeof result.user }> = {
        code: 200,
        data: { user: result.user },
        message: '登录成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      log.warn(`登录失败: ${error.message}`);
      res.status(401).json({ code: 401, data: null, message: '登录失败', error: error.message });
    }
  }

  /**
   * 登出（清除会话和 Cookie）
   */
  private async logout(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.cookies?.sid || req.cookies?.sid_r;

      if (sessionId) {
        await sessionService.deleteSession(sessionId);
        log.info(`会话已销毁: ${sessionId.slice(0, 8)}...`);
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
      res.status(500).json({ code: 500, data: null, message: '获取用户信息失败', error: error.message });
    }
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
      res.status(500).json({ code: 500, data: null, message: '获取用户列表失败', error: error.message });
    }
  }

  /**
   * 删除用户
   */
  private async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      await userService.deleteUser(req.params.id as string);
      res.status(200).json({ code: 200, data: { success: true }, message: '用户删除成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '用户删除失败', error: error.message });
    }
  }

  /**
   * 更新用户状态
   */
  private async updateUserStatus(req: Request, res: Response): Promise<void> {
    try {
      const user = await userService.updateUserStatus(req.params.id as string, req.body.status);
      res.status(200).json({ code: 200, data: user, message: '用户状态更新成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '用户状态更新失败', error: error.message });
    }
  }

  /**
   * 更新用户角色
   */
  private async updateUserRole(req: Request, res: Response): Promise<void> {
    try {
      const user = await userService.updateUserRole(req.params.id as string, req.body.role);
      res.status(200).json({ code: 200, data: user, message: '用户角色更新成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '用户角色更新失败', error: error.message });
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

      const user = await userService.updateProfile(id, { displayName, region }, currentUser?.role === 'admin');
      res.status(200).json({ code: 200, data: user, message: '个人资料更新成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '个人资料更新失败', error: error.message });
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
      res.status(400).json({ code: 400, data: null, message: '密码修改失败', error: error.message });
    }
  }

  /**
   * 管理员重置密码
   */
  private async adminResetPassword(req: Request, res: Response): Promise<void> {
    try {
      await userService.adminResetPassword(req.params.id as string, req.body.newPassword);
      res.status(200).json({ code: 200, data: { success: true }, message: '密码重置成功' });
    } catch (error: any) {
      res.status(400).json({ code: 400, data: null, message: '密码重置失败', error: error.message });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}

export const userRoutes = new UserRoutes();
