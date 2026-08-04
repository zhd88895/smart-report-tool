/**
 * 支持包 Agentic 分析服务
 *
 * 当压缩包过大或智能筛选无法覆盖时，不直接拼接上下文，
 * 而是给 AI 提供文件清单和两个工具（read_pack_file / search_pack_files），
 * 让 AI 自主选择读取哪些文件进行分析，节省 token 并提高准确性。
 *
 * @module services/supportPackAgentService
 */

import { callUserAI } from './aiProviderService';
import type { AIMessage, AIToolDefinition } from './aiProviderService';
import type { ArchiveEntry } from './archiveAnalysisService';
import { getLogger } from '../utils/logger';

const log = getLogger('SupportPackAgentService', 'core');

// ── 常量 ─────────────────────────────────────
/** 清单最多展示条数（超出按优先级+大小截断） */
const MAX_MANIFEST_ENTRIES = 500;
/** 工具循环最大轮次 */
const MAX_TOOL_ROUNDS = 8;
/** read_pack_file 默认最大字符数 */
const DEFAULT_READ_CHARS = 20000;
/** read_pack_file 单次最大字符数 */
const MAX_READ_CHARS = 40000;
/** search_pack_files 默认返回条数 */
const DEFAULT_SEARCH_RESULTS = 20;
/** search_pack_files 最大返回条数 */
const MAX_SEARCH_RESULTS = 50;

// ── 优先级正则（与 archiveAnalysisService 保持一致） ──
const P0_RE = /(event|alarm|sel|diagnos|fault|fdm_log)/i;
const P1_RE = /(kernel|raid|storage|sensor|bmc|system|power|fan|temp|osdump|linux)/i;

/** 进度回调：向 SSE 流推送阶段信息 */
export type ProgressCallback = (message: string) => void;

export interface AgenticAnalysisResult {
  /** AI 最终分析报告文本 */
  report: string;
  /** 是否走了 .env 兜底（用户未配置模型） */
  fallback: boolean;
}

/**
 * 构建文件清单：编号 + 路径 + 大小 + 类型标注
 * 按 P0 > P1 > 其他排序，超出 MAX_MANIFEST_ENTRIES 截断
 */
function buildManifest(entries: ArchiveEntry[]): string {
  // 排序：P0 优先 → P1 → 其他；同级按文件大小降序（大文件更可能是主日志）
  const sorted = [...entries].sort((a, b) => {
    const aP0 = P0_RE.test(a.path) ? 0 : P1_RE.test(a.path) ? 1 : 2;
    const bP0 = P0_RE.test(b.path) ? 0 : P1_RE.test(b.path) ? 1 : 2;
    if (aP0 !== bP0) return aP0 - bP0;
    return b.size - a.size;
  });

  const lines: string[] = [];
  const limit = Math.min(sorted.length, MAX_MANIFEST_ENTRIES);

  for (let i = 0; i < limit; i++) {
    const e = sorted[i];
    const type = e.text !== null ? 'text' : 'binary';
    const sizeKb = (e.size / 1024).toFixed(1);
    lines.push(`[${i + 1}] ${e.path} (${sizeKb} KB, ${type})`);
  }

  if (sorted.length > MAX_MANIFEST_ENTRIES) {
    lines.push(`...（共 ${sorted.length} 个文件，仅显示前 ${MAX_MANIFEST_ENTRIES} 个）`);
  }

  return lines.join('\n');
}

/** 构建文件路径→条目的索引（工具调用时快速查找） */
function buildEntryMap(entries: ArchiveEntry[]): Map<string, ArchiveEntry> {
  const map = new Map<string, ArchiveEntry>();
  for (const e of entries) {
    map.set(e.path, e);
    // 同时用文件名（不含目录）做备选键，方便 AI 只给文件名时也能找到
    const baseName = e.path.split('/').pop() || e.path;
    if (!map.has(baseName)) {
      map.set(baseName, e);
    }
  }
  return map;
}

