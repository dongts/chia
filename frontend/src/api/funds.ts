import type {
  Fund,
  FundCreate,
  FundDetail,
  FundTransaction,
  FundTransactionCreate,
  FundUpdate,
} from "@/types";
import client from "./client";

export async function createFund(groupId: string, data: FundCreate): Promise<Fund> {
  const response = await client.post<Fund>(`/groups/${groupId}/funds`, data);
  return response.data;
}

export async function listFunds(groupId: string): Promise<Fund[]> {
  const response = await client.get<Fund[]>(`/groups/${groupId}/funds`);
  return response.data;
}

export async function getFund(groupId: string, fundId: string): Promise<FundDetail> {
  const response = await client.get<FundDetail>(`/groups/${groupId}/funds/${fundId}`);
  return response.data;
}

export async function updateFund(
  groupId: string,
  fundId: string,
  data: FundUpdate,
): Promise<Fund> {
  const response = await client.patch<Fund>(`/groups/${groupId}/funds/${fundId}`, data);
  return response.data;
}

export async function closeFund(groupId: string, fundId: string): Promise<void> {
  await client.delete(`/groups/${groupId}/funds/${fundId}`);
}

export async function createFundTransaction(
  groupId: string,
  fundId: string,
  data: FundTransactionCreate,
): Promise<FundTransaction> {
  const response = await client.post<FundTransaction>(
    `/groups/${groupId}/funds/${fundId}/transactions`,
    data,
  );
  return response.data;
}

export async function listFundTransactions(
  groupId: string,
  fundId: string,
): Promise<FundTransaction[]> {
  const response = await client.get<FundTransaction[]>(
    `/groups/${groupId}/funds/${fundId}/transactions`,
  );
  return response.data;
}

export async function deleteFundTransaction(
  groupId: string,
  fundId: string,
  transactionId: string,
): Promise<void> {
  await client.delete(`/groups/${groupId}/funds/${fundId}/transactions/${transactionId}`);
}
