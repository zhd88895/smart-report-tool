/**
 * 多厂商 AI 服务模块
 *
 * 全项目 AI 调用（聊天、流式、文件分析、Agent、报告分析）的唯一入口：
 * - VENDOR_QUIRKS：厂商 quirks 注册表（认证头、token 参数名、默认模型等差异）
 * - callUserAI：非流式统一调用（支持 tool calling、用量记录）
 * - callUserAIStream：流式统一调用（透传上游 SSE 流，流结束后补写用量日志）
 * - fetchRemoteModels / testProviderConnection：厂商配置的辅助能力
 *
 * 配置解析优先级：用户数据库配置（指定模型或默认模型）→ .env MiMo 兜底。
 *
 * @module services/aiProviderService
 */

import { getConfig } from '../config';
import { getLogger } from '../utils/logger';
import {
  userAIConfigRepository,
  type UserAIProvider,
} from '../db/repositories/userAIConfigRepository';

const log = getLogger('AIProviderService', 'core');

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

/** 支持的厂商标识 */
export type VendorKey = 'mimo' | 'deepseek' | 'kimi' | 'qwen' | 'glm' | 'minimax' | 'lingyi' | 'openai' | 'opencode-go' | 'custom';

/** 厂商差异配置（认证方式、token 参数名、默认模型等） */
export interface VendorQuirks {
  key: VendorKey;
  name: string;
  defaultBaseUrl: string;
  /** 认证头名称：'api-key'（MiMo）或 'Authorization'（OpenAI 标准） */
  authHeader: string;
  /** 认证值前缀：'Bearer '（标准）或 ''（MiMo 无前缀） */
  authPrefix: string;
  /** 最大输出 token 的请求参数名 */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /** 流式请求是否支持 stream_options.include_usage（末尾返回 usage 统计） */
  supportsStreamUsage: boolean;
  defaultModels: string[];
}

/** 厂商 quirks 注册表：集中管理各厂商 API 差异 */
export const VENDOR_QUIRKS: Record<VendorKey, VendorQuirks> = {
  mimo:    { key: 'mimo',    name: '小米 MiMo',  defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',         authHeader: 'api-key',       authPrefix: '',        tokenParam: 'max_completion_tokens', supportsStreamUsage: true,  defaultModels: ['mimo-v2.5-pro', 'mimo-v2.5-flash'] },
  deepseek:{ key: 'deepseek',name: 'DeepSeek',   defaultBaseUrl: 'https://api.deepseek.com/v1',                     authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: true,  defaultModels: ['deepseek-chat', 'deepseek-reasoner'] },
  kimi:    { key: 'kimi',    name: 'Kimi',       defaultBaseUrl: 'https://api.moonshot.cn/v1',                      authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: true,  defaultModels: ['kimi-k2-0905-preview', 'moonshot-v1-8k'] },
  qwen:    { key: 'qwen',    name: '通义千问',    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',         supportsStreamUsage: true,  defaultModels: ['qwen-plus', 'qwen-turbo'] },
  glm:     { key: 'glm',     name: '智谱 GLM',   defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',            authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: true,  defaultModels: ['glm-4-plus', 'glm-4-flash'] },
  minimax: { key: 'minimax', name: 'MiniMax',    defaultBaseUrl: 'https://api.minimax.chat/v1',                     authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: false, defaultModels: ['abab6.5s-chat'] },
  lingyi:  { key: 'lingyi',  name: '零一万物',    defaultBaseUrl: 'https://api.lingyiwanwu.com/v1',                  authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',           supportsStreamUsage: true,  defaultModels: ['yi-large'] },
  openai:  { key: 'openai',  name: 'OpenAI',     defaultBaseUrl: 'https://api.openai.com/v1',                       authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: true,  defaultModels: ['gpt-4o', 'gpt-4o-mini'] },
  // OpenCode Go：OpenAI 兼容协议的模型可直接接入；Anthropic /messages（MiniMax、Qwen3.x）与 /responses（GPT 5.6 Luna）协议的模型暂不支持
  'opencode-go': { key: 'opencode-go', name: 'OpenCode Go', defaultBaseUrl: 'https://opencode.ai/zen/go/v1',        authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: true,  defaultModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'mimo-v2.5', 'mimo-v2.5-pro', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'glm-5.2', 'glm-5.1', 'grok-4.5', 'hy3'] },
  custom:  { key: 'custom',  name: '自定义',      defaultBaseUrl: '',                                                authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: false, defaultModels: [] },
};

// ═══════════════════════════════════════════════════════
//  已知模型规格表
// ═══════════════════════════════════════════════════════
//
// 各厂商的 /models 接口均不返回上下文/输出上限元数据（已实测 MiMo、DeepSeek、
// OpenCode Go 均只返回 id/object/owned_by），因此这里按官方文档维护一份已知
// 模型规格表，用于：添加/导入模型时自动填充上限、前端展示官方上限提示。
// 按 model_id 前缀匹配（长前缀在前），未命中时回退数据库默认值。
// 只收录已从官方渠道确认过的数值，宁可空缺也不猜。

/** 已知模型的官方上下文/输出上限 */
export interface KnownModelLimits {
  /** 官方上下文窗口（输入上限） */
  maxInputTokens?: number;
  /** 官方单次最大输出 */
  maxOutputTokens?: number;
}

const MODEL_KNOWN_LIMITS: Array<{ match: string; limits: KnownModelLimits }> = [
  // DeepSeek V4 系列：官方 API 文档 1M 上下文、最大输出 384K（OpenCode Go 同模型 ID 亦覆盖）
  { match: 'deepseek-v4-flash', limits: { maxInputTokens: 1048576, maxOutputTokens: 393216 } },
  { match: 'deepseek-v4-pro',   limits: { maxInputTokens: 1048576, maxOutputTokens: 393216 } },
  // 小米 MiMo-V2.5 系列：官方 1M 上下文（输出上限官方未明示，不填）
  { match: 'mimo-v2.5',         limits: { maxInputTokens: 1048576 } },
];

/** 按模型 ID 前缀查官方已知上限，未收录返回 null */
export function getKnownModelLimits(modelId: string): KnownModelLimits | null {
  const id = (modelId || '').toLowerCase();
  for (const entry of MODEL_KNOWN_LIMITS) {
    if (id.startsWith(entry.match)) return entry.limits;
  }
  return null;
}

/** 输出 token 的全局安全天花板（DeepSeek V4 官方最大输出 384K 为目前最高） */
export const OUTPUT_TOKEN_CEILING = 393216;

/** 工具调用（模型返回） */
export interface AIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** 单条聊天消息（content 为 null 表示纯工具调用回合） */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
}

/** 工具定义（传给模型的 function 描述） */
export interface AIToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: any };
}

