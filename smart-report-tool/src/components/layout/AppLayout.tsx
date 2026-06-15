import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useUIStore } from '@/stores/uiStore';
import { ROUTES } from '@/constants/routes';

export function AppLayout() {
  const { sidebarCollapsed } = useUIStore();
  const location = useLocation();
  const isLoginPage = location.pathname === ROUTES.LOGIN;

  if (isLoginPage) {
    return <Outlet />;
  }

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopNav />
        <main
          className="flex-1 overflow-auto p-6 pt-20"
          style={{
            marginLeft: sidebarCollapsed ? '64px' : '240px',
            transition: 'margin-left 0.3s ease',
          }}
        >
          <div className="mx-auto max-w-[1440px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
