import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Sprout } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import GoogleSignIn from "@/components/GoogleSignIn";
import { useTranslation } from "react-i18next";

export default function Register() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";
  const { register, googleLogin } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await register(email, password, displayName);
      navigate(redirect);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t("register.error");
      window.alert(msg);
    } finally { setLoading(false); }
  }

  async function handleGoogleCredential(credential: string) {
    setLoading(true);
    try {
      await googleLogin(credential);
      navigate(redirect);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t("login.error_google");
      window.alert(msg);
    } finally { setLoading(false); }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo + tagline */}
      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-editorial">
            <Sprout size={24} className="text-on-primary" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-on-surface mb-1">{t("register.title")}</h1>
        <p className="text-sm text-on-surface-variant">{t("register.subtitle")}</p>
      </div>

      {/* Google auth */}
      <div className="mb-4">
        <GoogleSignIn onCredential={handleGoogleCredential} disabled={loading} />
      </div>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-outline-variant/15" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-surface px-3 text-outline font-medium">{t("login.guest_divider")}</span>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wide">{t("register.display_name")}</label>
          <input type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("register.display_name")}
            className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wide">{t("register.email")}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wide">{t("register.password")}</label>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={t("upgrade.password_placeholder", { ns: "profile", defaultValue: "At least 8 characters" })}
            className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full transition-colors">
          {loading ? t("register.submitting") : t("register.submit")}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-on-surface-variant">
        {t("register.has_account")}{" "}
        <Link to={redirect !== "/dashboard" ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login"}
          className="text-primary font-semibold hover:underline">{t("register.login_link")}</Link>
      </p>
    </div>
  );
}