/** 统一 AI 调用请求 */
export interface UserAIRequest {
  messages: AIMessage[];
  /** 数据库模型记录 ID；缺省用用户默认模型 */
  modelId?: string;
  /** 调用场景，用于用量记录；'tool' 表示工具内部调用（如 analyze_script，不挂 tools 防递归） */
  feature: 'chat' | 'analyze_file' | 'agent' | 'report_analysis' | 'tool';
  tools?: AIToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  /** 所属对话 ID（仅 AI 助手对话场景），写入用量日志用于对话级 token 统计 */
  conversationId?: string;
}

/** 统一 AI 调用响应（非流式） */
export interface UserAIResponse {
  message: string;
  toolCalls?: AIToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  provider: string;
  /** true 表示走了 .env MiMo 兜底（用户未配置模型） */
  fallback: boolean;
}

/** 解析后的调用配置（数据库配置或 .env 兜底） */
export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
  /** 模型能力声明：是否支持工具调用（DB 模型；兜底配置视为支持） */
  supportsTools: boolean;
  /** 思考强度：'' 表示不传（自动）；low/medium/high 时请求体带 reasoning_effort */
  reasoningEffort: string;
  quirks: VendorQuirks;
  /** 数据库模型记录 ID；兜底时为 null（不写用量日志） */
  modelDbId: string | null;
  providerName: string;
  fallback: boolean;
}

// ═══════════════════════════════════════════════════════
//  配置解析
// ═══════════════════════════════════════════════════════

/**
 * 解析本次调用使用的配置。
 * 优先取用户数据库配置（指定 modelId 或默认模型）；
 * 用户无启用模型时回退到 .env 的 MiMo 配置（要求 MIMO_API_KEY 存在且非占位符）。
 */
