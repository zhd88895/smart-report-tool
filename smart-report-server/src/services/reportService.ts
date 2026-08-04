/**
 * 报告生成业务逻辑服务
 * 
 * 本模块提供报告生成相关的业务逻辑处理，包括生成、查询、删除等。
 * 使用SSE实时推送执行日志。
 * 
 * @module reportService
 */

import { scriptRepository, templateRepository, reportRepository } from '../db/repositories';
import { userRepository } from '../db/repositories/userRepository';
import { logger, getLogger, generateTraceId, Logger } from '../utils/logger';
import { fileManager } from '../utils/file';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs/promises';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import path from 'path';
import { spawn, execSync, execFile } from 'child_process';
import { promisify } from 'util';
import EventEmitter from 'events';
import {
  config,
  DATA_DIR,
  EMBEDDED_PYTHON,
  REPORTS_DIR,
  SCRIPTS_DIR,
  TEMPLATES_DIR,
  UPLOADS_DIR,
  VENV_PYTHON,
} from '../config';
import zlib from 'zlib';
import { Readable } from 'stream';
import * as tar from 'tar';

const execFileAsync = promisify(execFile);

// 模块级日志实例（核心业务模块）
const log = getLogger('ReportService', 'core');

/**
 * 报告输出文件扩展名白名单
 * 只有这些扩展名的文件才会被展示为可下载的报告文件
 */
const REPORT_FILE_EXTENSIONS = ['.html', '.docx', '.xlsx', '.md', '.pdf', '.json'];

/**
 * 脚本执行过程中常见的源码/辅助文件扩展名黑名单
 * 用于在兜底扫描时排除非报告文件
 */
const EXCLUDED_FILE_EXTENSIONS = [
  '.py', '.js', '.ts', '.jsx', '.tsx', '.ps1', '.bat', '.sh', '.cmd',
  '.ini', '.cfg', '.yaml', '.yml', '.toml', '.env', '.pyc', '.pyo',
  '.whl', '.tar', '.gz', '.zip', '.rar', '.7z', '.tmp', '.temp',
];

/**
 * 常见脚本/辅助文件名黑名单（不区分大小写）
 */
const EXCLUDED_FILE_NAMES = new Set([
  'alias.json', 'alias.py', 'analysis.py', 'config.py', 'excel_io.py', 'logger.py',
  'main.py', 'config.ini', 'config.json', 'requirements.txt', 'setup.py', 'run.py',
  'utils.py', 'common.py', 'helpers.py', 'constants.py', 'settings.py',
]);

/**
 * 输入/输出清单文件常量
 */
const INPUT_MANIFEST_NAME = '.input_manifest.json';
const OUTPUT_MANIFEST_NAME = '.output_manifest.json';
/** 解压出的临时文件清单，用于脚本运行后清理 */
const EXTRACTED_FILES_NAME = '.extracted_files.json';

/**
 * 清单文件中的文件条目
 */
interface ManifestFileEntry {
  /** 相对 workspaceDir 的文件路径 */
  path: string;
  /** 文件 SHA-256 哈希值 */
  hash: string;
  /** 文件大小（字节） */
  size: number;
}

/**
 * 输入文件清单
 */
interface InputManifest {
  /** 清单生成时间 */
  generatedAt: string;
  /** 输入文件列表 */
  files: ManifestFileEntry[];
}

/**
 * 输出文件清单
 */
interface OutputManifest {
  /** 清单生成时间 */
  generatedAt: string;
  /** 输出文件列表 */
  files: ManifestFileEntry[];
}

/**
 * 报告信息接口
 */
export interface Report {
  /** 报告ID */
  id: string;
  /** 报告名称 */
  name: string;
  /** 报告描述 */
  description: string;
  /** 脚本ID */
  scriptId: string;
  /** 脚本名称 */
  scriptName: string;
  /** 模板ID */
  templateId?: string;
  /** 模板名称 */
  templateName?: string;
  /** 输出格式 */
  outputFormat: string;
  /** 工作目录 */
  workspaceDir: string;
  /** 生成时间 */
  generatedAt: string;
  /** 生成者 */
  generatedBy: string;
  /** 状态 */
  status: 'generating' | 'success' | 'failed';
  /** 错误信息 */
  error?: string;
  /** 执行日志 */
  logs: string[];
  /** 报告文件路径列表（相对 workspaceDir） */
  filePaths?: string[];
  /** 报告类型（LogCategory，从脚本继承） */
  type?: string;
  /** 报告所属区域（从脚本继承） */
  region?: string;
  /** 报告日期（前端展示用，同 generatedAt） */
  date?: string;
  /** 报告作者（前端展示用，同 generatedBy） */
  author?: string;
  /** 创建时间（前端展示用，同 generatedAt） */
  createdAt?: string;
  /** 报告来源：'script' = 脚本生成，'ai' = AI 智能分析 */
  reportSource?: string;
  /** 联合判断详细信息 */
  judgment?: {
    /** 脚本退出码 */
    exitCode: number;
    /** 退出码是否表示成功 */
    exitCodeSuccess: boolean;
    /** 是否生成了新文件 */
    hasNewFiles: boolean;
    /** 新生成的文件数量 */
    newFilesCount: number;
    /** 是否生成了有效的报告文件 */
    hasValidReportFiles: boolean;
    /** 生成的报告文件列表 */
    generatedReportFiles: string[];
  };
}

/**
 * 报告文件信息接口
 */
export interface ReportFileInfo {
  /** 文件名 */
  name: string;
  /** 文件大小 */
  size: number;
  /** 文件路径 */
  path: string;
  /** 修改时间 */
  modifiedAt: Date;
}

/**
 * 报告服务类
 * 
 * 提供报告生成相关的所有业务逻辑操作
 */
export class ReportService {
  private readonly reportsDir: string;
  private readonly scriptsDir: string;
  private readonly templatesDir: string;
  private readonly uploadsDir: string;

  /** 后台运行中的生成任务 */
  private runningTasks = new Map<string, {
    emitter: EventEmitter;
    promise: Promise<void>;
    startedAt: number;
  }>();

  /** 日志缓冲区刷新周期 */
  private readonly LOG_FLUSH_INTERVAL = 2000; // 2秒
  private readonly LOG_FLUSH_BATCH_SIZE = 50;  // 或每50条

  /**
   * 创建报告服务实例
   */
  constructor() {
    this.reportsDir = REPORTS_DIR;
    this.scriptsDir = SCRIPTS_DIR;
    this.templatesDir = TEMPLATES_DIR;
    this.uploadsDir = UPLOADS_DIR;

    // 确保目录存在
    [this.reportsDir, this.scriptsDir, this.templatesDir, this.uploadsDir].forEach(
      (dir) => {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }
    );
  }

  /**
   * 将 author 字段中的 userId 自动替换为显示名称
   * 兼容旧数据：历史报告可能存储了 userId，查询时做展示层富化
   */
  private async enrichReportAuthor(report: Report): Promise<Report> {
    if (!report.author || report.author === 'unknown' || report.author === '当前用户') {
      return report;
    }
    // 简单判断：如果 author 看起来像 userId（user_ 开头或 UUID 格式），尝试查询用户
    const looksLikeUserId = report.author.startsWith('user_') || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(report.author);
    if (!looksLikeUserId) {
      return report;
    }
    try {
      const user = await userRepository.findById(report.author);
      if (user) {
        report.author = user.displayName || user.username || report.author;
      }
    } catch (err) {
      // 富化失败不影响主查询，静默忽略
      log.debug(`富化报告作者失败: ${report.id}`, undefined, { author: report.author, error: err instanceof Error ? err.message : String(err) });
    }
    return report;
  }

  /**
   * 从输入清单中提取"输入压缩包对应的解压目录名集合"
   * 例如 202508.zip -> 202508，用于排除脚本运行过程中重复解压出的原始数据
   */
  private getArchiveExtractDirNames(inputManifest: InputManifest | null): Set<string> {
    const names = new Set<string>();
    for (const f of inputManifest?.files || []) {
      const baseName = path.basename(f.path);
      const ext = path.extname(baseName).toLowerCase();
      if (['.zip', '.tar', '.gz', '.tgz'].includes(ext)) {
        const dirName = baseName.slice(0, -ext.length);
        if (dirName) names.add(dirName);
      }
    }
    return names;
  }

  /**
   * 判断文件是否位于输入压缩包的解压目录内
   */
  private isInsideExtractedArchiveDir(filePath: string, archiveDirNames: Set<string>): boolean {
    const firstPart = filePath.split(/[/\\]/)[0];
    return archiveDirNames.has(firstPart);
  }

  /**
   * 判断一个文件是否是输入/辅助文件（非报告输出）
   * 包括脚本源码、辅助文件、模板文件、用户上传的输入文件、压缩包解压后的文件
   */
  private isNonOutputFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();

    // 清单文件本身
    if (fileName === INPUT_MANIFEST_NAME.toLowerCase() || fileName === OUTPUT_MANIFEST_NAME.toLowerCase()) {
      return true;
    }

    // 常见脚本/辅助文件名黑名单
    if (EXCLUDED_FILE_NAMES.has(fileName)) {
      return true;
    }

    // 黑名单扩展名（脚本源码、压缩包、临时文件等）
    const ext = path.extname(fileName).toLowerCase();
    if (EXCLUDED_FILE_EXTENSIONS.includes(ext)) {
      return true;
    }

