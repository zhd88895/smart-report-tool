/**
 * 报告路由模块
 * 
 * 本模块提供报告相关的API端点，包括生成、查询、删除等。
 * 使用reportService处理业务逻辑。
 * 
 * @module routes/reports
 */

import { Router, Request, Response } from 'express';
import { reportService } from '../services/reportService';
import { authenticate, authorize } from '../middleware/auth';
import { uploadReportInputFiles } from '../middleware/upload';
import { ApiResponse } from '../types';

/**
 * 报告路由类
 */
export class ReportRoutes {
  private router: Router;

  /**
   * 创建报告路由实例
   */
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 获取报告列表（需要认证）
    this.router.get('/', authenticate, this.getReports.bind(this));

    // 获取单个报告（用于轮询状态，需要认证）
    this.router.get('/:id', authenticate, this.getReport.bind(this));

    // 生成报告（需要认证，SSE流式返回日志，需要 multer 处理 multipart/form-data）
    this.router.post('/generate', authenticate, uploadReportInputFiles, this.generateReport.bind(this));

    // 删除报告（需要认证）
    this.router.delete('/:id', authenticate, this.deleteReport.bind(this));

    // 获取报告执行日志（需要认证）
    this.router.get('/:id/logs', authenticate, this.getReportLogs.bind(this));

    // 列出报告文件（需要认证）
    this.router.get('/:id/files', authenticate, this.getReportFiles.bind(this));

    // 下载报告文件（需要认证）
    this.router.get(
      '/:id/download',
      authenticate,
      this.downloadReport.bind(this)
    );

