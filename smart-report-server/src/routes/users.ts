/**
 * 用户路由模块
 * 
 * 本模块提供用户相关的API端点，包括注册、登录、用户管理等。
 * 使用userService处理业务逻辑。
 * 
 * @module routes/users
 */

import { Router, Request, Response } from 'express';
import { userService } from '../services/userService';
import { authenticate, authorize } from '../middleware/auth';
import { ApiResponse } from '../types';

/**
 * 用户路由类
 */
export class UserRoutes {
  private router: Router;

  /**
   * 创建用户路由实例
   */
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 注册用户
    this.router.post('/register', this.register.bind(this));

    // 用户登录
    this.router.post('/login', this.login.bind(this));

    // 获取用户列表（需要认证）
    this.router.get('/', authenticate, this.getUsers.bind(this));

    // 删除用户（需要管理员权限）
    this.router.delete(
      '/:id',
      authenticate,
      authorize(['admin']),
      this.deleteUser.bind(this)
    );

    // 更新用户状态（需要管理员权限）
    this.router.patch(
      '/:id/status',
      authenticate,
      authorize(['admin']),
      this.updateUserStatus.bind(this)
    );

    // 更新用户角色（需要管理员权限）
    this.router.patch(
      '/:id/role',
      authenticate,
      authorize(['admin']),
      this.updateUserRole.bind(this)
    );

    // 更新用户个人资料（本人或管理员）
    this.router.patch(
      '/:id/profile',
      authenticate,
      this.updateProfile.bind(this)
    );

    // 用户自己修改密码
    this.router.post(
      '/change-password',
      authenticate,
      this.changePassword.bind(this)
    );

    // 管理员重置用户密码（需要管理员权限）
    this.router.post(
      '/:id/change-password',
      authenticate,
      authorize(['admin']),
      this.adminResetPassword.bind(this)
    );
  }

  /**
   * 注册用户
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, password, displayName, region } = req.body;

      const user = await userService.register(
        username,
        password,
        displayName,
        region
      );

      const response: ApiResponse<typeof user> = {
        code: 201,
        data: user,
        message: '用户注册成功',
      };

      res.status(201).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '用户注册失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 用户登录
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;

      const result = await userService.login(username, password);

      const response: ApiResponse<typeof result> = {
        code: 200,
        data: result,
        message: '登录成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 401,
        data: null,
        message: '登录失败',
        error: error.message,
      };

      res.status(401).json(response);
    }
  }

  /**
   * 获取用户列表
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const { status, region, role } = req.query;

      const users = await userService.getUsers({
        status: status as string,
        region: region as string,
        role: role as string,
      });

      const response: ApiResponse<{ users: typeof users }> = {
        code: 200,
        data: { users },
        message: '获取用户列表成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取用户列表失败',
        error: error.message,
      };

      res.status(500).json(response);
    }
  }

  /**
   * 删除用户
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      await userService.deleteUser(id);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '用户删除成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '用户删除失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 更新用户状态
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async updateUserStatus(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { status } = req.body;

      const user = await userService.updateUserStatus(id, status);

      const response: ApiResponse<typeof user> = {
        code: 200,
        data: user,
        message: '用户状态更新成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '用户状态更新失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 更新用户角色
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async updateUserRole(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { role } = req.body;

      const user = await userService.updateUserRole(id, role);

      const response: ApiResponse<typeof user> = {
        code: 200,
        data: user,
        message: '用户角色更新成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '用户角色更新失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 更新用户个人资料
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { displayName, region } = req.body;
      const currentUser = req.user;

      // 检查权限：只有本人或管理员可以修改
      if (currentUser?.userId !== id && currentUser?.role !== 'admin') {
        const response: ApiResponse<null> = {
          code: 403,
          data: null,
          message: '权限不足',
          error: '只有本人或管理员可以修改个人资料',
        };
        res.status(403).json(response);
        return;
      }

      const user = await userService.updateProfile(
        id,
        { displayName, region },
        currentUser?.role === 'admin'
      );

      const response: ApiResponse<typeof user> = {
        code: 200,
        data: user,
        message: '个人资料更新成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '个人资料更新失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 用户修改密码
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const { userId, currentPassword, newPassword } = req.body;
      const currentUser = req.user;

      // 检查权限：只能修改自己的密码
      if (currentUser?.userId !== userId) {
        const response: ApiResponse<null> = {
          code: 403,
          data: null,
          message: '权限不足',
          error: '只能修改自己的密码',
        };
        res.status(403).json(response);
        return;
      }

      await userService.changePassword(userId, currentPassword, newPassword);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '密码修改成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '密码修改失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 管理员重置用户密码
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async adminResetPassword(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { newPassword } = req.body;

      await userService.adminResetPassword(id, newPassword);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '密码重置成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '密码重置失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 获取路由器
   * 
   * @returns Express路由器
   */
  getRouter(): Router {
    return this.router;
  }
}

/**
 * 用户路由单例实例
 */
export const userRoutes = new UserRoutes();