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
import { SCRIPTS_DIR, VENV_PYTHON, EMBEDDED_PYTHON } from '../config';

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
  /** 依赖包列表 */
  requirements: string[];
  /** 依赖状态 */
  depsStatus: {
    status: 'none' | 'installing' | 'done' | 'failed';
    log: string;
    packages: string[];
    error?: string;
  };
  /** 上传时间 */
  uploadedAt: string;
  /** 上传者 */
  uploadedBy: string;
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
 * 脚本服务类
 * 
 * 提供脚本相关的所有业务逻辑操作
 */
export class ScriptService {
  private readonly scriptsDir: string;
  private readonly venvPython: string;
  private cachedPython: string | null = null;

  /**
   * 创建脚本服务实例
   */
  constructor() {
    this.scriptsDir = SCRIPTS_DIR;
    this.venvPython = VENV_PYTHON;

    // 确保脚本目录存在
    if (!existsSync(this.scriptsDir)) {
      mkdirSync(this.scriptsDir, { recursive: true });
    }
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

    // 去重辅助文件
    const result = scripts.map((script: Script) => {
      if (script.auxiliaryFiles && script.auxiliaryFiles.length > 0) {
        const seen = new Set<string>();
        script.auxiliaryFiles = script.auxiliaryFiles.filter((af) => {
          if (seen.has(af.name)) return false;
          seen.add(af.name);
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

    log.info(`✓ getScript 完成: ${scriptId}`, traceId);
    return script;
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
      auxiliaryFiles?: Array<{
        filename: string;
        path: string;
        size: number;
      }>;
    }
  ): Promise<Script> {
    const traceId = generateTraceId();
    log.info(`⇢ uploadScript 调用开始`, traceId, {
      filename: file.filename,
      size: file.size,
      scriptType: metadata.scriptType,
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
    const scriptDir = path.join(this.scriptsDir, id);
    mkdirSync(scriptDir, { recursive: true });

    // 移动脚本文件
    const destPath = path.join(scriptDir, file.filename);
    await safeMoveFile(file.path, destPath);
    log.info(`脚本文件已移动到: ${destPath}`, traceId);

    // 处理辅助文件
    const auxiliaryFiles: AuxiliaryFile[] = [];
    if (metadata.auxiliaryFiles) {
      log.info(`处理 ${metadata.auxiliaryFiles.length} 个辅助文件`, traceId);
      for (const auxFile of metadata.auxiliaryFiles) {
        const auxDir = path.join(scriptDir, 'aux');
        mkdirSync(auxDir, { recursive: true });

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

    // 计算脚本文件哈希
    const scriptHash = await this.computeFileHash(destPath);
    const hashStart = Date.now();
    log.dbOperation('SELECT', 'hash', Date.now() - hashStart, traceId);

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
      requirements: metadata.requirements || [],
      depsStatus: {
        status: 'none',
        log: '',
        packages: [],
      },
      uploadedAt: new Date().toISOString(),
      uploadedBy: metadata.uploadedBy || 'unknown',
    };

    // 保存到数据库
    const dbStart = Date.now();
    await scriptRepository.create(script);
    log.dbOperation('INSERT', 'scripts', Date.now() - dbStart, traceId, {
      scriptId: id,
      scriptName: script.name,
    });

    log.info(`✓ uploadScript 完成: ${script.name} (${id})`, traceId, {
      auxiliaryFileCount: auxiliaryFiles.length,
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
    const updated = await scriptRepository.update(scriptId, data);
    log.dbOperation('UPDATE', 'scripts', Date.now() - dbStart, traceId, { scriptId });

    if (!updated) {
      log.warn(`脚本不存在: ${scriptId}`, traceId);
      throw new Error('脚本不存在');
    }

    log.info(`✓ updateScript 完成: ${scriptId}`, traceId);
    return updated;
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

    const scriptDir = path.dirname(script.filePath);

    // 删除旧文件（如果文件名不同才需要删）
    if (existsSync(script.filePath)) {
      await fs.unlink(script.filePath);
      log.info(`旧文件已删除: ${script.filePath}`, traceId);
    }

    // 移动新文件到脚本目录
    const destPath = path.join(scriptDir, file.filename);
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
    const auxDir = path.join(scriptDir, 'aux');
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
        await this.createVirtualEnvironment(venvDir, addLog);
        log.info(`虚拟环境创建完成 (${Date.now() - venvStart}ms)`, traceId);
      } else {
        addLog('[venv] 虚拟环境已存在，跳过创建');
        log.info(`虚拟环境已存在，跳过创建`, traceId);
      }

      addLog('');
      addLog(`[依赖安装] 需要安装 ${requirements.length} 个包: ${requirements.join(', ')}`);
      addLog('[依赖安装] 开始安装...');

      // 安装依赖
      const pipPath = path.join(venvDir, 'Scripts', 'pip.exe');
      const pipCmd = existsSync(pipPath) ? pipPath : venvPythonExe;
      const pipExe = pipCmd.endsWith('.exe') && pipCmd !== venvPythonExe ? pipCmd : venvPythonExe;
      const installArgs = pipCmd.endsWith('.exe') && pipCmd !== venvPythonExe
        ? ['install', ...requirements]
        : [...venvPythonArgs, '-m', 'pip', 'install', ...requirements];

      let pipLastLine = '';
      let inAnsiSeq = false;
      const handlePipData = (d: Buffer) => {
        const t = d.toString('utf-8');
        for (let i = 0; i < t.length; i++) {
          const char = t[i];
          if (char === '\x1b') {
            inAnsiSeq = true;
            continue;
          }
          if (inAnsiSeq) {
            if (/[a-zA-Z]/.test(char)) {
              inAnsiSeq = false;
            }
            continue;
          }
          if (char === '\r') {
            pipLastLine = '';
          } else if (char === '\n') {
            if (pipLastLine.trim()) {
              addLog(`[pip] ${pipLastLine.trim()}`);
            }
            pipLastLine = '';
          } else {
            pipLastLine += char;
          }
        }
      };
      const flushPipBuf = () => {
        if (pipLastLine.trim()) {
          addLog(`[pip] ${pipLastLine.trim()}`);
          pipLastLine = '';
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
          flushPipBuf();
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

    // 其次使用全局虚拟环境
    if (existsSync(this.venvPython)) {
      return [this.venvPython, []];
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
   */
  private async createVirtualEnvironment(
    venvDir: string,
    onLog?: (message: string) => void
  ): Promise<void> {
    // 查找可用的 Python（内嵌 > 全局 venv > 系统）
    let systemPython: [string, string[]];
    if (existsSync(EMBEDDED_PYTHON)) {
      systemPython = [EMBEDDED_PYTHON, []];
    } else if (existsSync(this.venvPython)) {
      systemPython = [this.venvPython, []];
    } else {
      systemPython = this.findSystemPython();
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
}

/**
 * 脚本服务单例实例
 */
export const scriptService = new ScriptService();