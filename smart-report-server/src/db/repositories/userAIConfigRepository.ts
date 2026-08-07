/**
 * 用户级 AI 配置仓储模块
 *
 * 提供多厂商 AI 配置的 CRUD 操作：
 * - user_ai_providers：用户级 AI 厂商配置（每用户可配多个厂商）
 * - user_ai_models：用户级 AI 模型（每个厂商下可配多个模型）
 * - user_ai_usage_logs：AI 调用用量记录
 *
 * 所有查询均带 user_id 过滤，保证多用户数据隔离。
 *
 * @module db/repositories/userAIConfigRepository
 */

import { allAsync, getAsync, runAsync } from '../database';
import { getLogger } from '../../utils/logger';

const log = getLogger('UserAIConfigRepository', 'other');

// ═══════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════

export interface UserAIProvider {
  id: string;
  user_id: string;
  vendor_key: string;
  name: string;
  base_url: string;
  api_key: string;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UserAIModel {
  id: string;
  provider_id: string;
  user_id: string;
  model_id: string;
  display_name: string;
  temperature: number;
  max_input_tokens: number;
  max_output_tokens: number;
  enabled: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface UserAIUsageLog {
  id: string;
  user_id: string;
  model_id: string;
  feature: string;
  prompt_tokens: number;
  completion_tokens: number;
  created_at: string;
}

/** 生成带前缀的记录 ID：前缀 + 时间戳 + 随机串 */
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ═══════════════════════════════════════════════════════
//  仓储实现
// ═══════════════════════════════════════════════════════

export const userAIConfigRepository = {
  // ── 厂商（Provider）──

  /** 列出用户的全部 AI 厂商，按 sort_order 升序、创建时间升序 */
  async listProviders(userId: string): Promise<UserAIProvider[]> {
    const rows = await allAsync(
      `SELECT * FROM user_ai_providers WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC`,
      [userId]
    );
    return rows as UserAIProvider[];
  },

  /** 按 ID 获取厂商（限定 user_id 保证隔离） */
  async getProvider(userId: string, id: string): Promise<UserAIProvider | null> {
    const row = await getAsync(
      `SELECT * FROM user_ai_providers WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    return (row as UserAIProvider) || null;
  },

  /** 创建厂商，创建后需再调用 createModel 补充模型 */
  async createProvider(
    userId: string,
    data: { vendor_key: string; name: string; base_url: string; api_key: string }
  ): Promise<UserAIProvider> {
    const now = new Date().toISOString();
    const id = genId('uaip');
    // 新厂商排在现有排序末尾
    const maxRow = await getAsync(
      `SELECT MAX(sort_order) as max_sort FROM user_ai_providers WHERE user_id = ?`,
      [userId]
    );
    const sortOrder = ((maxRow as any)?.max_sort ?? -1) + 1;
    await runAsync(
      `INSERT INTO user_ai_providers (id, user_id, vendor_key, name, base_url, api_key, enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, userId, data.vendor_key, data.name, data.base_url, data.api_key, sortOrder, now, now]
    );
    return {
      id, user_id: userId, vendor_key: data.vendor_key, name: data.name,
      base_url: data.base_url, api_key: data.api_key, enabled: 1,
      sort_order: sortOrder, created_at: now, updated_at: now,
    };
  },

  /** 部分更新厂商字段（name/base_url/api_key/enabled/sort_order） */
  async updateProvider(
    userId: string,
    id: string,
    patch: Partial<Pick<UserAIProvider, 'name' | 'base_url' | 'api_key' | 'enabled' | 'sort_order'>>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.base_url !== undefined) { fields.push('base_url = ?'); values.push(patch.base_url); }
    if (patch.api_key !== undefined) { fields.push('api_key = ?'); values.push(patch.api_key); }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled); }
    if (patch.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(patch.sort_order); }
    fields.push('updated_at = ?'); values.push(new Date().toISOString());
    values.push(id, userId);
    await runAsync(
      `UPDATE user_ai_providers SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
  },

  /** 删除厂商（其下模型由外键 ON DELETE CASCADE 级联删除） */
  async deleteProvider(userId: string, id: string): Promise<void> {
    await runAsync(
      `DELETE FROM user_ai_providers WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
  },

  // ── 模型（Model）──

  /** 列出用户的模型，可按 providerId 过滤，按创建时间升序 */
  async listModels(userId: string, providerId?: string): Promise<UserAIModel[]> {
    if (providerId) {
      return await allAsync(
        `SELECT * FROM user_ai_models WHERE user_id = ? AND provider_id = ? ORDER BY created_at ASC`,
        [userId, providerId]
      ) as UserAIModel[];
    }
    return await allAsync(
      `SELECT * FROM user_ai_models WHERE user_id = ? ORDER BY created_at ASC`,
      [userId]
    ) as UserAIModel[];
  },