    // 批量下载报告文件（需要认证）
    this.router.get(
      '/:id/download-all',
      authenticate,
      this.downloadAllReports.bind(this)
    );
  }

  /**
   * 获取报告列表
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getReports(req: Request, res: Response): Promise<void> {
    try {
      const { status, generatedBy } = req.query;

      const reports = await reportService.getReports({
        status: status as string,
        generatedBy: generatedBy as string,
      });

      const response: ApiResponse<{ reports: typeof reports }> = {
        code: 200,
        data: { reports },
        message: '获取报告列表成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取报告列表失败',
        error: error.message,
      };

      res.status(500).json(response);
    }
  }

  /**
   * 获取单个报告（用于前段轮询状态）
   */
  private async getReport(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const report = await reportService.getReport(id);

      if (!report) {
        res.status(404).json({ code: 404, data: null, message: '报告不存在' } as ApiResponse<null>);
        return;
      }

      // 额外返回是否正在运行中的任务
      const isRunning = reportService.isTaskRunning(id);
      const response: ApiResponse<{ report: typeof report; isRunning: boolean }> = {
        code: 200,
        data: { report, isRunning },
        message: '获取报告成功',
      };
      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({ code: 500, data: null, message: '获取报告失败', error: error.message } as ApiResponse<null>);
    }
  }

  /**
   * 生成报告
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async generateReport(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      const files = req.files as
        | { [fieldname: string]: Express.Multer.File[] }
        | undefined;

      // 准备输入文件（按 inputFile0, inputFile1... 顺序收集）
      const inputFiles: Array<{
        filename: string;
        path: string;
        size: number;
      }> = [];
      if (files) {
        const inputKeys = Object.keys(files)
          .filter((key) => /^inputFile\d+$/.test(key))
          .sort((a, b) => {
            const idxA = parseInt(a.replace('inputFile', ''), 10);
            const idxB = parseInt(b.replace('inputFile', ''), 10);
            return idxA - idxB;
          });

        for (const key of inputKeys) {
          const inputFile = files[key]?.[0];
          if (inputFile) {
            inputFiles.push({
              filename: inputFile.originalname,
              path: inputFile.path,
              size: inputFile.size,
            });
          }
        }
      }

      // 启动后台生成任务，立即获取 reportId 和 EventEmitter
      const { reportId, emitter } = await reportService.startBackgroundGeneration({
        scriptId: body.scriptId,
        templateId: body.templateId,
        outputFormat: body.outputFormat,
        reportInfo: body.reportInfo ? JSON.parse(body.reportInfo) : {},
        inputFiles,
        inputHashes: body.inputHashes ? JSON.parse(body.inputHashes) : [],
        requirements: body.requirements ? JSON.parse(body.requirements) : [],
        generatedBy: req.user?.userId,
      });

      // 设置SSE响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const sendSSE = (event: string, data: any) => {
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
      };

      // 订阅 EventEmitter 事件 → SSE
      const onLog = (msg: string) => sendSSE('log', { message: msg });
      const onComplete = (data: any) => {
        sendSSE('complete', data);
        safeEnd();
      };
      const onError = (error: string) => {
        sendSSE('error', { error });
        safeEnd();
      };

      emitter.on('log', onLog);
      emitter.on('complete', onComplete);
      emitter.on('error', onError);

      // 发送 reportId 让前端可以后续轮询恢复
      sendSSE('started', { reportId });

      const safeEnd = () => {
        emitter.off('log', onLog);
        emitter.off('complete', onComplete);
        emitter.off('error', onError);
        try { res.end(); } catch {}
      };

      // 前端断开连接 → 只取消 SSE 订阅，后台任务继续运行
      req.on('close', () => {
        emitter.off('log', onLog);
        emitter.off('complete', onComplete);
        emitter.off('error', onError);
        try { res.end(); } catch {}
      });

    } catch (error: any) {
      if (!res.headersSent) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '生成报告失败',
          error: error.message,
        };
        res.status(400).json(response);
      }
    }
  }

  /**
   * 删除报告
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async deleteReport(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      await reportService.deleteReport(id);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '报告删除成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '报告删除失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 获取报告执行日志
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getReportLogs(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const logs = await reportService.getReportLogs(id);

      const response: ApiResponse<{ logs: typeof logs }> = {
        code: 200,
        data: { logs },
        message: '获取报告日志成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '获取报告日志失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 列出报告文件
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getReportFiles(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const files = await reportService.getReportFiles(id);

      const response: ApiResponse<{ files: typeof files }> = {
        code: 200,
        data: { files },
        message: '获取报告文件列表成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '获取报告文件列表失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 下载报告文件
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async downloadReport(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const fileIndex = req.query.fileIndex as string;

      const fileInfo = await reportService.downloadReport(
        id,
        fileIndex ? parseInt(fileIndex) : undefined
      );

      // 设置下载响应头
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(
          fileInfo.fileName
        )}"`,
      });

      // 创建文件读取流并发送
      const fileStream = require('fs').createReadStream(fileInfo.filePath);
      fileStream.pipe(res);
    } catch (error: any) {
      if (!res.headersSent) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '下载报告失败',
          error: error.message,
        };
        res.status(400).json(response);
      }
    }
  }

  /**
   * 批量下载报告文件
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async downloadAllReports(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const archiveInfo = await reportService.downloadAllReports(id);

      // 设置下载响应头
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(
          archiveInfo.fileName
        )}"`,
        'Content-Length': String(archiveInfo.fileSize),
      });

      // 创建文件读取流并发送
      const fileStream = require('fs').createReadStream(archiveInfo.filePath);
      // 流式传输完成后自动结束响应
      fileStream.on('error', (err: Error) => {
        console.error(`下载打包文件时读取失败: ${archiveInfo.filePath} - ${err.message}`);
        try { res.end(); } catch {}
      });
      fileStream.pipe(res);
    } catch (error: any) {
      console.error(`批量下载报告失败 (reportId=${req.params.id}): ${error.message}`, error.stack);
      if (!res.headersSent) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '批量下载报告失败',
          error: error.message,
        };
        res.status(400).json(response);
      }
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
 * 报告路由单例实例
 */
export const reportRoutes = new ReportRoutes();