import { getApiUrl, fetchWithAuth } from './api';

export interface SettingItem {
  key: string;
  value: string;
  category: string;
  label: string;
  description: string;
  valueType: 'string' | 'number' | 'boolean' | 'select';
  options: string[];
  editableBy: string;
  isSecret: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface SettingsData {
  settings: SettingItem[];
  categories: string[];
}

export interface SettingHistoryEntry {
  id: string;
  settingKey: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedByName: string;
  changedAt: string;
}

export async function fetchAllSettings(): Promise<SettingsData> {
  const res = await fetchWithAuth(getApiUrl('/settings'));
  if (!res.ok) throw new Error('获取设置失败');
  const data = await res.json();
  return { settings: data.data?.settings || [], categories: data.data?.categories || [] };
}

export async function updateSettings(updates: Array<{ key: string; value: string }>): Promise<void> {
  const res = await fetchWithAuth(getApiUrl('/settings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || '更新设置失败');
  }
  // 设置保存成功，通知认证模块立即重新同步会话超时等运行参数
  window.dispatchEvent(new CustomEvent('auth:refresh-idle-timeout'));
}

export async function fetchHistory(limit = 30): Promise<SettingHistoryEntry[]> {
  const res = await fetchWithAuth(getApiUrl(`/settings/history?limit=${limit}`));
  if (!res.ok) throw new Error('获取操作日志失败');
  const data = await res.json();
  return data.data?.history || [];
}

export const CATEGORY_LABELS: Record<string, string> = {
  // 注：AI 配置已迁移至独立的「AI设置」页（user_ai_providers/user_ai_models），
  // 系统设置不再有 ai 分类
  system: '系统',
  storage: '存储',
  security: '安全',
  logs: '日志',
  notification: '通知',
  python: 'Python',
};
