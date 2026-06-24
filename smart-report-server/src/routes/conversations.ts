/**
 * 对话路由模块
 * 
 * 本模块提供对话相关的API端点，包括创建、更新、删除等。
 * 使用SQLite数据库（通过conversationRepository）处理数据操作。
 * 
 * @module routes/conversations
 */

import { Router, Request, Response } from 'express';
import { conversationRepository } from '../db/repositories';
import { authenticate, authorize } from '../middleware/auth';
import { ApiResponse } from '../types';

/**
 * 对话路由类
 */
export class ConversationRoutes {
  private router: Router;

  /**
   * 创建对话路由实例
   */
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 获取对话列表（需要认证）
    this.router.get('/', authenticate, this.getConversations.bind(this));

    // 创建对话（需要认证）
    this.router.post('/', authenticate, this.createConversation.bind(this));

    // 更新对话（需要认证）
    this.router.put('/:id', authenticate, this.updateConversation.bind(this));

    // 删除对话（需要认证）
    this.router.delete(
      '/:id',
      authenticate,
      this.deleteConversation.bind(this)
    );
  }

  /**
   * 获取对话列表
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getConversations(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.query;

      let conversations;
      if (userId) {
        conversations = await conversationRepository.findAll({ userId: userId as string });
      } else {
        conversations = await conversationRepository.findAll();
      }

      const response: ApiResponse<{ conversations: typeof conversations }> = {
        code: 200,
        data: { conversations },
        message: '获取对话列表成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取对话列表失败',
        error: error.message,
      };

      res.status(500).json(response);
    }
  }

  /**
   * 创建对话
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async createConversation(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;

      // 创建对话对象
      const conversation = {
        id: body.id || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: body.userId || req.user?.userId || '',
        userName: body.userName || req.user?.username || '',
        messages: body.messages || [],
        createdAt: body.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 保存到数据库
      await conversationRepository.create(conversation);

      const response: ApiResponse<typeof conversation> = {
        code: 201,
        data: conversation,
        message: '对话创建成功',
      };

      res.status(201).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '对话创建失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 更新对话
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async updateConversation(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = req.body;

      // 检查对话是否存在
      const existing = await conversationRepository.findById(id);
      if (!existing) {
        throw new Error('对话不存在');
      }

      // 更新对话
      const updated = {
        ...body,
        updatedAt: new Date().toISOString(),
      };

      const conversation = await conversationRepository.update(id, updated);

      const response: ApiResponse<typeof conversation> = {
        code: 200,
        data: conversation,
        message: '对话更新成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '对话更新失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 删除对话
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async deleteConversation(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      // 检查对话是否存在
      const existing = await conversationRepository.findById(id);
      if (!existing) {
        throw new Error('对话不存在');
      }

      await conversationRepository.delete(id);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '对话删除成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '对话删除失败',
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
 * 对话路由单例实例
 */
export const conversationRoutes = new ConversationRoutes();