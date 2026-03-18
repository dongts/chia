import client from "./client";
import type { GroupCurrencyRead, GroupCurrencyCreate, GroupCurrencyUpdate } from "@/types";

export async function listGroupCurrencies(groupId: string): Promise<GroupCurrencyRead[]> {
  const res = await client.get(`/groups/${groupId}/currencies`);
  return res.data;
}

export async function addGroupCurrency(groupId: string, data: GroupCurrencyCreate): Promise<GroupCurrencyRead> {
  const res = await client.post(`/groups/${groupId}/currencies`, data);
  return res.data;
}

export async function updateGroupCurrency(groupId: string, currencyId: string, data: GroupCurrencyUpdate): Promise<GroupCurrencyRead> {
  const res = await client.patch(`/groups/${groupId}/currencies/${currencyId}`, data);
  return res.data;
}

export async function deleteGroupCurrency(groupId: string, currencyId: string): Promise<void> {
  await client.delete(`/groups/${groupId}/currencies/${currencyId}`);
}
