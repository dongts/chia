import type { TokenResponse, User } from "@/types";
import client from "./client";

export interface RegisterData {
  email: string;
  password: string;
  display_name: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface GuestAuthData {
  device_id: string;
  display_name?: string;
}

export interface UpgradeData {
  email: string;
  password: string;
  display_name?: string;
}

export async function register(data: RegisterData): Promise<TokenResponse> {
  const response = await client.post<TokenResponse>("/auth/register", data);
  return response.data;
}

export async function login(data: LoginData): Promise<TokenResponse> {
  const response = await client.post<TokenResponse>("/auth/login", data);
  return response.data;
}

export async function guestAuth(data: GuestAuthData): Promise<TokenResponse> {
  const response = await client.post<TokenResponse>("/auth/guest", data);
  return response.data;
}

export async function upgrade(data: UpgradeData): Promise<TokenResponse> {
  const response = await client.post<TokenResponse>("/auth/upgrade", data);
  return response.data;
}

export async function googleAuth(credential: string): Promise<TokenResponse> {
  const response = await client.post<TokenResponse>("/auth/google", { credential });
  return response.data;
}

export async function getAuthConfig(): Promise<{ google_client_id: string | null }> {
  const response = await client.get<{ google_client_id: string | null }>("/auth/config");
  return response.data;
}

export async function refreshToken(refreshToken: string): Promise<TokenResponse> {
  const response = await client.post<TokenResponse>("/auth/refresh", {
    refresh_token: refreshToken,
  });
  return response.data;
}

export async function getMe(): Promise<User> {
  const response = await client.get<User>("/users/me");
  return response.data;
}