  /** 按 ID 获取模型（限定 user_id 保证隔离） */
  async getModel(userId: string, id: string): Promise<UserAIModel | null> {
    const row = await getAsync(
      `SELECT * FROM user_ai_models WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    return (row as UserAIModel) || null;
  },

  /** 创建模型，display_name 缺省回退为 model_id；显式传入 token 上限时写入，否则用数据库默认值 */
  async createModel(
    userId: string,
    providerId: string,
    data: { model_id: string; display_name?: string; max_input_tokens?: number; max_output_tokens?: number }
  ): Promise<UserAIModel> {
    const now = new Date().toISOString();
    const id = genId('uaim');
    await runAsync(
      `INSERT INTO user_ai_models (id, provider_id, user_id, model_id, display_name, max_input_tokens, max_output_tokens, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, 128000), COALESCE(?, 4096), ?, ?)`,
      [id, providerId, userId, data.model_id, data.display_name || data.model_id,
       data.max_input_tokens ?? null, data.max_output_tokens ?? null, now, now]
    );
    // 重新读取以拿到数据库默认值（temperature / max_tokens / enabled / is_default）
    const row = await getAsync(`SELECT * FROM user_ai_models WHERE id = ?`, [id]);
    return row as UserAIModel;
  },

  /** 部分更新模型字段（display_name/temperature/max_input_tokens/max_output_tokens/enabled） */
  async updateModel(
    userId: string,
    id: string,
    patch: Partial<Pick<UserAIModel, 'display_name' | 'temperature' | 'max_input_tokens' | 'max_output_tokens' | 'enabled'>>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (patch.display_name !== undefined) { fields.push('display_name = ?'); values.push(patch.display_name); }
    if (patch.temperature !== undefined) { fields.push('temperature = ?'); values.push(patch.temperature); }
    if (patch.max_input_tokens !== undefined) { fields.push('max_input_tokens = ?'); values.push(patch.max_input_tokens); }
    if (patch.max_output_tokens !== undefined) { fields.push('max_output_tokens = ?'); values.push(patch.max_output_tokens); }
    if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled); }
    fields.push('updated_at = ?'); values.push(new Date().toISOString());
    values.push(id, userId);
    await runAsync(
      `UPDATE user_ai_models SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
  },

