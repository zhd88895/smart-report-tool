/**
 * AI Agent 路由模块
 * 
 * 本模块提供 AI Agent 相关的 API 端点，包括：
 * 1. 非流式 Agent 请求
 * 2. SSE 流式 Agent 请求
 * 3. 待确认操作的确认/取消
 * 4. Agent Skill 文档获取
 * 
 * @module routes/agent
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { agentService } from '../services/agentService';
import { ApiResponse } from '../types';
import { getLogger, generateTraceId } from '../utils/logger';

// 日志实例
const log = getLogger('AgentRoutes', 'other');

/**
 * Agent 路由类
 */
export class AgentRoutes {
  private router: Router;

  /**
   * 创建 Agent 路由实例
   */
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 非流式 Agent 请求（需要认证）
    this.router.post('/chat', authenticate, this.handleChat.bind(this));

    // SSE 流式 Agent 请求（需要认证）
    this.router.post('/chat/stream', authenticate, this.handleStreamChat.bind(this));

    // 确认待执行的写入操作（需要认证）
    this.router.post('/confirm/:actionId', authenticate, this.handleConfirmAction.bind(this));

    // 取消待执行操作（需要认证）
    this.router.delete('/confirm/:actionId', authenticate, this.handleCancelAction.bind(this));

    // 获取待确认操作列表（需要认证）
    this.router.get('/pending', authenticate, this.handleGetPendingActions.bind(this));

