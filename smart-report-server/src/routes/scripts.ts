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
import { settingsService } from '../services/settingsService';
import { fileManager } from '../utils/file';
import { ApiResponse, safeErrorMessage } from '../types';
import { existsSync, createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import * as tar from 'tar';
import { SCRIPTS_DIR, UPLOADS_DIR } from '../config';

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

    // 清空多文件模式下的脚本文件（需要认证）
    this.router.delete('/:id/files', authenticate, this.clearScriptFiles.bind(this));

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

    // 一键下载脚本的全部巡检工具（tar.gz 打包，所有登录用户可下载）
    this.router.get(
      '/:id/tools-download',
      authenticate,
      this.downloadTools.bind(this)
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
        error: safeErrorMessage(error),
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

      // 文件大小限制：从系统设置动态读取 storage.uploadLimit（单位 MB）
      const uploadLimitMB = settingsService.getNumber('storage.uploadLimit', 50);
      const maxFileSizeBytes = uploadLimitMB * 1024 * 1024;
      if (scriptFile.size > maxFileSizeBytes) {
        throw new Error(`脚本文件大小超过 ${uploadLimitMB}MB 限制`);
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

        if (aux.size > maxFileSizeBytes) {
          throw new Error(`辅助文件 ${aux.originalname} 超过 ${uploadLimitMB}MB 限制`);
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

      // 收集并校验巡检工具文件（multipart 字段名 tools，可多文件，不限扩展名）
      const toolFiles: Array<{
        filename: string;
        path: string;
        size: number;
      }> = [];
      for (const tool of files?.['tools'] || []) {
        if (tool.size > maxFileSizeBytes) {
          throw new Error(`巡检工具文件 ${tool.originalname} 超过 ${uploadLimitMB}MB 限制`);
        }
        if (!fileManager.validateFileName(tool.originalname)) {
          throw new Error(`巡检工具文件名无效: ${tool.originalname}`);
        }
        toolFiles.push({
          filename: tool.originalname,
          path: tool.path,
          size: tool.size,
        });
      }

      // 多文件模式：收集额外的 .py 脚本文件（scriptFile1, scriptFile2, ...）
      const extraScriptFiles: Array<{
        filename: string;
        path: string;
        size: number;
      }> = [];
      const isMultiFile = body.isMultiFile === 'true';
      if (isMultiFile) {
        const scriptKeys = Object.keys(files || {})
          .filter((key) => /^scriptFile\d+$/.test(key))
          .sort((a, b) => {
            const idxA = parseInt(a.replace('scriptFile', ''), 10);
            const idxB = parseInt(b.replace('scriptFile', ''), 10);
            return idxA - idxB;
          });
        for (const key of scriptKeys) {
          const f = files?.[key]?.[0];
          if (!f) continue;
          if (f.size > maxFileSizeBytes) {
            throw new Error(`额外脚本文件 ${f.originalname} 超过 ${uploadLimitMB}MB 限制`);
          }
          extraScriptFiles.push({
            filename: f.originalname,
            path: f.path,
            size: f.size,
          });
        }
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
          pythonVersion: body.pythonVersion || 'embedded',
          isMultiFile,
          reportNameTemplate: body.reportNameTemplate,
          auxiliaryFiles,
          toolFiles,
        },
        extraScriptFiles.length > 0 ? extraScriptFiles : undefined
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
        error: safeErrorMessage(error),
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

      // 1. 先更新元数据（包括 extraFiles 同步），这样删除旧 extra/主文件时不会误伤新文件
      const updateData = isMultipart
        ? this.parseMultipartMetadata(body)
        : body;
      if (updateData && Object.keys(updateData).length > 0) {
        await scriptService.updateScript(id, updateData);
      }

      // 2. 处理新脚本文件替换（主入口）
      const scriptFile = files?.['scriptFile']?.[0];
      if (scriptFile) {
        await scriptService.replaceScriptFile(id, {
          filename: scriptFile.originalname,
          path: scriptFile.path,
          size: scriptFile.size,
        });
      }

      // 3. 处理多文件模式下的额外 .py 文件（如果上传了新文件）
      const extraScriptFiles: Array<{ filename: string; path: string; size: number }> = [];
      if (body && (body as any).isMultiFile === 'true') {
        const scriptKeys = Object.keys(files || {})
          .filter((k) => /^scriptFile\d+$/.test(k))
          .sort((a, b) => parseInt(a.replace('scriptFile', ''), 10) - parseInt(b.replace('scriptFile', ''), 10));
        for (const key of scriptKeys) {
          const f = files?.[key]?.[0];
          if (!f) continue;
          extraScriptFiles.push({
            filename: f.originalname,
            path: f.path,
            size: f.size,
          });
        }
        if (extraScriptFiles.length > 0) {
          await scriptService.addExtraScriptFiles(id, extraScriptFiles);
        }
      }

      // 4. 处理新上传的辅助文件
      const auxFiles = this.collectAuxFiles(files);
      if (auxFiles.length > 0) {
        await scriptService.addAuxiliaryFiles(id, auxFiles);
      }

      // 5. 处理新上传的巡检工具文件
      const toolFiles = this.collectToolFiles(files);
      if (toolFiles.length > 0) {
        await scriptService.addToolFiles(id, toolFiles);
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
        error: safeErrorMessage(error),
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
    const uploadLimitMB = settingsService.getNumber('storage.uploadLimit', 50);
    for (const key of auxKeys) {
      const aux = files[key]?.[0];
      if (!aux) continue;
      if (aux.size > uploadLimitMB * 1024 * 1024) {
        throw new Error(`辅助文件 ${aux.originalname} 超过 ${uploadLimitMB}MB 限制`);
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
   * 从 multer files 中提取巡检工具文件列表（字段名 tools，不限扩展名）
   */
  private collectToolFiles(
    files: { [fieldname: string]: Express.Multer.File[] } | undefined
  ): Array<{ filename: string; path: string; size: number }> {
    if (!files) return [];

    const result: Array<{ filename: string; path: string; size: number }> = [];
    const uploadLimitMB = settingsService.getNumber('storage.uploadLimit', 50);
    for (const tool of files['tools'] || []) {
      if (tool.size > uploadLimitMB * 1024 * 1024) {
        throw new Error(`巡检工具文件 ${tool.originalname} 超过 ${uploadLimitMB}MB 限制`);
      }
      if (!fileManager.validateFileName(tool.originalname)) {
        throw new Error(`巡检工具文件名无效: ${tool.originalname}`);
      }
      result.push({
        filename: tool.originalname,
        path: tool.path,
        size: tool.size,
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
    if (body.pythonVersion) data.pythonVersion = body.pythonVersion;
    if (body.reportNameTemplate !== undefined) data.reportNameTemplate = body.reportNameTemplate;
    if (body.isMultiFile !== undefined) data.isMultiFile = body.isMultiFile === 'true';
    if (body.entryName) data.entryName = body.entryName;
    if (body.existingExtra) {
      data.extraFiles = JSON.parse(body.existingExtra);
    }
    if (body.existingAux) {
      data.auxiliaryFiles = JSON.parse(body.existingAux);
    }
    if (body.existingTools) {
      data.toolFiles = JSON.parse(body.existingTools);
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
        error: safeErrorMessage(error),
      };

      res.status(400).json(response);
    }
  }

  /**
   * 清空多文件模式下的脚本文件
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async clearScriptFiles(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      await scriptService.clearScriptFiles(id);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '脚本文件已清空',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '清空脚本文件失败',
        error: safeErrorMessage(error),
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
        error: safeErrorMessage(error),
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
        error: safeErrorMessage(error),
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
          `event: error\ndata: ${JSON.stringify({ error: safeErrorMessage(error), status: 'failed' })}\n\n`
        );
        res.end();
      } else {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '安装依赖失败',
          error: safeErrorMessage(error),
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

      // 同时提供 ASCII fallback 和 RFC 5987 UTF-8 编码，与其他下载路由保持一致
      const encodedName = encodeURIComponent(script.fileName).replace(/'/g, "%27");
      const asciiName = script.fileName.replace(/[^\x20-\x7E]/g, '?').replace(/"/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${asciiName || 'script'}"; filename*=UTF-8''${encodedName}`);
      res.setHeader('Content-Type', 'application/octet-stream');

      const fileStream = createReadStream(script.filePath);
      fileStream.pipe(res);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '下载脚本失败',
        error: safeErrorMessage(error),
      };
      res.status(400).json(response);
    }
  }

  /**
   * 一键下载脚本的全部巡检工具（tar.gz）
   *
   * 将 data/scripts/{scriptId}/tools/ 目录打包为 tar.gz 流式返回。
   * 所有登录用户均可下载（巡检工具面向一线工程师）。
   *
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async downloadTools(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const script = await scriptService.getScript(id);

      const toolsDir = path.join(SCRIPTS_DIR, id, 'tools');
      const existing = (script.toolFiles || []).filter((f) => existsSync(f.path));
      if (!existsSync(toolsDir) || existing.length === 0) {
        res.status(404).json({
          code: 404,
          data: null,
          message: '该脚本暂无巡检工具文件',
        });
        return;
      }

      // 下载文件名：{脚本名}_巡检工具_{YYYYMMDD}.tar.gz（脚本名清理文件系统不安全字符）
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
      const safeName = (script.name || '')
        .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_')
        .trim()
        .replace(/^\.+/, '') || 'script';
      const downloadName = `${safeName}_巡检工具_${dateStr}.tar.gz`;

      // 先打包到临时文件，再流式返回（与报告批量下载的 tar.create 用法一致）
      const archivePath = path.join(UPLOADS_DIR, `tools_${id}_${Date.now()}.tar.gz`);
      await tar.create(
        { gzip: true, file: archivePath, cwd: toolsDir },
        existing.map((f) => f.name)
      );

      // 同时提供 ASCII fallback 和 RFC 5987 UTF-8 编码（中文文件名）
      const encodedName = encodeURIComponent(downloadName).replace(/'/g, "%27");
      const asciiName = downloadName.replace(/[^\x20-\x7E]/g, '?').replace(/"/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="${asciiName || 'tools.tar.gz'}"; filename*=UTF-8''${encodedName}`);
      res.setHeader('Content-Type', 'application/gzip');

      const cleanup = () => { fs.unlink(archivePath).catch(() => {}); };
      res.on('finish', cleanup);
      res.on('close', cleanup);

      const fileStream = createReadStream(archivePath);
      fileStream.on('error', cleanup);
      fileStream.pipe(res);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '下载巡检工具失败',
        error: safeErrorMessage(error),
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