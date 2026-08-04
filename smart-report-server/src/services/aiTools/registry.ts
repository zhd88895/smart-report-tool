/**
 * AI 工具注册表模块
 *
 * 统一管理 AI 助手可调用的工具：
 * - TOOL_DEFINITIONS：OpenAI function calling schema（传给模型的 tools 参数）
 * - executeTool：按工具名分发执行，永远返回 ToolResult 不抛异常
 * - runToolLoop：工具调用循环——模型返回 tool_calls 时执行只读工具、
 *   结果以 role:'tool' 消息回注后继续调用，最多 3 轮；
 *   遇到需确认工具（write_script/run_script）落 pending 记录后立即暂停，
 *   在结果中携带 pendingConfirm 供前端渲染确认卡片
 *
 * 工具清单（对应设计文档 §5.2）：
 * - 只读：list_scripts / read_script / analyze_script / list_reports
 * - 需确认（Task 11 实现）：write_script / run_script
 *   —— 被调用时只创建 pending_tool_calls 记录，绝不直接执行业务动作，
 *   用户确认后经 POST /api/ai/tools/confirm 才执行
 *
 * 工具级 DB 审计：每次工具调用（含只读）都写 pending_tool_calls 记录
 * （只读工具直接写 status='executed'，含 tool 名、参数摘要、结果状态）。
 *
 * 说明：工具循环放在本模块而非 aiProviderService，是为了避免
 * aiProviderService ↔ aiTools 的循环依赖（analyze_script 内部要调 callUserAI）。
 *
 * @module services/aiTools/registry
 */

import {
  callUserAI,
  type AIToolCall,
  type AIToolDefinition,
  type AIMessage,
  type UserAIRequest,
  type UserAIResponse,
} from '../aiProviderService';
import { aiToolConfirmRepository } from '../../db/repositories/aiToolConfirmRepository';
import { getLogger } from '../../utils/logger';
import {
  analyzeScriptTool,
  listReportsTool,
  listScriptsTool,
  readScriptTool,
} from './scriptTools';
import { runScriptTool, writeScriptTool } from './confirmTools';

const log = getLogger('AIToolRegistry', 'core');

/** 工具执行结果（ok:false 表示失败，不抛异常） */
export interface ToolResult {
  ok: boolean;
  /** 给人/模型看的一句话结果摘要 */
  summary: string;
  /** 结构化结果数据（可选） */
  data?: unknown;
  /** true 表示该调用已落 pending 记录，等待用户确认（绝不已执行业务动作） */
  pending?: boolean;
  /** pending_tool_calls 记录 ID（pending=true 时存在） */
  pendingId?: string;
  /** 工具名（pending=true 时透传，供确认卡片展示） */
  tool?: string;
  /** 参数摘要（pending=true 时透传，供确认卡片展示） */
  argsSummary?: string;
}

/** 工具循环中一次工具调用的记录（供路由层/前端渲染工具卡片） */
export interface ToolCallRecord {
  name: string;
  ok: boolean;
  summary: string;
}

/** 待确认信息（工具循环遇 pending 暂停时返回给前端） */
export interface PendingConfirm {
  pendingId: string;
  tool: string;
  argsSummary: string;
}

/** 工具循环结果：在 UserAIResponse 基础上附加工具调用轨迹 */
export interface ToolLoopResult extends UserAIResponse {
  toolsUsed: ToolCallRecord[];
  /** 实际执行的工具回合数 */
  toolRounds: number;
  /** 遇到需确认工具暂停时携带（此时 message 为暂停说明文案） */
  pendingConfirm?: PendingConfirm;
}

/** 工具循环最大回合数 */
const MAX_TOOL_ROUNDS = 3;

// ═══════════════════════════════════════════════════════
//  工具定义（OpenAI function calling schema）
// ═══════════════════════════════════════════════════════

