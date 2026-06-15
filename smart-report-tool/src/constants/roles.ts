import { UserRole, FeatureKey } from '@/types';

export const ROLE_PERMISSIONS: Record<UserRole, Record<FeatureKey, boolean>> = {
  admin: {
    dashboard: true,
    scripts: true,
    scriptExecute: true,
    reportCreate: true,
    reports: true,
    deleteReport: true,
    assistant: true,
    users: true,
    conversations: true,
    settings: true,
    downloadReport: true,
    approveUser: true,
  },
  senior: {
    dashboard: true,
    scripts: true,
    scriptExecute: true,
    reportCreate: true,
    reports: true,
    deleteReport: true,
    assistant: true,
    users: false,
    conversations: false,
    settings: true,
    downloadReport: true,
    approveUser: false,
  },
  member: {
    dashboard: false,
    scripts: false,
    scriptExecute: false,
    reportCreate: true,
    reports: true,
    deleteReport: false,
    assistant: true,
    users: false,
    conversations: false,
    settings: true,
    downloadReport: true,
    approveUser: false,
  },
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '管理员',
  senior: '高级成员',
  member: '普通成员',
};

export const STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  active: '已激活',
  rejected: '已拒绝',
  running: '执行中',
  success: '成功',
  failed: '失败',
};

export const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};
