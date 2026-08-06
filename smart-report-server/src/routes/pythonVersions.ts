/**
 * Python 版本管理路由模块
 * 
 * 本模块提供 Python 版本管理的 API 端点。
 * 
 * @module routes/pythonVersions
 */

import { Router, Request, Response } from 'express';
import fsSync from 'fs';
import { execSync } from 'child_process';
import { pythonVersionService } from '../services/pythonVersionService';
import { authenticate, authorize, UserRole } from '../middleware/auth';
import { ApiResponse, safeErrorMessage } from '../types';
import { VENV_PYTHON, EMBEDDED_PYTHON, getPipIndexUrl } from '../config';

/**
 * 单个 Python 环境的探测结果
 */
interface PythonEnvProbe {
  /** 该环境是否可用 */
  available: boolean;
  /** Python 版本号（不可用时为 null） */
  version: string | null;
  /** python 可执行文件路径（系统 Python 未找到时为 null） */
  path: string | null;
}

/**
 * 脚本运行环境信息
 */
export interface PythonEnvironmentInfo {
  /** 内嵌 Python（data/python-embedded） */
  embedded: PythonEnvProbe;
  /** 全局虚拟环境（data/venv） */
  venv: PythonEnvProbe;
  /** 系统 PATH 中的 Python */
  system: PythonEnvProbe;
  /** 当前生效的 pip 镜像源地址 */
  pipIndexUrl: string;
}

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

    // 获取脚本运行环境信息（内嵌 Python / 全局 venv / 系统 Python / pip 镜像源）
    this.router.get('/environment', authenticate, this.getEnvironmentInfo.bind(this));

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
   * 获取脚本运行环境信息
   *
   * 通过运行各 Python 的 --version 命令探测：
   * - 内嵌 Python（data/python-embedded/python.exe）
   * - 全局虚拟环境（data/venv/Scripts/python.exe）
   * - 系统 PATH 中的 Python
   * 同时返回当前生效的 pip 镜像源地址。
   */
  private async getEnvironmentInfo(req: Request, res: Response): Promise<void> {
    /** 探测指定路径的 Python 可执行文件 */
    const probePython = (pythonPath: string): PythonEnvProbe => {
      if (!fsSync.existsSync(pythonPath)) {
        return { available: false, version: null, path: pythonPath };
      }
      try {
        // 旧版本 Python 的 --version 输出到 stderr，2>&1 统一捕获
        const out = execSync(`"${pythonPath}" --version 2>&1`, {
          timeout: 10000,
          encoding: 'utf-8',
        }).trim();
        const match = out.match(/Python\s+([\d.]+)/i);
        return { available: true, version: match ? match[1] : out, path: pythonPath };
      } catch {
        return { available: false, version: null, path: pythonPath };
      }
    };

    /** 探测系统 PATH 中的 Python */
    const probeSystemPython = (): PythonEnvProbe => {
      try {
        const out = execSync('python --version 2>&1', {
          timeout: 10000,
          encoding: 'utf-8',
        }).trim();
        const match = out.match(/Python\s+([\d.]+)/i);
        const version = match ? match[1] : out;

        // 尝试解析系统 Python 的实际路径（Windows where / POSIX which）
        let pythonPath: string | null = null;
        try {
          const whereCmd = process.platform === 'win32' ? 'where python' : 'which python';
          pythonPath = execSync(whereCmd, { timeout: 10000, encoding: 'utf-8' })
            .split(/\r?\n/)[0]
            .trim() || null;
        } catch {
          // 路径解析失败不影响版本信息
        }

        return { available: true, version, path: pythonPath };
      } catch {
        return { available: false, version: null, path: null };
      }
    };

    try {
      const info: PythonEnvironmentInfo = {
        embedded: probePython(EMBEDDED_PYTHON),
        venv: probePython(VENV_PYTHON),
        system: probeSystemPython(),
        pipIndexUrl: getPipIndexUrl(),
      };

      const response: ApiResponse<PythonEnvironmentInfo> = {
        code: 200,
        data: info,
        message: '获取环境信息成功',
      };

      res.status(200).json(response);
    } catch (error: unknown) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取环境信息失败',
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