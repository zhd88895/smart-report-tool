/**
 * 系统设置数据仓储
 *
 * @module db/repositories/settingsRepository
 */

import { getAsync, allAsync, runAsync } from '../database';

export interface Setting {
  key: string;
  value: string;
  category: string;
  label: string;
  description: string;
  valueType: string;
  options: string[];
  editableBy: string;
  isSecret: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface SettingHistory {
  id: string;
  settingKey: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedByName: string;
  changedAt: string;
}

function rowToSetting(row: any): Setting {
  return {
    key: row.key,
    value: row.value || '',
    category: row.category || 'system',
    label: row.label || '',
    description: row.description || '',
    valueType: row.value_type || 'string',
    options: row.options ? JSON.parse(row.options) : [],
    editableBy: row.editable_by || 'admin',
    isSecret: row.is_secret === 1,
    sortOrder: row.sort_order || 0,
    updatedAt: row.updated_at || '',
  };
}

export const settingsRepository = {
  async findAll(): Promise<Setting[]> {
    const rows = await allAsync('SELECT * FROM settings ORDER BY sort_order');
    return rows.map(rowToSetting);
  },

  /** 仅返回未隐藏的配置（系统设置页与设置接口使用；隐藏的占位配置保留数据不展示） */
  async findAllVisible(): Promise<Setting[]> {
    const rows = await allAsync('SELECT * FROM settings WHERE COALESCE(is_hidden, 0) = 0 ORDER BY sort_order');
    return rows.map(rowToSetting);
  },

  async findByCategory(category: string): Promise<Setting[]> {
    const rows = await allAsync('SELECT * FROM settings WHERE category = ? ORDER BY sort_order', [category]);
    return rows.map(rowToSetting);
  },

  async findByKey(key: string): Promise<Setting | null> {
    const row = await getAsync('SELECT * FROM settings WHERE key = ?', [key]);
    return row ? rowToSetting(row) : null;
  },

  async findAllKeys(): Promise<string[]> {
    const rows = await allAsync('SELECT key FROM settings');
    return rows.map((r) => r.key);
  },

  async batchUpdate(updates: Array<{ key: string; value: string }>): Promise<void> {
    const now = new Date().toISOString();
    for (const u of updates) {
      await runAsync(
        'UPDATE settings SET value = ?, updated_at = ? WHERE key = ?',
        [u.value, now, u.key]
      );
    }
  },

  async addHistory(entry: Omit<SettingHistory, 'id'>): Promise<void> {
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    await runAsync(
      `INSERT INTO settings_history (id, setting_key, old_value, new_value, changed_by, changed_by_name, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, entry.settingKey, entry.oldValue, entry.newValue, entry.changedBy, entry.changedByName, entry.changedAt]
    );
  },

  async getHistory(key: string, limit = 20): Promise<SettingHistory[]> {
    const rows = await allAsync(
      'SELECT * FROM settings_history WHERE setting_key = ? ORDER BY changed_at DESC LIMIT ?',
      [key, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      settingKey: r.setting_key,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name || '',
      changedAt: r.changed_at,
    }));
  },

  async getRecentHistory(limit = 30): Promise<SettingHistory[]> {
    const rows = await allAsync(
      'SELECT * FROM settings_history ORDER BY changed_at DESC LIMIT ?',
      [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      settingKey: r.setting_key,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name || '',
      changedAt: r.changed_at,
    }));
  },
};
