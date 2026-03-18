import type { Expense, ExpenseCreate, ExpenseUpdate } from "@/types";
import client from "./client";

export async function createExpense(groupId: string, data: ExpenseCreate): Promise<Expense> {
  const response = await client.post<Expense>(`/groups/${groupId}/expenses`, data);
  return response.data;
}

export async function listExpenses(groupId: string): Promise<Expense[]> {
  const response = await client.get<Expense[]>(`/groups/${groupId}/expenses`);
  return response.data;
}

export async function getExpense(groupId: string, expenseId: string): Promise<Expense> {
  const response = await client.get<Expense>(`/groups/${groupId}/expenses/${expenseId}`);
  return response.data;
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  data: ExpenseUpdate
): Promise<Expense> {
  const response = await client.patch<Expense>(
    `/groups/${groupId}/expenses/${expenseId}`,
    data
  );
  return response.data;
}

export async function deleteExpense(groupId: string, expenseId: string): Promise<void> {
  await client.delete(`/groups/${groupId}/expenses/${expenseId}`);
}
