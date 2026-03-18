import type { GroupMember, MemberCreate, MemberUpdate } from "@/types";
import client from "./client";

export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const response = await client.get<GroupMember[]>(`/groups/${groupId}/members`);
  return response.data;
}

export async function addMember(groupId: string, data: MemberCreate): Promise<GroupMember> {
  const response = await client.post<GroupMember>(`/groups/${groupId}/members`, data);
  return response.data;
}

export async function updateMember(
  groupId: string,
  memberId: string,
  data: MemberUpdate
): Promise<GroupMember> {
  const response = await client.patch<GroupMember>(
    `/groups/${groupId}/members/${memberId}`,
    data
  );
  return response.data;
}

export async function claimMember(groupId: string, memberId: string): Promise<GroupMember> {
  const response = await client.post<GroupMember>(
    `/groups/${groupId}/members/${memberId}/claim`
  );
  return response.data;
}

export async function removeMember(groupId: string, memberId: string): Promise<void> {
  await client.delete(`/groups/${groupId}/members/${memberId}`);
}
