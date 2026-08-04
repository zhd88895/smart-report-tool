/**
 * 对话路由模块
 * 
 * 提供对话相关的API端点：创建、更新、删除。
 * 使用SQLite数据库（通过conversationRepository）处理数据操作。
 * 
 * @module routes/conversations
 */

import { Router, Request, Response } from 'express';
import { conversationRepository } from '../db/repositories';
import { authenticate } from '../middleware/auth';
import { ApiResponse, safeErrorMessage } from '../types';

const router = Router();

/** 获取对话列表（严格按当前登录用户过滤） */
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      res.status(401).json({
        code: 401, data: null, message: '未登录',
      } as ApiResponse<null>);
      return;
    }
    const conversations = await conversationRepository.findAll({ userId: currentUserId });
    res.status(200).json({
      code: 200, data: { conversations }, message: '获取对话列表成功',
    } as ApiResponse<{ conversations: typeof conversations }>);
  } catch (error: any) {
    res.status(500).json({
      code: 500, data: null, message: '获取对话列表失败', error: safeErrorMessage(error),
    } as ApiResponse<null>);
  }
});

/** 创建对话 */
router.post('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const currentUserId = req.user?.userId;
    const currentUserName = req.user?.username;
    if (!currentUserId) {
      res.status(401).json({ code: 401, data: null, message: '未登录' } as ApiResponse<null>);
      return;
    }
    const body = req.body;
    const conversation = {
      id: body.id || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: currentUserId,
      userName: currentUserName || '',
      messages: body.messages || [],
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await conversationRepository.create(conversation);
    res.status(201).json({
      code: 201, data: conversation, message: '对话创建成功',
    } as ApiResponse<typeof conversation>);
  } catch (error: any) {
    res.status(400).json({
      code: 400, data: null, message: '对话创建失败', error: safeErrorMessage(error),
    } as ApiResponse<null>);
  }
});

/** 更新对话 */
router.put('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;
    const existing = await conversationRepository.findById(id);
    if (!existing) throw new Error('对话不存在');
    if (existing.userId !== currentUserId) throw new Error('无权更新该对话');
    const conversation = await conversationRepository.update(id, {
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    res.status(200).json({
      code: 200, data: conversation, message: '对话更新成功',
    } as ApiResponse<typeof conversation>);
  } catch (error: any) {
    res.status(400).json({
      code: 400, data: null, message: '对话更新失败', error: safeErrorMessage(error),
    } as ApiResponse<null>);
  }
});

/** 删除对话 */
router.delete('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const currentUserId = req.user?.userId;
    const existing = await conversationRepository.findById(id);
    if (!existing) throw new Error('对话不存在');
    if (existing.userId !== currentUserId) throw new Error('无权删除该对话');
    await conversationRepository.delete(id);
    res.status(200).json({
      code: 200, data: { success: true }, message: '对话删除成功',
    } as ApiResponse<{ success: boolean }>);
  } catch (error: any) {
    res.status(400).json({
      code: 400, data: null, message: '对话删除失败', error: safeErrorMessage(error),
    } as ApiResponse<null>);
  }
});

export { router as conversationRoutes };
