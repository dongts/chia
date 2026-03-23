import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Sprout } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import GoogleSignIn from "@/components/GoogleSignIn";

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";
  const { login, guestLogin, googleLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate(redirect);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Login failed.";
      window.alert(msg);
    } finally { setLoading(false); }
  }

  async function handleGoogleCredential(credential: string) {
    setLoading(true);
    try {
      await googleLogin(credential);
      navigate(redirect);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Google sign-in failed.";
      window.alert(msg);
    } finally { setLoading(false); }
  }

  async function handleGuest() {
    setLoading(true);
    try {
      await guestLogin("Guest");
      navigate(redirect);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to continue as guest";
      window.alert(message);
    } finally { setLoading(false); }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="flex justify-center mb-6">
        <div className="w-12 h-12 bg-green-600 rounded-2xl flex items-center justify-center">
          <Sprout size={24} className="text-white" />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">Welcome back</h1>
      <p className="text-sm text-gray-500 text-center mb-8">Sign in to your Chia account</p>

      <div className="mb-4">
        <GoogleSignIn onCredential={handleGoogleCredential} disabled={loading} />
      </div>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-4 text-gray-400">or</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors">
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button onClick={handleGuest} disabled={loading} className="text-sm text-green-600 hover:underline hover:text-green-700">
          Continue as guest
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        Don't have an account?{" "}
        <Link to={redirect !== "/dashboard" ? `/register?redirect=${encodeURIComponent(redirect)}` : "/register"}
          className="text-green-600 font-medium hover:underline">Sign up</Link>
      </p>
    </div>
  );
}
