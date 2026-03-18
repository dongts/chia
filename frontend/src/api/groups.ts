import type { Group, GroupCreate, GroupListItem, GroupUpdate } from "@/types";
import client from "./client";

export async function createGroup(data: GroupCreate): Promise<Group> {
  const response = await client.post<Group>("/groups", data);
  return response.data;
}

export async function listGroups(): Promise<GroupListItem[]> {
  const response = await client.get<GroupListItem[]>("/groups");
  return response.data;
}

export async function getGroup(groupId: string): Promise<Group> {
  const response = await client.get<Group>(`/groups/${groupId}`);
  return response.data;
}

export async function updateGroup(groupId: string, data: GroupUpdate): Promise<Group> {
  const response = await client.patch<Group>(`/groups/${groupId}`, data);
  return response.data;
}

export async function deleteGroup(groupId: string): Promise<void> {
  await client.delete(`/groups/${groupId}`);
}

export async function joinGroup(inviteCode: string): Promise<Group> {
  const response = await client.post<Group>(`/groups/join/${inviteCode}`);
  return response.data;
}
