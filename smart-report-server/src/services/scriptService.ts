/**
 * 脚本业务逻辑服务
 * 
 * 本模块提供脚本相关的业务逻辑处理，包括上传、更新、删除、内容管理等。
 * 使用fileManager进行文件操作，确保安全性。
 * 
 * @module scriptService
 */

import { scriptRepository } from '../db/repositories';
import { logger, getLogger, generateTraceId, Logger } from '../utils/logger';
import { fileManager, safeMoveFile } from '../utils/file';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { config, SCRIPTS_DIR, EMBEDDED_PYTHON, getPipIndexUrl } from '../config';

// 模块级日志实例（核心业务模块）
const log = getLogger('ScriptService', 'core');

/**
 * 脚本信息接口
 */
export interface Script {
  /** 脚本ID */
  id: string;
  /** 脚本名称 */
  name: string;
  /** 脚本描述 */
  description: string;
  /** 脚本类型 */
  scriptType: string;
  /** 适用区域 */
  region: string;
  /** 输入格式 */
  inputFormats: string;
  /** 是否手动输入格式 */
  inputFormatManual: boolean;
  /** 版本号 */
  version: string;
  /** 分类 */
  category: string;
  /** 文件名 */
  fileName: string;
  /** 文件路径 */
  filePath: string;
  /** 文件哈希 */
  fileHash: string;
  /** 文件大小 */
  fileSize: number;
  /** 是否需要模板 */
  templateRequired: boolean;
  /** 关联的模板ID列表 */
  templateIds: string[];
  /** 辅助文件列表 */
  auxiliaryFiles: AuxiliaryFile[];
  /** 多文件模式下的额外 .py 文件列表 */
  extraFiles: ExtraFile[];
  /** 巡检工具文件列表 */
  toolFiles: ToolFile[];
  /** 依赖包列表 */
  requirements: string[];
  /** 依赖状态 */
  depsStatus: {
    status: 'none' | 'env_ready' | 'installing' | 'done' | 'failed';
    log: string;
    packages: string[];
    error?: string;
  };
  /** Python 版本，如 'embedded'、'3.11.9'、'3.12.8' */
  pythonVersion?: string;
  /** 是否为多文件脚本模式 */
  isMultiFile?: boolean;
  /** 自定义报告命名模板（空字符串表示使用默认命名 报告_YYYY-MM-DD） */
  reportNameTemplate?: string;
  /** 上传时间 */
  uploadedAt: string;
  /** 上传者 */
  uploadedBy: string;
  /** 上传者显示名（通过 JOIN users 表获取） */
  uploaderName?: string;
}

/**
 * 辅助文件接口
 */
export interface AuxiliaryFile {
  /** 文件名 */
  name: string;
  /** 文件大小 */
  size: number;
  /** 文件路径 */
  path: string;
  /** 文件哈希 */
  hash: string;
}

/**
 * 额外脚本文件接口（多文件模式）
 */
export interface ExtraFile {
  name: string;
  size: number;
  path: string;
  hash: string;
}

/**
 * 巡检工具文件接口（与辅助文件结构一致，存储在 scripts/{id}/tools/ 下）
 */
export interface ToolFile {
  /** 文件名 */
  name: string;
  /** 文件大小 */
  size: number;
  /** 文件路径 */
  path: string;
  /** 文件哈希 */
  hash: string;
}

/** 单文件模式子目录名 */
const SINGLE_SUBDIR = 'single';
/** 多文件模式子目录名 */
const MULTI_SUBDIR = 'multi';

/**
 * 脚本服务类
 * 
 * 提供脚本相关的所有业务逻辑操作
 */
export class ScriptService {
  private readonly scriptsDir: string;
  private cachedPython: string | null = null;

  /**
   * 创建脚本服务实例
   */
  constructor() {
    this.scriptsDir = SCRIPTS_DIR;

    // 确保脚本目录存在
    if (!existsSync(this.scriptsDir)) {
      mkdirSync(this.scriptsDir, { recursive: true });
    }
  }

  /**
   * 根据脚本模式获取 .py 文件存放的子目录路径
   * 
   * - 单文件模式: {scriptsDir}/{scriptId}/single/
   * - 多文件模式: {scriptsDir}/{scriptId}/multi/
   */
  private getScriptSubDir(scriptId: string, isMultiFile: boolean): string {
    const sub = isMultiFile ? MULTI_SUBDIR : SINGLE_SUBDIR;
    return path.join(this.scriptsDir, scriptId, sub);
  }

  /**
   * 获取脚本主入口文件的绝对路径
   */
  private getMainScriptPath(scriptId: string, isMultiFile: boolean, fileName: string): string {
    return path.join(this.getScriptSubDir(scriptId, isMultiFile), fileName);
  }

  /**
   * 获取脚本列表
   * 
   * @param filter - 可选过滤条件
   * @returns 脚本列表
   */
  async getScripts(filter?: {
    region?: string;
    category?: string;
    scriptType?: string;
  }): Promise<Script[]> {
    const traceId = generateTraceId();
    log.info(`⇢ getScripts 调用开始`, traceId, { filter });
    const startTime = Date.now();

    const scripts = await scriptRepository.findAll(filter);

    // 记录数据库查询耗时
    log.dbOperation('SELECT', 'scripts', Date.now() - startTime, traceId, {
      resultCount: scripts.length,
    });

    // 同步磁盘上的 .py 文件到数据库（多文件模式脚本）
    for (const script of scripts) {
      if (script.isMultiFile) {
        try { await this.syncExtraFilesFromDisk(script); } catch (e) { /* 忽略单条错误 */ }
      }
    }
    // 重新拉取以拿到同步后的 extraFiles
    const refreshed = await scriptRepository.findAll(filter);

    // 去重辅助文件
    const result = refreshed.map((script: Script) => {
      if (script.auxiliaryFiles && script.auxiliaryFiles.length > 0) {
        const seen = new Set<string>();
        script.auxiliaryFiles = script.auxiliaryFiles.filter((af) => {
          if (seen.has(af.name)) return false;
          seen.add(af.name);
          return true;
        });
      }
      // 去重 extraFiles
      if (script.extraFiles && script.extraFiles.length > 0) {
        const seen = new Set<string>();
        script.extraFiles = script.extraFiles.filter((ef) => {
          if (seen.has(ef.name)) return false;
          seen.add(ef.name);
          return true;
        });
      }
      // 去重巡检工具文件
      if (script.toolFiles && script.toolFiles.length > 0) {
        const seen = new Set<string>();
        script.toolFiles = script.toolFiles.filter((tf) => {
          if (seen.has(tf.name)) return false;
          seen.add(tf.name);
          return true;
        });
      }
      return script;
    });

    log.info(`✓ getScripts 完成: ${result.length} 条记录`, traceId, {
      total: result.length,
      duration: Date.now() - startTime,
    });
    return result;
  }

