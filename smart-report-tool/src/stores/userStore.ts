import { create } from 'zustand';
import { User } from '@/types';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/services/api';

interface UserState {
  users: User[];
  pendingUsers: User[];
  loading: boolean;
  fetchUsers: () => Promise<void>;
  addUser: (params: { username: string; password: string; displayName: string; role: User['role']; region: string; adminPassword?: string }) => Promise<{ success: boolean; error?: string }>;
  removeUser: (id: string, adminPassword?: string) => Promise<{ success: boolean; error?: string }>;
  approveUser: (id: string) => Promise<void>;
  rejectUser: (id: string) => Promise<void>;
  updateUserRole: (id: string, role: User['role'], adminPassword?: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (id: string, data: { displayName?: string; region?: string; adminPassword?: string }) => Promise<{ success: boolean; error?: string; user?: User }>;
  resetPassword: (id: string, newPassword: string, adminPassword?: string) => Promise<{ success: boolean; error?: string }>;
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  pendingUsers: [],
  loading: false,

  fetchUsers: async () => {
    set({ loading: true });
    const data = await apiGet('/users');
    const all = (data.data?.users || []) as User[];
    set({ users: all, pendingUsers: all.filter((u) => u.status === 'pending'), loading: false });
  },

  addUser: async (params: { username: string; password: string; displayName: string; role: User['role']; region: string; adminPassword?: string }) => {
    try {
      // Register creates user as 'pending' member; then update status+role
      await apiPost('/users/register', { username: params.username, password: params.password, displayName: params.displayName, region: params.region });
    } catch (e: any) {
      return { success: false, error: e?.message || '创建用户失败' };
    }
    // Fetch the created user and update role/status
    const data = await apiGet('/users');
    const created = ((data.data?.users || []) as User[]).find((u: User) => u.username === params.username);
    if (created) {
      if (params.role !== 'member') {
        // 角色变更属敏感操作，需携带当前管理员密码
        try {
          await apiPatch(`/users/${created.id}/role`, { role: params.role, adminPassword: params.adminPassword });
        } catch (e: any) {
          await get().fetchUsers();
          return { success: false, error: `用户已创建，但角色设置失败：${e?.message || '未知错误'}` };
        }
      }
      await apiPatch(`/users/${created.id}/status`, { status: 'active' }).catch(() => {});
    }
    await get().fetchUsers();
    return { success: true };
  },

  removeUser: async (id: string, adminPassword?: string) => {
    try {
      await apiDelete(`/users/${id}`, undefined, adminPassword ? { adminPassword } : undefined);
      await get().fetchUsers();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || '删除用户失败' };
    }
  },

  approveUser: async (id: string) => {
    await apiPatch(`/users/${id}/status`, { status: 'active' });
    await get().fetchUsers();
  },

  rejectUser: async (id: string) => {
    await apiPatch(`/users/${id}/status`, { status: 'rejected' });
    await get().fetchUsers();
  },

  updateUserRole: async (id: string, role: User['role'], adminPassword?: string) => {
    try {
      await apiPatch(`/users/${id}/role`, { role, adminPassword });
      await get().fetchUsers();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || '角色更新失败' };
    }
  },

  updateProfile: async (id: string, data: { displayName?: string; region?: string; adminPassword?: string }) => {
    try {
      await apiPatch(`/users/${id}/profile`, data);
      await get().fetchUsers();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || '个人资料更新失败' };
    }
  },

  resetPassword: async (id: string, newPassword: string, adminPassword?: string) => {
    try {
      await apiPost(`/users/${id}/change-password`, { newPassword, adminPassword });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || '密码重置失败' };
    }
  },
}));

