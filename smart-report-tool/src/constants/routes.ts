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
  SYSTEM_SETTINGS: '/settings/system',
  AI_SETTINGS: '/settings/ai',
  KNOWLEDGE_BASE: '/knowledge-base',
} as const;

export const ROUTE_LABELS: Record<string, string> = {
  [ROUTES.DASHBOARD]: '仪表盘',
  [ROUTES.SCRIPTS]: '脚本及模板',
  [ROUTES.REPORT_CREATE]: '生成报告',
  [ROUTES.REPORTS]: '报告管理',
  [ROUTES.ASSISTANT]: 'AI助手',
  [ROUTES.USERS]: '用户管理',
  [ROUTES.CONVERSATIONS]: '对话记录',
  [ROUTES.SETTINGS]: '个人设置',
  [ROUTES.SYSTEM_SETTINGS]: '系统设置',
  [ROUTES.AI_SETTINGS]: 'AI设置',
  [ROUTES.KNOWLEDGE_BASE]: '知识库',
};