export const TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_scripts',
      description: '列出当前用户可见的脚本清单（id、名称、类型、分类、区域、版本等）',
      parameters: {
        type: 'object',
        properties: {
          region: { type: 'string', description: '按适用区域筛选（可选）' },
          category: { type: 'string', description: '按分类筛选（可选）' },
          scriptType: { type: 'string', description: '按脚本类型筛选，如 python/bat/ps1/sh（可选）' },
          limit: { type: 'number', description: '返回数量上限，默认 50，最大 100（可选）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_script',
      description: '读取指定脚本的元信息与源码内容（超长会截断）',
      parameters: {
        type: 'object',
        properties: {
          scriptId: { type: 'string', description: '脚本 ID（可从 list_scripts 获得）' },
        },
        required: ['scriptId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_script',
      description: '分析指定脚本的功能：调用 AI 阅读源码并总结处理流程、输入输出、依赖要求',
      parameters: {
        type: 'object',
        properties: {
          scriptId: { type: 'string', description: '脚本 ID（可从 list_scripts 获得）' },
        },
        required: ['scriptId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reports',
      description: '列出当前用户近期生成的报告（名称、脚本、状态、时间等），便于引用历史分析结果',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: '按状态筛选（可选）',
            enum: ['generating', 'success', 'failed'],
          },
          limit: { type: 'number', description: '返回数量上限，默认 20，最大 50（可选）' },
        },
        required: [],
      },
    },
  },
  // ─── 需确认工具（Task 11 实现：只落 pending 记录，用户确认后执行） ───
  {
    type: 'function',
    function: {
      name: 'write_script',
      description: '新建或修改脚本（含 main.py 源码内容）。调用后不会立即生效，需用户在界面上确认后才落库',
      parameters: {
        type: 'object',
        properties: {
          scriptId: { type: 'string', description: '要修改的脚本 ID；新建时不传' },
          name: { type: 'string', description: '脚本名称' },
          description: { type: 'string', description: '脚本描述（可选）' },
          category: { type: 'string', description: '脚本分类，如 host/storage/network（可选）' },
          mainPy: { type: 'string', description: 'main.py 完整源码内容' },
          requirements: { type: 'array', items: { type: 'string' }, description: 'Python 依赖包列表（可选）' },
        },
        required: ['name', 'mainPy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_script',
      description: '对指定日志文件执行脚本生成报告。调用后不会立即执行，需用户在界面上确认后才触发报告生成',
      parameters: {
        type: 'object',
        properties: {
          scriptId: { type: 'string', description: '脚本 ID' },
          logFileName: { type: 'string', description: '输入日志文件名（位于上传/日志目录，可选）' },
          templateId: { type: 'string', description: '模板 ID（可选）' },
          outputFormat: { type: 'string', description: '输出格式，如 html/docx/xlsx（可选）' },
        },
        required: ['scriptId'],
      },
    },
  },
];

// ═══════════════════════════════════════════════════════
//  工具分发执行
// ═══════════════════════════════════════════════════════

/** 只读工具 handler 表 */
const READ_ONLY_HANDLERS: Record<string, (userId: string, args: unknown) => Promise<ToolResult>> = {
  list_scripts: listScriptsTool,
  read_script: readScriptTool,
  analyze_script: analyzeScriptTool,
  list_reports: listReportsTool,
};

/** 需确认工具 handler 表（只落 pending 记录，绝不执行业务动作） */
const PENDING_HANDLERS: Record<string, (userId: string, args: unknown) => Promise<ToolResult>> = {
  write_script: writeScriptTool,
  run_script: runScriptTool,
};

/** 审计用的参数摘要：JSON 截断 500 字符，避免源码等大字段撑爆记录 */
function auditArgsSummary(args: unknown): Record<string, unknown> {
  try {
    const raw = JSON.stringify(args ?? {}) || '{}';
    return { _summary: raw.length > 500 ? `${raw.slice(0, 500)}…(截断)` : raw };
  } catch {
    return { _summary: '[无法序列化]' };
  }
}

/**
 * 工具分发器：按名称执行工具，永远返回 ToolResult 不抛异常。
 *
 * - 只读工具：立即执行，结果写入审计记录（status='executed'）
 * - 需确认工具（write_script/run_script）：只落 pending 记录返回待确认，
 *   安全底线——此处绝不执行任何写/执行类业务动作
 */
export async function executeTool(userId: string, name: string, args: unknown): Promise<ToolResult> {
  // ── 需确认工具：创建 pending 记录并返回待确认 ──
  const pendingHandler = PENDING_HANDLERS[name];
  if (pendingHandler) {
    try {
      return await pendingHandler(userId, args);
    } catch (e) {
      log.error(`tool ${name} 创建待确认记录失败: ${(e as Error).message}`);
      return { ok: false, summary: `工具 ${name} 创建待确认任务失败: ${(e as Error).message}` };
    }
  }

  // ── 只读工具：立即执行 + DB 审计（status='executed'） ──
  const handler = READ_ONLY_HANDLERS[name];
  if (!handler) {
    return { ok: false, summary: `未知工具: ${name}` };
  }
  let result: ToolResult;
  try {
    result = await handler(userId, args);
  } catch (e) {
    // 兜底：handler 内部已自捕获，这里防御未知异常
    log.error(`tool ${name} 未捕获异常: ${(e as Error).message}`);
    result = { ok: false, summary: `工具 ${name} 执行失败: ${(e as Error).message}` };
  }
  // 工具级 DB 审计：记录 tool 名、参数摘要、结果状态；审计失败不影响主流程
  try {
    await aiToolConfirmRepository.create({
      userId,
      tool: name,
      args: auditArgsSummary(args),
      status: 'executed',
      result: JSON.stringify({ ok: result.ok, summary: result.summary.slice(0, 500) }),
    });
  } catch (e) {
    log.warn(`tool ${name} 审计写入失败（忽略）: ${(e as Error).message}`);
  }
  return result;
}

// ═══════════════════════════════════════════════════════
//  工具调用循环
// ═══════════════════════════════════════════════════════

/** 解析模型返回的工具调用参数（JSON 字符串 → 对象，失败按空对象） */
function parseToolArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

/**
 * 工具调用循环（非流式）。
 *
 * 流程：callUserAI（带 tools）→ 若返回 toolCalls，逐只执行只读工具
 * → 助手消息（含 tool_calls）+ 工具结果消息（role:'tool'）回注消息流
 * → 再次调用，最多 MAX_TOOL_ROUNDS 轮；若最后一轮模型仍要调工具，
 * 追加一次不带 tools 的调用强制输出文本结论。
 *
 * 遇需确认工具：executeTool 返回 pending=true（已落 pending 记录）时
 * 立即暂停循环，响应携带 pendingConfirm 与暂停说明文案，
 * 不再回注消息流继续调模型（等用户确认后由前端发起新的对话）。
 *
 * usage 累计各轮调用之和（含满轮兜底调用）。
 */
export async function runToolLoop(userId: string, req: UserAIRequest): Promise<ToolLoopResult> {
  const messages: AIMessage[] = [...req.messages];
  const toolsUsed: ToolCallRecord[] = [];
  let toolRounds = 0;
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let sawUsage = false;

  const accumulateUsage = (resp: UserAIResponse): void => {
    if (!resp.usage) return;
    sawUsage = true;
    totalUsage.promptTokens += resp.usage.promptTokens;
    totalUsage.completionTokens += resp.usage.completionTokens;
    totalUsage.totalTokens += resp.usage.totalTokens;
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await callUserAI(userId, { ...req, messages, tools: TOOL_DEFINITIONS });
    accumulateUsage(resp);

    const toolCalls: AIToolCall[] = resp.toolCalls ?? [];
    if (toolCalls.length === 0) {
      // 模型直接给出文本回答，结束循环
      return { ...resp, usage: sawUsage ? { ...totalUsage } : undefined, toolsUsed, toolRounds };
    }

    toolRounds++;
    log.info(`⇢ 工具循环第 ${toolRounds} 轮: ${toolCalls.map((t) => t.function.name).join(', ')}`);

    // 回注助手消息（content 可能为 null，表示纯工具调用回合）
    messages.push({ role: 'assistant', content: resp.message || null, tool_calls: toolCalls });

    // 逐只执行工具并回注结果；遇 pending 工具立即暂停循环
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const args = parseToolArgs(tc.function.arguments);
      const result = await executeTool(userId, tc.function.name, args);
      toolsUsed.push({ name: tc.function.name, ok: result.ok, summary: result.summary });

      if (result.pending && result.pendingId) {
        log.info(`⏸ 工具循环暂停：${tc.function.name} 待用户确认 pendingId=${result.pendingId}`);
        // 同轮剩余 tool_calls 因暂停不再执行：显式标注 skipped，
        // 避免用户侧看到这些调用凭空消失（不落 pending 记录，防止重复确认入口）
        for (const rest of toolCalls.slice(i + 1)) {
          toolsUsed.push({
            name: rest.function.name,
            ok: false,
            summary: 'skipped：同轮已有待确认操作，该调用本次未执行，可在确认后重新发起',
          });
          log.warn(`⤳ 同轮工具调用被跳过: ${rest.function.name}（因 ${tc.function.name} 待确认暂停循环）`);
        }
        const pauseMessage =
          (resp.message ? `${resp.message}\n\n` : '') +
          `已准备执行操作：${result.argsSummary || result.summary}。\n` +
          `请在下方确认卡片中点击「确认执行」或「取消」。`;
        return {
          ...resp,
          message: pauseMessage,
          toolCalls: undefined,
          usage: sawUsage ? { ...totalUsage } : undefined,
          toolsUsed,
          toolRounds,
          pendingConfirm: {
            pendingId: result.pendingId,
            tool: result.tool || tc.function.name,
            argsSummary: result.argsSummary || result.summary,
          },
        };
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data ?? null }),
      });
    }
  }

  // 达到最大轮次后模型仍要调工具：追加一次不带 tools 的调用，强制输出文本结论
  log.warn(`工具循环达到最大轮次 ${MAX_TOOL_ROUNDS}，强制输出文本结论`);
  const finalResp = await callUserAI(userId, { ...req, messages, tools: undefined });
  accumulateUsage(finalResp);
  return { ...finalResp, usage: sawUsage ? { ...totalUsage } : undefined, toolsUsed, toolRounds };
}
