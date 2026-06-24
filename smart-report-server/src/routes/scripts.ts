/**
 * 脚本路由模块
 * 
 * 本模块提供脚本相关的API端点，包括上传、更新、删除、内容管理等。
 * 使用scriptService处理业务逻辑。
 * 
 * @module routes/scripts
 */

import { Router, Request, Response } from 'express';
import { scriptService } from '../services/scriptService';
import { authenticate, authorize } from '../middleware/auth';
import { uploadScriptFiles } from '../middleware/upload';
import { fileManager } from '../utils/file';
import { ApiResponse } from '../types';
import { existsSync, createReadStream } from 'fs';

/**
 * 脚本路由类
 */
export class ScriptRoutes {
  private router: Router;

  /**
   * 创建脚本路由实例
   */
  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 获取脚本列表（需要认证）
    this.router.get('/', authenticate, this.getScripts.bind(this));

    // 上传脚本（需要认证，需要 multer 处理 multipart/form-data）
    this.router.post('/', authenticate, uploadScriptFiles, this.uploadScript.bind(this));

    // 更新脚本元数据或替换脚本文件（需要认证）
    // uploadScriptFiles 对非 multipart 请求透明传递，不影响 JSON 更新
    this.router.put('/:id', authenticate, uploadScriptFiles, this.updateScript.bind(this));

    // 删除脚本（需要认证）
    this.router.delete('/:id', authenticate, this.deleteScript.bind(this));

    // 获取脚本内容（需要认证）
    this.router.get(
      '/:id/content',
      authenticate,
      this.getScriptContent.bind(this)
    );

    // 更新脚本内容（需要认证）
    this.router.put(
      '/:id/content',
      authenticate,
      this.updateScriptContent.bind(this)
    );

    // 安装脚本依赖（需要认证）
    this.router.post(
      '/:id/install-deps',
      authenticate,
      this.installDependencies.bind(this)
    );

