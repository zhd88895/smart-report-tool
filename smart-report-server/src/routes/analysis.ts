/**
 * AI 分析路由模块
 * 
 * 本模块提供 AI 分析相关的 API 端点，包括：
 * 1. 文件内容提取
 * 2. 流式 AI 分析
 * 3. 分析类别查询
 * 
 * @module routes/analysis
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { analysisService, AnalysisCategory } from '../services/analysisService';
import { aiAnalysisWithToolsService } from '../services/aiAnalysisWithTools';
import { ApiResponse } from '../types';
import { getLogger, generateTraceId } from '../utils/logger';

// 日志实例
const log = getLogger('AnalysisRoutes', 'other');

/**
 * AI 分析路由类
 */
export class AnalysisRoutes {
  private router: Router;

  /**
   * 创建 AI 分析路由实例
   */
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 获取支持的分析类别（需要认证）
    this.router.get('/categories', authenticate, this.handleGetCategories.bind(this));

    // 执行 AI 分析（需要认证）
    this.router.post('/analyze', authenticate, this.handleAnalyze.bind(this));

    // 执行流式 AI 分析（需要认证）
    this.router.post('/analyze/stream', authenticate, this.handleStreamAnalyze.bind(this));

    // 提取文件内容（需要认证）
    this.router.post('/extract', authenticate, this.handleExtractContent.bind(this));
  }

  /**
   * 处理获取分析类别
   */
  private async handleGetCategories(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      log.info(`获取分析类别`, traceId);

      const categories = analysisService.getSupportedCategories();

      res.json({
        code: 200,
        data: categories,
        message: '获取分析类别成功',
      } as ApiResponse<any>);

    } catch (error: any) {
      log.error(`获取分析类别失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: '获取分析类别失败',
        error: error.message,
      } as ApiResponse<null>);
    }
  }

  /**
   * 处理 AI 分析请求
   */
  private async handleAnalyze(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const { file, category, userPrompt, supplements, enableTools, workDir, autoExtract } = req.body;
      const userId = (req as any).userId;

      if (!category) {
        res.status(400).json({
          code: 400,
          data: null,
          message: '分析类别不能为空',
          error: '分析类别不能为空',
        } as ApiResponse<null>);
        return;
      }

      log.info(`AI 分析请求: ${category}`, traceId);

      let result;
      
      // 根据是否启用工具调用选择不同的分析服务
      if (enableTools) {
        log.info('使用工具模式分析', traceId);
        result = await aiAnalysisWithToolsService.analyzeWithTools({
          userId: req.user!.userId,
          file,
          category: category as AnalysisCategory,
          userPrompt,
          supplements,
          enableTools,
          workDir,
          autoExtract,
        });
      } else {
        result = await analysisService.analyze({
          userId: req.user!.userId,
          file,
          category: category as AnalysisCategory,
          userPrompt,
          supplements,
        });
      }

      res.json({
        code: 200,
        data: result,
        message: 'AI 分析完成',
      } as ApiResponse<any>);

    } catch (error: any) {
      log.error(`AI 分析失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: 'AI 分析失败',
        error: error.message,
      } as ApiResponse<null>);
    }
  }

  /**
   * 处理流式 AI 分析请求
   */
  private async handleStreamAnalyze(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const { file, category, userPrompt, supplements } = req.body;
      const userId = (req as any).userId;

      if (!category) {
        res.status(400).json({
          code: 400,
          data: null,
          message: '分析类别不能为空',
          error: '分析类别不能为空',
        } as ApiResponse<null>);
        return;
      }

      log.info(`流式 AI 分析请求: ${category}`, traceId);

      // 设置 SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // 发送初始连接确认
      res.write(`data: ${JSON.stringify({ type: 'connected', data: {} })}\n\n`);

      // 执行流式分析
      const generator = analysisService.analyzeStream({
        userId: req.user!.userId,
        file,
        category: category as AnalysisCategory,
        userPrompt,
        supplements,
      });

      // 流式发送结果
      for await (const chunk of generator) {
        const eventData = JSON.stringify({ type: 'chunk', data: { content: chunk } });
        res.write(`data: ${eventData}\n\n`);
      }

      // 发送完成事件
      res.write(`data: ${JSON.stringify({ type: 'done', data: {} })}\n\n`);
      res.end();

    } catch (error: any) {
      log.error(`流式 AI 分析失败: ${error.message}`, traceId);
      
      // 如果响应头已发送，尝试发送错误事件
      if (!res.headersSent) {
        res.status(500).json({
          code: 500,
          data: null,
          message: '流式 AI 分析失败',
          error: error.message,
        } as ApiResponse<null>);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', data: { message: error.message } })}\n\n`);
        res.end();
      }
    }
  }

  /**
   * 处理文件内容提取请求
   */
  private async handleExtractContent(req: Request, res: Response): Promise<void> {
    const traceId = generateTraceId();
    try {
      const { filePath } = req.body;
      const userId = (req as any).userId;

      if (!filePath) {
        res.status(400).json({
          code: 400,
          data: null,
          message: '文件路径不能为空',
          error: '文件路径不能为空',
        } as ApiResponse<null>);
        return;
      }

      log.info(`提取文件内容: ${filePath}`, traceId);

      // 提取文件内容
      const content = await analysisService.extractFileContent(filePath);

      res.json({
        code: 200,
        data: { content },
        message: '文件内容提取成功',
      } as ApiResponse<any>);

    } catch (error: any) {
      log.error(`文件内容提取失败: ${error.message}`, traceId);
      res.status(500).json({
        code: 500,
        data: null,
        message: '文件内容提取失败',
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
export const analysisRoutes = new AnalysisRoutes();
