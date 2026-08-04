/**
 * Python 版本管理路由模块
 * 
 * 本模块提供 Python 版本管理的 API 端点。
 * 
 * @module routes/pythonVersions
 */

import { Router, Request, Response } from 'express';
import { pythonVersionService } from '../services/pythonVersionService';
import { authenticate, authorize, UserRole } from '../middleware/auth';
import { ApiResponse, safeErrorMessage } from '../types';

/**
 * Python 版本管理路由类
 */
export class PythonVersionRoutes {
  private router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 获取可用的 Python 版本列表
    this.router.get('/available', authenticate, this.getAvailableVersions.bind(this));

    // 获取已安装的 Python 版本列表
    this.router.get('/installed', authenticate, this.getInstalledVersions.bind(this));

    // 下载并安装指定版本的 Python
    this.router.post('/:version/download', authenticate, authorize(['admin']), this.downloadVersion.bind(this));

    // 删除已安装的 Python 版本
    this.router.delete('/:version', authenticate, authorize(['admin']), this.deleteVersion.bind(this));

    // 获取版本下载进度（SSE）
    this.router.get('/:version/progress', authenticate, this.getVersionProgress.bind(this));
  }

  /**
   * 获取可用的 Python 版本列表
   */
  private async getAvailableVersions(req: Request, res: Response): Promise<void> {
    try {
      const versions = await pythonVersionService.getAvailableVersions();

      const response: ApiResponse<{ versions: typeof versions }> = {
        code: 200,
        data: { versions },
        message: '获取版本列表成功',
      };

      res.status(200).json(response);
    } catch (error: unknown) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取版本列表失败',
        error: safeErrorMessage(error),
      };

      res.status(500).json(response);
    }
  }

  /**
   * 获取已安装的 Python 版本列表
   */
  private async getInstalledVersions(req: Request, res: Response): Promise<void> {
    try {
      const versions = await pythonVersionService.getInstalledVersions();

      const response: ApiResponse<{ versions: typeof versions }> = {
        code: 200,
        data: { versions },
        message: '获取已安装版本列表成功',
      };

      res.status(200).json(response);
    } catch (error: unknown) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取已安装版本列表失败',
        error: safeErrorMessage(error),
      };

      res.status(500).json(response);
    }
  }

  /**
   * 下载并安装指定版本的 Python（SSE 流式响应）
   */
  private async downloadVersion(req: Request, res: Response): Promise<void> {
    const version = Array.isArray(req.params.version) ? req.params.version[0] : req.params.version;

    try {
      // 设置 SSE 响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const sendSSE = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const result = await pythonVersionService.downloadAndInstall(version, (progress) => {
        sendSSE('progress', progress);
      });

      sendSSE('complete', result);

      res.end();
    } catch (error: unknown) {
      // 如果 SSE 头已经发送，通过 SSE 发送错误
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(error) })}\n\n`
        );
        res.end();
      } else {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '下载安装失败',
          error: safeErrorMessage(error),
        };

        res.status(400).json(response);
      }
    }
  }

  /**
   * 删除已安装的 Python 版本
   */
  private async deleteVersion(req: Request, res: Response): Promise<void> {
    const version = Array.isArray(req.params.version) ? req.params.version[0] : req.params.version;

    try {
      const result = await pythonVersionService.deleteVersion(version);

      const response: ApiResponse<typeof result> = {
        code: result.success ? 200 : 400,
        data: result,
        message: result.message,
      };

      res.status(result.success ? 200 : 400).json(response);
    } catch (error: unknown) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '删除版本失败',
        error: safeErrorMessage(error),
      };

      res.status(400).json(response);
    }
  }

  /**
   * 获取版本下载进度（占位端点，实际进度通过 SSE 推送）
   */
  private async getVersionProgress(req: Request, res: Response): Promise<void> {
    const response: ApiResponse<{ message: string }> = {
      code: 200,
      data: { message: '进度通过 SSE 推送，请使用 POST /:version/download 端点' },
      message: '请使用 SSE 端点获取实时进度',
    };

    res.status(200).json(response);
  }

  /**
   * 获取路由器
   */
  getRouter(): Router {
    return this.router;
  }
}

/**
 * Python 版本管理路由单例实例
 */
export const pythonVersionRoutes = new PythonVersionRoutes();