import { create } from 'zustand';
import { User } from '@/types';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/services/api';

interface UserState {
  users: User[];
  pendingUsers: User[];
  loading: boolean;
  fetchUsers: () => Promise<void>;
  addUser: (params: { username: string; password: string; displayName: string; role: User['role']; region: string }) => Promise<{ success: boolean; error?: string }>;
  removeUser: (id: string) => Promise<void>;
  approveUser: (id: string) => Promise<void>;
  rejectUser: (id: string) => Promise<void>;
  updateUserRole: (id: string, role: User['role']) => Promise<void>;
  updateProfile: (id: string, data: { displayName?: string; region?: string }) => Promise<{ success: boolean; error?: string; user?: User }>;
  resetPassword: (id: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
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

  addUser: async (params: { username: string; password: string; displayName: string; role: User['role']; region: string }) => {
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
        await apiPatch(`/users/${created.id}/role`, { role: params.role }).catch(() => {});
      }
      await apiPatch(`/users/${created.id}/status`, { status: 'active' }).catch(() => {});
    }
    return { success: true };
  },

  removeUser: async (id: string) => {
    await apiDelete(`/users/${id}`);
    await get().fetchUsers();
  },

  approveUser: async (id: string) => {
    await apiPatch(`/users/${id}/status`, { status: 'active' });
    await get().fetchUsers();
  },

  rejectUser: async (id: string) => {
    await apiPatch(`/users/${id}/status`, { status: 'rejected' });
    await get().fetchUsers();
  },

  updateUserRole: async (id: string, role: User['role']) => {
    await apiPatch(`/users/${id}/role`, { role });
    await get().fetchUsers();
  },

  updateProfile: async (id: string, data: { displayName?: string; region?: string }) => {
    const res = await apiPatch(`/users/${id}/profile`, data);
    if (res.error) return { success: false, error: res.error };
    const { password: _, ...safe } = res as any;
    await get().fetchUsers();
    return { success: true, user: safe as User };
  },

  resetPassword: async (id: string, newPassword: string) => {
    try {
      await apiPost(`/users/${id}/change-password`, { newPassword });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || '密码重置失败' };
    }
  },
}));

