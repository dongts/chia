import type { Group, GroupCreate, GroupListItem, GroupUpdate } from "@/types";
import client from "./client";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

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

export interface GroupPreview {
  id: string;
  name: string;
  currency_code: string;
  member_count: number;
  require_verified_users: boolean;
  unclaimed_members: { id: string; display_name: string }[];
}

export async function previewGroup(inviteCode: string): Promise<GroupPreview> {
  // No auth needed — use raw axios
  const response = await axios.get<GroupPreview>(`${API_BASE}/groups/preview/${inviteCode}`);
  return response.data;
}

export async function joinGroup(inviteCode: string, claimMemberId?: string): Promise<Group> {
  const response = await client.post<Group>(`/groups/join/${inviteCode}`, {
    claim_member_id: claimMemberId || null,
  });
  return response.data;
}
