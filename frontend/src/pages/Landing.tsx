import { useNavigate } from "react-router-dom";
import { Sprout, Users, Receipt, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function Landing() {
  const navigate = useNavigate();
  const { guestLogin } = useAuth();

  async function handleGuestAccess() {
    try {
      await guestLogin("Guest");
      navigate("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to continue as guest";
      window.alert(message);
    }
  }

  return (
    <div className="w-full max-w-lg text-center">
      {/* Logo */}
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-editorial-lg">
          <Sprout size={32} className="text-on-primary" />
        </div>
      </div>

      {/* Headline */}
      <h1 className="text-4xl font-bold text-on-surface mb-3">
        Chia
      </h1>
      <p className="text-xl text-on-surface-variant mb-2">Split expenses effortlessly</p>
      <p className="text-sm text-outline mb-10">
        Track shared costs with friends, roommates, and travel companions — no sign-up required.
      </p>

      {/* CTAs */}
      <div className="flex flex-col gap-3 mb-12">
        <button
          onClick={handleGuestAccess}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dim text-on-primary font-semibold py-3 px-6 rounded-xl transition-colors shadow-editorial"
        >
          <ArrowRight size={18} />
          Try as Guest — no account needed
        </button>
        <button
          onClick={() => navigate("/register")}
          className="w-full flex items-center justify-center gap-2 bg-surface-container-lowest hover:bg-surface-container text-on-surface font-semibold py-3 px-6 rounded-xl border border-outline-variant/15 transition-colors"
        >
          Sign Up
        </button>
        <button
          onClick={() => navigate("/login")}
          className="w-full flex items-center justify-center gap-2 text-on-surface-variant hover:text-on-surface font-medium py-3 px-6 transition-colors"
        >
          Already have an account? Log In
        </button>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-primary-container/20 rounded-xl flex items-center justify-center">
            <Receipt size={20} className="text-primary" />
          </div>
          <p className="text-xs text-on-surface-variant font-medium">Track expenses</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-primary-container/20 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-primary" />
          </div>
          <p className="text-xs text-on-surface-variant font-medium">Split with anyone</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-primary-container/20 rounded-xl flex items-center justify-center">
            <Sprout size={20} className="text-primary" />
          </div>
          <p className="text-xs text-on-surface-variant font-medium">Settle up easily</p>
        </div>
      </div>
    </div>
  );
}
