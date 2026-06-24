/**
 * 认证服务（Cookie 版）
 *
 * 改造后：
 * - 不再通过 localStorage 存储/读取 JWT Token
 * - 使用 HttpOnly Cookie 由浏览器自动管理
 * - 登录/登出调用后端 API
 * - 会话状态通过 GET /api/users/me 确认
 */

import { User } from '@/types';
import { apiPost, apiGet } from './api';

export const CURRENT_USER_KEY = 'smart_report_current_user';

function isNetworkError(message: string): boolean {
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('无法连接') ||
    (message.includes('fetch') && message.includes('network'))
  );
}

function getErrorMessage(e: any): string {
  const msg = e?.message || '';
  if (isNetworkError(msg)) {
    return '无法连接后端服务，请确认后端已启动';
  }
  return msg || '无法连接后端服务，请确认后端已启动';
}

/**
 * 登录
 * 后端通过 HttpOnly Cookie 设置会话标识
 */
export async function login(
  username: string,
  password: string,
  rememberMe: boolean = false
): Promise<{ user: User | null; error?: string }> {
  try {
    const res = await apiPost('/users/login', { username, password, rememberMe }, true);
    if (res.error) return { user: null, error: res.error };

    if (!res.data || !res.data.user) {
      return { user: null, error: '服务器响应无效' };
    }

    const safeUser: User = {
      id: res.data.user.id,
      username: res.data.user.username,
      password: '',
      role: res.data.user.role || 'member',
      displayName: res.data.user.displayName || username,
      status: res.data.user.status || 'active',
      region: res.data.user.region || '全部',
      createdAt: res.data.user.createdAt || new Date().toISOString(),
    };

    // 将用户信息存入 localStorage（仅用于 UI 显示，非认证用途）
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));

    return { user: safeUser };
  } catch (e: any) {
    return { user: null, error: getErrorMessage(e) };
  }
}

/**
 * 注册
 */
export async function register(
  username: string,
  password: string,
  displayName: string,
  region: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiPost('/users/register', { username, password, displayName, region }, true);
    if (res.error) return { success: false, error: res.error };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: getErrorMessage(e) };
  }
}

/**
 * 登出 - 调用后端 API 销毁会话并清除 Cookie
 */
export async function logout(): Promise<void> {
  try {
    await apiPost('/users/logout', {}, true);
  } catch {
    // 即使 API 调用失败也清除本地状态
  }
  localStorage.removeItem(CURRENT_USER_KEY);
}

/**
 * 从 localStorage 获取用户信息（仅用于 UI 展示）
 */
export function getCurrentUser(): User | null {
  const raw = localStorage.getItem(CURRENT_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/**
 * 检查认证状态（通过后端 API）
 * 返回 true 表示会话有效
 */
export async function checkAuthStatus(): Promise<boolean> {
  try {
    const res = await apiGet('/users/me');
    return res?.data?.user != null;
  } catch {
    return false;
  }
}

/**
 * 同步获取当前用户（从 localStorage，仅缓存）
 */
export function isAuthenticated(): boolean {
  return !!localStorage.getItem(CURRENT_USER_KEY);
}
