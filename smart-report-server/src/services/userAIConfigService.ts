/**
 * 用户级 AI 配置服务模块
 *
 * 在 userAIConfigRepository 之上提供业务逻辑：
 * - 厂商/模型 CRUD 的参数校验与 DTO 组装（api_key 出库即打码）
 * - 默认模型唯一性维护（首个模型自动设为默认）
 * - 远端模型拉取差量导入
 * - 模型选择器数据源（resolved）与用量统计
 *
 * 所有方法均以 userId 为隔离键，越权访问他人资源返回 null（路由层统一 404）。
 *
 * @module services/userAIConfigService
 */

import { getConfig } from '../config';
import {
  userAIConfigRepository,
  type UserAIProvider,
  type UserAIModel,
} from '../db/repositories/userAIConfigRepository';
import {
  VENDOR_QUIRKS,
  fetchRemoteModels,
  testProviderConnection,
  testModelConnection,
  getKnownModelLimits,
  type VendorKey,
} from './aiProviderService';

// ═══════════════════════════════════════════════════════
//  DTO 类型定义（对前端暴露的响应形状， camelCase，不含 api_key 原文）
// ═══════════════════════════════════════════════════════

/** 厂商列表/详情项：apiKeyMasked 替代 api_key 原文 */
export interface ProviderDTO {
  id: string;
  vendorKey: string;
  vendorName: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  enabled: boolean;
  sortOrder: number;
  /** 厂商下模型数量（仅列表接口填充） */
  modelCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** 模型项 */
export interface ModelDTO {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  temperature: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** 官方已知上下文/输出上限（未收录的模型为 null），供前端提示与一键填满 */
  knownLimits: { maxInputTokens?: number; maxOutputTokens?: number } | null;
  /** 能力声明：工具调用 */
  supportsTools: boolean;
  /** 能力声明：图片输入（当前仅作元数据记录） */
  supportsVision: boolean;
  /** 能力声明：思考模式 */
  thinkingMode: boolean;
  /** 思考强度：'' 自动 / low / medium / high */
  reasoningEffort: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 模型选择器数据源中的精简模型项 */
export interface ResolvedModel {
  id: string;
  providerId: string;
  providerName: string;
  vendorKey: string;
  modelId: string;
  displayName: string;
  isDefault: boolean;
}

/** GET /resolved 的响应形状 */
export interface ResolvedConfigDTO {
  defaultModel: ResolvedModel | null;
  models: ResolvedModel[];
  /** .env MiMo 兜底是否可用（MIMO_API_KEY 存在且非占位符） */
  fallbackAvailable: boolean;
}

/** fetch-models 差量结果 */
export interface FetchModelsResult {
  /** 远端有而库中未添加的模型 ID 差量 */
  newModels: string[];
  /** 远端模型总数 */
  remoteCount: number;
  /** import: true 时的导入结果 */
  imported?: { importedCount: number; skippedCount: number; models: ModelDTO[] };
}

// ═══════════════════════════════════════════════════════
//  内部工具函数
// ═══════════════════════════════════════════════════════

/**
 * API Key 打码：长度 >10 显示前 6 位与后 4 位，否则全部打码
 */
export function maskApiKey(key: string): string {
  if (!key) return '***';
  return key.length > 10 ? `${key.slice(0, 6)}***${key.slice(-4)}` : '***';
}

/** 数据库厂商行 → 前端 DTO（不含 api_key 原文） */
function toProviderDTO(p: UserAIProvider, modelCount?: number): ProviderDTO {
  return {
    id: p.id,
    vendorKey: p.vendor_key,
    vendorName: VENDOR_QUIRKS[p.vendor_key as VendorKey]?.name ?? p.vendor_key,
    name: p.name,
    baseUrl: p.base_url,
    apiKeyMasked: maskApiKey(p.api_key),
    enabled: p.enabled === 1,
    sortOrder: p.sort_order,
    ...(modelCount !== undefined ? { modelCount } : {}),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** 查官方已知上限并转成仓储层创建参数（未收录返回空对象，走数据库默认值） */
function limitsForModel(modelId: string): { max_input_tokens?: number; max_output_tokens?: number } {
  const known = getKnownModelLimits(modelId);
  if (!known) return {};
  return {
    ...(known.maxInputTokens !== undefined ? { max_input_tokens: known.maxInputTokens } : {}),
    ...(known.maxOutputTokens !== undefined ? { max_output_tokens: known.maxOutputTokens } : {}),
  };
}

/** 数据库模型行 → 前端 DTO */
function toModelDTO(m: UserAIModel): ModelDTO {
  return {
    id: m.id,
    providerId: m.provider_id,
    modelId: m.model_id,
    displayName: m.display_name,
    temperature: m.temperature,
    maxInputTokens: m.max_input_tokens,
    maxOutputTokens: m.max_output_tokens,
    knownLimits: getKnownModelLimits(m.model_id),
    supportsTools: (m.supports_tools ?? 1) === 1,
    supportsVision: m.supports_vision === 1,
    thinkingMode: m.thinking_mode === 1,
    reasoningEffort: m.reasoning_effort ?? '',
    enabled: m.enabled === 1,
    isDefault: m.is_default === 1,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

/** 数据库模型行 + 厂商行 → 模型选择器精简项 */
function toResolvedModel(m: UserAIModel, p: UserAIProvider): ResolvedModel {
  return {
    id: m.id,
    providerId: p.id,
    providerName: p.name,
    vendorKey: p.vendor_key,
    modelId: m.model_id,
    displayName: m.display_name,
    isDefault: m.is_default === 1,
  };
}

/** 判断 .env MiMo 兜底是否可用（与 aiProviderService.resolveConfig 逻辑一致） */
function isFallbackAvailable(): boolean {
  const env = getConfig();
  return !!(env.MIMO_API_KEY && !env.MIMO_API_KEY.startsWith('tp-xxxxx'));
}

// ═══════════════════════════════════════════════════════
//  服务实现
// ═══════════════════════════════════════════════════════

export const userAIConfigService = {
  // ── 厂商（Provider）──

  /** 我的厂商列表（含模型数，api_key 打码） */
  async listProviders(userId: string): Promise<ProviderDTO[]> {
    const providers = await userAIConfigRepository.listProviders(userId);
    const models = await userAIConfigRepository.listModels(userId);
    const countMap = new Map<string, number>();
    for (const m of models) {
      countMap.set(m.provider_id, (countMap.get(m.provider_id) ?? 0) + 1);
    }
    return providers.map((p) => toProviderDTO(p, countMap.get(p.id) ?? 0));
  },

  /**
   * 新增厂商。
   * 校验：vendor_key 必须在 VENDOR_QUIRKS 中；name/apiKey 非空；
   * baseUrl 缺省用厂商默认地址，custom 无默认地址必须显式填写。
   */
  async createProvider(
    userId: string,
    data: { vendorKey: string; name: string; baseUrl?: string; apiKey: string }
  ): Promise<ProviderDTO> {
    const quirks = VENDOR_QUIRKS[data.vendorKey as VendorKey];
    if (!quirks) {
      throw new Error(`不支持的厂商类型: ${data.vendorKey}`);
    }
    if (!data.name || !data.name.trim()) {
      throw new Error('厂商名称不能为空');
    }
    if (!data.apiKey || !data.apiKey.trim()) {
      throw new Error('API Key 不能为空');
    }
    const baseUrl = (data.baseUrl ?? '').trim() || quirks.defaultBaseUrl;
    if (!baseUrl) {
      throw new Error('自定义厂商必须填写 API 地址');
    }
    const created = await userAIConfigRepository.createProvider(userId, {
      vendor_key: data.vendorKey,
      name: data.name.trim(),
      base_url: baseUrl,
      api_key: data.apiKey.trim(),
    });
    return toProviderDTO(created, 0);
  },

  /**
   * 修改厂商。apiKey 为空字符串/undefined 时不更新该字段。
   * 资源不存在（含越权）返回 null。
   */
  async updateProvider(
    userId: string,
    id: string,
    patch: { name?: string; baseUrl?: string; apiKey?: string; sortOrder?: number }
  ): Promise<ProviderDTO | null> {
    const existing = await userAIConfigRepository.getProvider(userId, id);
    if (!existing) return null;

    const repoPatch: Partial<Pick<UserAIProvider, 'name' | 'base_url' | 'api_key' | 'sort_order'>> = {};
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error('厂商名称不能为空');
      repoPatch.name = patch.name.trim();
    }
    if (patch.baseUrl !== undefined) {
      if (!patch.baseUrl.trim()) throw new Error('API 地址不能为空');
      repoPatch.base_url = patch.baseUrl.trim();
    }
    // apiKey 留空（空字符串/undefined）表示不改动
    if (patch.apiKey !== undefined && patch.apiKey !== '') {
      repoPatch.api_key = patch.apiKey.trim();
    }
    if (patch.sortOrder !== undefined) {
      repoPatch.sort_order = patch.sortOrder;
    }
    await userAIConfigRepository.updateProvider(userId, id, repoPatch);
    const updated = await userAIConfigRepository.getProvider(userId, id);
    return updated ? toProviderDTO(updated) : null;
  },

  /** 删除厂商（级联删模型）。资源不存在返回 false */
  async deleteProvider(userId: string, id: string): Promise<boolean> {
    const existing = await userAIConfigRepository.getProvider(userId, id);
    if (!existing) return false;
    await userAIConfigRepository.deleteProvider(userId, id);
    return true;
  },

  /**
   * 启用/停用厂商。body 带布尔 enabled 时设为该值，否则取反。
   * 资源不存在返回 null。
   */
  async toggleProvider(userId: string, id: string, enabled?: boolean): Promise<ProviderDTO | null> {
    const existing = await userAIConfigRepository.getProvider(userId, id);
    if (!existing) return null;
    const next = enabled !== undefined ? enabled : existing.enabled !== 1;
    await userAIConfigRepository.updateProvider(userId, id, { enabled: next ? 1 : 0 });
    const updated = await userAIConfigRepository.getProvider(userId, id);
    return updated ? toProviderDTO(updated) : null;
  },

  // ── 模型（Model）──

  /** 某厂商下我的模型列表。厂商不存在（含越权）返回 null */
  async listModels(userId: string, providerId: string): Promise<ModelDTO[] | null> {
    const provider = await userAIConfigRepository.getProvider(userId, providerId);
    if (!provider) return null;
    const models = await userAIConfigRepository.listModels(userId, providerId);
    return models.map(toModelDTO);
  },

  /**
   * 手动添加模型。厂商不存在返回 null；同厂商下 model_id 重复抛错。
   * 若用户尚无默认模型，首个模型自动设为默认。
   */
  async createModel(
    userId: string,
    providerId: string,
    data: { modelId: string; displayName?: string }
  ): Promise<ModelDTO | null> {
    const provider = await userAIConfigRepository.getProvider(userId, providerId);
    if (!provider) return null;
    if (!data.modelId || !data.modelId.trim()) {
      throw new Error('模型 ID 不能为空');
    }
    const modelId = data.modelId.trim();
    const existing = await userAIConfigRepository.listModels(userId, providerId);
    if (existing.some((m) => m.model_id === modelId)) {
      throw new Error(`模型 ${modelId} 已存在`);
    }
    const created = await userAIConfigRepository.createModel(userId, providerId, {
      model_id: modelId,
      display_name: data.displayName?.trim() || undefined,
      // 已收录官方规格的模型自动填充真实上下文/输出上限，未收录的用数据库默认值
      ...limitsForModel(modelId),
    });
    await this.ensureDefaultIfNone(userId, created.id);
    const fresh = await userAIConfigRepository.getModel(userId, created.id);
    return toModelDTO(fresh ?? created);
  },

  /**
   * 修改模型参数（显示名/温度/输入输出 Token 上限）。
   * 资源不存在（含越权）返回 null。
   */
  async updateModel(
    userId: string,
    id: string,
    patch: {
      displayName?: string;
      temperature?: number;
      maxInputTokens?: number;
      maxOutputTokens?: number;
      supportsTools?: boolean;
      supportsVision?: boolean;
      thinkingMode?: boolean;
      reasoningEffort?: string;
    }
  ): Promise<ModelDTO | null> {
    const existing = await userAIConfigRepository.getModel(userId, id);
    if (!existing) return null;

    const repoPatch: Partial<Pick<UserAIModel, 'display_name' | 'temperature' | 'max_input_tokens' | 'max_output_tokens' | 'supports_tools' | 'supports_vision' | 'thinking_mode' | 'reasoning_effort'>> = {};
    if (patch.displayName !== undefined) {
      if (!patch.displayName.trim()) throw new Error('显示名不能为空');
      repoPatch.display_name = patch.displayName.trim();
    }
    if (patch.temperature !== undefined) {
      if (typeof patch.temperature !== 'number' || patch.temperature < 0 || patch.temperature > 2) {
        throw new Error('temperature 必须是 0~2 之间的数字');
      }
      repoPatch.temperature = patch.temperature;
    }
    if (patch.maxInputTokens !== undefined) {
      if (!Number.isInteger(patch.maxInputTokens) || patch.maxInputTokens <= 0) {
        throw new Error('maxInputTokens 必须是正整数');
      }
      repoPatch.max_input_tokens = patch.maxInputTokens;
    }
    if (patch.maxOutputTokens !== undefined) {
      if (!Number.isInteger(patch.maxOutputTokens) || patch.maxOutputTokens <= 0) {
        throw new Error('maxOutputTokens 必须是正整数');
      }
      repoPatch.max_output_tokens = patch.maxOutputTokens;
    }
    if (patch.supportsTools !== undefined) repoPatch.supports_tools = patch.supportsTools ? 1 : 0;
    if (patch.supportsVision !== undefined) repoPatch.supports_vision = patch.supportsVision ? 1 : 0;
    if (patch.thinkingMode !== undefined) repoPatch.thinking_mode = patch.thinkingMode ? 1 : 0;
    if (patch.reasoningEffort !== undefined) {
      if (!['', 'low', 'medium', 'high'].includes(patch.reasoningEffort)) {
        throw new Error('reasoningEffort 必须是 auto/low/medium/high 之一');
      }
      repoPatch.reasoning_effort = patch.reasoningEffort;
    }
    await userAIConfigRepository.updateModel(userId, id, repoPatch);
    const updated = await userAIConfigRepository.getModel(userId, id);
    return updated ? toModelDTO(updated) : null;
  },

  /** 删除模型（默认模型由仓储层自动顶替）。资源不存在返回 false */
  async deleteModel(userId: string, id: string): Promise<boolean> {
    const existing = await userAIConfigRepository.getModel(userId, id);
    if (!existing) return false;
    await userAIConfigRepository.deleteModel(userId, id);
    return true;
  },

  /** 启用/停用模型。body 带布尔 enabled 时设为该值，否则取反。资源不存在返回 null */
  async toggleModel(userId: string, id: string, enabled?: boolean): Promise<ModelDTO | null> {
    const existing = await userAIConfigRepository.getModel(userId, id);
    if (!existing) return null;
    const next = enabled !== undefined ? enabled : existing.enabled !== 1;
    await userAIConfigRepository.updateModel(userId, id, { enabled: next ? 1 : 0 });
    const updated = await userAIConfigRepository.getModel(userId, id);
    return updated ? toModelDTO(updated) : null;
  },

  /** 设为默认模型（先清后设由仓储保证唯一）。资源不存在返回 false */
  async setDefaultModel(userId: string, id: string): Promise<boolean> {
    const existing = await userAIConfigRepository.getModel(userId, id);
    if (!existing) return false;
    await userAIConfigRepository.setDefaultModel(userId, id);
    return true;
  },

  /**
   * 差量导入模型：跳过已存在 model_id，返回导入结果。
   * 若用户尚无默认模型，导入的首个模型自动设为默认。
   */
  async importModels(
    userId: string,
    providerId: string,
    modelIds: string[]
  ): Promise<{ importedCount: number; skippedCount: number; models: ModelDTO[] }> {
    const existing = await userAIConfigRepository.listModels(userId, providerId);
    const existingIds = new Set(existing.map((m) => m.model_id));
    const imported: ModelDTO[] = [];
    let skippedCount = 0;
    for (const rawId of modelIds) {
      const modelId = (rawId ?? '').trim();
      if (!modelId || existingIds.has(modelId)) {
        skippedCount++;
        continue;
      }
      const created = await userAIConfigRepository.createModel(userId, providerId, { model_id: modelId, ...limitsForModel(modelId) });
      imported.push(toModelDTO(created));
      existingIds.add(modelId);
    }
    // 首个模型自动设为默认（若用户无默认模型）
    if (imported.length > 0) {
      await this.ensureDefaultIfNone(userId, imported[0].id);
    }
    // 重新读取以反映 is_default 变化
    const fresh = await userAIConfigRepository.listModels(userId, providerId);
    const freshMap = new Map(fresh.map((m) => [m.id, m]));
    return {
      importedCount: imported.length,
      skippedCount,
      models: imported.map((m) => toModelDTO(freshMap.get(m.id) ?? (m as unknown as UserAIModel))),
    };
  },

  /** 用户无默认模型时，将指定模型设为默认 */
  async ensureDefaultIfNone(userId: string, modelId: string): Promise<void> {
    const all = await userAIConfigRepository.listModels(userId);
    if (!all.some((m) => m.is_default === 1)) {
      await userAIConfigRepository.setDefaultModel(userId, modelId);
    }
  },

  // ── 远端模型拉取 / 连接测试 ──

  /**
   * 拉取远端模型列表并与库中求差。
   * import: true 时直接入库差量并返回导入结果，否则只返回差量列表。
   * 厂商不存在（含越权）返回 null。
   */
  async fetchModels(userId: string, providerId: string, doImport: boolean): Promise<FetchModelsResult | null> {
    const provider = await userAIConfigRepository.getProvider(userId, providerId);
    if (!provider) return null;

    const remoteIds = await fetchRemoteModels(provider);
    const existing = await userAIConfigRepository.listModels(userId, providerId);
    const existingIds = new Set(existing.map((m) => m.model_id));
    const newModels = remoteIds.filter((id) => !existingIds.has(id));

    const result: FetchModelsResult = { newModels, remoteCount: remoteIds.length };
    if (doImport && newModels.length > 0) {
      result.imported = await this.importModels(userId, providerId, newModels);
    } else if (doImport) {
      result.imported = { importedCount: 0, skippedCount: 0, models: [] };
    }
    return result;
  },

  /**
   * 测试连接：两种入参——
   * 1. providerId：取库中配置（隔离校验，不存在返回 null）
   * 2. 内联配置 { vendorKey, baseUrl?, apiKey }（不持久化）
   * 附带 modelId（厂商侧模型标识）时测试该模型的真实对话可用性，
   * 否则仅探测厂商默认模型。
   */
  async testConnection(
    userId: string,
    body: { providerId?: string; vendorKey?: string; baseUrl?: string; apiKey?: string; modelId?: string }
  ): Promise<{ ok: boolean; latencyMs?: number; reply?: string; error?: string } | null> {
    if (body.providerId) {
      const provider = await userAIConfigRepository.getProvider(userId, body.providerId);
      if (!provider) return null;
      if (body.modelId) return testModelConnection(provider, body.modelId);
      return testProviderConnection(provider);
    }
    if (!body.vendorKey || !VENDOR_QUIRKS[body.vendorKey as VendorKey]) {
      throw new Error('不支持的厂商类型');
    }
    const inline = {
      vendor_key: body.vendorKey,
      base_url: body.baseUrl ?? '',
      api_key: body.apiKey ?? '',
    };
    if (body.modelId) return testModelConnection(inline, body.modelId);
    return testProviderConnection(inline);
  },

  /**
   * 测试指定模型的可用性：加载用户自己的模型+厂商配置（隔离校验，
   * 不存在返回 null），向该模型发送最小对话请求并测量耗时。
   */
  async testModel(
    userId: string,
    modelId: string
  ): Promise<{ ok: boolean; latencyMs?: number; reply?: string; error?: string } | null> {
    const row = await userAIConfigRepository.getModelWithProvider(userId, modelId);
    if (!row) return null;
    return testModelConnection(row.provider, row.model_id);
  },

  // ── 模型选择器数据源 / 用量统计 ──

  /**
   * 模型选择器数据源：默认模型 + 全部启用模型精简列表 + .env 兜底可用性。
   * 仅包含厂商与模型均为启用状态的记录。
   */
  async getResolved(userId: string): Promise<ResolvedConfigDTO> {
    const providers = await userAIConfigRepository.listProviders(userId);
    const enabledProviderMap = new Map(providers.filter((p) => p.enabled === 1).map((p) => [p.id, p]));
    const models = await userAIConfigRepository.listModels(userId);

    const resolved: ResolvedModel[] = [];
    for (const m of models) {
      if (m.enabled !== 1) continue;
      const provider = enabledProviderMap.get(m.provider_id);
      if (!provider) continue;
      resolved.push(toResolvedModel(m, provider));
    }
    const defaultModel = resolved.find((m) => m.isDefault) ?? null;
    return { defaultModel, models: resolved, fallbackAvailable: isFallbackAvailable() };
  },

  /** 我的用量统计（按模型/功能聚合，近 30 天） */
  async getUsage(userId: string) {
    const stats = await userAIConfigRepository.getUsageStats(userId, 30);
    return { days: 30, stats };
  },
};
