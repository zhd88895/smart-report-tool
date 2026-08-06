/**
 * 报告路由模块
 * 
 * 本模块提供报告相关的API端点，包括生成、查询、删除等。
 * 使用reportService处理业务逻辑。
 * 
 * @module routes/reports
 */

import { Router, Request, Response } from 'express';
import { createReadStream } from 'fs';
import { reportService } from '../services/reportService';
import { fileDedupService } from '../services/fileDedupService';
import { getLogger } from '../utils/logger';
import { authenticate, authorize } from '../middleware/auth';
import { uploadReportInputFiles, uploadArchiveFile } from '../middleware/upload';
import { ApiResponse, safeErrorMessage } from '../types';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

const log = getLogger('ReportRoutes', 'core');

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

    // 解压压缩包（步骤：上传文件后下一步时调用，需要认证）
    this.router.post('/extract-archive', authenticate, uploadArchiveFile, this.extractArchive.bind(this));

    // 删除报告（需要认证）
    this.router.delete('/:id', authenticate, this.deleteReport.bind(this));

    // 获取报告执行日志（需要认证）
    this.router.get('/:id/logs', authenticate, this.getReportLogs.bind(this));

    // 列出报告文件（需要认证）
    this.router.get('/:id/files', authenticate, this.getReportFiles.bind(this));

    // 读取报告文件文本内容（在线预览，需要认证）
    this.router.get(
      '/:id/file-content',
      authenticate,
      this.getReportFileContent.bind(this)
    );

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

    // 保存 AI 分析报告（需要认证）
    this.router.post('/ai-save', authenticate, this.saveAIAnalysisReport.bind(this));
  }

  /**
   * 获取报告列表
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getReports(req: Request, res: Response): Promise<void> {
    try {
      const { status, generatedBy, reportSource } = req.query;

      const reports = await reportService.getReports({
        status: status as string,
        generatedBy: generatedBy as string,
        reportSource: reportSource as string,
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
        error: safeErrorMessage(error),
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
      res.status(500).json({ code: 500, data: null, message: '获取报告失败', error: safeErrorMessage(error) } as ApiResponse<null>);
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

      // 秒传引用：{ 索引: hash }，命中文件不上传、从去重存储解析
      const dedupRefs: Record<string, string> = body.dedupRefs ? JSON.parse(body.dedupRefs) : {};

      // 按索引合并「新上传文件」与「秒传引用文件」，保证与 inputHashes 严格对齐
      const byIndex = new Map<number, { filename: string; path: string; size: number }>();
      if (files) {
        for (const key of Object.keys(files)) {
          const m = /^inputFile(\d+)$/.exec(key);
          if (!m) continue;
          const f = files[key]?.[0];
          if (f) byIndex.set(parseInt(m[1], 10), { filename: f.originalname, path: f.path, size: f.size });
        }
      }
      const dedupIndexes: number[] = [];
      for (const [idxStr, hash] of Object.entries(dedupRefs)) {
        const idx = parseInt(idxStr, 10);
        if (!Number.isInteger(idx) || typeof hash !== 'string') continue;
        const entry = await fileDedupService.lookup(hash.toLowerCase());
        if (!entry) {
          res.status(400).json({ code: 400, data: null, message: `文件索引 ${idx} 的秒传引用已过期，请重新上传该文件` } as ApiResponse<null>);
          return;
        }
        await fileDedupService.touch(hash.toLowerCase());
        byIndex.set(idx, { filename: entry.fileName, path: entry.path, size: entry.size });
        dedupIndexes.push(idx);
      }
      const inputFiles = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);

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
        // 生成成功：把新上传的临时文件收编进内容寻址存储（失败不阻塞，留待散落清理）
        const uploadedPaths = [...byIndex.entries()]
          .filter(([idx]) => !dedupIndexes.includes(idx))
          .map(([, v]) => v);
        for (const f of uploadedPaths) {
          fileDedupService.register(f.path, f.filename, req.user!.userId)
            .catch((e) => log.warn(`输入文件收编失败: ${f.filename}: ${e?.message || e}`));
        }
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
          error: safeErrorMessage(error),
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
        error: safeErrorMessage(error),
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
        error: safeErrorMessage(error),
      };

      res.status(400).json(response);
    }
  }

  /**
   * 保存 AI 智能分析报告
   * 
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async saveAIAnalysisReport(req: Request, res: Response): Promise<void> {
    try {
      const { content, originalFileName, category, author } = req.body;
      const generatedBy = req.user?.userId || 'unknown';

      if (!content || !originalFileName) {
        res.status(400).json({
          code: 400, data: null,
          message: '缺少必要参数（content, originalFileName）',
        } as ApiResponse<null>);
        return;
      }

      const report = await reportService.saveAIAnalysisReport({
        content: content as string,
        originalFileName: originalFileName as string,
        category: (category as string) || 'other',
        author: (author as string) || generatedBy,
        generatedBy,
      });

      const response: ApiResponse<{ report: typeof report }> = {
        code: 200,
        data: { report },
        message: 'AI分析报告保存成功',
      };
      res.status(200).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 500,
        data: null,
        message: '保存AI分析报告失败',
        error: safeErrorMessage(error),
      };
      res.status(500).json(response);
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
        error: safeErrorMessage(error),
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

      // 设置下载响应头：同时提供 ASCII fallback 和 RFC 5987 UTF-8 编码，防止中文乱码
      const encodedName = encodeURIComponent(fileInfo.fileName).replace(/'/g, "%27");
      const asciiFallback = fileInfo.fileName.replace(/[^\x20-\x7E]/g, '?').replace(/"/g, '');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${asciiFallback || 'report'}"; filename*=UTF-8''${encodedName}`,
      });

      // 创建文件读取流并发送（stat 之后文件可能被清理，必须处理流错误避免响应挂起）
      const fileStream = createReadStream(fileInfo.filePath);
      fileStream.on('error', (err) => {
        log.error(`文件流读取失败: ${err.message}`);
        if (!res.headersSent) {
          res.status(404).json({ code: 404, data: null, message: '文件读取失败' });
        } else {
          res.end();
        }
      });
      fileStream.pipe(res);
    } catch (error: any) {
      if (!res.headersSent) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '下载报告失败',
          error: safeErrorMessage(error),
        };
        res.status(400).json(response);
      }
    }
  }

  /**
   * 读取报告文件文本内容（在线预览）
   *
   * @param req - Express请求对象
   * @param res - Express响应对象
   */
  private async getReportFileContent(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const fileIndex = req.query.fileIndex as string;

      const result = await reportService.getReportFileContent(
        id,
        fileIndex ? parseInt(fileIndex) : undefined
      );

      const response: ApiResponse<{ fileName: string; content: string; size: number }> = {
        code: 200,
        data: result,
        message: 'success',
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        code: 400,
        data: null,
        message: '读取文件内容失败',
        error: safeErrorMessage(error),
      };
      res.status(400).json(response);
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
      const encodedName = encodeURIComponent(archiveInfo.fileName).replace(/'/g, "%27");
      const asciiFallback = archiveInfo.fileName.replace(/[^\x20-\x7E]/g, '?').replace(/"/g, '');
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${asciiFallback || 'reports.tar.gz'}"; filename*=UTF-8''${encodedName}`,
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
      console.error(`批量下载报告失败 (reportId=${req.params.id}): ${safeErrorMessage(error)}`, error.stack);
      if (!res.headersSent) {
        const response: ApiResponse<null> = {
          code: 400,
          data: null,
          message: '批量下载报告失败',
          error: safeErrorMessage(error),
        };
        res.status(400).json(response);
      }
    }
  }

  /**
   * 解压压缩包 — 用户上传压缩包点击下一步时调用
   * 
   * 接收 multipart/form-data:
   *   - file: 压缩包文件
   *   - password?: 解压密码（可选）
   * 
   * 返回:
   *   { success: true, files: [{name, path, size}], totalSize }
   *   { success: false, needPassword: true, error: "..." }
   *   { success: false, error: "...", errorDetail: "..." }
   */
  private async extractArchive(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ code: 400, data: null, message: '请上传压缩包文件' } satisfies ApiResponse<null>);
        return;
      }

      const password = (req.body as any)?.password as string | undefined;
      const archivePath = file.path;

      // 检测压缩包类型
      const lowerName = file.originalname.toLowerCase();
      const isArchive = /\.(zip|tar|tar\.gz|tgz)$/i.test(lowerName);
      if (!isArchive) {
        // 不是压缩包，直接返回成功（无需解压）
        res.status(200).json({
          code: 200,
          data: {
            success: true,
            needExtract: false,
            files: [{
              name: file.originalname,
              originalPath: archivePath,
              size: file.size,
            }],
          },
          message: '非压缩包文件，无需解压',
        } satisfies ApiResponse<any>);
        return;
      }

      // 创建临时解压目录
      const extractDir = path.join(path.dirname(archivePath), `_extracted_${randomUUID().slice(0, 8)}`);
      fs.mkdirSync(extractDir, { recursive: true });

      // 查找 Python 解释器
      const pythonPath = findPythonForExtract();
      if (!pythonPath) {
        res.status(500).json({
          code: 500,
          data: null,
          message: '未找到可用的 Python 环境，无法解压压缩包',
        } satisfies ApiResponse<null>);
        return;
      }

      // 查找解压脚本
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'extract_archive.py');
      if (!fs.existsSync(scriptPath)) {
        res.status(500).json({
          code: 500,
          data: null,
          message: `解压脚本未找到: ${scriptPath}`,
        } satisfies ApiResponse<null>);
        return;
      }

      // 构建命令行参数
      const args = [scriptPath, archivePath, extractDir];
      if (password) {
        args.push('--password', password);
      }

      // 执行解压
      const { stdout, stderr } = await execFileAsync(pythonPath, args, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      });

      // 解析 Python 脚本输出
      let result: any;
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        // JSON 解析失败，返回 stderr 作为错误详情
        res.status(500).json({
          code: 500,
          data: {
            success: false,
            error: '解压脚本输出解析失败',
            errorDetail: stderr || stdout.slice(0, 500),
          },
          message: '解压失败：脚本输出格式错误',
        } satisfies ApiResponse<any>);
        return;
      }

      if (!result.success) {
        // 需要密码
        if (result.errorCode === 'NEED_PASSWORD') {
          res.status(200).json({
            code: 200,
            data: {
              success: false,
              needPassword: true,
              error: result.error,
              archivePath,
            },
            message: '压缩包需要密码',
          } satisfies ApiResponse<any>);
          return;
        }

        // 其他错误
        res.status(200).json({
          code: 200,
          data: {
            success: false,
            error: result.error || '解压失败',
            errorDetail: result.errorDetail || '',
            errorCode: result.errorCode || 'EXTRACTION_ERROR',
            archivePath,
          },
          message: result.error || '解压失败',
        } satisfies ApiResponse<any>);
        return;
      }

      // 解压成功 — 返回文件列表
      const files = (result.files || []).map((f: string) => ({
        name: f,
        path: path.join(extractDir, f),
        size: 0, // 文件大小由 Python 脚本返回的 total_size 总合
      }));

      // 同时记录解压后的原始目录路径，供后续步骤引用
      res.status(200).json({
        code: 200,
        data: {
          success: true,
          needExtract: true,
          files,
          totalSize: result.total_size || 0,
          extractDir,
        },
        message: `解压成功，共 ${files.length} 个文件`,
      } satisfies ApiResponse<any>);
    } catch (error: any) {
      const errorDetail = safeErrorMessage(error);
      res.status(500).json({
        code: 500,
        data: {
          success: false,
          error: '解压过程异常',
          errorDetail,
        },
        message: errorDetail,
      } satisfies ApiResponse<any>);
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

/**
 * 查找可用的 Python 解释器
 * 优先级: 项目内嵌 Python > 系统 Python
 */
function findPythonForExtract(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'python-embedded', 'python.exe'),
    path.resolve(process.cwd(), 'data', 'python-embedded', 'python'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 降级：尝试系统 Python
  try {
    execSync('python3 --version 2>nul || python --version 2>nul', { timeout: 3000, windowsHide: true });
    return 'python';
  } catch {
    // ignore
  }
  return null;
}