  /**
   * 删除模型；若删除的是默认模型，自动将同用户最新启用的模型设为默认
   */
  async deleteModel(userId: string, id: string): Promise<void> {
    const existing = await getAsync(
      `SELECT is_default FROM user_ai_models WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    await runAsync(
      `DELETE FROM user_ai_models WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if ((existing as any)?.is_default === 1) {
      // 找一个同用户最新创建且启用的模型顶替为默认
      const replacement = await getAsync(
        `SELECT id FROM user_ai_models WHERE user_id = ? AND enabled = 1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if ((replacement as any)?.id) {
        await runAsync(
          `UPDATE user_ai_models SET is_default = 1, updated_at = ? WHERE id = ?`,
          [new Date().toISOString(), (replacement as any).id]
        );
      }
    }
  },

  /** 设置默认模型：先清除同用户所有默认标记，再设置目标模型 */
  async setDefaultModel(userId: string, id: string): Promise<void> {
    const now = new Date().toISOString();
    await runAsync(
      `UPDATE user_ai_models SET is_default = 0, updated_at = ? WHERE user_id = ?`,
      [now, userId]
    );
    await runAsync(
      `UPDATE user_ai_models SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
      [now, id, userId]
    );
  },

  /**
   * 获取默认模型并 JOIN 厂商信息
   * 仅当厂商与模型均为启用状态时返回
   */
  async getDefaultModel(userId: string): Promise<(UserAIModel & { provider: UserAIProvider }) | null> {
    const model = await getAsync(
      `SELECT * FROM user_ai_models WHERE user_id = ? AND is_default = 1 AND enabled = 1 LIMIT 1`,
      [userId]
    ) as UserAIModel | undefined;
    if (!model) return null;
    const provider = await getAsync(
      `SELECT * FROM user_ai_providers WHERE id = ? AND user_id = ? AND enabled = 1`,
      [model.provider_id, userId]
    ) as UserAIProvider | undefined;
    if (!provider) return null;
    return { ...model, provider };
  },

  /**
   * 按 ID 获取模型并 JOIN 厂商信息
   * 仅当厂商与模型均为启用状态时返回
   */
  async getModelWithProvider(userId: string, id: string): Promise<(UserAIModel & { provider: UserAIProvider }) | null> {
    const model = await getAsync(
      `SELECT * FROM user_ai_models WHERE id = ? AND user_id = ? AND enabled = 1`,
      [id, userId]
    ) as UserAIModel | undefined;
    if (!model) return null;
    const provider = await getAsync(
      `SELECT * FROM user_ai_providers WHERE id = ? AND user_id = ? AND enabled = 1`,
      [model.provider_id, userId]
    ) as UserAIProvider | undefined;
    if (!provider) return null;
    return { ...model, provider };
  },

  // ── 用量记录（Usage Log）──

  /** 写入一次 AI 调用用量记录 */
  async logUsage(entry: {
    user_id: string;
    model_id: string;
    feature: string;
    prompt_tokens: number;
    completion_tokens: number;
    /** 所属对话 ID（仅 AI 助手对话场景有值，用于对话级 token 统计） */
    conversation_id?: string;
    /** 调用状态：success | error | canceled */
    status?: string;
    /** 失败原因（status=error 时有值） */
    error?: string;
    /** 调用耗时（毫秒） */
    latency_ms?: number;
    /** 请求结构摘要（JSON 字符串，供快速排查） */
    request_summary?: string;
    /** 完整请求体快照（JSON 字符串，超长会被截断） */
    request_body?: string;
  }): Promise<void> {
    const id = genId('uail');
    await runAsync(
      `INSERT INTO user_ai_usage_logs (id, user_id, model_id, feature, prompt_tokens, completion_tokens, conversation_id, status, error, latency_ms, request_summary, request_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, entry.user_id, entry.model_id, entry.feature,
        entry.prompt_tokens || 0, entry.completion_tokens || 0,
        entry.conversation_id || null,
        entry.status || 'success', entry.error || null,
        entry.latency_ms ?? null, entry.request_summary || null, entry.request_body || null,
        new Date().toISOString(),
      ]
    );
  },

  /** 分页查询调用记录列表（不含 request_body 大字段，按时间倒序，仅当前用户） */
  async listCallLogs(
    userId: string,
    opts: { feature?: string; limit?: number; offset?: number } = {}
  ): Promise<{ total: number; rows: any[] }> {
    const limit = Math.min(Math.max(opts.limit || 100, 1), 500);
    const offset = Math.max(opts.offset || 0, 0);
    const cond = opts.feature ? 'AND feature = ?' : '';
    const params: any[] = opts.feature ? [userId, opts.feature] : [userId];
    const countRow = await getAsync(
      `SELECT COUNT(*) as c FROM user_ai_usage_logs WHERE user_id = ? ${cond}`,
      params
    ) as any;
    const rows = await allAsync(
      `SELECT id, model_id, feature, prompt_tokens, completion_tokens, conversation_id,
              status, error, latency_ms, request_summary, created_at
       FROM user_ai_usage_logs
       WHERE user_id = ? ${cond}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { total: countRow?.c || 0, rows: rows as any[] };
  },

  /** 查询单条调用记录（含 request_body，仅当前用户） */
  async getCallLog(userId: string, id: string): Promise<any | null> {
    const row = await getAsync(
      `SELECT * FROM user_ai_usage_logs WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    return (row as any) || null;
  },

  /** 按对话聚合 token 用量（当前用户），供对话记录页展示 */
  async getConversationUsage(
    userId: string
  ): Promise<Array<{ conversation_id: string; prompt_total: number; completion_total: number; calls: number }>> {
    const rows = await allAsync(
      `SELECT conversation_id,
              SUM(prompt_tokens) as prompt_total,
              SUM(completion_tokens) as completion_total,
              COUNT(*) as calls
       FROM user_ai_usage_logs
       WHERE user_id = ? AND conversation_id IS NOT NULL
       GROUP BY conversation_id`,
      [userId]
    );
    return rows as Array<{ conversation_id: string; prompt_total: number; completion_total: number; calls: number }>;
  },

  /**
   * 查询最近 N 天的用量统计，按 model_id + feature 分组聚合
   */
  async getUsageStats(
    userId: string,
    days: number
  ): Promise<Array<{ model_id: string; feature: string; prompt_total: number; completion_total: number; calls: number }>> {
    const rows = await allAsync(
      `SELECT model_id, feature,
              SUM(prompt_tokens) as prompt_total,
              SUM(completion_tokens) as completion_total,
              COUNT(*) as calls
       FROM user_ai_usage_logs
       WHERE user_id = ? AND created_at >= datetime('now', ?)
       GROUP BY model_id, feature
       ORDER BY prompt_total DESC`,
      [userId, `-${days} days`]
    );
    return rows as Array<{ model_id: string; feature: string; prompt_total: number; completion_total: number; calls: number }>;
  },
};
