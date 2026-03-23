import { useNavigate } from "react-router-dom";
import { Sprout, ArrowRight, Shield, TrendingUp, BarChart3, Wallet, Leaf } from "lucide-react";
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
    <div className="w-full max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Sprout size={16} className="text-on-primary" />
          </div>
          <span className="font-bold text-on-surface">Chia</span>
        </div>
      </div>

      {/* Hero */}
      <div className="mb-8">
        <p className="text-[10px] font-semibold text-primary uppercase tracking-widest mb-3">Split Expenses</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-on-surface leading-tight mb-2">
          Share costs,{" "}
          <span className="text-primary">effortlessly</span>
        </h1>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          Track shared costs with friends, roommates, and travel companions — no sign-up required.
        </p>
      </div>

      {/* CTAs */}
      <div className="space-y-3 mb-10">
        <button
          onClick={() => navigate("/register")}
          className="w-full flex items-center justify-between bg-primary hover:bg-primary-dim text-on-primary font-semibold py-3.5 px-5 rounded-full transition-colors"
        >
          <span>Sign Up</span>
          <ArrowRight size={18} />
        </button>
        <div className="flex gap-3">
          <button
            onClick={handleGuestAccess}
            className="flex-1 py-3 px-4 rounded-full text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors text-center"
          >
            Try as Guest
          </button>
          <button
            onClick={() => navigate("/login")}
            className="flex-1 py-3 px-4 rounded-full text-sm font-medium text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors text-center"
          >
            Log In
          </button>
        </div>
      </div>

      {/* Feature highlight card */}
      <div className="bg-surface-container-lowest rounded-2xl p-5 mb-4 shadow-editorial">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-container/20 flex items-center justify-center flex-shrink-0">
            <Leaf size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface mb-1">Eco-Splitting</h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Split expenses with friends, roommates, and travel companions — no sign-up required.
            </p>
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-editorial">
          <Shield size={20} className="text-primary mb-2" />
          <h4 className="text-xs font-semibold text-on-surface mb-0.5">VietQR</h4>
          <p className="text-[10px] text-on-surface-variant">Pay via QR with Vietnamese banks</p>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-editorial">
          <TrendingUp size={20} className="text-primary mb-2" />
          <h4 className="text-xs font-semibold text-on-surface mb-0.5">Smart Settle</h4>
          <p className="text-[10px] text-on-surface-variant">Minimize transfers with debt simplification</p>
        </div>
      </div>

      {/* Bottom features */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3 px-1">
          <BarChart3 size={18} className="text-primary flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-on-surface">Group Reports</p>
            <p className="text-[10px] text-on-surface-variant">See who spent what, by category</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-1">
          <Wallet size={18} className="text-primary flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-on-surface">Multi-Currency</p>
            <p className="text-[10px] text-on-surface-variant">Log expenses in any currency with auto conversion</p>
          </div>
        </div>
      </div>
    </div>
  );
}
