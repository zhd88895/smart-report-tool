import { create } from 'zustand';
import { User } from '@/types';
import { 
  login as authLogin, 
  logout as authLogout, 
  getCurrentUser, 
  register as authRegister, 
  CURRENT_USER_KEY 
} from '@/services/authService';
import { setToken, removeToken, getToken } from '@/services/api';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  initAuth: () => void;
  register: (username: string, password: string, displayName: string, region: string) => Promise<{ success: boolean; error?: string }>;
  updateUser: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username: string, password: string) => {
    const result = await authLogin(username, password);
    if (result.user) {
      // The authLogin function already stores the token in localStorage
      // We just need to make sure our API module knows about it
      const token = getToken();
      if (token) {
        setToken(token);
      }
      set({ user: result.user, isAuthenticated: true, isLoading: false });
      return { success: true };
    }
    return { success: false, error: result.error };
  },

  logout: () => {
    authLogout();
    removeToken();
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  initAuth: () => {
    // Listen for unauthorized events from API module
    const handleUnauthorized = () => {
      const { logout } = get();
      logout();
    };

    // Remove any existing listener to avoid duplicates
    window.removeEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    // Check if token exists and is valid
    const token = getToken();
    const user = getCurrentUser();
    
    if (token && user) {
      // Check if token is expired
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const currentTime = Math.floor(Date.now() / 1000);
        
        if (payload.exp && payload.exp < currentTime) {
          // Token is expired, logout
          console.warn('Token expired, logging out');
          authLogout();
          removeToken();
          set({ user: null, isAuthenticated: false, isLoading: false });
          return;
        }
      } catch (error) {
        // If token parsing fails, assume invalid token
        console.warn('Invalid token format, logging out');
        authLogout();
        removeToken();
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
      
      // Token is valid, user is authenticated
      set({ user, isAuthenticated: true, isLoading: false });
    } else {
      // No token or user, not authenticated
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  register: async (username: string, password: string, displayName: string, region: string) => {
    return authRegister(username, password, displayName, region);
  },

  updateUser: (updates: Partial<User>) => {
    set((state) => {
      if (!state.user) return {};
      const updated = { ...state.user, ...updates };
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(updated));
      return { user: updated };
    });
  },
}));