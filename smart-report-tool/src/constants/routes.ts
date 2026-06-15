export const ROUTES = {
  LOGIN: '/login',
  REGISTER: '/register',
  DASHBOARD: '/dashboard',
  SCRIPTS: '/scripts',
  REPORT_CREATE: '/report/create',
  REPORTS: '/reports',
  ASSISTANT: '/assistant',
  USERS: '/users',
  CONVERSATIONS: '/conversations',
  SETTINGS: '/settings',
} as const;

export const ROUTE_LABELS: Record<string, string> = {
  [ROUTES.DASHBOARD]: '数据看板',
  [ROUTES.SCRIPTS]: '脚本管理',
  [ROUTES.REPORT_CREATE]: '生成报告',
  [ROUTES.REPORTS]: '报告管理',
  [ROUTES.ASSISTANT]: 'AI助手',
  [ROUTES.USERS]: '用户管理',
  [ROUTES.CONVERSATIONS]: '对话记录',
  [ROUTES.SETTINGS]: '个人设置',
};
