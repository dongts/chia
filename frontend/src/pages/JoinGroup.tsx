import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Sprout, ArrowRight } from "lucide-react";
import { joinGroup } from "@/api/groups";
import { useAuthStore } from "@/store/authStore";
import { useAuth } from "@/hooks/useAuth";

export default function JoinGroup() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { guestLogin } = useAuth();

  const [status, setStatus] = useState<"checking" | "need_auth" | "joining" | "success" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [guestLoggingIn, setGuestLoggingIn] = useState(false);

  // Step 1: Wait for auth to initialize, then decide what to do
  useEffect(() => {
    if (authLoading) return;
    if (!inviteCode) {
      setStatus("error");
      setErrorMsg("Invalid invite link");
      return;
    }
    if (isAuthenticated) {
      doJoin();
    } else {
      setStatus("need_auth");
    }
  }, [authLoading, isAuthenticated, inviteCode]);

  async function doJoin() {
    if (!inviteCode) return;
    setStatus("joining");
    try {
      const group = await joinGroup(inviteCode);
      setGroupId(group.id);
      setStatus("success");
      setTimeout(() => navigate(`/groups/${group.id}`), 1200);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to join group";
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  async function handleGuestJoin() {
    setGuestLoggingIn(true);
    try {
      await guestLogin("Guest");
      // After guest login, isAuthenticated flips → useEffect triggers doJoin()
    } catch {
      setErrorMsg("Failed to create guest account");
      setStatus("error");
      setGuestLoggingIn(false);
    }
  }

  // Save invite code so login/register pages can redirect back
  useEffect(() => {
    if (inviteCode) {
      localStorage.setItem("chia_pending_invite", inviteCode);
    }
    return () => {
      // Clean up on unmount (after successful join)
      if (status === "success") {
        localStorage.removeItem("chia_pending_invite");
      }
    };
  }, [inviteCode, status]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm w-full">
        <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Sprout size={26} className="text-white" />
        </div>

        {/* Checking auth */}
        {(status === "checking" || status === "joining") && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              {status === "checking" ? "Preparing..." : "Joining group..."}
            </h1>
            <p className="text-sm text-gray-500">Please wait a moment</p>
            <div className="mt-6 flex justify-center">
              <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}

        {/* Need to authenticate first */}
        {status === "need_auth" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">You're invited!</h1>
            <p className="text-sm text-gray-500 mb-6">
              Sign in or continue as a guest to join this group.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleGuestJoin}
                disabled={guestLoggingIn}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
              >
                <ArrowRight size={18} />
                {guestLoggingIn ? "Joining..." : "Join as Guest — no account needed"}
              </button>
              <Link
                to={`/login?redirect=/join/${inviteCode}`}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-3 px-6 rounded-xl border border-gray-200 transition-colors"
              >
                Log In
              </Link>
              <Link
                to={`/register?redirect=/join/${inviteCode}`}
                className="w-full flex items-center justify-center gap-2 text-gray-600 hover:text-gray-800 font-medium py-3 px-6 transition-colors"
              >
                Create Account
              </Link>
            </div>
          </>
        )}

        {/* Success */}
        {status === "success" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Joined!</h1>
            <p className="text-sm text-gray-500">Redirecting you to the group...</p>
            {groupId && (
              <button onClick={() => navigate(`/groups/${groupId}`)} className="mt-4 text-sm text-green-600 underline">
                Go now
              </button>
            )}
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Couldn't join</h1>
            <p className="text-sm text-red-500 mb-4">{errorMsg}</p>
            <button onClick={() => navigate("/dashboard")} className="text-sm text-green-600 hover:underline font-medium">
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
