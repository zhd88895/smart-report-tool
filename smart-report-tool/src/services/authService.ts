import { User } from '@/types';
import { getDB, getAllUsers, putUser } from './db';

const AUTH_TOKEN_KEY = 'smart_report_auth_token';
const CURRENT_USER_KEY = 'smart_report_current_user';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function initDefaultAdmin(): Promise<void> {
  const existing = await getDB().get('users', 'admin_default');
  if (!existing) {
    const admin: User = {
      id: 'admin_default',
      username: 'admin',
      password: await hashPassword('admin'),
      role: 'admin',
      displayName: '系统管理员',
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    await putUser(admin);
  }
}

export async function register(username: string, password: string, displayName: string): Promise<{ success: boolean; error?: string }> {
  const users = await getAllUsers();
  if (users.some((u) => u.username === username)) {
    return { success: false, error: '用户名已存在' };
  }

  const user: User = {
    id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    username,
    password: await hashPassword(password),
    role: 'member',
    displayName,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await putUser(user);
  return { success: true };
}

export async function login(username: string, password: string): Promise<{ user: User | null; error?: string }> {
  const users = await getAllUsers();
  const hashed = await hashPassword(password);
  const user = users.find((u) => u.username === username && u.password === hashed);

  if (!user) {
    return { user: null, error: '用户名或密码错误' };
  }

  if (user.status === 'pending') {
    return { user: null, error: '账户待审核，请联系管理员' };
  }

  if (user.status === 'rejected') {
    return { user: null, error: '账户已被拒绝' };
  }

  const token = await generateToken(user);
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  return { user };
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

async function generateToken(user: User): Promise<string> {
  const data = `${user.id}:${user.username}:${Date.now()}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