    // 下载脚本文件（需要认证）
    this.router.get(
      '/:id/download',
      authenticate,
      this.downloadScript.bind(this)
    );
  }

  /**
   * 获取脚本列表
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getScripts(req: Request, res: Response): Promise<void> {
    try {
      const { region, category, scriptType } = req.query;

      const scripts = await scriptService.getScripts({
        region: region as string,
        category: category as string,
        scriptType: scriptType as string,
      });

      const response: ApiResponse<{ scripts: typeof scripts }> = {
        code: 200,
        data: { scripts },
        message: '获取脚本列表成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取脚本列表失败',
        error: error.message,
      };

      res.status(500).json(response);
    }
  }

  /**
   * 上传脚本
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async uploadScript(req: Request, res: Response): Promise<void> {
    try {
      const files = req.files as
        | { [fieldname: string]: Express.Multer.File[] }
        | undefined;
      const body = req.body;

      const scriptFile = files?.['scriptFile']?.[0];

      if (!scriptFile) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '上传脚本失败',
          error: '没有上传文件',
        };
        res.status(400).json(response);
        return;
      }

      // 主文件大小限制：5MB
      if (scriptFile.size > 5 * 1024 * 1024) {
        throw new Error('脚本文件大小超过 5MB 限制');
      }

      // 收集并校验辅助文件
      const auxiliaryFiles: Array<{
        filename: string;
        path: string;
        size: number;
      }> = [];
      const auxKeys = Object.keys(files || {})
        .filter((key) => /^auxFile\d+$/.test(key))
        .sort((a, b) => {
          const idxA = parseInt(a.replace('auxFile', ''), 10);
          const idxB = parseInt(b.replace('auxFile', ''), 10);
          return idxA - idxB;
        });

      for (const key of auxKeys) {
        const aux = files?.[key]?.[0];
        if (!aux) continue;

        if (aux.size > 10 * 1024 * 1024) {
          throw new Error(`辅助文件 ${aux.originalname} 超过 10MB 限制`);
        }
        if (!fileManager.validateFileName(aux.originalname)) {
          throw new Error(`辅助文件名无效: ${aux.originalname}`);
        }

        auxiliaryFiles.push({
          filename: aux.originalname,
          path: aux.path,
          size: aux.size,
        });
      }

      const script = await scriptService.uploadScript(
        {
          filename: scriptFile.originalname,
          path: scriptFile.path,
          size: scriptFile.size,
        },
        {
          name: body.name,
          description: body.description,
          scriptType: body.scriptType,
          region: body.region,
          inputFormats: body.inputFormats,
          inputFormatManual: body.inputFormatManual === 'true',
          version: body.version,
          category: body.category,
          templateRequired: body.templateRequired === 'true',
          templateIds: body.templateIds ? JSON.parse(body.templateIds) : [],
          requirements: body.requirements ? JSON.parse(body.requirements) : [],
          uploadedBy: req.user?.userId,
          auxiliaryFiles,
        }
      );

      const response: ApiResponse<typeof script> = {
        code: 201,
        data: script,
        message: '脚本上传成功',
      };

      res.status(201).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '脚本上传失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 更新脚本元数据
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async updateScript(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      const isMultipart = files !== undefined;

      // 处理新脚本文件替换
      const scriptFile = files?.['scriptFile']?.[0];
      if (scriptFile) {
        await scriptService.replaceScriptFile(id, {
          filename: scriptFile.originalname,
          path: scriptFile.path,
          size: scriptFile.size,
        });
      }

      // 处理新上传的辅助文件
      const auxFiles = this.collectAuxFiles(files);
      if (auxFiles.length > 0) {
        await scriptService.addAuxiliaryFiles(id, auxFiles);
      }

      // 更新元数据
      const updateData = isMultipart
        ? this.parseMultipartMetadata(body)
        : body;
      if (updateData && Object.keys(updateData).length > 0) {
        await scriptService.updateScript(id, updateData);
      }

      const updatedScript = await scriptService.getScript(id);

      const response: ApiResponse<typeof updatedScript> = {
        code: 200,
        data: updatedScript,
        message: '脚本更新成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '脚本更新失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 从 multer files 中提取辅助文件列表
   */
  private collectAuxFiles(
    files: { [fieldname: string]: Express.Multer.File[] } | undefined
  ): Array<{ filename: string; path: string; size: number }> {
    if (!files) return [];

    const auxKeys = Object.keys(files)
      .filter((k) => k.startsWith('auxFile'))
      .sort((a, b) => parseInt(a.replace('auxFile', '')) - parseInt(b.replace('auxFile', '')));

    const result: Array<{ filename: string; path: string; size: number }> = [];
    for (const key of auxKeys) {
      const aux = files[key]?.[0];
      if (!aux) continue;
      if (aux.size > 10 * 1024 * 1024) {
        throw new Error(`辅助文件 ${aux.originalname} 超过 10MB 限制`);
      }
      if (!fileManager.validateFileName(aux.originalname)) {
        throw new Error(`辅助文件名无效: ${aux.originalname}`);
      }
      result.push({
        filename: aux.originalname,
        path: aux.path,
        size: aux.size,
      });
    }
    return result;
  }

  /**
   * 将 multipart 表单的字符串字段解析为更新数据对象
   * multer 将 multipart 的文本字段解析为字符串，需要手动转换布尔/JSON 类型
   */
  private parseMultipartMetadata(body: Record<string, any>): Record<string, any> {
    const data: Record<string, any> = {};
    if (body.name) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.scriptType) data.scriptType = body.scriptType;
    if (body.region) data.region = body.region;
    if (body.inputFormats !== undefined) data.inputFormats = body.inputFormats;
    if (body.inputFormatManual !== undefined) data.inputFormatManual = body.inputFormatManual === 'true';
    if (body.version) data.version = body.version;
    if (body.category) data.category = body.category;
    if (body.templateRequired !== undefined) data.templateRequired = body.templateRequired === 'true';
    if (body.templateIds) data.templateIds = JSON.parse(body.templateIds);
    if (body.requirements) data.requirements = JSON.parse(body.requirements);
    if (body.existingAux) {
      data.auxiliaryFiles = JSON.parse(body.existingAux);
    }
    return data;
  }

  /**
   * 删除脚本
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async deleteScript(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      await scriptService.deleteScript(id);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '脚本删除成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '脚本删除失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 获取脚本内容
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getScriptContent(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const content = await scriptService.getScriptContent(id);

      const response: ApiResponse<typeof content> = {
        code: 200,
        data: content,
        message: '获取脚本内容成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '获取脚本内容失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 更新脚本内容
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async updateScriptContent(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { content } = req.body;

      const result = await scriptService.updateScriptContent(id, content);

      const response: ApiResponse<typeof result> = {
        code: 200,
        data: result,
        message: '脚本内容更新成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '脚本内容更新失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 安装脚本依赖
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async installDependencies(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      // 设置SSE响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const sendSSE = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const onLog = (message: string) => {
        sendSSE('log', { message });
      };

      const result = await scriptService.installDependencies(id, onLog);

      sendSSE('complete', {
        success: result.success,
        status: result.success ? 'done' : 'failed',
        log: result.log,
      });

      res.end();
    } catch (error: any) {
      // 如果SSE头已经发送，通过SSE发送错误（包含status字段让前端可更新状态）
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: error.message, status: 'failed' })}\n\n`
        );
        res.end();
      } else {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '安装依赖失败',
          error: error.message,
        };
        res.status(400).json(response);
      }
    }
  }

  /**
   * 下载脚本文件
   *
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async downloadScript(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const script = await scriptService.getScript(id);

      if (!script.filePath || !existsSync(script.filePath)) {
        res.status(404).json({
          code: 404,
          data: null,
          message: '脚本文件不存在',
        });
        return;
      }

      const fileName = encodeURIComponent(script.fileName);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      res.setHeader('Content-Type', 'application/octet-stream');

      const fileStream = createReadStream(script.filePath);
      fileStream.pipe(res);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '下载脚本失败',
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
 * 脚本路由单例实例
 */
export const scriptRoutes = new ScriptRoutes();