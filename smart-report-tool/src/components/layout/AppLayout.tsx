import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { useUIStore } from '@/stores/uiStore';
import { SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED } from '@/constants/layout';
import { getApiUrl } from '@/services/api';

/**
 * 心跳节流间隔（5 分钟）
 *
 * 相对后端 SESSION_EXPIRY_MINUTES 默认值 30 分钟设计：
 * 用户持续活动时最多每 5 分钟续期一次，远小于过期窗口；
 * 连续无操作超过会话过期时长仍会话失效（安全语义不变）。
 */
const HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;

export function AppLayout() {
  const { sidebarCollapsed } = useUIStore();

  useEffect(() => {
    let lastHeartbeatAt = 0;
    let inFlight = false;

    const sendHeartbeat = () => {
      const now = Date.now();
      if (inFlight || now - lastHeartbeatAt < HEARTBEAT_THROTTLE_MS) return;
      lastHeartbeatAt = now;
      inFlight = true;
      fetch(getApiUrl('/users/heartbeat'), {
        method: 'POST',
        credentials: 'include',
      })
        .then((res) => {
          // 会话已失效（如服务器重启）：触发统一登出，保持踢出语义
          if (res.status === 401) {
            window.dispatchEvent(new CustomEvent('auth:unauthorized'));
          }
        })
        .catch(() => {
          // 网络异常忽略，下次活动再试
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const activityEvents = ['click', 'keydown', 'scroll'] as const;
    activityEvents.forEach((event) =>
      window.addEventListener(event, sendHeartbeat, { passive: true, capture: true })
    );

    return () => {
      activityEvents.forEach((event) =>
        window.removeEventListener(event, sendHeartbeat, { capture: true })
      );
    };
  }, []);

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopNav />
        <main
          className="flex-1 overflow-auto p-6 pt-20"
          style={{
            marginLeft: sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
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
