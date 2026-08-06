import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FileText, ClipboardList, Download, Bot,
  Users, Settings, SlidersHorizontal, ChevronLeft, ChevronRight,
  Database, Sparkles, FileSearch, FileBarChart, Terminal, ScrollText,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { ROUTES, ROUTE_LABELS } from '@/constants/routes';
import { SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED } from '@/constants/layout';
import { canAccess } from '@/utils/permissions';
import { cn } from '@/lib/utils';
import { AplLogo } from '@/components/common/AplLogo';
import type { LucideIcon } from 'lucide-react';
import type { FeatureKey } from '@/types';

interface MenuItem {
  icon: LucideIcon;
  path: string;
  feature: FeatureKey;
  indent?: boolean;
  /** 可选：覆盖 ROUTE_LABELS 的显示名（同一路由多个入口时使用） */
  label?: string;
  /** 可选：导航时附带的查询串（如 '?mode=script'） */
  search?: string;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

/** 仪表盘：独立于分组之外，固定位于侧边栏第一位（首页） */
const dashboardItem: MenuItem = { icon: LayoutDashboard, path: ROUTES.DASHBOARD, feature: 'dashboard' };

/** 分组与顺序定义于此，label 统一引用 ROUTE_LABELS 单一来源 */
const menuGroups: MenuGroup[] = [
  {
    title: 'AI 工作区',
    items: [
      { icon: Bot, path: ROUTES.ASSISTANT, feature: 'assistant' },
      { icon: FileSearch, path: ROUTES.REPORT_CREATE, feature: 'reportCreate' },
      // 与脚本报告共用 /reports 页面，?tab=ai 只看 AI 生成的报告
      { icon: FileBarChart, path: ROUTES.REPORTS, search: '?tab=ai', label: 'AI报告', feature: 'reports' },
      { icon: Database, path: ROUTES.KNOWLEDGE_BASE, feature: 'settings' },
    ],
  },
  {
    title: '脚本与数据',
    items: [
      // 与 AI智能分析共用 /report/create 页面，?mode=script 进入脚本模式
      { icon: ClipboardList, path: ROUTES.REPORT_CREATE, search: '?mode=script', label: '脚本生成报告', feature: 'reportCreate' },
      { icon: FileText, path: ROUTES.SCRIPTS, feature: 'scripts' },
      { icon: Download, path: ROUTES.REPORTS, label: '脚本报告', feature: 'reports' },
      { icon: Terminal, path: ROUTES.PYTHON_ENV, feature: 'scripts' },
    ],
  },
  {
    title: '系统',
    items: [
      { icon: Users, path: ROUTES.USERS, feature: 'users' },
      { icon: ScrollText, path: ROUTES.SYSTEM_LOGS, feature: 'users' },
      { icon: SlidersHorizontal, path: ROUTES.SYSTEM_SETTINGS, feature: 'systemSettings' },
      { icon: Sparkles, path: ROUTES.AI_SETTINGS, feature: 'ai-settings' },
      { icon: Settings, path: ROUTES.SETTINGS, feature: 'settings' },
    ],
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  const visibleGroups = menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(user?.role, item.feature)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className="fixed left-0 top-0 z-50 h-screen border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300"
      style={{ width: sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        {!sidebarCollapsed && <AplLogo dark />}
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1 hover:bg-sidebar-accent"
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {sidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>
      <nav className="flex-1 space-y-4 p-2 overflow-y-auto">
        {/* 仪表盘：独立于分组，固定第一位（登录后的首页） */}
        {canAccess(user?.role, dashboardItem.feature) && (
          <div className="border-b border-sidebar-border pb-3">
            <button
              onClick={() => navigate(dashboardItem.path)}
              aria-label={ROUTE_LABELS[dashboardItem.path]}
              title={ROUTE_LABELS[dashboardItem.path]}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                location.pathname === dashboardItem.path
                  ? 'bg-sidebar-accent text-sidebar-foreground'
                  : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground'
              )}
            >
              <LayoutDashboard className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>{ROUTE_LABELS[dashboardItem.path]}</span>}
            </button>
          </div>
        )}
        {visibleGroups.map((group) => (
          <div key={group.title}>
            {!sidebarCollapsed && (
              <div className="px-3 pb-1 text-xs uppercase tracking-wider text-sidebar-muted">
                {group.title}
              </div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                // 两个页面都有双入口：生成报告页（?mode=script）与报告列表页（?tab=ai），
                // 高亮时需同时匹配路径与对应参数，避免两个菜单项同时点亮
                const modeParam = new URLSearchParams(location.search).get('mode');
                const tabParam = new URLSearchParams(location.search).get('tab');
                const isActive = (() => {
                  if (location.pathname !== item.path) return false;
                  if (item.path === ROUTES.REPORT_CREATE) {
                    return item.search ? modeParam === 'script' : modeParam !== 'script';
                  }
                  if (item.path === ROUTES.REPORTS) {
                    return item.search ? tabParam === 'ai' : tabParam !== 'ai';
                  }
                  return true;
                })();
                const label = item.label ?? ROUTE_LABELS[item.path];
                return (
                  <button
                    key={item.path + (item.search || '')}
                    onClick={() => navigate(item.path + (item.search || ''))}
                    aria-label={label}
                    title={label}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                      item.indent && !sidebarCollapsed && 'pl-6',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-foreground'
                        : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    )}
                  >
                    <item.icon className={cn('shrink-0', item.indent ? 'h-4 w-4' : 'h-5 w-5')} />
                    {!sidebarCollapsed && <span>{label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
