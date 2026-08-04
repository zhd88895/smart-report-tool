/**
 * AI 只读工具实现模块
 *
 * 四个只读工具的业务实现：
 * - list_scripts：列出当前用户可见脚本（复用 scriptService.getScripts）
 * - read_script：读取指定脚本源码与元信息（复用 scriptService.getScript/getScriptContent）
 * - analyze_script：读脚本源码后调 callUserAI 生成功能总结
 *   （防递归：内部调用用 feature:'tool' 且不挂 tools）
 * - list_reports：列出当前用户近期报告（复用 reportService.getReports，generatedBy=userId 隔离）
 *
 * 所有 handler 不抛异常：脚本/报告不存在或内部错误一律返回 { ok: false }。
 * 脚本在系统内为认证用户共享（与既有 /api/scripts 路由行为一致），报告按 generatedBy 隔离。
 *
 * @module services/aiTools/scriptTools
 */

import { scriptService } from '../scriptService';
import { reportService } from '../reportService';
import { callUserAI } from '../aiProviderService';
import { getLogger } from '../../utils/logger';
import type { ToolResult } from './registry';

const log = getLogger('AIScriptTools', 'core');

/** read_script 单次返回给模型的源码最大字符数（超出截断并标注） */
const MAX_SCRIPT_CONTENT_CHARS = 20000;
/** analyze_script 传给模型分析的源码最大字符数 */
const MAX_ANALYZE_CONTENT_CHARS = 30000;
/** list_reports 默认/最大返回条数 */
const DEFAULT_REPORT_LIMIT = 20;
const MAX_REPORT_LIMIT = 50;
/** list_scripts 默认/最大返回条数 */
const DEFAULT_SCRIPT_LIMIT = 50;
const MAX_SCRIPT_LIMIT = 100;

/** 从未知 args 中安全取字符串参数 */
function argString(args: unknown, key: string): string | undefined {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 从未知 args 中安全取数值参数 */
function argNumber(args: unknown, key: string): number | undefined {
  const v = (args as Record<string, unknown> | null)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * list_scripts：列出脚本（id/名称/类型/分类/区域/版本/大小/上传时间）
 * 支持 region/category/scriptType 过滤与 limit 限制
 */
export async function listScriptsTool(userId: string, args: unknown): Promise<ToolResult> {
  try {
    const filter = {
      region: argString(args, 'region'),
      category: argString(args, 'category'),
      scriptType: argString(args, 'scriptType'),
    };
    const limit = Math.max(1, Math.min(argNumber(args, 'limit') ?? DEFAULT_SCRIPT_LIMIT, MAX_SCRIPT_LIMIT));

    const scripts = await scriptService.getScripts(filter);
    const total = scripts.length;
    const items = scripts.slice(0, limit).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      scriptType: s.scriptType,
      category: s.category,
      region: s.region,
      version: s.version,
      pythonVersion: s.pythonVersion,
      isMultiFile: !!s.isMultiFile,
      fileSize: s.fileSize,
      uploadedAt: s.uploadedAt,
    }));

    log.info(`⇢ tool list_scripts userId=${userId} total=${total} returned=${items.length}`);
    return {
      ok: true,
      summary: `共 ${total} 个脚本，返回前 ${items.length} 个`,
      data: { total, scripts: items },
    };
  } catch (e) {
    log.warn(`tool list_scripts 失败: ${(e as Error).message}`);
    return { ok: false, summary: `查询脚本列表失败: ${(e as Error).message}` };
  }
}

/**
 * read_script：读取指定脚本的元信息与源码
 * 脚本不存在/文件缺失时返回 { ok: false }，不抛异常
 */
