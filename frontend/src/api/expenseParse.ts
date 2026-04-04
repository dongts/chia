import type { ExpenseParseDraft } from "@/types";
import client from "./client";

export async function parseExpense(
  groupId: string,
  text: string,
  parsingLevel?: string,
): Promise<ExpenseParseDraft> {
  const response = await client.post<ExpenseParseDraft>(
    `/groups/${groupId}/expenses/parse`,
    {
      text,
      parsing_level: parsingLevel ?? undefined,
    },
  );
  return response.data;
}
