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
import { useConversationStore } from './conversationStore';
import { getApiUrl } from '@/services/api';

// 空闲超时时间默认值（毫秒）：后端会话超时默认 30 分钟，前端略早 1 分钟登出
const DEFAULT_IDLE_TIMEOUT_MS = 29 * 60 * 1000;

// 当前生效的空闲超时（毫秒），登录/初始化时从 /api/public-config 同步
let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;

/**
 * “记住我”会话标记（localStorage）
 * 持久会话（7 天免登录）不参与前端空闲登出，由长期 Cookie 自身有效期管理
 */
const REMEMBER_FLAG_KEY = 'smart_report_remember_me';

function isRememberMeSession(): boolean {
  return localStorage.getItem(REMEMBER_FLAG_KEY) === '1';
}

/**
 * 从后端公开配置同步会话超时设置（系统设置页 system.sessionTimeout），
 * 前端空闲登出比后端早 1 分钟，保证用户先收到友好的登出跳转
 */
async function refreshIdleTimeout(): Promise<void> {
  try {
    const res = await fetch(getApiUrl('/public-config'), { credentials: 'include' });
    if (!res.ok) return;
    const minutes = Number((await res.json())?.data?.sessionTimeoutMinutes);
    if (Number.isFinite(minutes) && minutes > 1) {
      idleTimeoutMs = Math.floor((minutes - 1) * 60 * 1000);
    }
  } catch {
    // 后端不可达时保持默认值
  }
}

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
      // 记录本次登录是否为“记住我”持久会话
      localStorage.setItem(REMEMBER_FLAG_KEY, rememberMe ? '1' : '0');
      // 登录新账号时清空上一个账号的对话状态
      useConversationStore.getState().resetConversations();
      // 登录成功后初始化空闲检测（并同步服务端会话超时设置）
      // “记住我”持久会话不做前端空闲登出，由 7 天长期 Cookie 管理
      refreshIdleTimeout();
      if (!rememberMe) {
        startIdleDetection();
      }
      return { success: true };
    }
    return { success: false, error: result.error };
  },

  logout: async () => {
    // 调用后端 API 销毁会话
    await authLogout();
    set({ user: null, isAuthenticated: false, isLoading: false });
    // 清除“记住我”标记
    localStorage.removeItem(REMEMBER_FLAG_KEY);
    // 清空当前账号的对话状态
    useConversationStore.getState().resetConversations();
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
        useConversationStore.getState().resetConversations();
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
        // “记住我”持久会话不做前端空闲登出
        if (!isRememberMeSession()) {
          startIdleDetection();
        }
      } else {
        // 会话无效，清除本地缓存
        if (cachedUser) {
          localStorage.removeItem('smart_report_current_user');
          localStorage.removeItem(REMEMBER_FLAG_KEY);
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

    // 窗口重新获得焦点时视为活动，并重新同步服务端超时设置
    // （覆盖在其它标签页修改 system.sessionTimeout 的场景）
    window.removeEventListener('focus', onWindowFocus);
    window.addEventListener('focus', onWindowFocus);

    // 系统设置保存成功后立即重新同步超时设置（当前标签页即时生效）
    window.removeEventListener('auth:refresh-idle-timeout', onRefreshIdleTimeout);
    window.addEventListener('auth:refresh-idle-timeout', onRefreshIdleTimeout);

    // 同步服务端会话超时设置
    refreshIdleTimeout();
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
// 空闲检测 tick 计数：每 10 个 tick（10 分钟）重新同步一次服务端超时设置
let idleTickCount = 0;

function onUserActivity(): void {
  lastActivityTime = Date.now();
}

/**
 * 窗口重新获得焦点：视为用户活动，并立即重新同步服务端超时设置。
 * 解决“登录后在系统设置里改了超时时间，但当前标签页仍按旧值倒计时”的问题。
 */
function onWindowFocus(): void {
  lastActivityTime = Date.now();
  refreshIdleTimeout();
}

/** 系统设置保存后触发：立即重新同步空闲超时 */
function onRefreshIdleTimeout(): void {
  refreshIdleTimeout();
}

function startIdleDetection(): void {
  lastActivityTime = Date.now();
  idleTickCount = 0;

  if (idleCheckTimer) {
    clearInterval(idleCheckTimer);
  }

  idleCheckTimer = setInterval(() => {
    // 定期重新同步服务端超时设置，让系统设置的修改无需重新登录即可生效
    idleTickCount += 1;
    if (idleTickCount % 10 === 0) {
      refreshIdleTimeout();
    }

    const elapsed = Date.now() - lastActivityTime;

    if (elapsed >= idleTimeoutMs) {
      // 空闲超时，自动登出
      console.warn('[Auth] 长时间无操作，自动登出');
      stopIdleDetection();

      // 调用后端登出
      authLogout().then(() => {
        localStorage.removeItem('smart_report_current_user');
        localStorage.removeItem(REMEMBER_FLAG_KEY);
        useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
        useConversationStore.getState().resetConversations();
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
