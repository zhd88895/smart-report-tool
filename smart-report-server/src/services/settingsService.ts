/**
 * 系统设置服务
 *
 * 提供系统设置的读取、更新、历史查询功能。
 * 支持角色权限控制：admin 可读写，senior 只读，member 不可见。
 *
 * @module services/settingsService
 */

import { settingsRepository, Setting, SettingHistory } from '../db/repositories/settingsRepository';
import { getLogger } from '../utils/logger';

const log = getLogger('SettingsService', 'core');

/** 内存缓存：键值对，用于运行时快速读取 */
const cache = new Map<string, string>();

/** 缓存是否已初始化 */
let cacheInitialized = false;

export const settingsService = {
  /**
   * 初始化缓存（从 DB 加载所有配置）
   */
  async initCache(): Promise<void> {
    if (cacheInitialized) return;
    const settings = await settingsRepository.findAll();
    for (const s of settings) {
      if (s.value) cache.set(s.key, s.value);
    }
    cacheInitialized = true;
    log.info(`设置缓存已初始化: ${cache.size} 项`);
  },

  /**
   * 从缓存获取单个配置值
   */
  get(key: string): string | undefined {
    return cache.get(key);
  },

  /**
   * 从缓存获取数值型配置，非法或未设置时返回 fallback。
   * 供运行时功能（会话超时、限流、上传限制、CORS）读取已接入的设置项。
   */
  getNumber(key: string, fallback: number): number {
    const raw = cache.get(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  },

  /**
   * 获取所有设置的分类列表（用于 UI Tab，不含隐藏配置）
   */
  async getCategories(): Promise<string[]> {
    const settings = await settingsRepository.findAllVisible();
    return [...new Set(settings.map((s) => s.category))];
  },

  /**
   * 获取指定分类的设置项（权限过滤，不含隐藏配置）
   * @param role 用户角色，决定哪些字段可编辑
   */
  async getSettings(role: string): Promise<Setting[]> {
    if (role === 'member') return [];
    const settings = await settingsRepository.findAllVisible();
    return settings.map((s) => ({
      ...s,
      value: s.isSecret && role !== 'admin' ? '••••••' : s.value,
      editableBy: role === 'admin' ? 'all' : 'none',
    }));
  },

  /**
   * 批量更新设置（仅 admin）
   */
  async updateSettings(
    updates: Array<{ key: string; value: string }>,
    changedBy: string,
    changedByName: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const oldValues = new Map<string, string>();

    // 记录旧值
    for (const u of updates) {
      const old = cache.get(u.key);
      oldValues.set(u.key, old || '');
    }

    // 批量更新 DB
    await settingsRepository.batchUpdate(updates);

    // 更新缓存
    for (const u of updates) {
      cache.set(u.key, u.value);
    }

    // 记录历史
    for (const u of updates) {
      await settingsRepository.addHistory({
        settingKey: u.key,
        oldValue: oldValues.get(u.key) || null,
        newValue: u.value,
        changedBy,
        changedByName,
        changedAt: now,
      });
    }

    log.info(`设置已更新: ${updates.length} 项`, undefined, { changedBy });
  },

  /**
   * 获取指定键的修改历史
   */
  async getHistory(key: string, limit = 20): Promise<SettingHistory[]> {
    return settingsRepository.getHistory(key, limit);
  },

  /**
   * 获取最近的全局修改记录
   */
  async getRecentHistory(limit = 30): Promise<SettingHistory[]> {
    return settingsRepository.getRecentHistory(limit);
  },

  /**
   * 刷新缓存（从 DB 重新加载）
   */
  async refreshCache(): Promise<void> {
    cache.clear();
    const settings = await settingsRepository.findAll();
    for (const s of settings) {
      if (s.value) cache.set(s.key, s.value);
    }
    log.info('设置缓存已刷新');
  },
};
