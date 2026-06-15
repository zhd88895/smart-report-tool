import { useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { ROUTES } from '@/constants/routes';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

export function TopNav() {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed } = useUIStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate(ROUTES.LOGIN);
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin': return '管理员';
      case 'user': return '普通用户';
      case 'readonly': return '只读用户';
      default: return role;
    }
  };

  return (
    <header className="fixed top-0 right-0 z-40 h-16 border-b bg-card px-4 flex items-center justify-between transition-all duration-300"
      style={{ left: sidebarCollapsed ? '64px' : '240px' }}
    >
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">智能报告生成工具</h1>
      </div>
      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 rounded-full">
              <Avatar>
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {user?.displayName?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.displayName || '未登录'}</p>
                <p className="text-xs text-muted-foreground">{getRoleLabel(user?.role || '')}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate(ROUTES.SETTINGS)}>
              <Settings className="mr-2 h-4 w-4" />
              <span>个人设置</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
