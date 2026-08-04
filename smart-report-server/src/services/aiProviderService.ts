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
export type VendorKey = 'mimo' | 'deepseek' | 'kimi' | 'qwen' | 'glm' | 'minimax' | 'lingyi' | 'openai' | 'custom';

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
  custom:  { key: 'custom',  name: '自定义',      defaultBaseUrl: '',                                                authHeader: 'Authorization', authPrefix: 'Bearer ', tokenParam: 'max_tokens',            supportsStreamUsage: false, defaultModels: [] },
};

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
interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
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
async function resolveConfig(userId: string, modelId?: string): Promise<ResolvedConfig> {
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
      maxOutputTokens: Math.min(env.MIMO_MAX_TOKENS || 4096, 131072),
      temperature: 0.7,
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
  return result;
}

/** 构造上游 chat/completions 请求体 */
function buildRequestBody(
  cfg: ResolvedConfig,
  req: UserAIRequest,
  stream: boolean
): Record<string, any> {
  const body: Record<string, any> = {
    model: cfg.model,
    messages: truncateMessages(req.messages, cfg.maxInputTokens),
    // 按厂商 quirks 选择 token 参数名，并裁剪到模型上限
    [cfg.quirks.tokenParam]: Math.min(req.maxOutputTokens ?? cfg.maxOutputTokens, 131072),
    temperature: req.temperature ?? cfg.temperature,
    stream,
    ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
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

  log.info(`⇢ callUserAI feature=${req.feature} model=${cfg.model} provider=${cfg.providerName} fallback=${cfg.fallback} msgCount=${req.messages.length}`);

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
    completionChars: number
  ) => void
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: { promptTokens: number; completionTokens: number } | null = null;
  let completionChars = 0;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    try {
      onFinish(usage, completionChars);
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
          finish();
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
        finish();
        controller.error(e);
      }
    },
    async cancel(reason) {
      finish();
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
  completionChars: number
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
    await logStreamUsage(userId, cfg, req.feature, { promptTokens: 0, completionTokens: 0 }, 0, 0);
    throw e;
  }

  if (!response.ok) {
    // 上游返回错误：记一条 0-token 用量日志后按统一错误处理抛出
    await logStreamUsage(userId, cfg, req.feature, { promptTokens: 0, completionTokens: 0 }, 0, 0);
    await throwForErrorResponse(response, 'callUserAIStream');
  }
  if (!response.body) {
    await logStreamUsage(userId, cfg, req.feature, { promptTokens: 0, completionTokens: 0 }, 0, 0);
    throw new Error('API 未返回流式响应');
  }

  const wrappedStream = wrapStreamForUsageLogging(
    response.body as unknown as ReadableStream<Uint8Array>,
    (usage, completionChars) => {
      logStreamUsage(userId, cfg, req.feature, usage, promptChars, completionChars).catch(() => {});
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
