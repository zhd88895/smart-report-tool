/**
 * 模板路由模块
 * 
 * 本模块提供模板相关的API端点，包括上传、更新、删除等。
 * 使用SQLite数据库（通过templateRepository）处理数据操作。
 * 
 * @module routes/templates
 */

import { Router, Request, Response } from 'express';
import { templateRepository } from '../db/repositories';
import { fileManager, safeMoveFile } from '../utils/file';
import { authenticate, authorize } from '../middleware/auth';
import { uploadTemplateFile } from '../middleware/upload';
import { ApiResponse } from '../types';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { TEMPLATES_DIR } from '../config';

/**
 * 模板路由类
 */
export class TemplateRoutes {
  private router: Router;
  private templatesDir: string;

  /**
   * 创建模板路由实例
   */
  constructor() {
    this.router = Router();
    this.templatesDir = TEMPLATES_DIR;
    this.setupRoutes();

    // 确保模板目录存在
    if (!existsSync(this.templatesDir)) {
      mkdirSync(this.templatesDir, { recursive: true });
    }
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 获取模板列表（需要认证）
    this.router.get('/', authenticate, this.getTemplates.bind(this));

    // 上传模板（需要认证，需要 multer 处理 multipart/form-data）
    this.router.post('/', authenticate, uploadTemplateFile, this.uploadTemplate.bind(this));

    // 更新模板（需要认证）
    this.router.put('/:id', authenticate, this.updateTemplate.bind(this));

    // 删除模板（需要认证）
    this.router.delete('/:id', authenticate, this.deleteTemplate.bind(this));

    // 下载模板文件（需要认证）
    this.router.get(
      '/:id/download',
      authenticate,
      this.downloadTemplate.bind(this)
    );
  }

  /**
   * 获取模板列表
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getTemplates(req: Request, res: Response): Promise<void> {
    try {
      const templates = await templateRepository.findAll();

      const response: ApiResponse<{ templates: typeof templates }> = {
        code: 200,
        data: { templates },
        message: '获取模板列表成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '获取模板列表失败',
        error: error.message,
      };

      res.status(500).json(response);
    }
  }

  /**
   * 上传模板
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async uploadTemplate(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;
      const body = req.body;

      if (!file) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '上传模板失败',
          error: '没有上传文件',
        };
        res.status(400).json(response);
        return;
      }

      // 模板文件大小限制：20MB
      if (file.size > 20 * 1024 * 1024) {
        throw new Error('模板文件大小超过 20MB 限制');
      }

      // 验证文件名
      if (!fileManager.validateFileName(file.originalname)) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '上传模板失败',
          error: '文件名无效',
        };
        res.status(400).json(response);
        return;
      }

      // 生成模板ID
      const id = `template_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const templateDir = path.join(this.templatesDir, id);
      mkdirSync(templateDir, { recursive: true });

      // 安全移动文件（处理跨盘场景）
      const destPath = path.join(templateDir, file.originalname);
      await safeMoveFile(file.path, destPath);

      // 创建模板对象
      const template = {
        id,
        name: body.name || file.originalname,
        description: body.description || '',
        fileType: this.getFileType(file.originalname),
        fileName: file.originalname,
        filePath: destPath,
        fileSize: file.size,
        compatibleScriptType: body.compatibleScriptType || 'python',
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user?.userId || 'unknown',
      };

      // 保存到数据库
      await templateRepository.create(template);

      const response: ApiResponse<typeof template> = {
        code: 201,
        data: template,
        message: '模板上传成功',
      };

      res.status(201).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '模板上传失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 更新模板
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async updateTemplate(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = req.body;

      // 检查模板是否存在
      const existing = await templateRepository.findById(id);
      if (!existing) {
        throw new Error('模板不存在');
      }

      // 更新允许的字段
      const allowedFields = [
        'name',
        'description',
        'compatibleScriptType',
      ];

      const updateData: Record<string, any> = {};
      for (const key of allowedFields) {
        if (body[key] !== undefined) {
          updateData[key] = body[key];
        }
      }

      const template = await templateRepository.update(id, updateData);

      const response: ApiResponse<typeof template> = {
        code: 200,
        data: template,
        message: '模板更新成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '模板更新失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 删除模板
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async deleteTemplate(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      // 检查模板是否存在
      const existing = await templateRepository.findById(id);
      if (!existing) {
        throw new Error('模板不存在');
      }

      // 删除模板文件目录
      const templateDir = path.join(this.templatesDir, id);
      if (existsSync(templateDir)) {
        await fs.rm(templateDir, { recursive: true, force: true });
      }

      // 从数据库中删除
      await templateRepository.delete(id);

      const response: ApiResponse<{ success: boolean }> = {
        code: 200,
        data: { success: true },
        message: '模板删除成功',
      };

      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '模板删除失败',
        error: error.message,
      };

      res.status(400).json(response);
    }
  }

  /**
   * 下载模板文件
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async downloadTemplate(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;

      const template = await templateRepository.findById(id);

      if (!template) {
        const response: ApiResponse<null> = {
          code: 404,
          data: null,
          message: '模板不存在',
          error: '找不到指定的模板',
        };
        res.status(404).json(response);
        return;
      }

      if (!existsSync(template.filePath)) {
        const response: ApiResponse<null> = {
          code: 404,
          data: null,
          message: '模板文件不存在',
          error: '模板文件已被删除或移动',
        };
        res.status(404).json(response);
        return;
      }

      // 设置下载响应头
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(
          template.fileName
        )}"`,
      });

      // 创建文件读取流并发送
      const fileStream = require('fs').createReadStream(template.filePath);
      fileStream.pipe(res);
    } catch (error: any) {
      if (!res.headersSent) {
        const response: ApiResponse<null> = {
          code: 500,
          data: null,
          message: '下载模板失败',
          error: error.message,
        };
        res.status(500).json(response);
      }
    }
  }

  /**
   * 获取文件类型
   * 
   * @param fileName - 文件名
   * @returns 文件类型
   */
  private getFileType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const typeMap: Record<string, string> = {
      '.docx': 'docx',
      '.doc': 'docx',
      '.xlsx': 'xlsx',
      '.xls': 'xlsx',
      '.pdf': 'pdf',
      '.md': 'md',
      '.txt': 'txt',
    };
    return typeMap[ext] || 'unknown';
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
 * 模板路由单例实例
 */
export const templateRoutes = new TemplateRoutes();