export async function resolveConfig(userId: string, modelId?: string): Promise<ResolvedConfig> {
  const row = modelId
    ? await userAIConfigRepository.getModelWithProvider(userId, modelId)
    : await userAIConfigRepository.getDefaultModel(userId);
  if (row) {
    const quirks = VENDOR_QUIRKS[row.provider.vendor_key as VendorKey] ?? VENDOR_QUIRKS.custom;
    return {
      apiKey: row.provider.api_key,
      baseUrl: row.provider.base_url,
      model: row.model_id,
      maxInputTokens: row.max_input_tokens,
      maxOutputTokens: row.max_output_tokens,
      temperature: row.temperature,
      supportsTools: (row.supports_tools ?? 1) === 1,
      reasoningEffort: row.thinking_mode === 1 ? (row.reasoning_effort ?? '') : '',
      quirks,
      modelDbId: row.id,
      providerName: row.provider.name,
      fallback: false,
    };
  }
  // .env 兜底：用户无启用模型且 MIMO_API_KEY 有效
  const env = getConfig();
  if (env.MIMO_API_KEY && !env.MIMO_API_KEY.startsWith('tp-xxxxx')) {
    return {
      apiKey: env.MIMO_API_KEY,
      baseUrl: env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
      model: env.MIMO_MODEL || 'mimo-v2.5-pro',
      maxInputTokens: 128000,
      maxOutputTokens: Math.min(env.MIMO_MAX_TOKENS || 4096, OUTPUT_TOKEN_CEILING),
      temperature: 0.7,
      supportsTools: true,
      reasoningEffort: '',
      quirks: VENDOR_QUIRKS.mimo,
      modelDbId: null,
      providerName: '系统默认',
      fallback: true,
    };
  }
  throw new Error('未配置 AI 模型，请前往「AI 设置」添加厂商和模型');
}

// ═══════════════════════════════════════════════════════
//  内部工具函数
// ═══════════════════════════════════════════════════════

/** 构建认证 headers（空 authPrefix 表示无前缀，如 MiMo 的 api-key 头） */
function buildAuthHeaders(quirks: VendorQuirks, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers[quirks.authHeader] = quirks.authPrefix ? quirks.authPrefix + apiKey : apiKey;
  return headers;
}

/**
 * 按 maxInputTokens 截断消息历史（粗算 1 token ≈ 2 字符）。
 * 超出时从最早的非 system 消息开始丢弃，system 消息始终保留。
 */
function truncateMessages(messages: AIMessage[], maxInputTokens: number): AIMessage[] {
  const maxChars = maxInputTokens * 2;
  const msgChars = (m: AIMessage) =>
    (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  const result = [...messages];
  let total = result.reduce((sum, m) => sum + msgChars(m), 0);
  // 从头开始丢弃最早的非 system 消息，直到总量不超限
  while (total > maxChars && result.length > 0) {
    const idx = result.findIndex((m) => m.role !== 'system');
    if (idx === -1) break; // 只剩 system 消息，无法继续丢弃
    total -= msgChars(result[idx]);
    result.splice(idx, 1);
  }
  return sanitizeToolChains(result);
}

/**
 * 修复截断后被破坏的工具调用链（部分厂商严格校验）：
 * 1. 删除没有对应 assistant tool_calls 的孤立 tool 消息；
 * 2. assistant 消息的 tool_calls 若缺少对应 tool 响应，
 *    将该消息降级为纯文本 assistant（去掉 tool_calls），避免出现
 *    "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"。
 */
function sanitizeToolChains(messages: AIMessage[]): AIMessage[] {
  // 每个 tool_call_id 对应的 assistant 消息是否仍在
  const liveCallIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) liveCallIds.add(tc.id);
    }
  }
  const cleaned: AIMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      // 孤立的 tool 消息（其 assistant tool_calls 已被截断丢弃）→ 转为普通 user 备注保留上下文
      if (m.tool_call_id && !liveCallIds.has(m.tool_call_id)) {
        cleaned.push({ role: 'user', content: `[早期工具读取结果，调用链已截断]\n${m.content ?? ''}` });
        continue;
      }
      cleaned.push(m);
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      // 该 assistant 的 tool 响应是否完整保留
      const responseIds = new Set(
        messages.filter((x) => x.role === 'tool').map((x) => x.tool_call_id)
      );
      const allAnswered = m.tool_calls.every((tc) => responseIds.has(tc.id) && liveCallIds.has(tc.id));
      if (!allAnswered) {
        // 响应不完整：降级为纯文本，避免请求被厂商拒绝
        if (m.content) cleaned.push({ role: 'assistant', content: m.content });
        continue;
      }
    }
    cleaned.push(m);
  }
  return cleaned;
}

