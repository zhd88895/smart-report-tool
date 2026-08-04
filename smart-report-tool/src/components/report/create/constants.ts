import { LogCategory, OutputFormat } from '@/types';

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  host: '主机',
  storage: '存储',
  database: '数据库',
  virtualization: '虚拟化',
  network: '交换机',
};

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  html: 'HTML',
  md: 'Markdown',
  docx: 'Word (DOCX)',
  xlsx: 'Excel',
  pdf: 'PDF',
};

/** localStorage 键：记录上次填写的报告名称 */
export const LAST_NAME_KEY = 'report_last_name';
