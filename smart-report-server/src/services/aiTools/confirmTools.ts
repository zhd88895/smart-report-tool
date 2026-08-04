/**
 * AI 需确认工具实现模块（write_script / run_script）
 *
 * 安全底线：这两个工具被模型调用时【绝不直接执行业务动作】，
 * 只在 pending_tool_calls 表落一条 status='pending' 的记录并返回
 * { ok: true, pending: true, pendingId, argsSummary }，由前端渲染确认卡片，
 * 用户点击确认后走 POST /api/ai/tools/confirm 才真正执行。
 *
 * 确认执行复用既有业务链路，不另起路径：
 * - write_script：新建 → scriptService.uploadScript（临时文件方式）；
 *                 修改 → scriptService.updateScriptContent（先写源码）+ updateScript（后改元数据）
 * - run_script：reportService.startBackgroundGeneration（既有报告生成链路）
 *
 * @module services/aiTools/confirmTools
 */

import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, unlink, stat, readdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import { scriptService } from '../scriptService';
import { reportService } from '../reportService';
import { aiToolConfirmRepository } from '../../db/repositories/aiToolConfirmRepository';
import { DATA_DIR, UPLOADS_DIR, LOGS_DIR } from '../../config';
import { getLogger } from '../../utils/logger';
import type { ToolResult } from './registry';

const log = getLogger('AIConfirmTools', 'core');

/** main.py 内容上限（与 read_script 截断量级保持一致防御） */
const MAX_MAIN_PY_CHARS = 100000;

