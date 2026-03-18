import { create } from "zustand";
import type { Notification } from "@/types";
import {
  listNotifications,
  markRead as apiMarkRead,
  markAllRead as apiMarkAllRead,
} from "@/api/notifications";

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  fetch: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  fetch: async () => {
    try {
      const notifications = await listNotifications();
      const unreadCount = notifications.filter((n) => !n.read).length;
      set({ notifications, unreadCount });
    } catch {
      // Silently fail — user may not be authenticated yet
    }
  },

  markRead: async (id: string) => {
    try {
      await apiMarkRead(id);
      const notifications = get().notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      const unreadCount = notifications.filter((n) => !n.read).length;
      set({ notifications, unreadCount });
    } catch {
      // Silently fail
    }
  },

  markAllRead: async () => {
    try {
      await apiMarkAllRead();
      const notifications = get().notifications.map((n) => ({ ...n, read: true }));
      set({ notifications, unreadCount: 0 });
    } catch {
      // Silently fail
    }
  },
}));
