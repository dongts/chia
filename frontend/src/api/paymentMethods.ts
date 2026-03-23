import type { PaymentMethod, PaymentMethodCreate, PaymentMethodUpdate, GroupPaymentMethod, MyGroupPaymentMethod } from "@/types";
import client from "./client";

// Profile-level
export async function listMyPaymentMethods(): Promise<PaymentMethod[]> {
  const res = await client.get<PaymentMethod[]>("/users/me/payment-methods");
  return res.data;
}

export async function createPaymentMethod(data: PaymentMethodCreate): Promise<PaymentMethod> {
  const res = await client.post<PaymentMethod>("/users/me/payment-methods", data);
  return res.data;
}

export async function updatePaymentMethod(id: string, data: PaymentMethodUpdate): Promise<PaymentMethod> {
  const res = await client.patch<PaymentMethod>(`/users/me/payment-methods/${id}`, data);
  return res.data;
}

export async function deletePaymentMethod(id: string): Promise<void> {
  await client.delete(`/users/me/payment-methods/${id}`);
}

export async function uploadQrImage(id: string, file: File): Promise<PaymentMethod> {
  const form = new FormData();
  form.append("file", file);
  const res = await client.post<PaymentMethod>(`/users/me/payment-methods/${id}/qr`, form, {
    headers: { "Content-Type": undefined },
  });
  return res.data;
}

// Group-level
export async function listGroupPaymentMethods(groupId: string): Promise<GroupPaymentMethod[]> {
  const res = await client.get<GroupPaymentMethod[]>(`/groups/${groupId}/payment-methods`);
  return res.data;
}

export async function listMyGroupPaymentMethods(groupId: string): Promise<MyGroupPaymentMethod[]> {
  const res = await client.get<MyGroupPaymentMethod[]>(`/groups/${groupId}/payment-methods/mine`);
  return res.data;
}

export async function enablePaymentMethodInGroup(groupId: string, paymentMethodId: string): Promise<GroupPaymentMethod> {
  const res = await client.post<GroupPaymentMethod>(`/groups/${groupId}/payment-methods`, { payment_method_id: paymentMethodId });
  return res.data;
}

export async function disablePaymentMethodInGroup(groupId: string, paymentMethodId: string): Promise<void> {
  await client.delete(`/groups/${groupId}/payment-methods/${paymentMethodId}`);
}