  /**
   * 获取单个脚本
   * 
   * @param scriptId - 脚本ID
   * @returns 脚本信息
   * @throws {Error} 如果脚本不存在
   */
  async getScript(scriptId: string): Promise<Script> {
    const traceId = generateTraceId();
    log.info(`⇢ getScript`, traceId, { scriptId });

    const script = await scriptRepository.findById(scriptId);
    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    // 同步：扫描磁盘上所有 .py 文件，补齐到数据库
    await this.syncExtraFilesFromDisk(script);
    return scriptRepository.findById(scriptId) as Promise<Script>;
  }

  /**
   * 扫描脚本 multi/ 子目录，把磁盘上所有 .py 文件（除主入口外）同步到 script_extra_files 表
   * 这样无论用户何时查询，UI 都能看到目录里的真实 .py 文件列表
   */
  private async syncExtraFilesFromDisk(script: Script): Promise<void> {
    if (!script.isMultiFile) return;
    const scriptSubDir = this.getScriptSubDir(script.id, true);
    if (!existsSync(scriptSubDir)) return;

    let diskPyFiles: string[] = [];
    try {
      diskPyFiles = (await fs.readdir(scriptSubDir))
        .filter((f) => f.toLowerCase().endsWith('.py') && f !== script.fileName);
    } catch (e) {
      return;
    }
    const dbNames = new Set(script.extraFiles.map((e) => e.name));
    const diskNames = new Set(diskPyFiles);

    // 删除 DB 中有但磁盘上没有的
    for (const ef of script.extraFiles) {
      if (!diskNames.has(ef.name) && existsSync(ef.path)) {
        try { await fs.unlink(ef.path); } catch {}
      }
      if (!diskNames.has(ef.name)) {
        await scriptRepository.clearExtraFiles(script.id);
        break;
      }
    }

    // 补全磁盘上有但 DB 没有的
    const refreshed = await scriptRepository.findById(script.id);
    if (!refreshed) return;
    const refreshedNames = new Set(refreshed.extraFiles.map((e) => e.name));
    for (const name of diskPyFiles) {
      if (!refreshedNames.has(name)) {
        const fullPath = path.join(scriptSubDir, name);
        const stat = await fs.stat(fullPath);
        const hash = await this.computeFileHash(fullPath);
        await scriptRepository.createExtraFile(script.id, {
          name, size: stat.size, path: fullPath, hash,
        });
      }
    }
  }

