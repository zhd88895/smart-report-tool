/**
 * AI 配置服务层
 * 数据源为服务端 /api/ai-config 接口（Cookie 会话），不再读取前端 localStorage 配置
 */

import { getApiUrl } from './api';

/** 服务端解析后的模型（含所属厂商信息） */
export interface ResolvedModel {
  id: string;
  providerId: string;
  providerName: string;
  vendorKey: string;
  modelId: string;
  displayName: string;
  isDefault: boolean;
}

/** 服务端解析后的完整 AI 配置 */
export interface ResolvedAIConfig {
  defaultModel: ResolvedModel | null;
  models: ResolvedModel[];
  fallbackAvailable: boolean;
}

/** 获取服务端解析后的 AI 配置 */
export async function fetchResolved(): Promise<ResolvedAIConfig> {
  const res = await fetch(getApiUrl('/ai-config/resolved'), { credentials: 'include' });
  if (!res.ok) throw new Error('获取 AI 配置失败');
  return (await res.json()).data;
}

// ═══════════════════════════════════════════════════════
//  AI 设置页：厂商 / 模型 / 用量管理 API
// ═══════════════════════════════════════════════════════

/** 厂商预设（镜像后端 aiProviderService.VENDOR_QUIRKS） */
export interface VendorPreset {
  key: string;
  name: string;
  defaultBaseUrl: string;
}

