import type { Notification } from "@/types";
import client from "./client";

export async function listNotifications(): Promise<Notification[]> {
  const response = await client.get<Notification[]>("/notifications");
  return response.data;
}

export async function markRead(notificationId: string): Promise<Notification> {
  const response = await client.patch<Notification>(`/notifications/${notificationId}/read`);
  return response.data;
}

export async function markAllRead(): Promise<void> {
  await client.post("/notifications/read-all");
}
