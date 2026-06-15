import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FileText, ClipboardList, Download, Bot,
  Users, MessageSquare, Settings, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { ROUTES } from '@/constants/routes';
import { canAccess } from '@/utils/permissions';
import { cn } from '@/lib/utils';

const menuItems = [
  { icon: LayoutDashboard, label: '仪表盘', path: ROUTES.DASHBOARD, feature: 'dashboard' as const },
  { icon: FileText, label: '脚本及模板', path: ROUTES.SCRIPTS, feature: 'scripts' as const },
  { icon: ClipboardList, label: '生成报告', path: ROUTES.REPORT_CREATE, feature: 'reportCreate' as const },
  { icon: Download, label: '报告管理', path: ROUTES.REPORTS, feature: 'reports' as const },
  { icon: Bot, label: 'AI助手', path: ROUTES.ASSISTANT, feature: 'assistant' as const },
  { icon: Users, label: '用户管理', path: ROUTES.USERS, feature: 'users' as const },
  { icon: MessageSquare, label: '对话记录', path: ROUTES.CONVERSATIONS, feature: 'conversations' as const },
  { icon: Settings, label: '个人设置', path: ROUTES.SETTINGS, feature: 'settings' as const },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  const visibleItems = menuItems.filter((item) => canAccess(user?.role, item.feature));

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-50 h-screen border-r bg-card flex flex-col transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-60'
      )}
    >
      <div className="flex h-16 items-center justify-between border-b px-4">
        {!sidebarCollapsed && (
          <span className="text-lg font-bold text-primary">SRT</span>
        )}
        <button
          onClick={toggleSidebar}
          className="rounded-md p-1 hover:bg-accent"
        >
          {sidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>
      <nav className="flex-1 space-y-1 p-2 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
