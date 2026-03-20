import { useAuthStore } from "@/store/authStore";
import {
  login as apiLogin,
  register as apiRegister,
  guestAuth as apiGuestAuth,
  googleAuth as apiGoogleAuth,
  getMe,
} from "@/api/auth";
import { getDeviceId } from "@/utils/deviceId";

export function useAuth() {
  const { user, isAuthenticated, isLoading, setUser, logout: storeLogout } = useAuthStore();

  async function login(email: string, password: string): Promise<void> {
    const tokens = await apiLogin({ email, password });
    localStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    const userData = await getMe();
    setUser(userData);
  }

  async function register(
    email: string,
    password: string,
    display_name: string
  ): Promise<void> {
    const tokens = await apiRegister({ email, password, display_name });
    localStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    const userData = await getMe();
    setUser(userData);
  }

  async function guestLogin(displayName: string = "Guest"): Promise<void> {
    const deviceId = getDeviceId();
    const tokens = await apiGuestAuth({ device_id: deviceId, display_name: displayName });
    localStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    const userData = await getMe();
    setUser(userData);
  }

  async function googleLogin(credential: string): Promise<void> {
    const tokens = await apiGoogleAuth(credential);
    localStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    const userData = await getMe();
    setUser(userData);
  }

  function logout(): void {
    storeLogout();
  }

  return {
    user,
    isAuthenticated,
    isLoading,
    login,
    register,
    guestLogin,
    googleLogin,
    logout,
  };
}
