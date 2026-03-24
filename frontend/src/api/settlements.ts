import type { Balance, Settlement, SettlementCreate, SettlementUpdate, SuggestedSettlement } from "@/types";
import client from "./client";

export async function getBalances(groupId: string): Promise<Balance[]> {
  const response = await client.get<Balance[]>(`/groups/${groupId}/balances`);
  return response.data;
}

export async function getSuggestedSettlements(groupId: string): Promise<SuggestedSettlement[]> {
  const response = await client.get<SuggestedSettlement[]>(
    `/groups/${groupId}/settlements/suggested`
  );
  return response.data;
}

export async function createSettlement(
  groupId: string,
  data: SettlementCreate
): Promise<Settlement> {
  const response = await client.post<Settlement>(`/groups/${groupId}/settlements`, data);
  return response.data;
}

export async function updateSettlement(
  groupId: string,
  settlementId: string,
  data: SettlementUpdate
): Promise<Settlement> {
  const response = await client.patch<Settlement>(`/groups/${groupId}/settlements/${settlementId}`, data);
  return response.data;
}

export async function listSettlements(groupId: string): Promise<Settlement[]> {
  const response = await client.get<Settlement[]>(`/groups/${groupId}/settlements`);
  return response.data;
}