export const VENDOR_PRESETS: VendorPreset[] = [
  { key: 'mimo',    name: '小米 MiMo',  defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
  { key: 'deepseek',name: 'DeepSeek',   defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { key: 'kimi',    name: 'Kimi',       defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { key: 'qwen',    name: '通义千问',    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { key: 'glm',     name: '智谱 GLM',   defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { key: 'minimax', name: 'MiniMax',    defaultBaseUrl: 'https://api.minimax.chat/v1' },
  { key: 'lingyi',  name: '零一万物',    defaultBaseUrl: 'https://api.lingyiwanwu.com/v1' },
  { key: 'openai',  name: 'OpenAI',     defaultBaseUrl: 'https://api.openai.com/v1' },
  { key: 'opencode-go', name: 'OpenCode Go', defaultBaseUrl: 'https://opencode.ai/zen/go/v1' },
  { key: 'custom',  name: '自定义',      defaultBaseUrl: '' },
];

/** 厂商列表/详情项（api_key 已打码） */
export interface AIProvider {
  id: string;
  vendorKey: string;
  vendorName: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  enabled: boolean;
  sortOrder: number;
  modelCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** 模型项 */
export interface AIModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  temperature: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** 官方已知上下文/输出上限（后端按模型规格表返回，未收录为 null） */
  knownLimits?: { maxInputTokens?: number; maxOutputTokens?: number } | null;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** fetch-models 差量结果 */
export interface FetchModelsResult {
  newModels: string[];
  remoteCount: number;
  imported?: { importedCount: number; skippedCount: number; models: AIModel[] };
}

/** 用量统计行（按模型+功能聚合） */
export interface UsageStatRow {
  model_id: string;
  feature: string;
  prompt_total: number;
  completion_total: number;
  calls: number;
}

export interface UsageStats {
  days: number;
  stats: UsageStatRow[];
}

/** 统一请求：解包 { code, data, message }，失败抛 Error(message) */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(getApiUrl(path), {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `请求失败 (${res.status})`);
  }
  return json?.data as T;
}

const jsonBody = (data: unknown): RequestInit => ({ body: JSON.stringify(data) });

// ── 厂商 ──

export async function listProviders(): Promise<AIProvider[]> {
  return (await request<{ providers: AIProvider[] }>('/ai-config/providers')).providers;
}

export async function createProvider(data: {
  vendorKey: string; name: string; baseUrl?: string; apiKey: string;
}): Promise<AIProvider> {
  return (await request<{ provider: AIProvider }>('/ai-config/providers', {
    method: 'POST', ...jsonBody(data),
  })).provider;
}

export async function updateProvider(
  id: string,
  data: { name?: string; baseUrl?: string; apiKey?: string; sortOrder?: number }
): Promise<AIProvider> {
  return (await request<{ provider: AIProvider }>(`/ai-config/providers/${id}`, {
    method: 'PUT', ...jsonBody(data),
  })).provider;
}

export async function deleteProvider(id: string): Promise<void> {
  await request<{ success: boolean }>(`/ai-config/providers/${id}`, { method: 'DELETE' });
}

export async function toggleProvider(id: string, enabled: boolean): Promise<AIProvider> {
  return (await request<{ provider: AIProvider }>(`/ai-config/providers/${id}/toggle`, {
    method: 'PUT', ...jsonBody({ enabled }),
  })).provider;
}

// ── 模型 ──

export async function listModels(providerId: string): Promise<AIModel[]> {
  return (await request<{ models: AIModel[] }>(`/ai-config/providers/${providerId}/models`)).models;
}

export async function createModel(
  providerId: string,
  data: { modelId: string; displayName?: string }
): Promise<AIModel> {
  return (await request<{ model: AIModel }>(`/ai-config/providers/${providerId}/models`, {
    method: 'POST', ...jsonBody(data),
  })).model;
}

export async function updateModel(
  id: string,
  data: { displayName?: string; temperature?: number; maxInputTokens?: number; maxOutputTokens?: number }
): Promise<AIModel> {
  return (await request<{ model: AIModel }>(`/ai-config/models/${id}`, {
    method: 'PUT', ...jsonBody(data),
  })).model;
}

export async function deleteModel(id: string): Promise<void> {
  await request<{ success: boolean }>(`/ai-config/models/${id}`, { method: 'DELETE' });
}

export async function toggleModel(id: string, enabled: boolean): Promise<AIModel> {
  return (await request<{ model: AIModel }>(`/ai-config/models/${id}/toggle`, {
    method: 'PUT', ...jsonBody({ enabled }),
  })).model;
}

export async function setDefaultModel(id: string): Promise<void> {
  await request<{ success: boolean }>(`/ai-config/models/${id}/set-default`, { method: 'PUT' });
}

/** 模型可用性测试结果 */
export interface ModelTestResult {
  ok: boolean;
  latencyMs?: number;
  reply?: string;
  error?: string;
}

/** 测试指定模型：发送最小对话请求，校验能否正常返回内容并测量耗时 */
export async function testModel(id: string): Promise<ModelTestResult> {
  return request<ModelTestResult>(`/ai-config/models/${id}/test`, { method: 'POST' });
}

/** 拉取远端模型差量；doImport=true 时后端直接全量导入差量 */
export async function fetchProviderModels(providerId: string, doImport = false): Promise<FetchModelsResult> {
  return request<FetchModelsResult>(`/ai-config/providers/${providerId}/fetch-models`, {
    method: 'POST', ...jsonBody(doImport ? { import: true } : {}),
  });
}

// ── 辅助 ──

/** 连接/模型测试结果（带 modelId 时含耗时与回复摘要） */
export interface ConnectionTestResult {
  ok: boolean;
  latencyMs?: number;
  reply?: string;
  error?: string;
}

/** 测试连接：providerId（已保存厂商）或内联 { vendorKey, baseUrl, apiKey }；附带 modelId 时测试该模型的真实对话可用性 */
export async function testConnection(
  body: ({ providerId: string } | { vendorKey: string; baseUrl?: string; apiKey?: string }) & { modelId?: string }
): Promise<ConnectionTestResult> {
  return request<ConnectionTestResult>('/ai-config/test-connection', {
    method: 'POST', ...jsonBody(body),
  });
}

/** 近 30 天用量统计（按模型+功能聚合） */
export async function fetchUsage(): Promise<UsageStats> {
  return request<UsageStats>('/ai-config/usage');
}

// ── 调用记录 ──

/** 调用记录列表行（不含请求体大字段） */
export interface CallLogRecord {
  id: string;
  model_id: string;
  feature: string;
  prompt_tokens: number;
  completion_tokens: number;
  conversation_id: string | null;
  status: 'success' | 'error' | 'canceled';
  error: string | null;
  latency_ms: number | null;
  request_summary: string | null;
  created_at: string;
}

/** 调用记录详情（含请求体快照） */
export interface CallLogDetail extends CallLogRecord {
  request_body: string | null;
}

export interface CallLogListResult {
  total: number;
  rows: CallLogRecord[];
}

/** 分页查询调用记录（可按功能筛选） */
export async function fetchCallLogs(params: {
  feature?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<CallLogListResult> {
  const qs = new URLSearchParams();
  if (params.feature) qs.set('feature', params.feature);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<CallLogListResult>(`/ai-config/call-logs${suffix}`);
}

/** 查询单条调用记录详情（含请求体快照） */
export async function fetchCallLogDetail(id: string): Promise<CallLogDetail> {
  return request<CallLogDetail>(`/ai-config/call-logs/${id}`);
}

const LEGACY_KEY = 'ai-vendor-config';

/**
 * 一次性迁移：旧 localStorage 配置入库。返回是否执行了迁移。
 * 仅在全部步骤成功后才清除 localStorage；任何一步失败都保留原始数据，
 * 以便下次启动重试（避免 API Key 被永久删除）。
 */
export async function migrateLegacyConfig(): Promise<boolean> {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return false;
  try {
    const state = JSON.parse(raw)?.state;
    if (!state?.apiKey) {
      // 旧数据无有效配置，直接清除
      localStorage.removeItem(LEGACY_KEY);
      return false;
    }
    // 库中已有厂商时视为已迁移（防多浏览器环境重复建厂商），直接清除旧数据
    const existing = await listProviders().catch(() => []);
    if (existing.length > 0) {
      localStorage.removeItem(LEGACY_KEY);
      return false;
    }
    // 后端 createProvider 解构 camelCase 字段：vendorKey/name/baseUrl/apiKey
    const provider = await createProvider({
      vendorKey: state.vendor || 'mimo',
      name: '小米 MiMo（迁移）',
      baseUrl: state.baseUrl || 'https://token-plan-cn.xiaomimimo.com/v1',
      apiKey: state.apiKey,
    });
    if (!provider?.id) throw new Error('迁移创建厂商失败');
    // 添加模型并修正 maxTokens（旧值 1048576 是 400 报错元凶）
    // 后端 createModel 解构 camelCase 字段：modelId/displayName
    await createModel(provider.id, {
      modelId: state.model || 'mimo-v2.5-pro',
      displayName: state.model || 'mimo-v2.5-pro',
    });
    // 两步都成功后才清除 localStorage，失败保留以便下次启动重试
    localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch (e) {
    console.warn('[AI 配置迁移] 旧 localStorage 配置迁移失败，已保留原始数据以便下次重试：', e);
    return false;
  }
}