    return false;
  }

  /**
   * 判断一个文件是否是有效的报告输出文件
   * 基于白名单扩展名和黑名单文件名/扩展名，并排除输入压缩包解压目录
   */
  private isReportOutputFile(filePath: string, archiveDirNames?: Set<string>): boolean {
    // 先排除非输出文件（脚本、辅助、模板、清单、压缩包等）
    if (this.isNonOutputFile(filePath)) {
      return false;
    }

    // 排除输入压缩包解压出的目录（脚本可能重复解压原始数据）
    if (archiveDirNames && this.isInsideExtractedArchiveDir(filePath, archiveDirNames)) {
      return false;
    }

    const fileName = path.basename(filePath).toLowerCase();
    const ext = path.extname(fileName).toLowerCase();

    // 白名单扩展名
    return REPORT_FILE_EXTENSIONS.includes(ext);
  }

  /**
   * 计算文件的 SHA-256 哈希值（流式读取，支持大文件）
   */
  private async computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks
      stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 写入清单文件到工作目录
   */
  private async writeManifest<T>(workspaceDir: string, manifestName: string, manifest: T): Promise<void> {
    const manifestPath = path.join(workspaceDir, manifestName);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * 从工作目录读取清单文件
   */
  private async readManifest<T>(workspaceDir: string, manifestName: string): Promise<T | null> {
    const manifestPath = path.join(workspaceDir, manifestName);
    if (!existsSync(manifestPath)) return null;
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * 获取报告文件清单（优先 output_manifest，兜底 filePaths，最后白名单扫描）
   */
  private async getReportFilePaths(workspaceDir: string, filePaths?: string[]): Promise<string[]> {
    const inputManifest = await this.readManifest<InputManifest>(workspaceDir, INPUT_MANIFEST_NAME);
    const archiveDirNames = this.getArchiveExtractDirNames(inputManifest);
    const inputFilePaths = new Set((inputManifest?.files || []).map((f) => f.path));
    const inputFileHashes = new Set((inputManifest?.files || []).map((f) => f.hash));

    const outputManifest = await this.readManifest<OutputManifest>(workspaceDir, OUTPUT_MANIFEST_NAME);
    if (outputManifest && outputManifest.files && outputManifest.files.length > 0) {
      return outputManifest.files
        .map((f) => f.path)
        .filter((p) => this.isReportOutputFile(p, archiveDirNames))
        .filter((p) => !inputFilePaths.has(p) && !inputFileHashes.has(p));
    }

    if (filePaths && filePaths.length > 0) {
      return this.filterReportFiles(filePaths, archiveDirNames);
    }

    const files = await this.listAllFiles(workspaceDir, workspaceDir);
    return files.filter((f) => this.isReportOutputFile(f, archiveDirNames));
  }

  /**
   * 从文件路径列表中过滤出有效的报告文件
   */
  private filterReportFiles(filePaths: string[], archiveDirNames?: Set<string>): string[] {
    return filePaths.filter((fp) => this.isReportOutputFile(fp, archiveDirNames));
  }

  /**
   * 获取报告列表
   * 
   * @param filter - 可选过滤条件
   * @returns 报告列表
   */
  async getReports(filter?: {
    status?: string;
    generatedBy?: string;
    reportSource?: string;
  }): Promise<Report[]> {
    const traceId = generateTraceId();
    const startTime = Date.now();
    log.info(`⇢ getReports`, traceId, { filter });

    const results = await reportRepository.findAll(filter);
    log.dbOperation('SELECT', 'reports', Date.now() - startTime, traceId, {
      resultCount: results.length,
    });

    // 富化作者显示名（兼容旧数据）
    const enriched = await Promise.all(results.map((r) => this.enrichReportAuthor(r)));
    return enriched;
  }

  /**
   * 获取单个报告
   * 
   * @param reportId - 报告ID
   * @returns 报告信息或null
   */
  async getReport(reportId: string): Promise<Report | null> {
    const report = await reportRepository.findById(reportId);
    if (!report) return null;
    return this.enrichReportAuthor(report);
  }

  /**
   * 检查是否有正在运行的后台生成任务
   */
  isTaskRunning(reportId: string): boolean {
    return this.runningTasks.has(reportId);
  }

  /**
   * 获取正在运行的任务信息
   */
  getRunningTask(reportId: string): { emitter: EventEmitter; startedAt: number } | null {
    const task = this.runningTasks.get(reportId);
    return task ? { emitter: task.emitter, startedAt: task.startedAt } : null;
  }

  /**
   * 生成报告（核心功能）
   * 
   * 启动后台生成任务，立即返回 reportId + EventEmitter。
   * 后台任务会：
   * - 实时写日志到 EventEmitter（供 SSE 推送）
   * - 定期刷日志到数据库（供轮询恢复）
   * - 完成后更新数据库状态
   * 
   * @param params - 生成参数
   * @returns reportId 和 EventEmitter
   */
  async startBackgroundGeneration(
    params: {
      scriptId: string;
      templateId?: string;
      outputFormat?: string;
      reportInfo?: { name?: string; description?: string; author?: string; date?: string; category?: string };
      inputFiles?: Array<{ filename: string; path: string; size: number }>;
      inputHashes?: string[];
      requirements?: string[];
      generatedBy?: string;
    }
  ): Promise<{ reportId: string; emitter: EventEmitter }> {
    // ─── 同步准备阶段 ───
    const { scriptId, templateId, outputFormat = 'html', reportInfo = {},
      inputFiles = [], inputHashes = [], requirements: formRequirements = [],
      generatedBy = 'unknown' } = params;

    let script = await scriptRepository.findById(scriptId);
    if (!script) script = await this.rebuildScriptFromFileSystem(scriptId);
    if (!script) throw new Error('脚本不存在');

    let template = templateId ? await templateRepository.findById(templateId) : null;
    if (!template && templateId) template = await this.rebuildTemplateFromFileSystem(templateId);
    if (template && (!template.filePath || !existsSync(template.filePath))) {
      throw new Error(`模板文件「${template.fileName}」不存在，请重新上传模板`);
    }

    const reportId = randomUUID();
    const workspaceDir = path.join(this.reportsDir, reportId);
    mkdirSync(workspaceDir, { recursive: true });

    // 复制文件到工作目录
    await this.prepareWorkspace(workspaceDir, script, template, inputFiles, inputHashes);

    // 创建 DB 记录（立即保存，status: generating）
    const now = new Date().toISOString();
    const initialReport: Report = {
      id: reportId,
      name: reportInfo.name || `报告_${now.slice(0, 10)}`,
      description: reportInfo.description || '',
      scriptId, scriptName: script.name,
      templateId: template?.id, templateName: template?.fileName,
      outputFormat, workspaceDir,
      generatedAt: now,
      generatedBy,
      status: 'generating',
      logs: [],
      filePaths: [],
      // 从脚本继承 region，从表单继承 type/category、date、author
      type: reportInfo.category || script.category || '',
      region: script.region || '',
      date: reportInfo.date || now,
      author: reportInfo.author || generatedBy,
      createdAt: now,
    };
    await reportRepository.create(initialReport);

    // ─── 启动后台执行 ───
    const emitter = new EventEmitter();
    const taskPromise = this.runBackground(workspaceDir, reportId, emitter, script, template, {
      outputFormat, reportInfo, inputFiles, inputHashes, formRequirements, generatedBy,
    });

    this.runningTasks.set(reportId, { emitter, promise: taskPromise, startedAt: Date.now() });

    return { reportId, emitter };
  }

  /**
   * 后台执行报告生成（fire-and-forget）
   */
  private async runBackground(
    workspaceDir: string, reportId: string, emitter: EventEmitter,
    script: any, template: any,
    extra: { outputFormat: string; reportInfo: any; inputFiles: any[]; inputHashes: string[];
      formRequirements: string[]; generatedBy: string }
  ): Promise<void> {
    const logBuffer: string[] = [];
    let lastFlush = Date.now();

    const addLog = (msg: string) => {
      logBuffer.push(msg);
      emitter.emit('log', msg);
      // 定期刷到 DB
      if (logBuffer.length >= this.LOG_FLUSH_BATCH_SIZE || Date.now() - lastFlush >= this.LOG_FLUSH_INTERVAL) {
        this.flushLogs(reportId, logBuffer);
        logBuffer.length = 0;
        lastFlush = Date.now();
      }
    };

    try {
      const report = await this.generateReport(
        Object.assign({}, {
          scriptId: script.id, templateId: template?.id,
          outputFormat: extra.outputFormat, reportInfo: extra.reportInfo,
          inputFiles: extra.inputFiles, inputHashes: extra.inputHashes,
          requirements: extra.formRequirements, generatedBy: extra.generatedBy,
        }, {
          _workspaceDir: workspaceDir, _script: script, _template: template,
        }) as any,
        addLog
      );

      // 最终刷日志
      if (logBuffer.length > 0) {
        await this.flushLogs(reportId, logBuffer);
      }

      // 更新最终状态（同时补齐 type/region/date/author 等字段）
      await reportRepository.finalize(reportId, {
        status: report.status,
        logs: report.logs,
        filePaths: report.filePaths || [],
        error: report.error,
        type: report.type,
        region: report.region,
        date: report.date,
        author: report.author,
        createdAt: report.createdAt,
      });

      emitter.emit('complete', { report });
    } catch (error: any) {
      if (logBuffer.length > 0) await this.flushLogs(reportId, logBuffer);

      // 即使脚本被kill/超时，只要工作目录里生成了报告文件，也保存到 output_manifest
      // 这样后续 getReportFiles 能优先读取清单，避免兜底扫描混入辅助文件
      try {
        const savedFiles = await this.saveOutputManifestFromWorkspace(workspaceDir, addLog);
        if (savedFiles.length > 0) {
          addLog(`[恢复] 失败流程中检测到 ${savedFiles.length} 个输出文件，已保存到清单`);
          await reportRepository.updateFilePaths(reportId, savedFiles);
        }
      } catch (manifestErr: any) {
        addLog(`[调试] 失败流程保存输出清单出错: ${manifestErr.message}`);
      }

      await reportRepository.appendLogs(reportId, [`[错误] 报告生成失败: ${error.message}`]);
      await reportRepository.updateStatus(reportId, 'failed', error.message);
      emitter.emit('error', error.message);
    } finally {
      this.runningTasks.delete(reportId);
    }
  }

  /** 批量刷新日志到数据库 */
  private async flushLogs(reportId: string, logs: string[]): Promise<void> {
    if (logs.length === 0) return;
    try {
      await reportRepository.appendLogs(reportId, [...logs]);
    } catch (e) {
      log.error(`刷新日志到DB失败: ${e}`);
    }
  }

  /** 准备工作报告目录（复制文件） */
  private async prepareWorkspace(
    workspaceDir: string, script: any, template: any,
    inputFiles: Array<{ filename: string; path: string; size: number }>,
    inputHashes: string[]
  ): Promise<void> {
    const nonOutputEntries: ManifestFileEntry[] = [];

    // 复制脚本
    const scriptDest = path.join(workspaceDir, script.fileName);
    await fs.copyFile(script.filePath, scriptDest);
    nonOutputEntries.push({ path: script.fileName, hash: await this.computeFileHash(scriptDest), size: (await fs.stat(scriptDest)).size });

    // 多文件模式：复制所有额外 .py 文件
    if (script.isMultiFile && script.extraFiles && script.extraFiles.length > 0) {
      for (const ef of script.extraFiles) {
        const dest = path.join(workspaceDir, ef.name);
        await fs.copyFile(ef.path, dest);
        nonOutputEntries.push({ path: ef.name, hash: await this.computeFileHash(dest), size: (await fs.stat(dest)).size });
      }
    }

    // 复制辅助文件
    if (script.auxiliaryFiles) {
      for (const af of script.auxiliaryFiles) {
        const dest = path.join(workspaceDir, af.name);
        mkdirSync(path.dirname(dest), { recursive: true });
        await fs.copyFile(af.path, dest);
        nonOutputEntries.push({ path: af.name, hash: await this.computeFileHash(dest), size: (await fs.stat(dest)).size });
      }
    }

    // 复制模板
    if (template) {
      const dest = path.join(workspaceDir, template.fileName);
      await fs.copyFile(template.filePath, dest);
      nonOutputEntries.push({ path: template.fileName, hash: await this.computeFileHash(dest), size: (await fs.stat(dest)).size });
    }

    // 验证并复制输入文件
    const inputFileEntries: ManifestFileEntry[] = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const actualHash = await this.computeFileHash(file.path);
      if (inputHashes[i] && actualHash !== inputHashes[i]) {
        throw new Error(`文件「${file.filename}」哈希校验失败`);
      }
      const dest = path.join(workspaceDir, file.filename);
      await fs.copyFile(file.path, dest);
      inputFileEntries.push({ path: file.filename, hash: actualHash, size: file.size });
    }

    // 输入清单合并：输入文件 + 非输出文件（脚本、辅助、模板）全部记录
    const inputManifest: InputManifest = {
      generatedAt: new Date().toISOString(),
      files: [...nonOutputEntries, ...inputFileEntries],
    };
    await this.writeManifest(workspaceDir, INPUT_MANIFEST_NAME, inputManifest);
  }

  /**
   * 生成报告（内部核心逻辑）
   * 
   * @param params - 生成参数
   * @param onLog - 日志回调函数
   * @returns 生成的报告信息
   * @throws {Error} 如果生成失败
   */
  async generateReport(
    params: {
      scriptId: string;
      templateId?: string;
      outputFormat?: string;
      reportInfo?: {
        name?: string;
        description?: string;
        author?: string;
        date?: string;
        category?: string;
      };
      inputFiles?: Array<{
        filename: string;
        path: string;
        size: number;
      }>;
      inputHashes?: string[];
      requirements?: string[];
      generatedBy?: string;
    },
    onLog?: (message: string) => void
  ): Promise<Report> {
    const {
      scriptId,
      templateId,
      outputFormat = 'html',
      reportInfo = {},
      inputFiles = [],
      inputHashes = [],
      requirements: formRequirements = [],
      generatedBy = 'unknown',
    } = params;

      // 后台运行模式：使用已准备好的工作目录和对象
    const preWorkspaceDir = (params as any)._workspaceDir as string | undefined;
    const preScript = (params as any)._script as any | undefined;
    const preTemplate = (params as any)._template as any | undefined;

    const logMessages: string[] = [];
    const addLog = (msg: string) => {
      logMessages.push(msg);
      onLog?.(msg);
    };

    try {
      // 获取脚本信息
      let script = preScript;
      if (!script) {
        script = await scriptRepository.findById(scriptId);
        if (!script) script = await this.rebuildScriptFromFileSystem(scriptId);
      }
      if (!script) throw new Error('脚本不存在');

      // 获取模板信息
      let template = preTemplate;
      if (!template && templateId) {
        template = await templateRepository.findById(templateId);
        if (!template) template = await this.rebuildTemplateFromFileSystem(templateId);
      }
      if (template && (!template.filePath || !existsSync(template.filePath))) {
        throw new Error(`模板文件「${template.fileName}」不存在，请重新上传模板`);
      }

      // 创建报告ID和工作目录（后台模式跳过，已由 prepareWorkspace 创建）
      const reportId = preWorkspaceDir ? path.basename(preWorkspaceDir) : randomUUID();
      const workspaceDir = preWorkspaceDir || path.join(this.reportsDir, reportId);
      if (!preWorkspaceDir) mkdirSync(workspaceDir, { recursive: true });

      const allFiles: string[] = [];
      const inputFileNames: string[] = [];
      let inputFileEntryCount = 0;

      // 后台模式：文件已由 prepareWorkspace 复制，跳过后面的文件复制
      if (!preWorkspaceDir) {
        const nonOutputEntries: ManifestFileEntry[] = [];

        await fs.copyFile(script.filePath, path.join(workspaceDir, script.fileName));
        allFiles.push(script.fileName);
        nonOutputEntries.push({ path: script.fileName, hash: await this.computeFileHash(path.join(workspaceDir, script.fileName)), size: (await fs.stat(path.join(workspaceDir, script.fileName))).size });

        // 多文件模式：复制所有额外 .py 文件
        if (script.isMultiFile && script.extraFiles && script.extraFiles.length > 0) {
          for (const ef of script.extraFiles) {
            await fs.copyFile(ef.path, path.join(workspaceDir, ef.name));
            allFiles.push(ef.name);
            nonOutputEntries.push({ path: ef.name, hash: await this.computeFileHash(path.join(workspaceDir, ef.name)), size: (await fs.stat(path.join(workspaceDir, ef.name))).size });
          }
        }

        if (script.auxiliaryFiles && script.auxiliaryFiles.length > 0) {
          for (const af of script.auxiliaryFiles) {
            const destPath = path.join(workspaceDir, af.name);
            mkdirSync(path.dirname(destPath), { recursive: true });
            await fs.copyFile(af.path, destPath);
            allFiles.push(af.name);
            nonOutputEntries.push({ path: af.name, hash: await this.computeFileHash(destPath), size: (await fs.stat(destPath)).size });
          }
        }

        if (template) {
          await fs.copyFile(template.filePath, path.join(workspaceDir, template.fileName));
          allFiles.push(template.fileName);
          nonOutputEntries.push({ path: template.fileName, hash: await this.computeFileHash(path.join(workspaceDir, template.fileName)), size: (await fs.stat(path.join(workspaceDir, template.fileName))).size });
        }

        const inputFileEntries: ManifestFileEntry[] = [];
        for (let i = 0; i < inputFiles.length; i++) {
          const file = inputFiles[i];
          const actualHash = await this.computeFileHash(file.path);
          if (inputHashes[i] && actualHash !== inputHashes[i]) {
            throw new Error(`文件「${file.filename}」哈希校验失败，上传可能不完整。请重新上传。`);
          }
          await fs.copyFile(file.path, path.join(workspaceDir, file.filename));
          allFiles.push(file.filename);
          inputFileNames.push(file.filename);
          inputFileEntries.push({ path: file.filename, hash: actualHash, size: file.size });
        }

        const inputManifest: InputManifest = {
          generatedAt: new Date().toISOString(),
          files: [...nonOutputEntries, ...inputFileEntries],
        };
        await this.writeManifest(workspaceDir, INPUT_MANIFEST_NAME, inputManifest);
        inputFileEntryCount = inputFileEntries.length;
      } else {
        const existingFiles = await this.listAllFiles(workspaceDir, workspaceDir);
        for (const f of existingFiles) {
          if (f.startsWith('.')) continue;
          allFiles.push(f);
        }
        const savedManifest = await this.readManifest<InputManifest>(workspaceDir, INPUT_MANIFEST_NAME);
        if (savedManifest) {
          for (const fe of savedManifest.files) inputFileNames.push(fe.path);
          inputFileEntryCount = savedManifest.files.length;
        }
      }
      addLog(`[清单] 已记录 ${inputFileEntryCount} 个输入文件哈希值`);

      // 记录日志
      addLog('========================================');
      addLog('开始生成报告...');
      addLog(`报告名称: ${reportInfo.name || '未命名'}`);
      addLog(`处理脚本: ${script.name}`);
      addLog(`脚本类型: ${script.scriptType}`);
      addLog(`输出格式: ${outputFormat}`);
      addLog(
        `模板: ${
          template
            ? template.fileName +
              ' (' +
              (existsSync(template.filePath) ? '已找到' : '文件缺失!') +
              ')'
            : '无'
        }`
      );
      addLog(`工作目录: ${workspaceDir}`);
      addLog('工作目录内文件:');
      for (const fn of allFiles) addLog(`  - ${fn}`);
      addLog('========================================');

      // 解压压缩包，并把解压出的文件追加到 input_manifest（避免被识别为报告输出）
      // 同时记录解压出的临时文件到 .extracted_files.json，供脚本运行后清理
      const allExtractedEntries: string[] = [];
      for (const fn of [...inputFileNames]) {
        const filePath = path.join(workspaceDir, fn);
        const ext = fn.split('.').pop()?.toLowerCase() || '';

        if (ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === 'tgz') {
          addLog('');
          addLog(`[解压] 检测到压缩包: ${fn}，开始解压...`);
          try {
            const { files: entries } = await this.extractArchive(filePath, workspaceDir, undefined, addLog);
            const savedInputManifest = await this.readManifest<InputManifest>(workspaceDir, INPUT_MANIFEST_NAME) || { generatedAt: new Date().toISOString(), files: [] };
            for (const e of entries) {
              allFiles.push(e);
              inputFileNames.push(e);
              allExtractedEntries.push(e);
              const fullPath = path.join(workspaceDir, e);
              if (existsSync(fullPath)) {
                const stat = await fs.stat(fullPath);
                const hash = await this.computeFileHash(fullPath);
                savedInputManifest.files.push({ path: e, hash, size: stat.size });
              }
            }
            await this.writeManifest(workspaceDir, INPUT_MANIFEST_NAME, savedInputManifest);
            addLog(`[解压] 完成，共 ${entries.length} 个文件`);
          } catch (e: any) {
            addLog(`[解压] 失败: ${e.message}`);
          }
        }
      }

      // 记录所有解压出的临时文件，供脚本运行后清理
      if (allExtractedEntries.length > 0) {
        await this.writeManifest(workspaceDir, EXTRACTED_FILES_NAME, {
          generatedAt: new Date().toISOString(),
          files: allExtractedEntries,
        });
        addLog(`[解压] 已记录 ${allExtractedEntries.length} 个临时文件到 ${EXTRACTED_FILES_NAME}`);
      }

      // 设置环境变量
      const existingPythonPath = process.env.PYTHONPATH || '';
      const pythonPath = existingPythonPath
        ? `${workspaceDir}${path.delimiter}${existingPythonPath}`
        : workspaceDir;
      const spawnEnv = {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        LANG: 'zh_CN.UTF-8',
        PYTHONPATH: pythonPath,
      };

      // 获取Python路径
      const [pythonExe, pythonArgs] = await this.resolvePythonPath(scriptId);

      // 检查并安装Python依赖
      const requirements: string[] =
        formRequirements.length > 0
          ? formRequirements
          : script.requirements || [];
      if (script.scriptType === 'python' && requirements.length > 0) {
        addLog('');
        addLog('========================================');
        addLog('[环境检查] 开始检查 Python 依赖包...');
        addLog(
          `[环境检查] 需要 ${requirements.length} 个包: ${requirements.join(
            ', '
          )}`
        );
        addLog(
          `[环境检查] 来源: ${
            formRequirements.length > 0 ? '前端传入' : '脚本数据库记录'
          }`
        );

        await this.installPythonDependencies(
          pythonExe,
          pythonArgs,
          requirements,
          spawnEnv,
          addLog
        );

        addLog('========================================');
        addLog('');
      } else if (script.scriptType === 'python') {
        addLog('');
        addLog('[环境检查] 该脚本未配置依赖包，跳过环境检查');
        addLog(
          `[环境检查] 调试: formRequirements=${formRequirements.length} 条, dbRequirements=${
            (script.requirements || []).length
          } 条`
        );
      }

      // 确定执行命令
      const commandMap: Record<string, string> = {
        python: pythonExe,
        bat: 'cmd',
        ps1: 'powershell',
        sh: 'bash',
        powershell: 'pwsh',
      };
      const cmd = commandMap[script.scriptType] || pythonExe;
      const args: string[] =
        script.scriptType === 'bat'
          ? ['/c', script.fileName]
          : script.scriptType === 'ps1'
          ? ['-File', script.fileName]
          : script.scriptType === 'powershell'
          ? ['-File', script.fileName]
          : [...pythonArgs, script.fileName];

      addLog('');
      addLog(`[执行] ${cmd} ${args.join(' ')}`);
      addLog(`[工作目录] ${workspaceDir}`);
      addLog(`[Python路径] ${pythonExe}${pythonArgs.length > 0 ? ' ' + pythonArgs.join(' ') : ''}`);
      addLog(`[环境] PYTHONIOENCODING=utf-8, PYTHONPATH=${workspaceDir}`);

      // 记录脚本运行前的文件列表
      const filesBefore = new Set(
        await this.listAllFiles(workspaceDir, workspaceDir)
      );

      // 执行脚本
      const executionResult = await this.executeScript(
        cmd,
        args,
        workspaceDir,
        spawnEnv,
        script.scriptType,
        addLog
      );

      // 记录脚本运行后的文件列表
      const filesAfter = await this.listAllFiles(workspaceDir, workspaceDir);
      let newFiles = filesAfter.filter((f) => !filesBefore.has(f));

      // 读取输入文件清单，排除输入文件（防止脚本把输入文件复制到子目录被误识别为输出）
      const savedInputManifest = await this.readManifest<InputManifest>(workspaceDir, INPUT_MANIFEST_NAME);
      const archiveDirNames = this.getArchiveExtractDirNames(savedInputManifest);
      const inputFilePaths = new Set((savedInputManifest?.files || []).map((f) => f.path));
      const inputFileHashes = new Set((savedInputManifest?.files || []).map((f) => f.hash));

      // 二次校验：排除输入文件、日志/缓存目录、输入压缩包解压目录以及非报告输出文件
      const verifiedOutputFiles: string[] = [];
      for (const f of newFiles) {
        const fullPath = path.join(workspaceDir, f);
        if (!existsSync(fullPath)) continue;

        // 排除日志目录和 Python 缓存目录
        const parts = f.split(/[/\\]/);
        if (parts.includes('logs') || parts.includes('__pycache__')) continue;

        // 排除输入压缩包解压出的目录（脚本可能重复解压原始数据）
        if (this.isInsideExtractedArchiveDir(f, archiveDirNames)) {
          addLog(`[过滤] 排除输入压缩包解压目录: ${f}`);
          continue;
        }

        // 排除输入文件（按路径）
        if (inputFilePaths.has(f)) continue;

        // 排除输入文件（按哈希，处理复制/重命名情况）
        const hash = await this.computeFileHash(fullPath);
        if (inputFileHashes.has(hash)) {
          addLog(`[过滤] 排除与输入文件哈希相同的文件: ${f}`);
          continue;
        }

        // 最终只保留有效的报告输出文件
        if (!this.isReportOutputFile(f, archiveDirNames)) {
          addLog(`[过滤] 排除非报告输出文件: ${f}`);
          continue;
        }

        verifiedOutputFiles.push(f);
      }

      // 保存输出文件清单（仅包含最终报告文件）
      const outputFileEntries: ManifestFileEntry[] = [];
      for (const f of verifiedOutputFiles) {
        const fullPath = path.join(workspaceDir, f);
        const stat = await fs.stat(fullPath);
        const hash = await this.computeFileHash(fullPath);
        outputFileEntries.push({ path: f, hash, size: stat.size });
      }
      const outputManifest: OutputManifest = {
        generatedAt: new Date().toISOString(),
        files: outputFileEntries,
      };
      await this.writeManifest(workspaceDir, OUTPUT_MANIFEST_NAME, outputManifest);

      // 脚本执行完毕，清理解压出的临时文件（避免残留占用工作目录空间）
      await this.cleanupExtractedFiles(workspaceDir, addLog);

      // 联合判断：退出码 + 文件生成情况
      const exitCodeSuccess = executionResult.code === 0;
      const hasNewFiles = verifiedOutputFiles.length > 0;
      
      // 检查是否生成了有效的报告文件（排除日志文件、临时文件、脚本辅助文件和输入文件）
      const generatedReportFiles = this.filterReportFiles(verifiedOutputFiles, archiveDirNames);
      const hasValidReportFiles = generatedReportFiles.length > 0;

      addLog('');
      addLog('========================================');
      addLog(`[完成] 脚本执行完成，退出码: ${executionResult.code}`);
      addLog(`[判断] 退出状态: ${exitCodeSuccess ? '成功' : '失败'}`);
      addLog(`[判断] 文件生成: ${hasNewFiles ? `发现 ${verifiedOutputFiles.length} 个新文件` : '未生成新文件'}`);
      if (hasNewFiles) {
        addLog(`[判断] 报告文件: ${hasValidReportFiles ? `${generatedReportFiles.length} 个有效报告文件` : '无有效报告文件'}`);
        for (const f of generatedReportFiles) addLog(`  - ${f}`);
      }
      addLog('========================================');

      // 联合判断最终状态
      let finalStatus: 'success' | 'failed';
      let errorMessage: string | undefined;

      if (exitCodeSuccess && hasValidReportFiles) {
        // 退出码成功 + 生成了有效报告文件 → 成功
        finalStatus = 'success';
        addLog('[结果] ✅ 报告生成成功');
      } else if (exitCodeSuccess && !hasValidReportFiles) {
        // 退出码成功 + 未生成有效报告文件 → 警告（可能是脚本没有输出功能）
        finalStatus = 'failed';
        errorMessage = '脚本执行成功但未生成有效的报告文件';
        addLog('[结果] ⚠️ 脚本执行成功但未生成有效的报告文件');
      } else if (!exitCodeSuccess && hasValidReportFiles) {
        // 退出码失败 + 生成了有效报告文件 → 部分成功（警告）
        finalStatus = 'success';
        addLog('[结果] ⚠️ 脚本执行有错误但生成了报告文件，视为成功');
      } else {
        // 退出码失败 + 未生成有效报告文件 → 失败
        finalStatus = 'failed';
        errorMessage = `脚本执行失败，退出码: ${executionResult.code}`;
        addLog('[结果] ❌ 报告生成失败');
      }

      // 创建报告记录，只保存有效的报告输出文件路径
      const reportFilePaths = outputFileEntries.map((f) => f.path);
      const now = new Date().toISOString();
      const report: Report = {
        id: reportId,
        name: reportInfo.name || `报告_${now.slice(0, 10)}`,
        description: reportInfo.description || '',
        scriptId,
        scriptName: script.name,
        templateId: template?.id,
        templateName: template?.fileName,
        outputFormat,
        workspaceDir,
        generatedAt: now,
        generatedBy,
        status: finalStatus,
        error: errorMessage,
        logs: logMessages,
        filePaths: reportFilePaths,
        type: reportInfo.category || script.category || '',
        region: script.region || '',
        date: reportInfo.date || now,
        author: reportInfo.author || generatedBy,
        createdAt: now,
        // 添加联合判断的详细信息
        judgment: {
          exitCode: executionResult.code,
          exitCodeSuccess,
          hasNewFiles,
          newFilesCount: newFiles.length,
          hasValidReportFiles,
          generatedReportFiles,
        },
      };

      // 保存到数据库（后台模式由 runBackground 的 finalize 负责写入）
      if (!preWorkspaceDir) {
        await reportRepository.create(report);
      }

      log.info(`报告生成完成: ${report.name} (${reportId})`);

      return report;
    } catch (error: any) {
      addLog(`[错误] 报告生成失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 删除报告
   * 
   * @param reportId - 报告ID
   * @throws {Error} 如果报告不存在
   */
  async deleteReport(reportId: string): Promise<void> {
    const report = await reportRepository.findById(reportId);

    if (!report) {
      throw new Error('报告不存在');
    }

    // 删除报告文件目录
    if (
      report.workspaceDir &&
      report.workspaceDir.startsWith(this.reportsDir)
    ) {
      try {
        await fs.rm(report.workspaceDir, { recursive: true, force: true });
      } catch (error) {
        log.error(`删除报告目录失败: ${error}`);
      }
    }

    await reportRepository.delete(reportId);
    log.info(`报告已删除: ${report.name} (${reportId})`);
  }

  /**
   * 保存 AI 智能分析报告
   * 
   * 将 AI 分析结果写入数据库和文件系统。
   * 文件命名规则：AI分析报告（{原始文件名}）_{YY-MM-DD HH-mm-ss}.md
   * 
   * @param params - 参数
   * @returns 创建的报告记录
   */
  async saveAIAnalysisReport(params: {
    content: string;
    originalFileName: string;
    category: string;
    author: string;
    generatedBy: string;
  }): Promise<Report> {
    const { content, originalFileName, category, author, generatedBy } = params;
    const traceId = generateTraceId();

    // 生成报告ID和工作目录
    const reportId = randomUUID();
    const workspaceDir = path.join(this.reportsDir, reportId);
    mkdirSync(workspaceDir, { recursive: true });

    // 生成时间戳
    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(2)}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

    // 文件名：AI分析报告（{原始文件名}）_{YY-MM-DD HH-mm-ss}.md
    const reportFileName = `AI分析报告（${originalFileName}）_${dateStr} ${timeStr}.md`;
    const reportFilePath = path.join(workspaceDir, reportFileName);

    // 写入 Markdown 文件
    await fs.writeFile(reportFilePath, content, 'utf-8');

    // 写入输出清单
    const outputManifest: OutputManifest = {
      generatedAt: now.toISOString(),
      files: [
        {
          path: reportFileName,
          hash: await this.computeFileHash(reportFilePath),
          size: Buffer.byteLength(content, 'utf-8'),
        },
      ],
    };
    await this.writeManifest(workspaceDir, OUTPUT_MANIFEST_NAME, outputManifest);

    // 创建数据库记录
    const isoNow = now.toISOString();
    const report: Report = {
      id: reportId,
      name: reportFileName,
      description: `${category} 类巡检日志 AI 智能分析报告`,
      scriptId: 'ai-generated',
      scriptName: 'AI智能分析',
      templateId: undefined,
      templateName: undefined,
      outputFormat: 'md',
      workspaceDir,
      generatedAt: isoNow,
      generatedBy,
      status: 'success',
      logs: ['[AI分析] 分析完成，报告已自动保存'],
      filePaths: [reportFileName],
      type: category,
      region: '',
      date: isoNow.slice(0, 10),
      author,
      createdAt: isoNow,
      reportSource: 'ai',
    };

    await reportRepository.create(report);
    log.info(`AI分析报告已保存: ${reportFileName} (${reportId})`, traceId, { category, originalFileName });
    return report;
  }

  /**
   * 获取报告执行日志
   * 
   * @param reportId - 报告ID
   * @returns 执行日志
   * @throws {Error} 如果报告不存在
   */
  async getReportLogs(reportId: string): Promise<string[]> {
    const report = await reportRepository.findById(reportId);

    if (!report) {
      throw new Error('报告不存在');
    }

    return report.logs || [];
  }

  /**
   * 列出报告文件
   * 
   * @param reportId - 报告ID
   * @returns 文件列表
   * @throws {Error} 如果报告不存在
   */
  async getReportFiles(reportId: string): Promise<ReportFileInfo[]> {
    const report = await reportRepository.findById(reportId);

    if (!report) {
      throw new Error('报告不存在');
    }

    if (!existsSync(report.workspaceDir)) {
      return [];
    }

    const inputManifest = await this.readManifest<InputManifest>(
      report.workspaceDir,
      INPUT_MANIFEST_NAME
    );
    const archiveDirNames = this.getArchiveExtractDirNames(inputManifest);
    const inputFilePaths = new Set((inputManifest?.files || []).map((f) => f.path));
    const inputFileHashes = new Set((inputManifest?.files || []).map((f) => f.hash));

    // 优先读取输出文件清单，但仍需过滤（防止旧清单被污染）
    const outputManifest = await this.readManifest<OutputManifest>(
      report.workspaceDir,
      OUTPUT_MANIFEST_NAME
    );
    if (outputManifest && outputManifest.files && outputManifest.files.length > 0) {
      const files: ReportFileInfo[] = [];
      for (const entry of outputManifest.files) {
        // 排除清单中的非报告文件以及输入压缩包解压目录
        if (!this.isReportOutputFile(entry.path, archiveDirNames)) continue;
        if (inputFilePaths.has(entry.path)) continue;

        const fullPath = path.join(report.workspaceDir, entry.path);
        if (!existsSync(fullPath)) continue;

        // 二次校验：排除与输入文件哈希相同的文件
        const hash = await this.computeFileHash(fullPath);
        if (inputFileHashes.has(hash)) continue;

        const stat = await fs.stat(fullPath);
        files.push({
          name: entry.path,
          size: stat.size,
          path: fullPath,
          modifiedAt: stat.mtime,
        });
      }
      if (files.length > 0) return files;
    }

    // 兜底：按白名单/黑名单扫描工作目录，并排除已记录的输入/辅助/模板文件
    const files: ReportFileInfo[] = [];
    await this.collectFilesRecursive(report.workspaceDir, report.workspaceDir, files);

    const result: ReportFileInfo[] = [];
    for (const f of files) {
      // 排除非输出文件（脚本、辅助、模板、压缩包、临时文件等）
      if (this.isNonOutputFile(f.name)) continue;
      if (!this.isReportOutputFile(f.name, archiveDirNames)) continue;
      if (inputFilePaths.has(f.name)) continue;
      // 二次校验：排除与输入文件哈希相同的文件
      const hash = await this.computeFileHash(f.path);
      if (inputFileHashes.has(hash)) {
        continue;
      }
      result.push(f);
    }

    return result;
  }

  /**
   * 扫描工作目录并保存输出文件清单（失败恢复/兜底场景使用）
   *
   * @param workspaceDir - 工作目录
   * @param onLog - 可选日志回调
   * @returns 保存到清单中的文件路径列表
   */
  private async saveOutputManifestFromWorkspace(
    workspaceDir: string,
    onLog?: (message: string) => void
  ): Promise<string[]> {
    if (!existsSync(workspaceDir)) return [];

    // 读取输入文件清单
    const inputManifest = await this.readManifest<InputManifest>(workspaceDir, INPUT_MANIFEST_NAME);
    const archiveDirNames = this.getArchiveExtractDirNames(inputManifest);
    const inputFilePaths = new Set((inputManifest?.files || []).map((f) => f.path));
    const inputFileHashes = new Set((inputManifest?.files || []).map((f) => f.hash));

    // 收集当前工作目录所有文件
    const allFiles: ReportFileInfo[] = [];
    await this.collectFilesRecursive(workspaceDir, workspaceDir, allFiles);

    const outputFileEntries: ManifestFileEntry[] = [];
    for (const f of allFiles) {
      // 排除非输出文件（脚本、辅助、模板、压缩包、临时文件等）
      if (this.isNonOutputFile(f.name)) {
        onLog?.(`[过滤] 排除非输出文件: ${f.name}`);
        continue;
      }

      // 排除输入压缩包解压出的目录（脚本可能重复解压原始数据）
      if (this.isInsideExtractedArchiveDir(f.name, archiveDirNames)) {
        onLog?.(`[过滤] 排除输入压缩包解压目录: ${f.name}`);
        continue;
      }

      // 排除输入文件（按路径）
      if (inputFilePaths.has(f.name)) {
        onLog?.(`[过滤] 排除输入文件: ${f.name}`);
        continue;
      }

      // 排除输入文件（按哈希）
      const hash = await this.computeFileHash(f.path);
      if (inputFileHashes.has(hash)) {
        onLog?.(`[过滤] 排除与输入文件哈希相同的文件: ${f.name}`);
        continue;
      }

      // 只保留有效的报告输出文件
      if (!this.isReportOutputFile(f.name, archiveDirNames)) {
        onLog?.(`[过滤] 排除非报告输出文件: ${f.name}`);
        continue;
      }

      outputFileEntries.push({ path: f.name, hash, size: f.size });
    }

    if (outputFileEntries.length > 0) {
      const outputManifest: OutputManifest = {
        generatedAt: new Date().toISOString(),
        files: outputFileEntries,
      };
      await this.writeManifest(workspaceDir, OUTPUT_MANIFEST_NAME, outputManifest);
      onLog?.(`[清单] 已保存 ${outputFileEntries.length} 个输出文件到 ${OUTPUT_MANIFEST_NAME}`);
    }

    return outputFileEntries.map((e) => e.path);
  }

  /**
   * 递归收集目录下文件（排除日志和临时目录）
   */
  private async collectFilesRecursive(
    dirPath: string,
    basePath: string,
    files: ReportFileInfo[]
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      // 排除日志目录和临时文件
      if (entry.name === 'logs' || entry.name === '__pycache__') continue;

      if (entry.isDirectory()) {
        await this.collectFilesRecursive(fullPath, basePath, files);
      } else if (entry.isFile()) {
        // 只收集有效的报告输出文件，排除脚本源码和辅助文件
        if (!this.isReportOutputFile(relativePath)) continue;
        const stat = await fs.stat(fullPath);
        files.push({
          name: relativePath,
          size: stat.size,
          path: fullPath,
          modifiedAt: stat.mtime,
        });
      }
    }
  }

  /**
   * 下载报告文件
   * 
   * @param reportId - 报告ID
   * @param fileIndex - 文件索引（可选）
   * @returns 文件信息
   * @throws {Error} 如果报告不存在或文件不存在
   */
  async downloadReport(
    reportId: string,
    fileIndex?: number
  ): Promise<{
    fileName: string;
    filePath: string;
    fileSize: number;
  }> {
    const report = await reportRepository.findById(reportId);

    if (!report) {
      throw new Error('报告不存在');
    }

    if (!existsSync(report.workspaceDir)) {
      throw new Error('报告文件目录不存在');
    }

    // 优先使用数据库中保存的 filePaths（顺序与前端一致），并过滤确保只有报告文件
    const inputManifest = await this.readManifest<InputManifest>(report.workspaceDir, INPUT_MANIFEST_NAME);
    const archiveDirNames = this.getArchiveExtractDirNames(inputManifest);

    const validFilePaths = report.filePaths && report.filePaths.length > 0
      ? this.filterReportFiles(report.filePaths, archiveDirNames)
      : [];

    if (validFilePaths.length > 0) {
      const targetPath =
        fileIndex !== undefined ? validFilePaths[fileIndex] : validFilePaths[0];
      if (!targetPath) {
        throw new Error('指定的文件不存在');
      }
      const fullPath = path.join(report.workspaceDir, targetPath);
      if (!existsSync(fullPath)) {
        throw new Error('报告文件不存在');
      }
      const stat = await fs.stat(fullPath);
      return {
        fileName: path.basename(targetPath),
        filePath: fullPath,
        fileSize: stat.size,
      };
    }

    const files = await this.getReportFiles(reportId);
    if (files.length === 0) {
      throw new Error('报告没有文件');
    }

    const targetFile =
      fileIndex !== undefined ? files[fileIndex] : files[0];
    if (!targetFile) {
      throw new Error('指定的文件不存在');
    }

    return {
      fileName: targetFile.name,
      filePath: targetFile.path,
      fileSize: targetFile.size,
    };
  }

  /**
   * 批量下载报告文件（tar.gz）
   * 
   * @param reportId - 报告ID
   * @returns 压缩包信息
   * @throws {Error} 如果报告不存在或没有文件
   */
  async downloadAllReports(
    reportId: string
  ): Promise<{
    fileName: string;
    filePath: string;
    fileSize: number;
  }> {
    const report = await reportRepository.findById(reportId);

    if (!report) {
      throw new Error('报告不存在');
    }

    if (!existsSync(report.workspaceDir)) {
      throw new Error('报告文件目录不存在');
    }

    const files = await this.getReportFiles(reportId);
    if (files.length === 0) {
      throw new Error('报告没有文件');
    }

    // 创建tar.gz压缩包，文件名仅使用 reportId（防止路径遍历）
    const archiveName = `${reportId}.tar.gz`;
    const archivePath = path.join(this.reportsDir, archiveName);

    await this.createTarGz(report.workspaceDir, files, archivePath);

    const stat = await fs.stat(archivePath);
    return {
      fileName: archiveName,
      filePath: archivePath,
      fileSize: stat.size,
    };
  }

  /**
   * 执行脚本
   * 
   * @param cmd - 命令
   * @param args - 参数
   * @param cwd - 工作目录
   * @param env - 环境变量
   * @param scriptType - 脚本类型
   * @param onLog - 日志回调函数
   * @returns 执行结果
   */
  private async executeScript(
    cmd: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    scriptType: string,
    onLog?: (message: string) => void
  ): Promise<{ code: number }> {
    const scriptTimeout = 300000; // 5 minutes
      const LONG_SILENCE_TIMEOUT = 60000; // 60秒无输出才考虑再次发送回车
      const INPUT_PROMPT_DEBOUNCE_MS = 3000; // 检测到输入提示后，最多3秒内发送回车

      return new Promise((resolve, reject) => {
        let enterSent = false;
        let enterResetTimer: ReturnType<typeof setTimeout> | null = null;
        // 输出行缓冲区：处理 stdout/stderr 数据跨 chunk 截断的情况
        let lineBuffer = '';
        let gracefulKillTimer: ReturnType<typeof setTimeout> | null = null;
        let timeoutExpired = false;

        onLog?.(`[调试] spawn: cmd="${cmd}", args=${JSON.stringify(args)}, cwd="${cwd}"`);

        // Shell 模式安全校验：对 fileName 进行额外白名单检查
        const useShell = scriptType === 'bat' || scriptType === 'ps1';
        if (useShell) {
          const SAFE_FILENAME = /^[a-zA-Z0-9\u4e00-\u9fff _\-\.]+$/;
          if (!SAFE_FILENAME.test(args[0])) {
            throw new Error(`Shell 模式下文件名不安全: ${args[0]}`);
          }
        }

        const child = spawn(cmd, args, {
          cwd,
          shell: useShell,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // 手动超时处理（spawn 不自带 timeout）
        const timeoutTimer = setTimeout(() => {
          timeoutExpired = true;
          onLog?.(`[错误] 脚本执行超时 (${scriptTimeout / 1000}秒)，正在终止...`);

          // 先关闭 stdin（发送 EOF），让等待 input() 的脚本自然退出
          // Python 的 input() 收到 EOF 后会抛 EOFError 导致进程退出，
          // 这样 child.on('close') 会被触发并清除宽限期定时器。
          if (child.stdin && !child.stdin.destroyed) {
            onLog?.('[系统] 关闭 stdin 发送 EOF，尝试让脚本自然退出...');
            try {
              child.stdin.write('\n');
              child.stdin.end();
            } catch {}
          }

          // 5 秒宽限期：如果脚本还没退出再强制终止
          gracefulKillTimer = setTimeout(() => {
            if (!child.killed) {
              onLog?.('[系统] 脚本未在宽限期内退出，强制终止...');
              child.kill('SIGKILL');
            }
          }, 5000);
        }, scriptTimeout);

        // 长时间无输出时，检测脚本是否在等待用户输入
        let silenceTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingInputPrompt = false;
        let inputPromptDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        /** 检测脚本是否在等待输入的常见关键词 */
        const promptKeywords = ['回车', 'Enter', 'enter', 'exit', '退出', 'press any key', '按任意键'];

        const resetEnterSent = () => {
          if (enterResetTimer) clearTimeout(enterResetTimer);
          enterResetTimer = setTimeout(() => {
            enterSent = false;
          }, 15000);
        };

        const sendEnter = (reason: string) => {
          if (!child.stdin || child.stdin.destroyed || enterSent) return;
          enterSent = true;
          onLog?.(`[系统] ${reason}，发送回车...`);
          try {
            child.stdin.write('\n');
          } catch (e: any) {
            onLog?.(`[系统] 发送回车失败: ${e.message}`);
          }
          resetEnterSent();
        };

        const scheduleSilenceCheck = () => {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            // 长时间无输出时检查是否有挂起的输入提示，再次发送回车
            if (pendingInputPrompt) {
              sendEnter('脚本长时间无输出且仍等待输入');
            }
          }, LONG_SILENCE_TIMEOUT);
        };

        /** 去除 ANSI 转义序列 */
        const stripAnsi = (text: string): string => {
          return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                     .replace(/\x1b\][0-9;]*[a-zA-Z]/g, '')
                     .replace(/\x1b[=><F-HK-N]|[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        };

        /**
         * 处理数据块，按行拆分，逐行推送
         * 解决多个 `\n` 行在同一数据块中合并为一条日志的问题
         */
        const handleOutputChunk = (chunk: Buffer, logPrefix: string = '') => {
          const raw = chunk.toString('utf-8');
          const cleaned = stripAnsi(raw);
          // 拼接到行缓冲区
          lineBuffer += cleaned;
          // 按 \n 拆分为行
          const lines = lineBuffer.split('\n');
          // 最后一个元素可能是不完整的行，保留到下一轮
          lineBuffer = lines.pop() || '';
          let hasInputPrompt = false;
          for (const line of lines) {
            // 去除行尾 \r (CRLF 行尾)
            const trimmed = line.replace(/\r$/, '');
            const msg = logPrefix ? `${logPrefix}${trimmed}` : trimmed;
            onLog?.(msg);
            if (!logPrefix && promptKeywords.some((kw) => trimmed.includes(kw))) {
              hasInputPrompt = true;
            }
          }
          if (hasInputPrompt) {
            pendingInputPrompt = true;
            // 检测到输入提示后，延迟很短时间就发送回车（避免脚本还没输出完整提示）
            if (inputPromptDebounceTimer) clearTimeout(inputPromptDebounceTimer);
            inputPromptDebounceTimer = setTimeout(() => {
              sendEnter('检测到脚本输入提示');
            }, INPUT_PROMPT_DEBOUNCE_MS);
          }
          scheduleSilenceCheck();
        };

        child.stdout.on('data', (data) => {
          handleOutputChunk(data);
        });

        child.stderr.on('data', (data) => {
          handleOutputChunk(data, '[stderr] ');
        });

        child.on('close', (code, signal) => {
          clearTimeout(timeoutTimer);
          if (silenceTimer) clearTimeout(silenceTimer);
          if (inputPromptDebounceTimer) clearTimeout(inputPromptDebounceTimer);
          if (enterResetTimer) clearTimeout(enterResetTimer);
          if (gracefulKillTimer) clearTimeout(gracefulKillTimer);
          // 刷新缓冲区中残留的不完整行
          if (lineBuffer.trim()) {
            const remaining = lineBuffer.replace(/\r$/, '').trim();
            if (remaining) onLog?.(remaining);
            lineBuffer = '';
          }
          if (signal) {
            // 如果超时已经触发（timeoutExpired），说明报告文件已经生成
            if (timeoutExpired) {
              onLog?.(`[完成] 脚本执行超时但报告文件已生成，退出码: ${code ?? 0}`);
              resolve({ code: code ?? 0 });
              return;
            }
            onLog?.(`[错误] 脚本被系统终止 (signal: ${signal})`);
            reject(new Error(`脚本被系统终止 (signal: ${signal})`));
            return;
          }
          onLog?.(`[完成] 脚本退出，退出码: ${code}`);
          resolve({ code: code ?? 0 });
        });

        child.on('error', (error) => {
          clearTimeout(timeoutTimer);
          if (silenceTimer) clearTimeout(silenceTimer);
          if (inputPromptDebounceTimer) clearTimeout(inputPromptDebounceTimer);
          if (enterResetTimer) clearTimeout(enterResetTimer);
          if (gracefulKillTimer) clearTimeout(gracefulKillTimer);
          onLog?.(`[错误] 无法启动脚本进程: ${error.message}`);
          reject(error);
        });

        // 启动首次静默检查
        scheduleSilenceCheck();
      });
  }

  /**
   * 调用 Python 脚本解压压缩包（支持 zip/tar/tar.gz/tgz/gz）
   *
   * @param archivePath - 压缩包路径
   * @param destDir - 目标目录
   * @param onLog - 日志回调函数
   * @returns 解压出的相对文件路径列表
   */
  private async extractArchive(
    archivePath: string,
    destDir: string,
    password?: string,
    onLog?: (message: string) => void
  ): Promise<{ files: string[]; totalSize: number }> {
    const pythonPath = EMBEDDED_PYTHON || this.findSystemPython()[0];
    if (!pythonPath) {
      throw new Error('未找到可用的 Python 环境');
    }

    const scriptPath = path.join(process.cwd(), 'scripts', 'extract_archive.py');
    if (!existsSync(scriptPath)) {
      throw new Error('未找到解压脚本 scripts/extract_archive.py');
    }

    const args = [scriptPath, archivePath, destDir];
    if (password) {
      args.push('--password', password);
    }

    const { stdout, stderr } = await execFileAsync(pythonPath, args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    if (stderr) {
      onLog?.(`[解压] ${stderr.trim()}`);
    }

    // 解析 JSON 输出（新脚本输出 JSON，兼容旧格式）
    let result: any;
    try {
      result = JSON.parse(stdout.trim());
    } catch {
      // 旧格式：每行一个文件名
      const files = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      return { files, totalSize: 0 };
    }

    if (!result.success) {
      throw new Error(result.error || '解压失败');
    }

    return {
      files: result.files || [],
      totalSize: result.total_size || 0,
    };
  }

  /**
   * 解压tar文件
   *
   * @param filePath - tar文件路径
   * @param destDir - 目标目录
   * @param onLog - 日志回调函数
   * @returns 解压的文件列表
   */
  private async extractTar(
    tarPath: string,
    destDir: string,
    password?: string,
    onLog?: (message: string) => void
  ): Promise<{ files: string[]; totalSize: number }> {
    return this.extractArchive(tarPath, destDir, password, onLog);
  }

  /**
   * 解压gz文件
   *
   * @param filePath - gz文件路径
   * @param destDir - 目标目录
   * @param onLog - 日志回调函数
   * @returns 解压的文件列表
   */
  private async extractGz(
    gzPath: string,
    destDir: string,
    password?: string,
    onLog?: (message: string) => void
  ): Promise<{ files: string[]; totalSize: number }> {
    return this.extractArchive(gzPath, destDir, password, onLog);
  }

  /**
   * 解压zip文件
   *
   * @param filePath - zip文件路径
   * @param destDir - 目标目录
   * @param onLog - 日志回调函数
   * @returns 解压的文件列表
   */
  private async extractZip(
    zipPath: string,
    destDir: string,
    password?: string,
    onLog?: (message: string) => void
  ): Promise<{ files: string[]; totalSize: number }> {
    return this.extractArchive(zipPath, destDir, password, onLog);
  }

  /**
   * 创建tar.gz压缩包
   * 只打包指定的报告文件，不包含脚本源码和辅助文件
   * 
   * @param cwd - 工作目录，用于计算 tar 包中的相对路径
   * @param files - 要打包的报告文件列表
   * @param destPath - 目标文件路径
   */
  private async createTarGz(
    cwd: string,
    files: ReportFileInfo[],
    destPath: string
  ): Promise<void> {
    if (files.length === 0) {
      throw new Error('没有可打包的文件');
    }

    // 收集要打包的（tar包内名称, 绝对路径）对
    const fileEntries: { name: string; path: string }[] = [];
    for (const f of files) {
      if (!existsSync(f.path)) continue;
      fileEntries.push({ name: f.name, path: f.path });
    }

    if (fileEntries.length === 0) {
      throw new Error('报告文件不存在，无法打包');
    }

    // 防御性检查：确认 tar 模块可用
    if (!tar || typeof tar.create !== 'function') {
      throw new Error('tar 模块未正确加载，无法创建压缩包');
    }

    await tar.create(
      {
        gzip: true,
        file: destPath,
        cwd,
      },
      fileEntries.map((e) => e.name)
    );
  }

  /**
   * 列出目录下所有文件
   * 
   * @param dirPath - 目录路径
   * @param basePath - 基础路径（用于相对路径）
   * @returns 文件相对路径列表
   */
  private async listAllFiles(
    dirPath: string,
    basePath: string
  ): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        const relativePath = path.relative(basePath, fullPath);
        files.push(relativePath);
      } else if (entry.isDirectory()) {
        const subFiles = await this.listAllFiles(fullPath, basePath);
        files.push(...subFiles);
      }
    }

    return files;
  }

  /**
   * 解析Python路径
   * 
   * @param scriptId - 脚本ID
   * @returns Python路径
   */
  private async resolvePythonPath(scriptId: string): Promise<[string, string[]]> {
    // 优先使用脚本专用虚拟环境
    const scriptVenv = path.join(
      this.scriptsDir,
      scriptId,
      'venv',
      'Scripts',
      'python.exe'
    );
    if (existsSync(scriptVenv)) {
      return [scriptVenv, []];
    }

    // 其次使用全局虚拟环境
    const globalVenv = VENV_PYTHON;
    if (existsSync(globalVenv)) {
      return [globalVenv, []];
    }

    // 最后查找系统 Python（支持 python / python3 / py 启动器）
    return this.findSystemPython();
  }

  /**
   * 查找系统中可用的 Python 可执行文件
   * 按优先级尝试：内嵌 Python → py 启动器 → python3 → python
   */
  /**
   * 清理脚本运行后残留的解压临时文件
   * 读取 .extracted_files.json，删除其中列出的所有文件，然后删除清单本身
   */
  private async cleanupExtractedFiles(
    workspaceDir: string,
    onLog?: (message: string) => void
  ): Promise<void> {
    try {
      const manifestPath = path.join(workspaceDir, EXTRACTED_FILES_NAME);
      if (!existsSync(manifestPath)) return;

      const manifest = await this.readManifest<{ files: string[] }>(workspaceDir, EXTRACTED_FILES_NAME);
      if (!manifest?.files?.length) {
        await fs.unlink(manifestPath).catch(() => {});
        return;
      }

      let deletedCount = 0;
      let failedCount = 0;
      for (const f of manifest.files) {
        const fullPath = path.join(workspaceDir, f);
        try {
          await fs.unlink(fullPath);
          deletedCount++;
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            failedCount++;
            onLog?.(`[清理] 删除临时文件失败: ${f} - ${err.message}`);
          }
        }
      }

      // 删除清单文件自身
      await fs.unlink(manifestPath).catch(() => {});

      if (deletedCount > 0) {
        onLog?.(`[清理] 已删除 ${deletedCount} 个解压临时文件${failedCount > 0 ? `，${failedCount} 个失败` : ''}`);
      }
    } catch (err: any) {
      onLog?.(`[清理] 临时文件清理异常: ${err.message}`);
    }
  }

  private findSystemPython(): [string, string[]] {
    // 0. 最优先：内嵌 Python 环境
    if (existsSync(EMBEDDED_PYTHON)) {
      return [EMBEDDED_PYTHON, []];
    }

    // 1. 尝试系统 Python 命令
    // 注意：必须用 py 启动器优先，因为它不受 Windows Store 别名影响
    const candidates: [string, string[]][] = [
      ['py', ['-3']],
      ['py', []],
      ['python3', []],
      ['python', []],
    ];
    for (const [exe, pyArgs] of candidates) {
      const cmdStr = pyArgs.length > 0 ? `${exe} ${pyArgs.join(' ')}` : exe;
      try {
        const result = execSync(`${cmdStr} --version`, { encoding: 'utf-8', timeout: 5000 });
        // 严格验证：必须是真正的版本信息（如 "Python 3.11.9"），排除 Windows Store 错误提示
        if (result && /^Python \d+\.\d+/i.test(result.trim())) {
          return [exe, pyArgs];
        }
      } catch {
        // 命令不存在或执行失败，继续尝试下一个
      }
    }

    // 2. 全部失败，回退到 'python'（调用方会得到明确的错误信息）
    return ['python', []];
  }

  /**
   * 安装Python依赖
   * 
   * @param pythonCmd - Python命令
   * @param requirements - 依赖列表
   * @param env - 环境变量
   * @param onLog - 日志回调函数
   */
  private async installPythonDependencies(
    pythonExe: string,
    pythonArgs: string[],
    requirements: string[],
    env: Record<string, string>,
    onLog?: (message: string) => void
  ): Promise<void> {
    try {
      // 获取pip路径
      const pipCmd = path.join(path.dirname(pythonExe), 'pip3.exe');
      const pipPath = existsSync(pipCmd)
        ? pipCmd
        : existsSync(pythonExe.replace('python.exe', 'pip.exe'))
        ? pythonExe.replace('python.exe', 'pip.exe')
        : null;

      // 查询已安装的包
      onLog?.('[环境检查] 查询已安装的包...');

      let pipExe: string;
      let pipListArgs: string[];

      if (pipPath && pipPath.endsWith('.exe')) {
        pipExe = pipPath;
        pipListArgs = ['list', '--format=json'];
      } else {
        pipExe = pythonExe;
        pipListArgs = [...pythonArgs, '-m', 'pip', 'list', '--format=json'];
      }

      const installed = await new Promise<Set<string>>((resolve, reject) => {
        const p = spawn(pipExe, pipListArgs, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 300000,
        });
        let out = '';
        p.stdout.on('data', (d) => {
          out += d.toString('utf-8');
        });
        p.stderr.on('data', (d) => {
          out += d.toString('utf-8');
        });
        p.on('close', (c) => {
          try {
            const list = JSON.parse(out);
            resolve(
              new Set<string>(
                list.map((pkg: any) => pkg.name.toLowerCase())
              )
            );
          } catch {
            // 回退到文本格式解析
            const names = new Set<string>();
            out.split('\n').forEach((line) => {
              const m = line.match(/^(\S+)\s+/);
              if (m) names.add(m[1].toLowerCase());
            });
            resolve(names);
          }
        });
        p.on('error', reject);
      });

      // 安全校验：包名（不含版本限定符/ extras）必须符合 PyPI 命名规范（深度防御）
      const PIP_PACKAGE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
      for (const req of requirements) {
        const pkgName = req.match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)/)?.[1] || '';
        if (!PIP_PACKAGE_REGEX.test(pkgName)) {
          throw new Error(`无效的依赖包名: ${req}`);
        }
      }

      // 找出缺失的包
      const missing: string[] = [];
      for (const req of requirements) {
        const pkgName = (req.match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)/)?.[1] || '').toLowerCase();
        if (!installed.has(pkgName)) {
          missing.push(req);
          onLog?.(`[环境检查] 缺少: ${req}`);
        } else {
          onLog?.(`[环境检查] 已安装: ${req}`);
        }
      }

      // 安装缺失的包
      if (missing.length > 0) {
        onLog?.('');
        onLog?.(
          `[环境安装] 开始安装 ${missing.length} 个缺失的包...`
        );
        const installArgs = pipPath?.endsWith('.exe')
          ? ['install', '--progress-bar', 'off', '--index-url', config.PIP_INDEX_URL, ...missing]
          : [...pythonArgs, '-m', 'pip', 'install', '--progress-bar', 'off', '--index-url', config.PIP_INDEX_URL, ...missing];
        const pipInstallExe = pipPath?.endsWith('.exe') ? pipPath : pythonExe;
        const installResult = await new Promise<{ code: number; out: string }>(
          (resolve, reject) => {
            const p = spawn(pipInstallExe, installArgs, {
              env,
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 300000,
            });
            let out = '';
            let buf = '';
            const handleData = (d: Buffer) => {
              const t = d.toString('utf-8');
              out += t;
              buf += t;
              const lines = buf.split('\n');
              buf = lines.pop() || '';
              for (const rawLine of lines) {
                const cleaned = rawLine.replace(/\x1b\[[0-9;]*m/g, '');
                if (cleaned.trim())
                  onLog?.(`[环境安装] ${cleaned.trim()}`);
              }
            };
            p.stdout.on('data', handleData);
            p.stderr.on('data', handleData);
            p.on('close', (c: number | null) => {
              if (buf.trim())
                onLog?.(
                  `[环境安装] ${buf
                    .replace(/\x1b\[[0-9;]*m/g, '')
                    .trim()}`
                );
              resolve({ code: c ?? 0, out });
            });
            p.on('error', reject);
          }
        );

        if (installResult.code === 0) {
          onLog?.('[环境安装] 安装完成！');
        } else {
          onLog?.(
            `[环境安装] 安装过程返回非零退出码: ${installResult.code}，部分包可能安装失败`
          );
        }
      } else {
        onLog?.('[环境检查] 所有依赖包已就绪，无需安装');
      }
    } catch (e: any) {
      onLog?.(`[环境检查] 出错: ${e.message}`);
    }
  }

  /**
   * 从文件系统重建脚本信息
   * 
   * @param scriptId - 脚本ID
   * @returns 脚本信息或null
   */
  private async rebuildScriptFromFileSystem(
    scriptId: string
  ): Promise<any | null> {
    const scriptDir = path.join(this.scriptsDir, scriptId);
    if (!existsSync(scriptDir)) {
      return null;
    }

    const files = await fs.readdir(scriptDir);
    const pyFile = files.find(
      (f) =>
        f.endsWith('.py') ||
        f.endsWith('.sh') ||
        f.endsWith('.bat') ||
        f.endsWith('.ps1')
    );

    if (!pyFile) {
      return null;
    }

    const stat = await fs.stat(path.join(scriptDir, pyFile));
    const script = {
      id: scriptId,
      name: pyFile,
      description: '',
      scriptType: pyFile.endsWith('.py')
        ? 'python'
        : pyFile.endsWith('.bat')
        ? 'bat'
        : pyFile.endsWith('.ps1')
        ? 'ps1'
        : 'sh',
      version: '1.0',
      category: 'host',
      fileName: pyFile,
      filePath: path.join(scriptDir, pyFile),
      fileSize: stat.size,
      templateRequired: false,
      templateIds: [],
      auxiliaryFiles: [] as Array<{
        name: string;
        size: number;
        path: string;
        hash: string;
      }>,
      requirements: [],
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'system',
    };

    // 读取辅助文件目录
    const auxDir = path.join(scriptDir, 'auxfiles');
    if (existsSync(auxDir)) {
      const auxEntries = await fs.readdir(auxDir);
      for (const ae of auxEntries) {
        const ap = path.join(auxDir, ae);
        const as = await fs.stat(ap).catch(() => null);
        if (as && as.isFile()) {
          script.auxiliaryFiles.push({
            name: ae,
            size: as.size,
            path: ap,
            hash: '',
          });
        }
      }
    }

    return script;
  }

  /**
   * 从文件系统重建模板信息
   * 
   * @param templateId - 模板ID
   * @returns 模板信息或null
   */
  private async rebuildTemplateFromFileSystem(
    templateId: string
  ): Promise<any | null> {
    const templateDir = path.join(this.templatesDir, templateId);
    if (!existsSync(templateDir)) {
      return null;
    }

    const tplFiles = await fs.readdir(templateDir);
    const tplFile = tplFiles.find(
      (f) =>
        f.endsWith('.docx') ||
        f.endsWith('.xlsx') ||
        f.endsWith('.md') ||
        f.endsWith('.pdf')
    );

    if (!tplFile) {
      return null;
    }

    const stat = await fs.stat(path.join(templateDir, tplFile));
    return {
      id: templateId,
      name: tplFile,
      description: '',
      fileType: tplFile.endsWith('.docx')
        ? 'docx'
        : tplFile.endsWith('.xlsx')
        ? 'xlsx'
        : tplFile.endsWith('.md')
        ? 'md'
        : 'pdf',
      fileName: tplFile,
      filePath: path.join(templateDir, tplFile),
      fileSize: stat.size,
      compatibleScriptType: 'python',
      uploadedAt: new Date().toISOString(),
    };
  }
}

/**
 * 报告服务单例实例
 */
export const reportService = new ReportService();