/**
 * 执行 read_pack_file 工具：读取指定文件内容
 */
function executeReadPackFile(
  entryMap: Map<string, ArchiveEntry>,
  args: { path: string; max_chars?: number; tail?: boolean }
): string {
  const entry = entryMap.get(args.path);
  if (!entry) {
    return `错误：找不到文件 "${args.path}"。请从文件清单中选择正确的文件路径。`;
  }
  if (entry.text === null) {
    return `文件 "${args.path}" 是二进制文件，无法以文本形式读取。`;
  }

  const maxChars = Math.min(args.max_chars || DEFAULT_READ_CHARS, MAX_READ_CHARS);
  const content = entry.text;

  if (content.length <= maxChars) {
    return `=== ${args.path} (完整内容，${content.length} 字符) ===\n${content}`;
  }

  if (args.tail !== false) {
    // 默认取尾部（最新日志通常在末尾）
    const head = content.slice(0, Math.floor(maxChars * 0.3));
    const tail = content.slice(-Math.floor(maxChars * 0.7));
    return `=== ${args.path} (共 ${content.length} 字符，显示头部+尾部) ===\n${head}\n\n... (中间部分已省略) ...\n\n${tail}`;
  }

  // 取头部
  const head = content.slice(0, maxChars);
  return `=== ${args.path} (共 ${content.length} 字符，仅显示前 ${maxChars} 字符) ===\n${head}\n\n... (后续部分已省略，可使用 tail=true 查看尾部)`;
}

/**
 * 执行 search_pack_files 工具：跨文件搜索关键词
 */
function executeSearchPackFiles(
  entries: ArchiveEntry[],
  args: { keyword: string; max_results?: number }
): string {
  const keyword = args.keyword.toLowerCase();
  const maxResults = Math.min(args.max_results || DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS);
  const results: string[] = [];

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (entry.text === null) continue;

    const lines = entry.text.split('\n');
    const matching: string[] = [];
    for (let i = 0; i < lines.length && matching.length < 5; i++) {
      if (lines[i].toLowerCase().includes(keyword)) {
        // 附带前后各 1 行上下文
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        matching.push(lines.slice(start, end).join('\n'));
      }
    }

    if (matching.length > 0) {
      results.push(`--- ${entry.path} ---\n${matching.join('\n...\n')}`);
    }
  }

  if (results.length === 0) {
    return `未找到包含关键词 "${args.keyword}" 的内容。`;
  }

  return `搜索 "${args.keyword}" 的结果（共 ${results.length} 个文件匹配）：\n\n${results.join('\n\n')}`;
}

/** 工具定义 */
const TOOLS: AIToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_pack_file',
      description: '读取支持包中指定文件的内容。对于大文件默认返回头部30%+尾部70%（最新日志通常在末尾）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径（从文件清单中选择）' },
          max_chars: { type: 'number', description: '最大返回字符数，默认 20000，上限 40000' },
          tail: { type: 'boolean', description: 'true=取尾部（默认），false=取头部' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_pack_files',
      description: '在支持包的所有文本文件中搜索关键词，返回包含匹配行的文件及上下文。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词（不区分大小写）' },
          max_results: { type: 'number', description: '最大返回文件数，默认 20' },
        },
        required: ['keyword'],
      },
    },
  },
];

/**
 * Agentic 支持包分析主函数
 *
 * 不直接拼接文件内容到上下文，而是给 AI 提供文件清单，
 * 让 AI 通过工具自主选择读取哪些文件进行分析。
 */