/** 构造上游 chat/completions 请求体 */
function buildRequestBody(
  cfg: ResolvedConfig,
  req: UserAIRequest,
  stream: boolean
): Record<string, any> {
  // 模型声明不支持工具调用时给出明确报错，避免上游返回难懂的错误
  if (req.tools?.length && !cfg.supportsTools) {
    throw new Error(`模型 ${cfg.model} 未声明支持「工具调用」，此功能需要支持工具调用的模型，请在 AI 设置中调整模型能力或更换模型`);
  }
  const body: Record<string, any> = {
    model: cfg.model,
    messages: truncateMessages(req.messages, cfg.maxInputTokens),
    // 按厂商 quirks 选择 token 参数名，并裁剪到模型上限
    [cfg.quirks.tokenParam]: Math.min(req.maxOutputTokens ?? cfg.maxOutputTokens, OUTPUT_TOKEN_CEILING),
    temperature: req.temperature ?? cfg.temperature,
    stream,
    ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
    // 思考强度（OpenAI 兼容 reasoning_effort）：仅在模型开启思考模式且用户选择了档位时传
    ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
  };
  return body;
}

/** 处理上游错误响应，转为用户可读的 Error */
async function throwForErrorResponse(response: Response, context: string): Promise<never> {
  const errorText = await response.text().catch(() => '');
  log.error(`${context} API 错误 (${response.status}): ${errorText.slice(0, 500)}`);
  if (response.status === 401) throw new Error('API Key 无效或已过期');
  if (response.status === 429) throw new Error('请求频率过高');
  throw new Error(`API 返回错误 (${response.status}): ${errorText.slice(0, 300)}`);
}

/** 请求体快照最大存储长度（超出截断并标注） */
const REQUEST_BODY_SNAPSHOT_LIMIT = 40000;

/**
 * 生成请求体检视信息：结构摘要（消息数/每条消息角色与字符数/工具数/参数）
 * + 完整请求体快照（超长截断）。供调用记录排查异常提交。
 */
function buildRequestInspection(body: Record<string, any>): { summary: string; body: string } {
  const messages = (body.messages || []) as Array<{ role?: string; content?: string; tool_calls?: any }>;
  const summary = {
    model: body.model,
    messageCount: messages.length,
    totalChars: messages.reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0),
      0
    ),
    messages: messages.map((m) => ({
      role: m.role || 'unknown',
      chars: (typeof m.content === 'string' ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0),
    })),
    toolsCount: Array.isArray(body.tools) ? body.tools.length : 0,
    temperature: body.temperature,
    maxOutputTokens: body.max_tokens ?? body.max_completion_tokens,
    stream: !!body.stream,
  };
  let bodyJson = JSON.stringify(body);
  if (bodyJson.length > REQUEST_BODY_SNAPSHOT_LIMIT) {
    bodyJson = bodyJson.slice(0, REQUEST_BODY_SNAPSHOT_LIMIT) + `\n...[已截断，原始长度 ${bodyJson.length} 字符]`;
  }
  return { summary: JSON.stringify(summary), body: bodyJson };
}

// ═══════════════════════════════════════════════════════
//  统一调用入口
// ═══════════════════════════════════════════════════════

/**
 * 统一 AI 调用（非流式）。
 * 解析 choices[0].message（content + tool_calls）与 usage；
 * 成功且 modelDbId 非空（非兜底）时写用量日志。
 */
