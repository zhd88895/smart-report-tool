import { LogCategory } from '@/types';

export const LOG_CATEGORIES: { value: LogCategory; label: string }[] = [
  { value: 'host', label: '主机日志' },
  { value: 'storage', label: '存储日志' },
  { value: 'database', label: '数据库日志' },
  { value: 'virtualization', label: '虚拟化日志' },
  { value: 'network', label: '网络日志' },
];

export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  host: '主机日志',
  storage: '存储日志',
  database: '数据库日志',
  virtualization: '虚拟化日志',
  network: '网络日志',
};

export const LOG_CATEGORY_COLORS: Record<LogCategory, string> = {
  host: '#2563EB',
  storage: '#7C3AED',
  database: '#059669',
  virtualization: '#D97706',
  network: '#DC2626',
};