export async function analyzeWithAgent(
  userId: string,
  entries: ArchiveEntry[],
  options: {
    category: string;
    customPrompt?: string;
    supplements?: any[];
    knowledgeContext?: string;
    userHint?: string;
    modelId?: string;
    onProgress?: ProgressCallback;
  }
): Promise<AgenticAnalysisResult> {
  const { category, customPrompt, supplements, knowledgeContext, userHint, modelId, onProgress } = options;
  const progress = onProgress || (() => {});

  // 构建清单和索引
  const manifest = buildManifest(entries);
  const entryMap = buildEntryMap(entries);
  const textCount = entries.filter((e) => e.text !== null).length;
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  log.info(`Agentic 分析开始: ${entries.length} 个文件 (${textCount} 文本), 总大小 ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

  // 构建系统提示词
  const { getPrompt } = await import('./aiPrompts');
  // 用 getPrompt 获取分析框架（category 对应的 system prompt），但内容部分替换为清单
  const basePrompt = getPrompt(category, '', customPrompt, supplements);

  // 提取 system 部分（getPrompt 返回的是完整 prompt，我们只需要分析框架部分）
  // 这里直接构建 agentic 专用的 system prompt
  const systemPrompt = `${basePrompt.split('---')[0]}

## 支持包分析模式

你正在分析一个支持包/压缩包，共包含 ${entries.length} 个文件（其中 ${textCount} 个文本文件），总大小约 ${(totalSize / 1024 / 1024).toFixed(1)} MB。

**工作方式**：你不会直接收到所有文件内容。请按照以下步骤操作：
1. 先浏览下方的文件清单，识别最可能包含故障信息的文件
2. 使用 read_pack_file 工具逐个读取你认为关键的文件
3. 也可以使用 search_pack_files 工具搜索特定关键词（如错误代码、告警ID等）
4. 读取足够信息后，直接输出完整的分析报告

**注意事项**：
- 优先读取文件名中包含 event、alarm、error、fault、sel、diagnos 等关键词的文件
- 对于大文件，默认会返回尾部内容（最新日志），这对故障分析通常足够
- 请高效利用工具调用次数，不要逐个读取所有文件
- 分析完成后直接输出完整报告，不要询问用户

## 文件清单

${manifest}`;

  // 构建用户消息（补充信息 + 知识库 + 用户提示）
  let userMessage = '请分析上述支持包，找出故障点并给出解决方案。';

  if (knowledgeContext) {
    userMessage = `## 知识库参考\n${knowledgeContext}\n\n${userMessage}`;
  }
  if (userHint) {
    userMessage = `## 用户补充提示\n${userHint}\n\n${userMessage}`;
  }

  // 消息历史
  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let fallback = false;

  // 工具循环
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    progress(`AI 分析中（第 ${round + 1} 轮）...`);

    const response = await callUserAI(userId, {
      messages,
      modelId,
      feature: 'agent',
      tools: TOOLS,
      temperature: 0.3,
      maxOutputTokens: 8192,
    });

    fallback = response.fallback;

    // 无工具调用 → AI 已生成最终报告
    if (!response.toolCalls || response.toolCalls.length === 0) {
      log.info(`Agentic 分析完成: 第 ${round + 1} 轮, 报告长度 ${response.message.length}`);
      return { report: response.message, fallback };
    }

    // 有工具调用 → 执行并追加结果
    messages.push({
      role: 'assistant',
      content: response.message || null,
      tool_calls: response.toolCalls,
    });

    for (const tc of response.toolCalls) {
      const fnName = tc.function.name;
      let args: any;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      progress(`AI 正在${fnName === 'read_pack_file' ? `阅读 ${args.path || '文件'}` : `搜索 "${args.keyword || ''}"`}...`);

      let result: string;
      if (fnName === 'read_pack_file') {
        result = executeReadPackFile(entryMap, args);
      } else if (fnName === 'search_pack_files') {
        result = executeSearchPackFiles(entries, args);
      } else {
        result = `未知工具: ${fnName}`;
      }

      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: tc.id,
      });
    }
  }

  // 超过最大轮次：取最后一轮 assistant 的文本，或提示轮次用尽
  log.warn(`Agentic 分析达到最大轮次 ${MAX_TOOL_ROUNDS}`);
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);
  const report = lastAssistant?.content || '分析轮次已达上限，请尝试缩小支持包范围或提供更明确的分析方向。';

  return { report, fallback };
}