export async function callUserAI(userId: string, req: UserAIRequest): Promise<UserAIResponse> {
  const cfg = await resolveConfig(userId, req.modelId);
  const url = `${cfg.baseUrl}/chat/completions`;
  const body = buildRequestBody(cfg, req, false);
  const inspection = buildRequestInspection(body);
  const startedAt = Date.now();

  log.info(`⇢ callUserAI feature=${req.feature} model=${cfg.model} provider=${cfg.providerName} fallback=${cfg.fallback} msgCount=${req.messages.length}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(cfg.quirks, cfg.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // 非流式超时 120s
    });

    if (!response.ok) {
      await throwForErrorResponse(response, 'callUserAI');
    }

    const data = (await response.json()) as any;
    const choiceMsg = data.choices?.[0]?.message ?? {};
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined;

    // 仅数据库配置（非兜底）写用量日志，失败不影响主流程
    if (cfg.modelDbId && usage) {
      try {
        await userAIConfigRepository.logUsage({
          user_id: userId,
          model_id: cfg.modelDbId,
          feature: req.feature,
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          conversation_id: req.conversationId,
          status: 'success',
          latency_ms: Date.now() - startedAt,
          request_summary: inspection.summary,
          request_body: inspection.body,
        });
      } catch (e) {
        log.warn(`写用量日志失败: ${(e as Error).message}`);
      }
    }

    return {
      message: choiceMsg.content ?? '',
      toolCalls: choiceMsg.tool_calls,
      usage,
      model: data.model ?? cfg.model,
      provider: cfg.providerName,
      fallback: cfg.fallback,
    };
  } catch (e) {
    // 请求失败也记一条调用记录（0 token），便于排查异常提交
    if (cfg.modelDbId) {
      try {
        await userAIConfigRepository.logUsage({
          user_id: userId,
          model_id: cfg.modelDbId,
          feature: req.feature,
          prompt_tokens: 0,
          completion_tokens: 0,
          conversation_id: req.conversationId,
          status: 'error',
          error: (e as Error).message,
          latency_ms: Date.now() - startedAt,
          request_summary: inspection.summary,
          request_body: inspection.body,
        });
      } catch (logErr) {
        log.warn(`写失败用量日志失败: ${(logErr as Error).message}`);
      }
    }
    throw e;
  }
}

/**
 * 包装上游 SSE 流：原样透传字节给路由层，同时在后台解析 data: 行，
 * 提取流末尾的 usage 统计（OpenAI 兼容 stream_options.include_usage）并累计输出字符数。
 * 流正常结束 / 中途出错 / 客户端取消时各回调一次 onFinish（内部去重，保证只记一次日志）。
 */
function wrapStreamForUsageLogging(
  upstream: ReadableStream<Uint8Array>,
  onFinish: (
    usage: { promptTokens: number; completionTokens: number } | null,
    completionChars: number,
    status: 'success' | 'error' | 'canceled',
    errorMessage?: string
  ) => void
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: { promptTokens: number; completionTokens: number } | null = null;
  let completionChars = 0;
  let finished = false;

  const finish = (status: 'success' | 'error' | 'canceled', errorMessage?: string): void => {
    if (finished) return;
    finished = true;
    try {
      onFinish(usage, completionChars, status, errorMessage);
    } catch { /* 用量统计失败不影响主流程 */ }
  };

  /** 解析一行 SSE 数据：捕获 usage 字段并累计输出字符数（估算用） */
  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) return;
    const dataPart = trimmed.slice(6);
    if (dataPart === '[DONE]') return;
    try {
      const parsed = JSON.parse(dataPart);
      if (parsed.usage) {
        usage = {
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0,
        };
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') completionChars += delta.length;
    } catch { /* 忽略无法解析的行 */ }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // flush 解码器与行缓冲，处理流末尾残留的完整行
          buffer += decoder.decode();
          if (buffer.trim()) handleLine(buffer);
          controller.close();
          finish('success');
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 末尾不完整的一行留到下一轮拼接
        buffer = lines.pop() || '';
        for (const line of lines) handleLine(line);
        controller.enqueue(value);
      } catch (e) {
        // 上游流中途出错：记日志后把错误透传给路由层
        finish('error', (e as Error).message);
        controller.error(e);
      }
    },
    async cancel(reason) {
      finish('canceled', reason ? String(reason) : undefined);
      await reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * 流式调用用量记录：优先使用上游返回的 usage，缺失时按字符数估算（约 2 字符/token）。
 * 字段与 userAIConfigRepository.logUsage 签名一致；写库失败仅告警，不影响主流程。
 */
async function logStreamUsage(
  userId: string,
  cfg: ResolvedConfig,
  feature: UserAIRequest['feature'],
  usage: { promptTokens: number; completionTokens: number } | null,
  promptChars: number,
  completionChars: number,
  conversationId?: string,
  extra?: {
    status?: 'success' | 'error' | 'canceled';
    error?: string;
    latencyMs?: number;
    inspection?: { summary: string; body: string };
  }
): Promise<void> {
  // .env 兜底无数据库模型记录，与非流式 callUserAI 一致不写用量日志
  if (!cfg.modelDbId) return;
  try {
    await userAIConfigRepository.logUsage({
      user_id: userId,
      model_id: cfg.modelDbId,
      feature,
      prompt_tokens: usage?.promptTokens ?? Math.ceil(promptChars / 2),
      completion_tokens: usage?.completionTokens ?? Math.ceil(completionChars / 2),
      conversation_id: conversationId,
      status: extra?.status || 'success',
      error: extra?.error,
      latency_ms: extra?.latencyMs,
      request_summary: extra?.inspection?.summary,
      request_body: extra?.inspection?.body,
    });
  } catch (e) {
    log.warn(`写流式用量日志失败: ${(e as Error).message}`);
  }
}

/**
 * 统一 AI 调用（流式）。
 * 返回包装后的上游 SSE 流（转发逻辑由路由层负责，与旧 ai.ts 一致）；
 * 流结束/出错/取消后补写一条用量日志：支持的厂商请求时带 stream_options.include_usage
 * 取流末尾 usage，取不到时按字符数估算；请求阶段失败的调用也记一条 0-token 记录。
 */
export async function callUserAIStream(
  userId: string,
  req: UserAIRequest
): Promise<{ stream: ReadableStream<Uint8Array>; model: string; provider: string; fallback: boolean }> {
  const cfg = await resolveConfig(userId, req.modelId);
  const url = `${cfg.baseUrl}/chat/completions`;
  const body = buildRequestBody(cfg, req, true);
  // 按厂商支持情况请求流末尾 usage 统计；不支持的厂商在写日志时按字符数估算
  if (cfg.quirks.supportsStreamUsage) {
    body.stream_options = { include_usage: true };
  }
  // 估算用的输入字符数（按截断后的实际请求消息计）
  const promptChars = (body.messages as AIMessage[]).reduce(
    (sum, m) => sum + (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0),
    0
  );
  const inspection = buildRequestInspection(body);
  const startedAt = Date.now();

  log.info(`⇢ callUserAIStream feature=${req.feature} model=${cfg.model} provider=${cfg.providerName} fallback=${cfg.fallback} msgCount=${req.messages.length}`);

  // 流式不设超时：长回复可能持续较久，由路由层/客户端控制中断
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(cfg.quirks, cfg.apiKey),
      body: JSON.stringify(body),
    });
  } catch (e) {
    // 请求未发出即失败：记一条 0-token 用量日志后原样抛出
    await logStreamUsage(userId, cfg, req.feature, { promptTokens: 0, completionTokens: 0 }, 0, 0, req.conversationId, {
      status: 'error',
      error: (e as Error).message,
      latencyMs: Date.now() - startedAt,
      inspection,
    });
    throw e;
  }

  if (!response.ok) {
    // 上游返回错误：记一条 0-token 用量日志后按统一错误处理抛出
    const statusCode = response.status;
    await logStreamUsage(userId, cfg, req.feature, { promptTokens: 0, completionTokens: 0 }, 0, 0, req.conversationId, {
      status: 'error',
      error: `API 返回错误 (${statusCode})`,
      latencyMs: Date.now() - startedAt,
      inspection,
    });
    await throwForErrorResponse(response, 'callUserAIStream');
  }
  if (!response.body) {
    await logStreamUsage(userId, cfg, req.feature, { promptTokens: 0, completionTokens: 0 }, 0, 0, req.conversationId, {
      status: 'error',
      error: 'API 未返回流式响应',
      latencyMs: Date.now() - startedAt,
      inspection,
    });
    throw new Error('API 未返回流式响应');
  }

  const wrappedStream = wrapStreamForUsageLogging(
    response.body as unknown as ReadableStream<Uint8Array>,
    (usage, completionChars, status, errorMessage) => {
      logStreamUsage(userId, cfg, req.feature, usage, promptChars, completionChars, req.conversationId, {
        status,
        error: errorMessage,
        latencyMs: Date.now() - startedAt,
        inspection,
      }).catch(() => {});
    }
  );

  return {
    stream: wrappedStream,
    model: cfg.model,
    provider: cfg.providerName,
    fallback: cfg.fallback,
  };
}

// ═══════════════════════════════════════════════════════
//  厂商配置辅助能力
// ═══════════════════════════════════════════════════════

/**
 * 拉取厂商远程模型列表：GET {baseUrl}/models，15s 超时。
 * 返回模型 ID 字符串数组；baseUrl 为空时回退到厂商默认地址。
 */
export async function fetchRemoteModels(provider: UserAIProvider): Promise<string[]> {
  const quirks = VENDOR_QUIRKS[provider.vendor_key as VendorKey] ?? VENDOR_QUIRKS.custom;
  const baseUrl = provider.base_url || quirks.defaultBaseUrl;
  if (!baseUrl) throw new Error('该厂商未配置 API 地址');

  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: buildAuthHeaders(quirks, provider.api_key),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    await throwForErrorResponse(response, 'fetchRemoteModels');
  }

  const data = (await response.json()) as any;
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.map((m: any) => m.id).filter((id: any) => typeof id === 'string');
}

/**
 * 测试指定模型的可用性：用该模型发送一个最小对话请求，
 * 校验能否正常返回内容，并测量耗时。
 * 返回 { ok, latencyMs, reply?, error? }，不抛异常。
 */
export async function testModelConnection(
  provider: Pick<UserAIProvider, 'vendor_key' | 'base_url' | 'api_key'>,
  modelId: string
): Promise<{ ok: boolean; latencyMs?: number; reply?: string; error?: string }> {
  const startedAt = Date.now();
  try {
    const quirks = VENDOR_QUIRKS[provider.vendor_key as VendorKey] ?? VENDOR_QUIRKS.custom;
    const baseUrl = provider.base_url || quirks.defaultBaseUrl;
    if (!baseUrl) return { ok: false, error: '该厂商未配置 API 地址' };
    if (!provider.api_key) return { ok: false, error: '未配置 API Key' };

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildAuthHeaders(quirks, provider.api_key),
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Hi，请用一句话回复确认你可以正常工作。' }],
        // 给足输出额度：推理类模型（如 MiMo）会先消耗思考 token，额度过小会导致正文为空
        [quirks.tokenParam]: 512,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 401) return { ok: false, latencyMs, error: 'API Key 无效或已过期' };
      if (response.status === 404) return { ok: false, latencyMs, error: `模型不存在或未开通（${modelId}）` };
      if (response.status === 429) return { ok: false, latencyMs, error: '请求频率过高，请稍后再试' };
      return { ok: false, latencyMs, error: `API 返回错误 (${response.status}): ${errorText.slice(0, 200)}` };
    }

    const data = (await response.json()) as any;
    const choice = data?.choices?.[0] ?? {};
    const reply: string = choice.message?.content ?? '';
    if (reply && reply.trim()) {
      return { ok: true, latencyMs, reply: reply.trim().slice(0, 120) };
    }
    // 正文为空但属于推理 token 用尽（finish_reason=length）或有推理内容：
    // 说明模型正常响应了，只是输出额度被思考过程占满，视为可用
    const reasoning: string = choice.message?.reasoning_content ?? '';
    if (choice.finish_reason === 'length' || reasoning.trim()) {
      return { ok: true, latencyMs, reply: '（推理模型：思考过程正常返回，正文被输出上限截断）' };
    }
    return { ok: false, latencyMs, error: '模型返回了空内容' };
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('timed out') || msg.includes('TimeoutError') || (e as any)?.name === 'TimeoutError') {
      return { ok: false, latencyMs: Date.now() - startedAt, error: '请求超时（60s），模型无响应' };
    }
    return { ok: false, latencyMs: Date.now() - startedAt, error: msg || '网络请求失败' };
  }
}

/**
 * 测试厂商连接：发送一个最小「Hi」请求（max output = 16）。
 * 返回 { ok: true } 或 { ok: false, error }，不抛异常。
 */
export async function testProviderConnection(
  provider: Pick<UserAIProvider, 'vendor_key' | 'base_url' | 'api_key'>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const quirks = VENDOR_QUIRKS[provider.vendor_key as VendorKey] ?? VENDOR_QUIRKS.custom;
    const baseUrl = provider.base_url || quirks.defaultBaseUrl;
    if (!baseUrl) return { ok: false, error: '该厂商未配置 API 地址' };
    if (!provider.api_key) return { ok: false, error: '未配置 API Key' };

    // 用厂商默认模型的第一个作为探测模型
    const model = quirks.defaultModels[0] ?? 'gpt-4o-mini';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildAuthHeaders(quirks, provider.api_key),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        [quirks.tokenParam]: 16,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 401) return { ok: false, error: 'API Key 无效或已过期' };
      if (response.status === 429) return { ok: false, error: '请求频率过高' };
      return { ok: false, error: `API 返回错误 (${response.status}): ${errorText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
