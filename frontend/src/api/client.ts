import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

const client = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: attach access token
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 and attempt token refresh
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function clearAuthAndRedirect() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  window.location.href = import.meta.env.BASE_URL + "login";
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only handle 401 from the server — not network errors
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Don't retry auth endpoints themselves
    const url = originalRequest.url || "";
    if (url.includes("/auth/login") || url.includes("/auth/register") || url.includes("/auth/refresh")) {
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      clearAuthAndRedirect();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        subscribeTokenRefresh((token: string) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(client(originalRequest));
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const response = await axios.post(`${API_BASE}/auth/refresh`, {
        refresh_token: refreshToken,
      });

      const { access_token, refresh_token: newRefreshToken } = response.data;
      localStorage.setItem("access_token", access_token);
      localStorage.setItem("refresh_token", newRefreshToken);

      onTokenRefreshed(access_token);
      isRefreshing = false;

      originalRequest.headers.Authorization = `Bearer ${access_token}`;
      return client(originalRequest);
    } catch (refreshError) {
      isRefreshing = false;
      // Only clear credentials if the refresh was explicitly rejected (401/403)
      // Network errors should not log the user out
      const status = (refreshError as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        clearAuthAndRedirect();
      }
      return Promise.reject(error);
    }
  }
);

export default client;
