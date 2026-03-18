import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { User, ArrowLeft, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import client from "@/api/client";
import { upgrade } from "@/api/auth";
import { getMe } from "@/api/auth";
import { useAuthStore } from "@/store/authStore";

export default function Profile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setUser } = useAuthStore();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [savingName, setSavingName] = useState(false);

  // Upgrade form
  const [upgradeEmail, setUpgradeEmail] = useState("");
  const [upgradePassword, setUpgradePassword] = useState("");
  const [upgrading, setUpgrading] = useState(false);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      await client.patch("/users/me", { display_name: displayName });
      const updated = await getMe();
      setUser(updated);
      window.alert("Display name updated!");
    } catch {
      window.alert("Failed to update display name");
    } finally {
      setSavingName(false);
    }
  }

  async function handleUpgrade(e: FormEvent) {
    e.preventDefault();
    setUpgrading(true);
    try {
      const tokens = await upgrade({
        email: upgradeEmail,
        password: upgradePassword,
      });
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      const updated = await getMe();
      setUser(updated);
      window.alert("Account upgraded! You can now log in with your email.");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to upgrade account";
      window.alert(msg);
    } finally {
      setUpgrading(false);
    }
  }

  if (!user) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Avatar + name */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.display_name}
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <User size={28} className="text-green-600" />
              )}
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">{user.display_name}</p>
              {user.is_verified && user.email ? (
                <p className="text-sm text-gray-500">{user.email}</p>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                  Guest account
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleSaveName} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            {user.is_verified && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2.5">
                  {user.email}
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={savingName}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {savingName ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </section>

        {/* Upgrade section for guests */}
        {!user.is_verified && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={18} className="text-green-600" />
              <h2 className="text-base font-semibold text-gray-900">Upgrade to Full Account</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Add an email and password to keep your data across devices and never lose access.
            </p>
            <form onSubmit={handleUpgrade} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={upgradeEmail}
                  onChange={(e) => setUpgradeEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={upgradePassword}
                  onChange={(e) => setUpgradePassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={upgrading}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {upgrading ? "Upgrading..." : "Upgrade Account"}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
