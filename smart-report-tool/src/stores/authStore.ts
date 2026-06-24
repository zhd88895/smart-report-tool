/**
 * 认证状态管理（Cookie 版）
 *
 * 改造后：
 * - 通过 GET /api/users/me 在页面加载时验证会话状态
 * - 通过 POST /api/users/logout 登出（销毁后端会话）
 * - 不再依赖 localStorage 中的 Token
 * - 增加空闲检测和活动心跳
 */

import { create } from 'zustand';
import { User } from '@/types';
import {
  login as authLogin,
  logout as authLogout,
  getCurrentUser,
  register as authRegister,
  checkAuthStatus,
} from '@/services/authService';

// 空闲超时时间（毫秒）
const IDLE_TIMEOUT_MS = 25 * 60 * 1000; // 25 分钟（略小于后端 30 分钟）

// 活动检测间隔
const ACTIVITY_CHECK_INTERVAL_MS = 60 * 1000; // 1 分钟

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  initAuth: () => void;
  register: (username: string, password: string, displayName: string, region: string) => Promise<{ success: boolean; error?: string }>;
  updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username: string, password: string, rememberMe: boolean = false) => {
    const result = await authLogin(username, password, rememberMe);
    if (result.user) {
      set({ user: result.user, isAuthenticated: true, isLoading: false });
      // 登录成功后初始化空闲检测
      startIdleDetection();
      return { success: true };
    }
    return { success: false, error: result.error };
  },

  logout: async () => {
    // 调用后端 API 销毁会话
    await authLogout();
    set({ user: null, isAuthenticated: false, isLoading: false });
    // 停止空闲检测
    stopIdleDetection();
  },

  initAuth: () => {
    // 监听 401 事件
    const handleUnauthorized = () => {
      const { logout } = get();
      const user = getCurrentUser();
      if (user) {
        logout();
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    };

    window.removeEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    // 尝试从 localStorage 恢复用户信息（用于 UI 显示）
    const cachedUser = getCurrentUser();

    // 调用后端 API 验证会话是否有效
    checkAuthStatus().then((isValid) => {
      if (isValid && cachedUser) {
        set({ user: cachedUser, isAuthenticated: true, isLoading: false });
        startIdleDetection();
      } else {
        // 会话无效，清除本地缓存
        if (cachedUser) {
          localStorage.removeItem('smart_report_current_user');
        }
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    }).catch(() => {
      // 后端不可达时，如果有缓存用户则暂时认为已认证
      if (cachedUser) {
        set({ user: cachedUser, isAuthenticated: true, isLoading: false });
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    });

    // 注册空闲检测事件监听
    window.removeEventListener('mousedown', onUserActivity);
    window.removeEventListener('keydown', onUserActivity);
    window.removeEventListener('touchstart', onUserActivity);
    window.removeEventListener('scroll', onUserActivity);
    window.addEventListener('mousedown', onUserActivity);
    window.addEventListener('keydown', onUserActivity);
    window.addEventListener('touchstart', onUserActivity);
    window.addEventListener('scroll', onUserActivity);
  },

  register: async (username: string, password: string, displayName: string, region: string) => {
    return authRegister(username, password, displayName, region);
  },

  updateUser: (updates: Partial<User>) => {
    set((state) => {
      if (!state.user) return {};
      const updated = { ...state.user, ...updates };
      localStorage.setItem('smart_report_current_user', JSON.stringify(updated));
      return { user: updated };
    });
  },
}));

// ═══════════════════════════════════════════════════════
//  空闲检测机制
// ═══════════════════════════════════════════════════════

let lastActivityTime = Date.now();
let idleCheckTimer: ReturnType<typeof setInterval> | null = null;

function onUserActivity(): void {
  lastActivityTime = Date.now();
}

function startIdleDetection(): void {
  lastActivityTime = Date.now();

  if (idleCheckTimer) {
    clearInterval(idleCheckTimer);
  }

  idleCheckTimer = setInterval(() => {
    const elapsed = Date.now() - lastActivityTime;

    if (elapsed >= IDLE_TIMEOUT_MS) {
      // 空闲超时，自动登出
      console.warn('[Auth] 长时间无操作，自动登出');
      stopIdleDetection();

      // 调用后端登出
      authLogout().then(() => {
        localStorage.removeItem('smart_report_current_user');
        useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
        // 触发 401 事件让页面跳转到登录
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      });
    }
  }, ACTIVITY_CHECK_INTERVAL_MS);
}

function stopIdleDetection(): void {
  if (idleCheckTimer) {
    clearInterval(idleCheckTimer);
    idleCheckTimer = null;
  }

  window.removeEventListener('mousedown', onUserActivity);
  window.removeEventListener('keydown', onUserActivity);
  window.removeEventListener('touchstart', onUserActivity);
  window.removeEventListener('scroll', onUserActivity);
}
