import { LogCategory } from '@/types';

export const LOG_CATEGORIES: { value: LogCategory; label: string }[] = [
  { value: 'host', label: '主机' },
  { value: 'storage', label: '存储' },
  { value: 'database', label: '数据库' },
  { value: 'virtualization', label: '虚拟化' },
  { value: 'network', label: '交换机' },
];

export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  host: '主机',
  storage: '存储',
  database: '数据库',
  virtualization: '虚拟化',
  network: '交换机',
};

export const LOG_CATEGORY_COLORS: Record<LogCategory, string> = {
  host: '#2563EB',
  storage: '#7C3AED',
  database: '#059669',
  virtualization: '#D97706',
  network: '#DC2626',
};
