import { create } from 'zustand';
import { User } from '@/types';
import { login as authLogin, logout as authLogout, getCurrentUser, initDefaultAdmin, register as authRegister } from '@/services/authService';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  initAuth: () => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<{ success: boolean; error?: string }>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username: string, password: string) => {
    const result = await authLogin(username, password);
    if (result.user) {
      set({ user: result.user, isAuthenticated: true, isLoading: false });
      return { success: true };
    }
    return { success: false, error: result.error };
  },

  logout: () => {
    authLogout();
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  initAuth: async () => {
    await initDefaultAdmin();
    const user = getCurrentUser();
    set({ user, isAuthenticated: !!user, isLoading: false });
  },

  register: async (username: string, password: string, displayName: string) => {
    return authRegister(username, password, displayName);
  },
}));
