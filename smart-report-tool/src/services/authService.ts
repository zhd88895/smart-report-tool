import { User } from '@/types';
import { apiPost } from './api';

const AUTH_TOKEN_KEY = 'smart_report_auth_token';
export const CURRENT_USER_KEY = 'smart_report_current_user';

function isNetworkError(message: string): boolean {
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('无法连接') ||
    message.includes('fetch') && message.includes('network')
  );
}

function getErrorMessage(e: any): string {
  const msg = e?.message || '';
  if (isNetworkError(msg)) {
    return '无法连接后端服务，请确认后端已启动';
  }
  return msg || '无法连接后端服务，请确认后端已启动';
}

export async function register(username: string, password: string, displayName: string, region: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiPost('/users/register', { username, password, displayName, region }, true);
    if (res.error) return { success: false, error: res.error };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function login(username: string, password: string): Promise<{ user: User | null; error?: string }> {
  try {
    const res = await apiPost('/users/login', { username, password }, true);
    if (res.error) return { user: null, error: res.error };

    if (!res.data || !res.data.user || !res.data.token) {
      return { user: null, error: 'Invalid response from server' };
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

    localStorage.setItem(AUTH_TOKEN_KEY, res.data.token);
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(safeUser));
    return { user: safeUser };
  } catch (e: any) {
    return { user: null, error: getErrorMessage(e) };
  }
}

export function logout(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
}

export function getCurrentUser(): User | null {
  const raw = localStorage.getItem(CURRENT_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(AUTH_TOKEN_KEY);
}