export async function readScriptTool(userId: string, args: unknown): Promise<ToolResult> {
  const scriptId = argString(args, 'scriptId');
  if (!scriptId) return { ok: false, summary: '缺少必需参数 scriptId' };

  try {
    const script = await scriptService.getScript(scriptId);
    const { content, fileName } = await scriptService.getScriptContent(scriptId);

    const truncated = content.length > MAX_SCRIPT_CONTENT_CHARS;
    const shown = truncated ? content.slice(0, MAX_SCRIPT_CONTENT_CHARS) : content;

    log.info(`⇢ tool read_script userId=${userId} scriptId=${scriptId} chars=${content.length}`);
    return {
      ok: true,
      summary: `已读取脚本「${script.name}」（${fileName}，${content.length} 字符${truncated ? '，已截断' : ''}）`,
      data: {
        id: script.id,
        name: script.name,
        description: script.description,
        scriptType: script.scriptType,
        category: script.category,
        region: script.region,
        version: script.version,
        pythonVersion: script.pythonVersion,
        requirements: script.requirements,
        fileName,
        content: shown,
        truncated,
        totalChars: content.length,
      },
    };
  } catch (e) {
    // getScript/getScriptContent 对不存在的脚本抛「脚本不存在」，转为 {ok:false}
    log.warn(`tool read_script 失败: scriptId=${scriptId} ${(e as Error).message}`);
    return { ok: false, summary: `读取脚本失败: ${(e as Error).message}` };
  }
}

/**
 * analyze_script：读取脚本源码后调用 AI 生成功能总结
 * 防递归：内部 callUserAI 使用 feature:'tool' 且不传 tools
 */
export async function analyzeScriptTool(userId: string, args: unknown): Promise<ToolResult> {
  const scriptId = argString(args, 'scriptId');
  if (!scriptId) return { ok: false, summary: '缺少必需参数 scriptId' };

  try {
    const script = await scriptService.getScript(scriptId);
    const { content, fileName } = await scriptService.getScriptContent(scriptId);

    const truncated = content.length > MAX_ANALYZE_CONTENT_CHARS;
    const shown = truncated ? content.slice(0, MAX_ANALYZE_CONTENT_CHARS) : content;

    const aiResp = await callUserAI(userId, {
      // 防递归：feature 标记为 tool，且不挂 tools
      feature: 'tool',
      messages: [
        {
          role: 'system',
          content:
            '你是脚本分析助手。用户会给你一段脚本源码，请用中文简洁总结：' +
            '1) 脚本功能与处理流程；2) 输入（文件/格式/目录约定）；3) 输出（生成的文件/报告格式）；' +
            '4) 依赖与环境要求。只基于源码作答，不要臆测。',
        },
        {
          role: 'user',
          content:
            `脚本名称：${script.name}\n描述：${script.description || '（无）'}\n` +
            `类型：${script.scriptType}，分类：${script.category}，区域：${script.region}\n` +
            `声明依赖：${(script.requirements || []).join(', ') || '（无）'}\n\n` +
            `源码（${fileName}${truncated ? '，已截断' : ''}）：\n\`\`\`\n${shown}\n\`\`\``,
        },
      ],
      maxOutputTokens: 2048,
    });

    log.info(`⇢ tool analyze_script userId=${userId} scriptId=${scriptId} summaryChars=${aiResp.message.length}`);
    return {
      ok: true,
      summary: aiResp.message || '（AI 未返回分析内容）',
      data: {
        id: script.id,
        name: script.name,
        fileName,
        truncated,
        analysis: aiResp.message,
      },
    };
  } catch (e) {
    log.warn(`tool analyze_script 失败: scriptId=${scriptId} ${(e as Error).message}`);
    return { ok: false, summary: `分析脚本失败: ${(e as Error).message}` };
  }
}

/**
 * list_reports：列出当前用户近期报告（generatedBy=userId 隔离）
 * 支持 status 过滤与 limit 限制
 */
export async function listReportsTool(userId: string, args: unknown): Promise<ToolResult> {
  try {
    const status = argString(args, 'status');
    const limit = Math.max(1, Math.min(argNumber(args, 'limit') ?? DEFAULT_REPORT_LIMIT, MAX_REPORT_LIMIT));

    const reports = await reportService.getReports({ status, generatedBy: userId });
    const total = reports.length;
    const items = reports.slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      scriptName: r.scriptName,
      status: r.status,
      outputFormat: r.outputFormat,
      type: r.type,
      region: r.region,
      reportSource: r.reportSource,
      generatedAt: r.generatedAt,
      error: r.error,
    }));

    log.info(`⇢ tool list_reports userId=${userId} total=${total} returned=${items.length}`);
    return {
      ok: true,
      summary: `共 ${total} 份报告，返回最近 ${items.length} 份`,
      data: { total, reports: items },
    };
  } catch (e) {
    log.warn(`tool list_reports 失败: ${(e as Error).message}`);
    return { ok: false, summary: `查询报告列表失败: ${(e as Error).message}` };
  }
}