  /**
   * 上传脚本
   * 
   * @param file - 脚本文件信息
   * @param metadata - 脚本元数据
   * @returns 创建的脚本信息
   * @throws {Error} 如果文件验证失败
   */
  async uploadScript(
    file: {
      filename: string;
      path: string;
      size: number;
    },
    metadata: {
      name?: string;
      description?: string;
      scriptType?: string;
      region?: string;
      inputFormats?: string;
      inputFormatManual?: boolean;
      version?: string;
      category?: string;
      templateRequired?: boolean;
      templateIds?: string[];
      requirements?: string[];
      uploadedBy?: string;
      pythonVersion?: string;
      isMultiFile?: boolean;
      reportNameTemplate?: string;
      auxiliaryFiles?: Array<{
        filename: string;
        path: string;
        size: number;
      }>;
      toolFiles?: Array<{
        filename: string;
        path: string;
        size: number;
      }>;
    },
    extraScriptFiles?: Array<{
      filename: string;
      path: string;
      size: number;
    }>
  ): Promise<Script> {
    const traceId = generateTraceId();
    log.info(`⇢ uploadScript 调用开始`, traceId, {
      filename: file.filename,
      size: file.size,
      scriptType: metadata.scriptType,
      pythonVersion: metadata.pythonVersion,
    });

    // 验证文件名
    const validation = fileManager.validateFileName(file.filename);
    if (!validation) {
      log.warn(`文件名验证失败: ${file.filename}`, traceId);
      throw new Error('文件名无效');
    }

    // 验证输入格式
    if (metadata.inputFormats) {
      const fmtCheck = this.validateInputFormats(metadata.inputFormats);
      if (!fmtCheck.valid) {
        log.warn(`输入格式验证失败: ${fmtCheck.error}`, traceId);
        throw new Error(fmtCheck.error);
      }
    }

    // 生成脚本ID
    const id = `script_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const isMulti = metadata.isMultiFile || false;
    const scriptRootDir = path.join(this.scriptsDir, id);

    // 创建脚本根目录 + 模式子目录
    mkdirSync(scriptRootDir, { recursive: true });

    // 移动脚本文件（主入口）到对应模式子目录
    const subDir = this.getScriptSubDir(id, isMulti);
    mkdirSync(subDir, { recursive: true });
    const destPath = path.join(subDir, file.filename);
    await safeMoveFile(file.path, destPath);
    log.info(`脚本文件已移动到: ${destPath}`, traceId, { isMultiFile: isMulti, subDir });

    // 多文件模式：将额外的 .py 文件也移到 multi/ 子目录
    if (extraScriptFiles && extraScriptFiles.length > 0) {
      for (const extra of extraScriptFiles) {
        const extraDest = path.join(subDir, extra.filename);
        await safeMoveFile(extra.path, extraDest);
        log.info(`额外脚本文件已移动到: ${extraDest}`, traceId);
      }
    }

    // 处理辅助文件（放在脚本根目录的 auxfiles/ 下，两种模式共享）
    const auxiliaryFiles: AuxiliaryFile[] = [];
    if (metadata.auxiliaryFiles) {
      log.info(`处理 ${metadata.auxiliaryFiles.length} 个辅助文件`, traceId);
      const auxDir = path.join(scriptRootDir, 'auxfiles');
      mkdirSync(auxDir, { recursive: true });
      for (const auxFile of metadata.auxiliaryFiles) {
        const auxPath = path.join(auxDir, auxFile.filename);
        await safeMoveFile(auxFile.path, auxPath);

        // 计算文件哈希
        const fileHash = await this.computeFileHash(auxPath);
        auxiliaryFiles.push({
          name: auxFile.filename,
          size: auxFile.size,
          path: auxPath,
          hash: fileHash,
        });
      }
    }

    // 处理巡检工具文件（放在脚本根目录的 tools/ 下，两种模式共享）
    const toolFiles: ToolFile[] = [];
    if (metadata.toolFiles) {
      log.info(`处理 ${metadata.toolFiles.length} 个巡检工具文件`, traceId);
      const toolsDir = path.join(scriptRootDir, 'tools');
      mkdirSync(toolsDir, { recursive: true });
      for (const toolFile of metadata.toolFiles) {
        const toolPath = path.join(toolsDir, toolFile.filename);
        await safeMoveFile(toolFile.path, toolPath);

        // 计算文件哈希
        const fileHash = await this.computeFileHash(toolPath);
        toolFiles.push({
          name: toolFile.filename,
          size: toolFile.size,
          path: toolPath,
          hash: fileHash,
        });
      }
    }

    // 计算脚本文件哈希
    const scriptHash = await this.computeFileHash(destPath);
    const hashStart = Date.now();
    log.dbOperation('SELECT', 'hash', Date.now() - hashStart, traceId);

    // 处理额外 .py 文件（多文件模式）
    const extraFiles: ExtraFile[] = [];
    if (extraScriptFiles && extraScriptFiles.length > 0) {
      for (const extra of extraScriptFiles) {
        const extraPath = path.join(subDir, extra.filename);
        if (!existsSync(extraPath)) {
          log.warn(`额外脚本文件不存在: ${extraPath}`, traceId);
          continue;
        }
        const fileHash = await this.computeFileHash(extraPath);
        extraFiles.push({
          name: extra.filename,
          size: extra.size,
          path: extraPath,
          hash: fileHash,
        });
      }
    }

    // 创建脚本对象
    const script: Script = {
      id,
      name: metadata.name || file.filename,
      description: metadata.description || '',
      scriptType: metadata.scriptType || 'python',
      region: metadata.region || '全部',
      inputFormats: metadata.inputFormats || '',
      inputFormatManual: metadata.inputFormatManual || false,
      version: metadata.version || '1.0',
      category: metadata.category || 'host',
      fileName: file.filename,
      filePath: destPath,
      fileHash: scriptHash,
      fileSize: file.size,
      templateRequired: metadata.templateRequired || false,
      templateIds: metadata.templateIds || [],
      auxiliaryFiles,
      extraFiles,
      toolFiles,
      requirements: metadata.requirements || [],
      depsStatus: {
        status: 'none',
        log: '',
        packages: [],
      },
      pythonVersion: metadata.pythonVersion || 'embedded',
      isMultiFile: metadata.isMultiFile || false,
      reportNameTemplate: metadata.reportNameTemplate || '',
      uploadedAt: new Date().toISOString(),
      uploadedBy: metadata.uploadedBy || 'unknown',
    };

    // 保存到数据库
    const dbStart = Date.now();
    await scriptRepository.create(script);
    if (extraFiles.length > 0) {
      for (const ef of extraFiles) {
        await scriptRepository.createExtraFile(id, ef);
      }
    }
    log.dbOperation('INSERT', 'scripts', Date.now() - dbStart, traceId, {
      scriptId: id,
      scriptName: script.name,
    });

    log.info(`✓ uploadScript 完成: ${script.name} (${id})`, traceId, {
      auxiliaryFileCount: auxiliaryFiles.length,
      extraFileCount: extraFiles.length,
      toolFileCount: toolFiles.length,
      requirements: metadata.requirements?.length || 0,
    });

    return script;
  }

  /**
   * 更新脚本元数据
   * 
   * @param scriptId - 脚本ID
   * @param data - 要更新的数据
   * @returns 更新后的脚本信息
   * @throws {Error} 如果脚本不存在或数据无效
   */
  async updateScript(
    scriptId: string,
    data: Partial<{
      name: string;
      description: string;
      scriptType: string;
      region: string;
      inputFormats: string;
      inputFormatManual: boolean;
      version: string;
      category: string;
      templateRequired: boolean;
      templateIds: string[];
      requirements: string[];
      pythonVersion: string;
      depsStatus: Script['depsStatus'];
      auxiliaryFiles: AuxiliaryFile[];
      toolFiles: ToolFile[];
      isMultiFile: boolean;
      reportNameTemplate: string;
      extraFiles: ExtraFile[];
      entryName: string;
    }>
  ): Promise<Script> {
    const traceId = generateTraceId();
    log.info(`⇢ updateScript`, traceId, { scriptId, updateFields: Object.keys(data) });

    // 验证输入格式
    if (data.inputFormats) {
      const fmtCheck = this.validateInputFormats(data.inputFormats);
      if (!fmtCheck.valid) {
        log.warn(`输入格式验证失败: ${fmtCheck.error}`, traceId);
        throw new Error(fmtCheck.error);
      }
    }

    const dbStart = Date.now();

    // 检测 Python 版本是否变更，若变更则删除旧虚拟环境并重置依赖状态
    if (data.pythonVersion !== undefined) {
      const oldScript = await scriptRepository.findById(scriptId);
      if (oldScript && oldScript.pythonVersion !== data.pythonVersion) {
        const venvDir = path.join(this.scriptsDir, scriptId, 'venv');
        if (existsSync(venvDir)) {
          await fs.rm(venvDir, { recursive: true, force: true });
          log.info(`Python 版本从 ${oldScript.pythonVersion} 切换到 ${data.pythonVersion}，已删除旧虚拟环境`, traceId, { scriptId, venvDir });
        }
        data.depsStatus = {
          status: 'none',
          log: '',
          packages: [],
        };
      }
    }

    // 检测模式切换 (single ↔ multi)：迁移文件到对应子目录
    if (data.isMultiFile !== undefined) {
      const oldScript = await scriptRepository.findById(scriptId);
      if (oldScript && oldScript.isMultiFile !== data.isMultiFile) {
        await this.migrateScriptMode(scriptId, oldScript, data.isMultiFile, traceId);
        // 迁移后需要重新读取脚本以获取更新后的路径
        const migrated = await scriptRepository.findById(scriptId);
        if (migrated) {
          // 更新 data 中的 filePath/fileName 为迁移后的值
          (data as any).fileName = migrated.fileName;
          (data as any).filePath = migrated.filePath;
          if (data.isMultiFile) {
            // 切换到多文件模式：可能需要重新扫描 extraFiles
            data.extraFiles = migrated.extraFiles;
          }
        }
      }
    }

    // 处理多文件模式下切换主入口到另一个已存在的 .py 文件
    if (data.entryName !== undefined) {
      const oldScript = await scriptRepository.findById(scriptId);
      if (oldScript && oldScript.isMultiFile && data.entryName !== oldScript.fileName) {
        await this.swapEntryFile(scriptId, oldScript, data.entryName, traceId);
      }
      delete (data as any).entryName;
    }

    // 如果 auxiliaryFiles 在更新数据中，说明用户编辑了辅助文件列表（增删）
    // 比对原数据库记录，删除多余的文件（磁盘 + DB 记录）
    if (data.auxiliaryFiles !== undefined) {
      const oldScript = await scriptRepository.findById(scriptId);
      if (oldScript) {
        const newAuxNames = new Set(data.auxiliaryFiles.map((a) => a.name));
        const toDelete = oldScript.auxiliaryFiles.filter((a) => !newAuxNames.has(a.name));
        for (const aux of toDelete) {
          try {
            if (existsSync(aux.path)) {
              await fs.unlink(aux.path);
              log.info(`删除磁盘上的辅助文件: ${aux.path}`, traceId, { scriptId, name: aux.name });
            }
          } catch (e) {
            log.warn(`删除辅助文件失败: ${aux.path}: ${(e as Error).message}`, traceId);
          }
        }
        if (toDelete.length > 0) {
          await scriptRepository.clearAuxiliaryFiles(scriptId);
          for (const keep of data.auxiliaryFiles) {
            await scriptRepository.createAuxiliaryFile(scriptId, keep);
          }
          log.info(`同步辅助文件: 删除 ${toDelete.length} 个，保留 ${data.auxiliaryFiles.length} 个`, traceId);
        }
      }
    }

    // 如果 toolFiles 在更新数据中，说明用户编辑了巡检工具文件列表（增删）
    // 比对原数据库记录，删除多余的文件（磁盘 + DB 记录）
    if (data.toolFiles !== undefined) {
      const oldScript = await scriptRepository.findById(scriptId);
      if (oldScript) {
        const newToolNames = new Set(data.toolFiles.map((t) => t.name));
        const toDeleteTools = oldScript.toolFiles.filter((t) => !newToolNames.has(t.name));
        for (const tool of toDeleteTools) {
          try {
            if (existsSync(tool.path)) {
              await fs.unlink(tool.path);
              log.info(`删除磁盘上的巡检工具文件: ${tool.path}`, traceId, { scriptId, name: tool.name });
            }
          } catch (e) {
            log.warn(`删除巡检工具文件失败: ${tool.path}: ${(e as Error).message}`, traceId);
          }
        }
        if (toDeleteTools.length > 0) {
          await scriptRepository.clearToolFiles(scriptId);
          for (const keep of data.toolFiles) {
            await scriptRepository.createToolFile(scriptId, keep);
          }
          log.info(`同步巡检工具文件: 删除 ${toDeleteTools.length} 个，保留 ${data.toolFiles.length} 个`, traceId);
        }
      }
    }

    // 如果 extraFiles 在更新数据中（多文件模式编辑），同步数据库与磁盘
    if (data.extraFiles !== undefined) {
      const oldScript = await scriptRepository.findById(scriptId);
      if (oldScript) {
        const newNames = new Set(data.extraFiles.map((a) => a.name));
        const toDelete = oldScript.extraFiles.filter((a) => !newNames.has(a.name));

        // 删除多余的文件
        for (const ef of toDelete) {
          try {
            if (existsSync(ef.path)) {
              await fs.unlink(ef.path);
              log.info(`删除磁盘上的额外脚本文件: ${ef.path}`, traceId, { scriptId, name: ef.name });
            }
          } catch (e) {
            log.warn(`删除额外脚本文件失败: ${ef.path}: ${(e as Error).message}`, traceId);
          }
          await scriptRepository.deleteExtraFile(scriptId, ef.name);
        }

        // 更新保留的文件元数据（仅当文件仍存在于磁盘上时）
        for (const keep of data.extraFiles) {
          if (existsSync(keep.path)) {
            const stat = await fs.stat(keep.path);
            const hash = await this.computeFileHash(keep.path);
            await scriptRepository.updateExtraFile(scriptId, keep.name, {
              size: stat.size,
              path: keep.path,
              hash,
            });
          } else {
            log.warn(`保留的额外脚本文件不存在: ${keep.path}`, traceId, { scriptId, name: keep.name });
          }
        }
        log.info(`同步额外脚本文件: 删除 ${toDelete.length} 个，保留 ${data.extraFiles.length} 个`, traceId);
      }
    }

    // 如果 requirements 发生变化，根据虚拟环境实际存在情况重新评估状态
    if (data.requirements !== undefined) {
      const oldScript = await scriptRepository.findById(scriptId);
      if (oldScript) {
        const oldReqs = (oldScript.requirements || []).slice().sort();
        const newReqs = (data.requirements || []).slice().sort();
        const reqsChanged = oldReqs.length !== newReqs.length || oldReqs.some((v, i) => v !== newReqs[i]);
        if (reqsChanged) {
          data.depsStatus = await this.checkEnvironmentStatus(scriptId, data.requirements || []);
          log.info(`requirements 已变更，重置依赖状态为 ${data.depsStatus.status}`, traceId, { scriptId, oldReqs, newReqs });
        }
      }
    }

    // 清理 data 中不能直接传给 repository 的字段
    const dbData = { ...data };
    delete (dbData as any).auxiliaryFiles;
    delete (dbData as any).extraFiles;
    delete (dbData as any).toolFiles;

    const updated = await scriptRepository.update(scriptId, dbData);
    log.dbOperation('UPDATE', 'scripts', Date.now() - dbStart, traceId, { scriptId });

    if (!updated) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    log.info(`✓ updateScript 完成: ${scriptId}`, traceId);
    return updated;
  }

  /**
   * 模式切换时的文件迁移
   * 
   * 将脚本从 single/ ↔ multi/ 子目录之间迁移 .py 文件。
   * 
   * @param scriptId - 脚本ID
   * @param oldScript - 旧脚本信息
   * @param toMulti - 是否切换到多文件模式
   * @param traceId - 追踪ID
   */
  private async migrateScriptMode(
    scriptId: string,
    oldScript: Script,
    toMulti: boolean,
    traceId: string
  ): Promise<void> {
    const oldSubDir = this.getScriptSubDir(scriptId, oldScript.isMultiFile || false);
    const newSubDir = this.getScriptSubDir(scriptId, toMulti);
    
    log.info(`模式切换: ${oldScript.isMultiFile ? 'multi' : 'single'} → ${toMulti ? 'multi' : 'single'}`, traceId, {
      scriptId,
      oldSubDir,
      newSubDir,
    });

    // 确保新子目录存在
    mkdirSync(newSubDir, { recursive: true });

    if (toMulti) {
      // single → multi: 将 single/ 下的 .py 文件移动到 multi/
      if (existsSync(oldSubDir)) {
        const files = await fs.readdir(oldSubDir);
        for (const f of files) {
          const oldPath = path.join(oldSubDir, f);
          const newPath = path.join(newSubDir, f);
          await safeMoveFile(oldPath, newPath);
          log.info(`迁移文件: ${oldPath} → ${newPath}`, traceId);
        }
        // 清空旧目录
        const remaining = await fs.readdir(oldSubDir);
        if (remaining.length === 0) {
          await fs.rmdir(oldSubDir);
        }
      }
      // 更新主文件路径到数据库
      const newMainPath = path.join(newSubDir, oldScript.fileName);
      await scriptRepository.updateFileInfo(scriptId, {
        fileName: oldScript.fileName,
        filePath: newMainPath,
        fileHash: oldScript.fileHash,
        fileSize: oldScript.fileSize,
      });
    } else {
      // multi → single: 
      // 1) 删除 extra_files 表中的所有记录
      // 2) 将主入口文件移动到 single/
      // 3) 清理 multi/ 下其余 .py 文件
      await scriptRepository.clearExtraFiles(scriptId);
      
      if (existsSync(oldSubDir)) {
        // 只移动主入口文件到 single/
        const oldMainPath = path.join(oldSubDir, oldScript.fileName);
        if (existsSync(oldMainPath)) {
          const newPath = path.join(newSubDir, oldScript.fileName);
          await safeMoveFile(oldMainPath, newPath);
          log.info(`迁移主文件: ${oldMainPath} → ${newPath}`, traceId);
        }
        // 删除 multi/ 下剩余的所有文件（用户切换到单文件模式意味着不再需要多文件）
        const remaining = await fs.readdir(oldSubDir);
        for (const f of remaining) {
          if (f !== oldScript.fileName) {
            const filePath = path.join(oldSubDir, f);
            await fs.unlink(filePath);
            log.info(`清理多余文件: ${filePath}`, traceId);
          }
        }
        // 再次检查目录是否为空，是则删除
        const afterClean = await fs.readdir(oldSubDir);
        if (afterClean.length === 0) {
          await fs.rmdir(oldSubDir);
        }
      }
      // 更新主文件路径到数据库
      const newMainPath = path.join(newSubDir, oldScript.fileName);
      await scriptRepository.updateFileInfo(scriptId, {
        fileName: oldScript.fileName,
        filePath: newMainPath,
        fileHash: oldScript.fileHash,
        fileSize: oldScript.fileSize,
      });
    }

    log.info(`模式切换完成: ${scriptId}`, traceId);
  }

  /**
   * 多文件模式下切换主入口文件到另一个已存在的 .py 文件
   * 
   * 仅在数据库层面交换记录，不移动物理文件（所有 .py 都在 multi/ 下）
   */
  private async swapEntryFile(
    scriptId: string,
    oldScript: Script,
    newEntryName: string,
    traceId: string
  ): Promise<void> {
    const newEntryExtra = oldScript.extraFiles.find((e) => e.name === newEntryName);
    if (!newEntryExtra) {
      log.warn(`切换主入口失败: 找不到 ${newEntryName} 在 extra_files 中`, traceId, { scriptId });
      throw new Error(`切换主入口失败: ${newEntryName} 不是当前脚本的额外文件`);
    }

    log.info(`切换主入口: ${oldScript.fileName} → ${newEntryName}`, traceId, { scriptId });

    // 1) 将旧的入口文件加入 extra_files
    await scriptRepository.createExtraFile(scriptId, {
      name: oldScript.fileName,
      size: oldScript.fileSize,
      path: oldScript.filePath,
      hash: oldScript.fileHash,
    });

    // 2) 从 extra_files 删除新的入口文件
    await scriptRepository.deleteExtraFile(scriptId, newEntryName);

    // 3) 更新 scripts 表主入口为新文件
    await scriptRepository.updateFileInfo(scriptId, {
      fileName: newEntryName,
      filePath: newEntryExtra.path,
      fileHash: newEntryExtra.hash,
      fileSize: newEntryExtra.size,
    });

    log.info(`主入口切换完成: ${newEntryName}`, traceId);
  }

  /**
   * 清空多文件模式下的所有脚本文件（.py）
   * 仅删除 multi/ 子目录中的 .py 文件，并重置脚本主文件元数据，不影响单文件模式
   * 
   * @param scriptId - 脚本ID
   * @throws {Error} 如果脚本不存在或不是多文件模式
   */
  async clearScriptFiles(scriptId: string): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ clearScriptFiles`, traceId, { scriptId });

