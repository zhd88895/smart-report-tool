/**
 * 文件文本提取 / CLI 转换工具
 *
 * 纯文本文件用编码自动探测（UTF-8 / UTF-16 / GBK）读取；
 * xlsx / zip / tar 等非纯文本文件通过嵌入式 Python CLI 脚本转换为文本。
 *
 * 供 routes/ai.ts（同步分析）与 services/analysisTaskService.ts
 * （队列化分析）共用。
 *
 * @module utils/fileTextConvert
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import path from 'path';
import { getLogger } from './logger';
import { decodeTextBuffer } from './textEncoding';

const log = getLogger('FileTextConvert', 'core');

/** Promise 化的 execFile */
const execFileAsync = promisify(execFile);

/** 读取文件内容，自动探测编码（UTF-8 / UTF-16 / GBK，详见 utils/textEncoding） */
export async function readFileContent(buffer: Buffer): Promise<string> {
  return decodeTextBuffer(buffer);
}

/** 需要 CLI 转换的非纯文本文件扩展名 */
const CONVERTIBLE_EXTS = new Set(['.xlsx', '.xls', '.zip', '.tar', '.gz', '.tgz']);

/** 确定文件是否需要 CLI 转换 */
export function needsConversion(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (CONVERTIBLE_EXTS.has(ext)) return true;
  // .tar.gz / .tgz 等复合扩展名
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar.bz2') || lower.endsWith('.tar.xz')) return true;
  return false;
}

/** 读取文件内容：纯文本用编码检测，非纯文本通过 CLI 工具转换 */
export async function readAndConvertFile(buffer: Buffer, filename: string): Promise<string> {
  if (needsConversion(filename)) {
    return convertWithCLI(buffer, filename);
  }
  return readFileContent(buffer);
}

/**
 * 通过 Python CLI 脚本将非纯文本文件转换为文本
 *
 * 修复要点：
 * 1. 使用 promisify(execFile) 真正等待 Python 进程结束
 * 2. 读取输出文件前检查文件是否存在
 * 3. 捕获 stderr 用于调试
 * 4. 校验文件大小和扩展名
 * 5. 无论成功失败都清理临时文件
 */
export async function convertWithCLI(buffer: Buffer, filename: string): Promise<string> {
  const lowerName = filename.toLowerCase();
  const ext = path.extname(filename).toLowerCase();

  // 1. 输入校验
  if (!buffer || buffer.length === 0) {
    return '[文件转换失败] 文件内容为空。';
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return '[文件转换失败] 文件大小超过 10MB 限制。';
  }
  if (!needsConversion(filename)) {
    return `[文件转换失败] 不支持的文件格式: ${ext || '未知'}。`;
  }

  // 2. 准备临时目录（使用项目 data/temp 避免系统临时目录权限问题）
  const tmpDir = path.resolve(process.cwd(), 'data', 'temp', 'file-convert');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  // 使用安全的临时文件名（避免原始文件名中的特殊字符）
  const jobId = randomUUID();
  const safeInputName = `${jobId}_input${ext}`;
  const safeOutputName = `${jobId}_output.txt`;
  const tmpInput = path.join(tmpDir, safeInputName);
  const tmpOutput = path.join(tmpDir, safeOutputName);

  log.info(`CLI 转换开始: ${filename}, 大小: ${(buffer.length / 1024).toFixed(1)} KB, 任务ID: ${jobId}`);

  try {
    // 3. 写入临时输入文件
    await writeFile(tmpInput, buffer);
    log.debug(`临时输入文件已写入: ${tmpInput}`);

    // 4. 找到嵌入式 Python
    const pythonPath = findEmbeddedPython();
    if (!pythonPath) {
      return `[文件转换失败] 未找到可用的 Python 环境，无法解析 ${ext} 文件。

原始文件类型: ${ext}
文件大小: ${(buffer.length / 1024).toFixed(1)} KB

请尝试将文件导出为 .txt / .csv / .log 等纯文本格式后再上传。`;
    }

    // 5. 找到转换脚本
    const scriptPath = findConverterScript();
    if (!scriptPath) {
      return `[文件转换失败] 未找到文件转换脚本。请检查 scripts/file_converter.py 是否存在。`;
    }

    // 6. 执行转换（真正等待子进程结束）
    const { stdout, stderr } = await execFileAsync(pythonPath, [scriptPath, tmpInput, tmpOutput], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });

    if (stderr) {
      log.warn(`CLI 转换 stderr: ${filename}: ${stderr.slice(0, 500)}`);
    }

    // 7. 检查输出文件是否存在
    if (!existsSync(tmpOutput)) {
      log.error(`CLI 转换后输出文件不存在: ${tmpOutput}`);
      return `[文件转换失败] Python 转换后未生成输出文件。

文件类型: ${ext}
可能原因: 转换脚本异常或输出路径不可写

建议：请将文件导出为 .txt / .csv / .log 等纯文本格式后再上传。`;
    }

    // 8. 读取输出
    const output = await readFile(tmpOutput, 'utf-8');

    if (!output || output.trim().length === 0) {
      return `[文件转换完成] 文件已转换，但内容为空。

文件类型: ${ext}
可能原因: Excel 工作表为空，或压缩包中无文本文件。`;
    }

    const preview = output.slice(0, 300).replace(/\s+/g, ' ');
    log.info(`CLI 转换完成: ${filename} (${(buffer.length / 1024).toFixed(1)} KB → ${(output.length / 1024).toFixed(1)} KB 文本) 任务ID: ${jobId}\n预览: ${preview}...`);

    return output;
  } catch (err: any) {
    log.warn(`CLI 转换失败: ${filename}: ${err.message || err}`);
    if (err.stderr) {
      log.warn(`CLI 转换失败 stderr: ${err.stderr.slice(0, 500)}`);
    }

    // 区分错误类型，给出更友好的提示
    let reason = err.message || '未知错误';
    if (err.killed && err.signal === 'SIGTERM') {
      reason = '转换超时（超过 30 秒）';
    } else if (err.code === 'ENOENT') {
      reason = '转换输出文件未生成（Python 进程可能异常退出）';
    }

    return `[文件转换失败] 无法解析 "${filename}"。

文件类型: ${ext}
原因: ${reason}

建议：请将文件导出为 .txt / .csv / .log 等纯文本格式后再上传。`;
  } finally {
    // 9. 清理临时文件（静默忽略错误）
    try { await unlink(tmpInput); } catch { /* ignore */ }
    try { await unlink(tmpOutput); } catch { /* ignore */ }
  }
}

/** 查找嵌入式 Python 解释器路径 */
function findEmbeddedPython(): string | null {
  // 项目内置 embedded Python
  const candidates = [
    path.resolve(process.cwd(), 'data', 'python-embedded', 'python.exe'),
    path.resolve(process.cwd(), 'data', 'python-embedded', 'python'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // 降级：尝试系统 Python
  try {
    const result = execSync('python3 --version 2>nul || python --version 2>nul || py -3 --version 2>nul', { timeout: 3000 });
    if (result) return 'python';
  } catch {}
  return null;
}

/** 查找文件转换脚本路径 */
function findConverterScript(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'scripts', 'file_converter.py'),
    path.resolve(__dirname, '..', '..', 'scripts', 'file_converter.py'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
