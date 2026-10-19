import { create } from "zustand";
import type { User } from "@/types";
import { getMe } from "@/api/auth";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  initializationError: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  initializationError: false,

  setUser: (user) => {
    set({ user, isAuthenticated: !!user, initializationError: false });
  },

  logout: () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    set({ user: null, isAuthenticated: false, initializationError: false });
  },

  initialize: async () => {
    set({ isLoading: true, initializationError: false });
    const token = localStorage.getItem("access_token");
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      const user = await getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const rejected = status === 401 || status === 403;
      if (rejected) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      }
      set({ user: null, isAuthenticated: false, isLoading: false, initializationError: !rejected });
    }
  },
}));