    const script = await scriptRepository.findById(scriptId);
    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    if (!script.isMultiFile) {
      log.warn(`仅支持清空多文件模式的脚本文件: ${scriptId}`, traceId);
      throw new Error('仅支持清空多文件模式的脚本文件');
    }

    // 删除 multi/ 子目录下所有 .py 文件
    const subDir = this.getScriptSubDir(scriptId, true);
    if (existsSync(subDir)) {
      const files = await fs.readdir(subDir);
      for (const file of files) {
        if (file.endsWith('.py')) {
          const filePath = path.join(subDir, file);
          await fs.unlink(filePath);
          log.info(`已删除脚本文件: ${filePath}`, traceId);
        }
      }
      log.info(`多文件脚本目录已清空: ${subDir}`, traceId);
    }

    // 清空 extra_files 表
    const extraStart = Date.now();
    await scriptRepository.clearExtraFiles(scriptId);
    log.dbOperation('DELETE', 'script_extra_files', Date.now() - extraStart, traceId, { scriptId });

    // 重置 scripts 表主文件字段
    await scriptRepository.updateFileInfo(scriptId, {
      fileName: '',
      filePath: '',
      fileHash: '',
      fileSize: 0,
    });

    log.info(`✓ clearScriptFiles 完成: ${scriptId}`, traceId);
  }

  /**
   * 删除脚本
   * 
   * @param scriptId - 脚本ID
   * @throws {Error} 如果脚本不存在
   */
  async deleteScript(scriptId: string): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ deleteScript`, traceId, { scriptId });

    const script = await scriptRepository.findById(scriptId);
    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    // 删除脚本目录
    const scriptDir = path.join(this.scriptsDir, scriptId);
    if (existsSync(scriptDir)) {
      await fs.rm(scriptDir, { recursive: true, force: true });
      log.info(`脚本目录已删除: ${scriptDir}`, traceId);
    }

    const dbStart = Date.now();
    await scriptRepository.delete(scriptId);
    log.dbOperation('DELETE', 'scripts', Date.now() - dbStart, traceId, { scriptId });
    log.info(`✓ deleteScript 完成: ${scriptId}`, traceId);
  }

  /**
   * 获取脚本内容
   * 
   * @param scriptId - 脚本ID
   * @returns 脚本内容信息
   * @throws {Error} 如果脚本不存在或文件不存在
   */
  async getScriptContent(
    scriptId: string
  ): Promise<{ id: string; fileName: string; content: string }> {
    const traceId = generateTraceId();
    log.info(`⇢ getScriptContent`, traceId, { scriptId });

    const script = await scriptRepository.findById(scriptId);

    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    if (!existsSync(script.filePath)) {
      log.error(`脚本文件不存在: ${script.filePath}`, traceId);
      throw new Error('脚本文件不存在');
    }

    const content = await fs.readFile(script.filePath, 'utf-8');
    log.info(`✓ getScriptContent 完成: ${script.fileName} (${content.length} bytes)`, traceId);
    return {
      id: scriptId,
      fileName: script.fileName,
      content,
    };
  }

  /**
   * 更新脚本内容
   * 
   * @param scriptId - 脚本ID
   * @param content - 新内容
   * @returns 更新后的文件信息
   * @throws {Error} 如果脚本不存在或文件不存在
   */
  async updateScriptContent(
    scriptId: string,
    content: string
  ): Promise<{
    id: string;
    fileName: string;
    size: number;
    fileHash: string;
  }> {
    const traceId = generateTraceId();
    log.info(`⇢ updateScriptContent`, traceId, { scriptId, contentLength: content.length });

    const script = await scriptRepository.findById(scriptId);

    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    if (!existsSync(script.filePath)) {
      log.error(`脚本文件不存在: ${script.filePath}`, traceId);
      throw new Error('脚本文件不存在');
    }

    // 写入新内容
    await fs.writeFile(script.filePath, content, 'utf-8');
    log.info(`脚本内容已写入: ${script.filePath}`, traceId);

    // 更新哈希和大小
    const fileHash = await this.computeFileHash(script.filePath);
    const fileSize = (await fs.stat(script.filePath)).size;
    const dbStart = Date.now();
    await scriptRepository.updateContent(scriptId, fileHash, fileSize);
    log.dbOperation('UPDATE', 'scripts', Date.now() - dbStart, traceId, { scriptId });

    log.info(`✓ updateScriptContent 完成: ${script.name} (${scriptId})`, traceId, {
      size: fileSize,
      hash: fileHash.slice(0, 8) + '...',
    });

    return {
      id: scriptId,
      fileName: script.fileName,
      size: fileSize,
      fileHash,
    };
  }

  /**
   * 替换脚本文件
   * 
   * 删除旧脚本文件，将新文件移动到脚本目录，并更新数据库记录。
   * 
   * @param scriptId - 脚本ID
   * @param file - 新脚本文件信息
   * @returns 更新后的脚本信息
   * @throws {Error} 如果脚本不存在或文件名无效
   */
  async replaceScriptFile(
    scriptId: string,
    file: { filename: string; path: string; size: number }
  ): Promise<Script> {
    const traceId = generateTraceId();
    log.info(`⇢ replaceScriptFile`, traceId, { scriptId, newFilename: file.filename });

    const script = await scriptRepository.findById(scriptId);
    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    // 验证新文件名
    const validation = fileManager.validateFileName(file.filename);
    if (!validation) {
      log.warn(`文件名验证失败: ${file.filename}`, traceId);
      throw new Error('文件名无效');
    }

    // 获取正确的模式子目录
    const subDir = this.getScriptSubDir(scriptId, script.isMultiFile || false);
    mkdirSync(subDir, { recursive: true });

    // 删除旧文件（如果存在）
    if (script.filePath && existsSync(script.filePath)) {
      await fs.unlink(script.filePath);
      log.info(`旧文件已删除: ${script.filePath}`, traceId);
    }

    // 移动新文件到对应模式子目录
    const destPath = path.join(subDir, file.filename);
    await safeMoveFile(file.path, destPath);
    log.info(`新文件已移动到: ${destPath}`, traceId);

    // 计算文件哈希
    const fileHash = await this.computeFileHash(destPath);

    // 更新数据库中的文件信息
    const dbStart = Date.now();
    await scriptRepository.updateFileInfo(scriptId, {
      fileName: file.filename,
      filePath: destPath,
      fileHash,
      fileSize: file.size,
    });
    log.dbOperation('UPDATE', 'scripts', Date.now() - dbStart, traceId, {
      scriptId,
      action: 'replaceFile',
    });

    const updated = await scriptRepository.findById(scriptId);

    log.info(`✓ replaceScriptFile 完成: ${scriptId}`, traceId, {
      oldName: script.fileName,
      newName: file.filename,
      size: file.size,
    });

    return updated as Script;
  }

  /**
   * 批量添加辅助文件
   * 
   * @param scriptId - 脚本ID
   * @param auxiliaryFiles - 辅助文件列表
   */
  async addAuxiliaryFiles(
    scriptId: string,
    auxiliaryFiles: Array<{ filename: string; path: string; size: number }>
  ): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ addAuxiliaryFiles`, traceId, { scriptId, count: auxiliaryFiles.length });

    const script = await scriptRepository.findById(scriptId);
    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    const scriptDir = path.join(this.scriptsDir, scriptId);
    const auxDir = path.join(scriptDir, 'auxfiles');
    mkdirSync(auxDir, { recursive: true });

    for (const auxFile of auxiliaryFiles) {
      const auxPath = path.join(auxDir, auxFile.filename);
      await safeMoveFile(auxFile.path, auxPath);
      const fileHash = await this.computeFileHash(auxPath);
      await scriptRepository.createAuxiliaryFile(scriptId, {
        name: auxFile.filename,
        size: auxFile.size,
        path: auxPath,
        hash: fileHash,
      });
    }

    log.info(`✓ addAuxiliaryFiles 完成: ${scriptId}, 添加 ${auxiliaryFiles.length} 个辅助文件`, traceId);
  }

  /**
   * 批量添加巡检工具文件
   * 将新上传的工具文件移到脚本根目录的 tools/ 下，并写入 script_tool_files 表
   *
   * @param scriptId - 脚本ID
   * @param toolFiles - 巡检工具文件列表
   */
  async addToolFiles(
    scriptId: string,
    toolFiles: Array<{ filename: string; path: string; size: number }>
  ): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ addToolFiles`, traceId, { scriptId, count: toolFiles.length });

    const script = await scriptRepository.findById(scriptId);
    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    const scriptDir = path.join(this.scriptsDir, scriptId);
    const toolsDir = path.join(scriptDir, 'tools');
    mkdirSync(toolsDir, { recursive: true });

    for (const toolFile of toolFiles) {
      const toolPath = path.join(toolsDir, toolFile.filename);
      await safeMoveFile(toolFile.path, toolPath);
      const fileHash = await this.computeFileHash(toolPath);
      await scriptRepository.createToolFile(scriptId, {
        name: toolFile.filename,
        size: toolFile.size,
        path: toolPath,
        hash: fileHash,
      });
    }

    log.info(`✓ addToolFiles 完成: ${scriptId}, 添加 ${toolFiles.length} 个巡检工具文件`, traceId);
  }

  /**
   * 批量添加额外脚本文件（多文件模式）
   * 将新上传的 .py 文件移到脚本目录，并写入 script_extra_files 表
   *
   * @param scriptId - 脚本ID
   * @param extraFiles - 额外 .py 文件列表
   */
  async addExtraScriptFiles(
    scriptId: string,
    extraFiles: Array<{ filename: string; path: string; size: number }>
  ): Promise<void> {
    const traceId = generateTraceId();
    log.info(`⇢ addExtraScriptFiles`, traceId, { scriptId, count: extraFiles.length });

    const script = await scriptRepository.findById(scriptId);
    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    // 额外脚本文件放入 multi/ 子目录
    const subDir = this.getScriptSubDir(scriptId, true);
    mkdirSync(subDir, { recursive: true });

    for (const extra of extraFiles) {
      const destPath = path.join(subDir, extra.filename);
      await safeMoveFile(extra.path, destPath);
      const fileHash = await this.computeFileHash(destPath);
      const stat = await fs.stat(destPath);
      await scriptRepository.createExtraFile(scriptId, {
        name: extra.filename,
        size: stat.size,
        path: destPath,
        hash: fileHash,
      });
    }

    log.info(`✓ addExtraScriptFiles 完成: ${scriptId}, 添加 ${extraFiles.length} 个额外脚本文件`, traceId);
  }

  /**
   * 安装脚本依赖
   * 
   * @param scriptId - 脚本ID
   * @param onLog - 日志回调函数
   * @returns 安装结果
   * @throws {Error} 如果脚本不存在或没有配置依赖
   */
  async installDependencies(
    scriptId: string,
    onLog?: (message: string) => void
  ): Promise<{ success: boolean; log: string }> {
    const traceId = generateTraceId();
    log.info(`⇢ installDependencies`, traceId, { scriptId });

    const script = await scriptRepository.findById(scriptId);

    if (!script) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    const requirements = script.requirements || [];
    if (requirements.length === 0) {
      log.warn(`脚本没有配置依赖: ${scriptId}`, traceId);
      throw new Error('该脚本没有配置依赖');
    }

    log.info(`开始安装依赖: ${requirements.join(', ')}`, traceId, {
      packageCount: requirements.length,
      packages: requirements,
    });

    const logMessages: string[] = [];
    const addLog = (msg: string) => {
      logMessages.push(msg);
      onLog?.(msg);
    };

    try {
      // 更新状态为安装中
      await scriptRepository.update(scriptId, {
        depsStatus: {
          status: 'installing',
          log: '',
          packages: requirements,
        },
      });
      log.info(`依赖状态已更新为: installing`, traceId);

      addLog('========================================');
      addLog('[依赖安装] 开始为脚本创建专用虚拟环境...');

      // 获取Python路径
      const venvPythonResult = await this.resolvePythonPath(scriptId);
      if (!venvPythonResult) {
        addLog('[依赖安装] ❌ 无法获取Python路径');
        log.error(`无法获取Python路径`, traceId);
        throw new Error('无法获取Python路径');
      }
      const [venvPythonExe, venvPythonArgs] = venvPythonResult;
      log.info(`Python路径: ${venvPythonExe}`, traceId);

      // 创建虚拟环境
      const venvDir = path.join(this.scriptsDir, scriptId, 'venv');
      if (!existsSync(path.join(venvDir, 'Scripts', 'python.exe'))) {
        addLog('[venv] 正在创建专用虚拟环境...');
        const venvStart = Date.now();
        await this.createVirtualEnvironment(venvDir, addLog, scriptId);
        log.info(`虚拟环境创建完成 (${Date.now() - venvStart}ms)`, traceId);
      } else {
        addLog('[venv] 虚拟环境已存在，跳过创建');
        log.info(`虚拟环境已存在，跳过创建`, traceId);
      }

      addLog('');
      addLog(`[依赖安装] 需要安装 ${requirements.length} 个包: ${requirements.join(', ')}`);

      // 安全校验：包名（不含版本限定符/ extras）必须符合 PyPI 命名规范
      const PIP_PACKAGE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
      for (const req of requirements) {
        const pkgName = req.match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)/)?.[1] || '';
        if (!PIP_PACKAGE_REGEX.test(pkgName)) {
          throw new Error(`无效的依赖包名: ${req}`);
        }
      }

      addLog('[依赖安装] 开始安装...');

      // 安装依赖
      const pipPath = path.join(venvDir, 'Scripts', 'pip.exe');
      const pipCmd = existsSync(pipPath) ? pipPath : venvPythonExe;
      const pipExe = pipCmd.endsWith('.exe') && pipCmd !== venvPythonExe ? pipCmd : venvPythonExe;
      const pipIndexUrl = getPipIndexUrl();
      const installArgs = pipCmd.endsWith('.exe') && pipCmd !== venvPythonExe
        ? ['install', '--progress-bar', 'off', '--index-url', pipIndexUrl, ...requirements]
        : [...venvPythonArgs, '-m', 'pip', 'install', '--progress-bar', 'off', '--index-url', pipIndexUrl, ...requirements];

      // 简化日志处理：去掉 ANSI 序列后按行输出，每行都实时推送给前端
      const handlePipData = (d: Buffer) => {
        const text = d.toString('utf-8');
        // 去掉 ANSI 转义序列
        const cleaned = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b[\[\(][0-9;]*[a-zA-Z]/g, '');
        // 按行分割，过滤空行
        const lines = cleaned.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            addLog(`[pip] ${trimmed}`);
          }
        }
      };

      const pipStartTime = Date.now();
      const result = await new Promise<{ code: number; failedPkgs: string[] }>((resolve, reject) => {
        const p = spawn(pipExe, installArgs, { 
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        p.stdout.on('data', handlePipData);
        p.stderr.on('data', handlePipData);
        p.on('close', (code) => {
          resolve({ code: code ?? 1, failedPkgs: [] });
        });
        p.on('error', (e) => {
          reject(e);
        });
      });
      const pipDuration = Date.now() - pipStartTime;

      if (result.code === 0) {
        addLog('');
        addLog('[依赖安装] ✅ 所有依赖安装成功！');
        
        await scriptRepository.update(scriptId, {
          depsStatus: {
            status: 'done',
            log: logMessages.join('\n'),
            packages: requirements,
          },
        });
        
        log.info(`✓ installDependencies 成功 (${pipDuration}ms)`, traceId, {
          packages: requirements,
          duration: pipDuration,
        });
        
        return { success: true, log: logMessages.join('\n') };
      } else {
        addLog('');
        addLog('[依赖安装] ❌ 部分依赖安装失败');
        
        await scriptRepository.update(scriptId, {
          depsStatus: {
            status: 'failed',
            log: logMessages.join('\n'),
            packages: requirements,
            error: '部分依赖安装失败',
          },
        });
        
        log.warn(`部分依赖安装失败 (exit code: ${result.code}, ${pipDuration}ms)`, traceId, {
          exitCode: result.code,
          duration: pipDuration,
        });
        
        return { success: false, log: logMessages.join('\n') };
      }
    } catch (error: any) {
      addLog(`[依赖安装] ❌ 安装过程中出错: ${error.message}`);
      
      await scriptRepository.update(scriptId, {
        depsStatus: {
          status: 'failed',
          log: logMessages.join('\n'),
          packages: requirements,
          error: error.message,
        },
      });
      
      log.error(`installDependencies 异常: ${error.message}`, traceId, {
        error: error.message,
        stack: error.stack,
      });
      
      throw error;
    }
  }

  /**
   * 计算文件哈希值
   * 
   * @param filePath - 文件路径
   * @returns SHA-256哈希值
   */
  private async computeFileHash(filePath: string): Promise<string> {
    try {
      const buf = await fs.readFile(filePath);
      return createHash('sha256').update(buf).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * 验证输入格式
   * 
   * @param inputFormats - 输入格式字符串
   * @returns 验证结果
   */
  private validateInputFormats(inputFormats: string): {
    valid: boolean;
    error?: string;
  } {
    // 简单验证，可以根据需要扩展
    if (inputFormats.length > 1000) {
      return { valid: false, error: '输入格式字符串过长' };
    }
    return { valid: true };
  }

  /**
   * 解析Python路径
   * 
   * @param scriptId - 脚本ID
   * @returns Python路径或null
   */
  private async resolvePythonPath(scriptId: string): Promise<[string, string[]] | null> {
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

    // 最后查找系统 Python（支持 python / python3 / py 启动器）
    return this.findSystemPython();
  }

  /**
   * 检查 Python 是否可用 venv 模块
   */
  private async checkVenvAvailable(pythonExe: string, pythonArgs: string[] = []): Promise<boolean> {
    try {
      execSync(`${pythonExe} ${pythonArgs.join(' ')} -c "import venv"`.trim(), { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 查找系统中可用的 Python 可执行文件
   * 按优先级尝试：内嵌 Python → py 启动器 → python3 → python
   */
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

    // 2. 全部失败，记录警告并回退
    log.warn('未找到可用的 Python 环境，请运行 setup-embedded-python.ps1 配置内嵌 Python');
    return ['python', []];
  }

  /**
   * 创建虚拟环境
   * 
   * @param venvDir - 虚拟环境目录
   * @param onLog - 日志回调函数
   * @param scriptId - 脚本ID（用于查找指定的 Python 版本）
   */
  private async createVirtualEnvironment(
    venvDir: string,
    onLog?: (message: string) => void,
    scriptId?: string
  ): Promise<void> {
    // 查找可用的 Python（内嵌 > 系统）
    let systemPython: [string, string[]];
    
    // 如果指定了脚本，检查是否指定了特定的 Python 版本
    if (scriptId) {
      const script = await scriptRepository.findById(scriptId);
      if (script && script.pythonVersion && script.pythonVersion !== 'embedded') {
        // 使用指定版本的 Python
        const pythonVersionService = (await import('./pythonVersionService')).pythonVersionService;
        const pythonExe = pythonVersionService.getPythonExecutable(script.pythonVersion);
        
        if (pythonExe) {
          log.info(`使用脚本指定的 Python 版本: ${script.pythonVersion}`, '-', { scriptId });
          onLog?.(`[venv] 使用指定 Python 版本: ${script.pythonVersion}`);
          systemPython = [pythonExe, []];
        } else {
          log.warn(`脚本指定的 Python 版本 ${script.pythonVersion} 未安装，回退到默认版本`, '-', { scriptId });
          onLog?.(`[venv] 警告: 指定的 Python 版本 ${script.pythonVersion} 未安装，使用默认版本`);
          systemPython = this.findDefaultPython();
        }
      } else {
        systemPython = this.findDefaultPython();
      }
    } else {
      systemPython = this.findDefaultPython();
    }

    const [venvPyExe, venvPyArgs] = systemPython;

    // 检查是否可以使用 venv 模块
    const canUseVenv = await this.checkVenvAvailable(venvPyExe);
    
    // 选择创建命令：优先使用 venv，如果不可用则使用 virtualenv
    const args = canUseVenv 
      ? [...venvPyArgs, '-m', 'venv', venvDir]
      : [...venvPyArgs, '-m', 'virtualenv', venvDir];
    
    onLog?.(`[venv] 使用 ${canUseVenv ? 'venv' : 'virtualenv'} 创建虚拟环境...`);
    
    return new Promise((resolve, reject) => {
      const p = spawn(venvPyExe, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      let out = '';
      let lastLine = '';
      
      const processOutput = (data: Buffer, prefix: string) => {
        const t = data.toString('utf-8');
        out += t;
        
        // 处理回车符（进度条更新）和换行符
        for (let i = 0; i < t.length; i++) {
          const char = t[i];
          if (char === '\r') {
            // 回车：替换当前行（进度条更新）
            lastLine = '';
          } else if (char === '\n') {
            // 换行：输出当前行
            if (lastLine.trim()) {
              onLog?.(`${prefix} ${lastLine.trim()}`);
            }
            lastLine = '';
          } else {
            lastLine += char;
          }
        }
      };
      
      p.stdout.on('data', (d) => processOutput(d, '[venv]'));
      p.stderr.on('data', (d) => processOutput(d, '[venv]'));
      p.on('close', (code) => {
        if (code === 0 && existsSync(path.join(venvDir, 'Scripts', 'python.exe'))) {
          onLog?.('[venv] 虚拟环境创建成功！');
          resolve();
        } else {
          onLog?.(`[venv] 虚拟环境创建失败 (退出码: ${code})`);
          onLog?.('[venv] 输出: ' + out.slice(-500));
          reject(new Error(`虚拟环境创建失败，退出码: ${code}`));
        }
      });
      p.on('error', (e) => {
        onLog?.(`[venv] 创建虚拟环境出错: ${e.message}`);
        reject(e);
      });
    });
  }

  /**
   * 检查脚本虚拟环境及依赖的实际状态
   * 
   * @param scriptId - 脚本ID
   * @param requirements - 当前依赖列表
   * @returns 标准化后的 depsStatus 对象
   */
  private async checkEnvironmentStatus(scriptId: string, requirements: string[]): Promise<Script['depsStatus']> {
    const venvPython = path.join(this.scriptsDir, scriptId, 'venv', 'Scripts', 'python.exe');
    const venvExists = existsSync(venvPython);

    if (!venvExists) {
      return { status: 'none', log: '', packages: [] };
    }

    if (requirements.length === 0) {
      return { status: 'done', log: '', packages: [] };
    }

    return { status: 'env_ready', log: '', packages: [] };
  }

  /**
   * 查找默认 Python（内嵌 > 系统）
   */
  private findDefaultPython(): [string, string[]] {
    if (existsSync(EMBEDDED_PYTHON)) {
      return [EMBEDDED_PYTHON, []];
    } else {
      return this.findSystemPython();
    }
  }
}

/**
 * 脚本服务单例实例
 */
export const scriptService = new ScriptService();