    // 获取 Agent Skill 文档（需要认证）
    this.router.get('/skill', authenticate, this.handleGetAgentSkill.bind(this));
  }

  /**
   * 处理非流式 Agent 请求
   */
  private async handleChat(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const { message, conversationId, model } = req.body;
      const userId = (req as any).userId;
      const userName = (req as any).userName;

      if (!message) {
        res.status(400).json({
          code: 400,
          data: null,
          message: '消息内容不能为空',
          error: '消息内容不能为空',
        } as ApiResponse<null>);
        return;
      }

      log.info(`非流式 Agent 请求: ${message.substring(0, 50)}...`, traceId);

      // 执行 Agent 请求
      const response = await agentService.executeStream({
        conversationId,
        message,
        userId: req.user!.userId,
        userName,
        model,
        stream: false,
      });

      // 收集所有事件
      const events: any[] = [];
      for await (const event of response) {
        events.push(event);
      }

      // 提取最终消息
      const finalEvent = events.find(e => e.type === 'message');
      const errorEvent = events.find(e => e.type === 'error');

      if (errorEvent) {
        res.status(500).json({
          code: 500,
          data: null,
          message: 'Agent 请求失败',
          error: errorEvent.data.message,
        } as ApiResponse<null>);
        return;
      }

      res.json({
        code: 200,
        data: finalEvent?.data || {},
        message: 'Agent 请求成功',
      } as ApiResponse<any>);

    } catch (error: any) {
      log.error(`非流式 Agent 请求失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: '非流式 Agent 请求失败',
        error: error.message,
      } as ApiResponse<null>);
    }
  }

  /**
   * 处理 SSE 流式 Agent 请求
   */
  private async handleStreamChat(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const { message, conversationId, model } = req.body;
      const userId = (req as any).userId;
      const userName = (req as any).userName;

      if (!message) {
        res.status(400).json({
          code: 400,
          data: null,
          message: '消息内容不能为空',
          error: '消息内容不能为空',
        } as ApiResponse<null>);
        return;
      }

      log.info(`SSE 流式 Agent 请求: ${message.substring(0, 50)}...`, traceId);

      // 设置 SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // 发送初始连接确认
      res.write(`data: ${JSON.stringify({ type: 'connected', data: {} })}\n\n`);

      // 执行 Agent 流式请求
      const generator = agentService.executeStream({
        conversationId,
        message,
        userId: req.user!.userId,
        userName,
        model,
        stream: true,
      });

      // 流式发送事件
      for await (const event of generator) {
        const eventData = JSON.stringify(event);
        res.write(`data: ${eventData}\n\n`);
        
        // 如果是完成或错误事件，结束响应
        if (event.type === 'done' || event.type === 'error') {
          break;
        }
      }

      // 结束响应
      res.end();

    } catch (error: any) {
      log.error(`SSE 流式 Agent 请求失败: ${error.message}`, traceId);
      
      // 如果响应头已发送，尝试发送错误事件
      if (!res.headersSent) {
        res.status(500).json({
          code: 500,
          data: null,
          message: 'SSE 流式 Agent 请求失败',
          error: error.message,
        } as ApiResponse<null>);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', data: { message: error.message } })}\n\n`);
        res.end();
      }
    }
  }

  /**
   * 处理确认待执行操作
   */
  private async handleConfirmAction(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const actionId = req.params.actionId as string;
      const userId = (req as any).userId;

      log.info(`确认操作: ${actionId}`, traceId);

      // 执行确认的操作
      const result = await agentService.confirmAction(actionId);

      if (!result.success) {
        res.status(400).json({
          code: 400,
          data: null,
          message: result.error || '操作确认失败',
          error: result.error || '操作确认失败',
        } as ApiResponse<null>);
        return;
      }

      res.json({
        code: 200,
        data: result.data,
        message: result.message || '操作确认成功',
      } as ApiResponse<any>);

    } catch (error: any) {
      log.error(`确认操作失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: '确认操作失败',
        error: error.message,
      } as ApiResponse<null>);
    }
  }

  /**
   * 处理取消待执行操作
   */
  private async handleCancelAction(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const actionId = req.params.actionId as string;
      const userId = (req as any).userId;

      log.info(`取消操作: ${actionId}`, traceId);

      // 取消操作
      const cancelled = agentService.cancelAction(actionId);

      if (!cancelled) {
        res.status(404).json({
          code: 404,
          data: null,
          message: '操作不存在或已过期',
          error: '操作不存在或已过期',
        } as ApiResponse<null>);
        return;
      }

      res.json({
        code: 200,
        data: null,
        message: '操作已取消',
      } as ApiResponse<null>);

    } catch (error: any) {
      log.error(`取消操作失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: '取消操作失败',
        error: error.message,
      } as ApiResponse<null>);
    }
  }

  /**
   * 处理获取待确认操作列表
   */
  private async handleGetPendingActions(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const userId = (req as any).userId;

      log.info(`获取待确认操作列表`, traceId);

      // 获取待确认操作
      const pendingActions = agentService.getPendingActions();

      res.json({
        code: 200,
        data: {
          actions: pendingActions,
          total: pendingActions.length,
        },
        message: '获取待确认操作列表成功',
      } as ApiResponse<any>);

    } catch (error: any) {
      log.error(`获取待确认操作列表失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: '获取待确认操作列表失败',
        error: error.message,
      } as ApiResponse<null>);
    }
  }

  /**
   * 处理获取 Agent Skill 文档
   */
  private async handleGetAgentSkill(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const userId = (req as any).userId;

      log.info(`获取 Agent Skill 文档`, traceId);

      // Agent Skill 文档
      const agentSkill = {
        name: 'Smart Report Agent',
        version: '1.0.0',
        description: '智能巡检报告管理系统的 AI Agent 助手',
        capabilities: [
          '查询报告列表和详情',
          '查看报告文件',
          '查询脚本列表和详情',
          '查看脚本运行日志',
          '获取系统状态',
          '查看操作日志',
          '创建新脚本',
          '更新脚本配置',
          '运行脚本生成报告',
          '删除报告',
          '修改系统设置',
        ],
        tools: [
          {
            name: 'list_reports',
            description: '查询报告列表，支持按状态、用户、区域筛选',
            permission: 'read_only',
          },
          {
            name: 'get_report_detail',
            description: '获取单个报告的详细信息',
            permission: 'read_only',
          },
          {
            name: 'get_report_files',
            description: '获取报告关联的文件列表',
            permission: 'read_only',
          },
          {
            name: 'list_scripts',
            description: '查询脚本列表，支持按状态、关键词筛选',
            permission: 'read_required',
          },
          {
            name: 'get_script_detail',
            description: '获取脚本的详细配置信息',
            permission: 'read_only',
          },
          {
            name: 'get_script_logs',
            description: '获取脚本的运行日志',
            permission: 'read_only',
          },
          {
            name: 'get_system_status',
            description: '获取系统运行状态',
            permission: 'read_only',
          },
          {
            name: 'get_operation_logs',
            description: '查询系统操作日志',
            permission: 'read_only',
          },
          {
            name: 'create_script',
            description: '创建新的巡检脚本',
            permission: 'write',
          },
          {
            name: 'update_script',
            description: '修改脚本配置或内容',
            permission: 'write',
          },
          {
            name: 'run_script',
            description: '运行指定的巡检脚本生成报告',
            permission: 'write',
          },
          {
            name: 'delete_report',
            description: '删除指定的报告及其文件',
            permission: 'dangerous',
          },
          {
            name: 'update_settings',
            description: '修改系统配置',
            permission: 'write',
          },
        ],
        usage: {
          streamEndpoint: '/api/agent/chat/stream',
          nonStreamEndpoint: '/api/agent/chat',
          confirmEndpoint: '/api/agent/confirm/:actionId',
          cancelEndpoint: '/api/agent/confirm/:actionId',
          pendingEndpoint: '/api/agent/pending',
        },
        examples: [
          {
            query: '查看最近完成的报告',
            description: '查询状态为"completed"的报告列表',
          },
          {
            query: '查看脚本 script_123 的详情',
            description: '获取指定脚本的详细配置信息',
          },
          {
            query: '创建一个Windows巡检脚本',
            description: '需要确认后执行创建脚本操作',
          },
          {
            query: '删除报告 rpt_456',
            description: '需要二次确认的危险操作',
          },
        ],
      };

      res.json({
        code: 200,
        data: agentSkill,
        message: '获取 Agent Skill 文档成功',
      } as ApiResponse<any>);

    } catch (error: any) {
      log.error(`获取 Agent Skill 文档失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: '获取 Agent Skill 文档失败',
        error: error.message,
      } as ApiResponse<null>);
    }
  }

  /**
   * 获取路由实例
   */
  getRouter(): Router {
    return this.router;
  }
}

// 导出路由实例
export const agentRoutes = new AgentRoutes();