/** 从未知 args 中安全取字符串参数 */
function argString(args: unknown, key: string): string | undefined {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 从未知 args 中安全取字符串数组参数 */
function argStringArray(args: unknown, key: string): string[] | undefined {
  const v = (args as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is string => typeof x === 'string' && !!x.trim());
  return list.length ? list : undefined;
}

/** 生成给人看的参数摘要（确认卡片展示用，不含完整源码） */
function summarizeArgs(tool: string, args: Record<string, unknown>): string {
  if (tool === 'write_script') {
    const name = typeof args.name === 'string' ? args.name : '（未命名）';
    const isUpdate = typeof args.scriptId === 'string' && !!args.scriptId;
    const chars = typeof args.mainPy === 'string' ? args.mainPy.length : 0;
    return `${isUpdate ? '修改' : '新建'}脚本「${name}」（main.py 约 ${chars} 字符）`;
  }
  if (tool === 'run_script') {
    const scriptId = typeof args.scriptId === 'string' ? args.scriptId : '（未指定）';
    const logFile = typeof args.logFileName === 'string' ? args.logFileName : '（无输入文件）';
    return `执行脚本 ${scriptId}（输入: ${logFile}）`;
  }
  return JSON.stringify(args).slice(0, 200);
}

/**
 * 创建待确认记录（write_script / run_script 共用的 pending 入口）。
 * 只落库，不执行任何业务动作。
 */
async function createPending(
  userId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const argsSummary = summarizeArgs(tool, args);
  const record = await aiToolConfirmRepository.create({ userId, tool, args });
  log.info(`⇢ tool ${tool} 创建待确认记录 pendingId=${record.id} userId=${userId} ${argsSummary}`);
  return {
    ok: true,
    summary: `已准备${argsSummary}，等待用户确认后执行`,
    pending: true,
    pendingId: record.id,
    tool,
    argsSummary,
  };
}

/**
 * write_script（pending 入口）：新建或修改脚本（含 main.py 内容）。
 * 参数校验在这里做（尽早失败），业务动作留到确认后。
 */
export async function writeScriptTool(userId: string, args: unknown): Promise<ToolResult> {
  const name = argString(args, 'name');
  const mainPy = argString(args, 'mainPy');
  const scriptId = argString(args, 'scriptId');

  if (!name) return { ok: false, summary: '缺少必需参数 name' };
  if (!mainPy) return { ok: false, summary: '缺少必需参数 mainPy（脚本源码内容）' };
  if (mainPy.length > MAX_MAIN_PY_CHARS) {
    return { ok: false, summary: `mainPy 内容过长（${mainPy.length} 字符，上限 ${MAX_MAIN_PY_CHARS}）` };
  }

  // 修改场景先验证脚本存在，避免创建一条注定失败的 pending 记录
  if (scriptId) {
    try {
      await scriptService.getScript(scriptId);
    } catch {
      return { ok: false, summary: `要修改的脚本不存在: ${scriptId}` };
    }
  }

  return createPending(userId, 'write_script', {
    scriptId,
    name,
    category: argString(args, 'category'),
    description: argString(args, 'description'),
    requirements: argStringArray(args, 'requirements'),
    mainPy,
  });
}

/**
 * run_script（pending 入口）：对指定日志文件执行脚本生成报告。
 * 同样只落 pending 记录，确认后才触发报告生成链路。
 */
export async function runScriptTool(userId: string, args: unknown): Promise<ToolResult> {
  const scriptId = argString(args, 'scriptId');
  if (!scriptId) return { ok: false, summary: '缺少必需参数 scriptId' };

  try {
    await scriptService.getScript(scriptId);
  } catch {
    return { ok: false, summary: `脚本不存在: ${scriptId}` };
  }

  return createPending(userId, 'run_script', {
    scriptId,
    logFileName: argString(args, 'logFileName'),
    templateId: argString(args, 'templateId'),
    outputFormat: argString(args, 'outputFormat'),
  });
}

// ═══════════════════════════════════════════════════════
//  确认后的真正执行（仅供 routes/ai.ts confirm 端点调用）
// ═══════════════════════════════════════════════════════

/** 确认执行结果（confirm 端点透传给前端） */
export interface ConfirmExecResult {
  summary: string;
  data?: unknown;
}

/**
 * 执行 write_script：新建走 uploadScript（临时文件方式复用完整校验与落库），
 * 修改走 updateScriptContent（源码）+ updateScript（元数据）——先写源码成功后
 * 再改元数据，源码失败时元数据未被改动，避免「新元数据+旧源码」不一致。
 */
export async function executeWriteScript(
  userId: string,
  args: Record<string, unknown>
): Promise<ConfirmExecResult> {
  const name = argString(args, 'name');
  const mainPy = argString(args, 'mainPy');
  const scriptId = argString(args, 'scriptId');
  if (!name || !mainPy) throw new Error('待确认参数不完整（缺少 name/mainPy）');
  if (mainPy.length > MAX_MAIN_PY_CHARS) throw new Error('mainPy 内容超过长度上限');

  if (scriptId) {
    // ── 修改既有脚本 ──
    const meta: Record<string, unknown> = { name };
    const description = argString(args, 'description');
    const category = argString(args, 'category');
    const requirements = argStringArray(args, 'requirements');
    if (description !== undefined) meta.description = description;
    if (category !== undefined) meta.category = category;
    if (requirements !== undefined) meta.requirements = requirements;

    // 先写源码：成功后再改元数据。若源码写入失败，元数据保持原样，
    // 避免脚本落入「新元数据+旧源码」的不一致状态（pending 已标 executed 不可重试）
    const fileInfo = await scriptService.updateScriptContent(scriptId, mainPy);
    await scriptService.updateScript(scriptId, meta);
    log.info(`✓ write_script(修改) 完成: ${name} (${scriptId}) userId=${userId}`);
    return {
      summary: `已更新脚本「${name}」（${fileInfo.fileName}，${fileInfo.size} 字节）`,
      data: { scriptId, name, fileName: fileInfo.fileName, size: fileInfo.size, action: 'updated' },
    };
  }

  // ── 新建脚本：先写临时文件，再复用 uploadScript 完整链路 ──
  const tmpDir = path.resolve(DATA_DIR, 'temp', 'ai-tools');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${randomUUID()}_main.py`);
  try {
    await writeFile(tmpPath, mainPy, 'utf-8');
    const fileStat = await stat(tmpPath);
    const script = await scriptService.uploadScript(
      { filename: 'main.py', path: tmpPath, size: fileStat.size },
      {
        name,
        description: argString(args, 'description'),
        category: argString(args, 'category'),
        scriptType: 'python',
        requirements: argStringArray(args, 'requirements'),
        uploadedBy: userId,
      }
    );
    log.info(`✓ write_script(新建) 完成: ${script.name} (${script.id}) userId=${userId}`);
    return {
      summary: `已创建脚本「${script.name}」（id: ${script.id}）`,
      data: { scriptId: script.id, name: script.name, action: 'created' },
    };
  } finally {
    // uploadScript 成功时会 move 走临时文件；失败时兜底清理
    try { await unlink(tmpPath); } catch { /* 已被移动或不存在，忽略 */ }
  }
}

/**
 * 执行 run_script：解析日志文件 → startBackgroundGeneration（既有报告生成链路）。
 * 输入文件只在数据目录内解析（防路径穿越）；找不到时明确报错。
 */
export async function executeRunScript(
  userId: string,
  args: Record<string, unknown>
): Promise<ConfirmExecResult> {
  const scriptId = argString(args, 'scriptId');
  if (!scriptId) throw new Error('待确认参数不完整（缺少 scriptId）');

  const inputFiles: Array<{ filename: string; path: string; size: number }> = [];
  const logFileName = argString(args, 'logFileName');
  if (logFileName) {
    const resolved = await resolveLogFile(logFileName);
    if (!resolved) {
      throw new Error(`找不到输入文件「${logFileName}」（仅搜索上传目录与日志目录）`);
    }
    inputFiles.push(resolved);
  }

  const script = await scriptService.getScript(scriptId);
  const { reportId } = await reportService.startBackgroundGeneration({
    scriptId,
    templateId: argString(args, 'templateId'),
    outputFormat: argString(args, 'outputFormat'),
    reportInfo: { name: `${script.name}_AI触发_${new Date().toISOString().slice(0, 10)}` },
    inputFiles,
    generatedBy: userId,
  });
  log.info(`✓ run_script 已触发报告生成: reportId=${reportId} scriptId=${scriptId} userId=${userId}`);
  return {
    summary: `已触发脚本「${script.name}」执行，报告生成中（reportId: ${reportId}），可在报告页查看进度`,
    data: { reportId, scriptId, scriptName: script.name },
  };
}

/**
 * 在数据目录内解析用户给出的日志文件名：
 * - 只取 basename，拒绝任何路径穿越
 * - 依次搜索 UPLOADS_DIR 与 LOGS_DIR（含一级子目录）
 */
async function resolveLogFile(
  logFileName: string
): Promise<{ filename: string; path: string; size: number } | null> {
  // 含路径分隔符的输入一律按 basename 处理，不做目录拼接（防路径穿越）
  const base = path.basename(logFileName);
  const candidates: string[] = [];
  for (const dir of [UPLOADS_DIR, LOGS_DIR]) {
    if (!existsSync(dir)) continue;
    candidates.push(path.join(dir, base));
    // 一级子目录（uploads 可能按日期/会话分目录）
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(dir, entry.name, base));
      }
    } catch { /* 忽略读取失败 */ }
  }
  for (const p of candidates) {
    // 防越界：解析结果必须仍在 DATA_DIR 内
    const abs = path.resolve(p);
    if (!abs.startsWith(path.resolve(DATA_DIR))) continue;
    if (existsSync(abs)) {
      const s = await stat(abs);
      if (s.isFile()) return { filename: base, path: abs, size: s.size };
    }
  }
  return null;
}
