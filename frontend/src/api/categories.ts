import type { Category, CategoryCreate } from "@/types";
import client from "./client";

export async function listSystemCategories(): Promise<Category[]> {
  const response = await client.get<Category[]>("/categories");
  return response.data;
}

export async function listGroupCategories(groupId: string): Promise<Category[]> {
  const response = await client.get<Category[]>(`/groups/${groupId}/categories`);
  return response.data;
}

export async function createCategory(
  groupId: string,
  data: CategoryCreate
): Promise<Category> {
  const response = await client.post<Category>(`/groups/${groupId}/categories`, data);
  return response.data;
}
