import { useEffect } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { useAuthStore } from "@/store/authStore";

const POLL_INTERVAL_MS = 30_000;

export function useNotifications() {
  const { notifications, unreadCount, fetch, markRead, markAllRead } = useNotificationStore();
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) return;

    fetch();

    const interval = setInterval(() => {
      fetch();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isAuthenticated, fetch]);

  return { notifications, unreadCount, markRead, markAllRead };
}
