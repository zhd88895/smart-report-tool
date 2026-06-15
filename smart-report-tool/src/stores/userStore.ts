import { create } from 'zustand';
import { User } from '@/types';
import { getAllUsersService, createUser as createUserService, deleteUser as deleteUserService, approveUser as approveUserService, rejectUser as rejectUserService, updateUserRole as updateUserRoleService, getPendingUsers } from '@/services/userService';

interface UserState {
  users: User[];
  pendingUsers: User[];
  loading: boolean;
  fetchUsers: () => Promise<void>;
  fetchPendingUsers: () => Promise<void>;
  addUser: (user: User) => Promise<void>;
  removeUser: (id: string) => Promise<void>;
  approveUser: (id: string) => Promise<void>;
  rejectUser: (id: string) => Promise<void>;
  updateUserRole: (id: string, role: User['role']) => Promise<void>;
}

export const useUserStore = create<UserState>((set) => ({
  users: [],
  pendingUsers: [],
  loading: false,

  fetchUsers: async () => {
    set({ loading: true });
    const users = await getAllUsersService();
    set({ users, loading: false });
  },

  fetchPendingUsers: async () => {
    set({ loading: true });
    const pendingUsers = await getPendingUsers();
    set({ pendingUsers, loading: false });
  },

  addUser: async (user: User) => {
    await createUserService(user);
    const users = await getAllUsersService();
    set({ users });
  },

  removeUser: async (id: string) => {
    await deleteUserService(id);
    const users = await getAllUsersService();
    set({ users });
  },

  approveUser: async (id: string) => {
    await approveUserService(id);
    const users = await getAllUsersService();
    const pendingUsers = await getPendingUsers();
    set({ users, pendingUsers });
  },

  rejectUser: async (id: string) => {
    await rejectUserService(id);
    const users = await getAllUsersService();
    const pendingUsers = await getPendingUsers();
    set({ users, pendingUsers });
  },

  updateUserRole: async (id: string, role: User['role']) => {
    await updateUserRoleService(id, role);
    const users = await getAllUsersService();
    set({ users });
  },
}));
