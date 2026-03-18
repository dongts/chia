import { useNavigate } from "react-router-dom";
import { Wallet, Users, Receipt, ArrowRight } from "lucide-react";
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
        <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center shadow-lg">
          <Wallet size={32} className="text-white" />
        </div>
      </div>

      {/* Headline */}
      <h1 className="text-4xl font-bold text-gray-900 mb-3">
        Chia
      </h1>
      <p className="text-xl text-gray-500 mb-2">Split expenses effortlessly</p>
      <p className="text-sm text-gray-400 mb-10">
        Track shared costs with friends, roommates, and travel companions — no sign-up required.
      </p>

      {/* CTAs */}
      <div className="flex flex-col gap-3 mb-12">
        <button
          onClick={handleGuestAccess}
          className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors shadow-sm"
        >
          <ArrowRight size={18} />
          Try as Guest — no account needed
        </button>
        <button
          onClick={() => navigate("/register")}
          className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-3 px-6 rounded-xl border border-gray-200 transition-colors"
        >
          Sign Up
        </button>
        <button
          onClick={() => navigate("/login")}
          className="w-full flex items-center justify-center gap-2 text-gray-600 hover:text-gray-800 font-medium py-3 px-6 transition-colors"
        >
          Already have an account? Log In
        </button>
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
            <Receipt size={20} className="text-green-600" />
          </div>
          <p className="text-xs text-gray-500 font-medium">Track expenses</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-green-600" />
          </div>
          <p className="text-xs text-gray-500 font-medium">Split with anyone</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
            <Wallet size={20} className="text-green-600" />
          </div>
          <p className="text-xs text-gray-500 font-medium">Settle up easily</p>
        </div>
      </div>
    </div>
  );
}
