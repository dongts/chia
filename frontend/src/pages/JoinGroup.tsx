import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Sprout, ArrowRight, UserCheck, UserPlus } from "lucide-react";
import { joinGroup, previewGroup } from "@/api/groups";
import type { GroupPreview } from "@/api/groups";
import { useAuthStore } from "@/store/authStore";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Status = "loading" | "need_auth" | "choose_identity" | "joining" | "success" | "error";

export default function JoinGroup() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { guestLogin } = useAuth();

  const [status, setStatus] = useState<Status>("loading");
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [guestLoggingIn, setGuestLoggingIn] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  // Load preview (no auth needed)
  useEffect(() => {
    if (!inviteCode) { setStatus("error"); setErrorMsg("Invalid invite link"); return; }
    previewGroup(inviteCode)
      .then((p) => { setPreview(p); })
      .catch(() => { setStatus("error"); setErrorMsg("Invalid or expired invite link"); });
  }, [inviteCode]);

  // Once preview loaded + auth resolved, decide next step
  useEffect(() => {
    if (!preview || authLoading) return;
    if (!isAuthenticated) {
      setStatus("need_auth");
    } else if (preview.unclaimed_members.length > 0) {
      setStatus("choose_identity");
    } else {
      doJoin(null);
    }
  }, [preview, authLoading, isAuthenticated]);

  async function doJoin(claimId: string | null) {
    if (!inviteCode) return;
    setStatus("joining");
    try {
      const group = await joinGroup(inviteCode, claimId || undefined);
      setGroupId(group.id);
      setStatus("success");
      localStorage.removeItem("chia_pending_invite");
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
      // isAuthenticated flips → useEffect handles next step
    } catch {
      setErrorMsg("Failed to create guest account");
      setStatus("error");
      setGuestLoggingIn(false);
    }
  }

  // Save invite code for redirect after login/register
  useEffect(() => {
    if (inviteCode) localStorage.setItem("chia_pending_invite", inviteCode);
  }, [inviteCode]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm w-full">
        <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Sprout size={26} className="text-white" />
        </div>

        {/* Group name */}
        {preview && status !== "error" && (
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Joining</p>
        )}
        {preview && status !== "error" && (
          <h1 className="text-xl font-bold text-gray-900 mb-1">{preview.name}</h1>
        )}
        {preview && status !== "error" && (
          <p className="text-xs text-gray-400 mb-6">{preview.member_count} members · {preview.currency_code}</p>
        )}

        {/* Loading */}
        {status === "loading" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Loading...</h1>
            <div className="mt-4 flex justify-center">
              <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}

        {/* Need auth */}
        {status === "need_auth" && (
          <>
            <p className="text-sm text-gray-500 mb-6">Sign in or continue as a guest to join.</p>
            <div className="flex flex-col gap-3">
              <button onClick={handleGuestJoin} disabled={guestLoggingIn}
                className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
                <ArrowRight size={18} />
                {guestLoggingIn ? "Joining..." : "Join as Guest"}
              </button>
              <Link to={`/login?redirect=/join/${inviteCode}`}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-3 px-6 rounded-xl border border-gray-200 transition-colors">
                Log In
              </Link>
              <Link to={`/register?redirect=/join/${inviteCode}`}
                className="w-full flex items-center gap-2 justify-center text-gray-600 hover:text-gray-800 font-medium py-3 px-6 transition-colors">
                Create Account
              </Link>
            </div>
          </>
        )}

        {/* Choose identity — claim existing member or join as new */}
        {status === "choose_identity" && preview && (
          <>
            <p className="text-sm text-gray-500 mb-4">Are you one of these members?</p>

            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 mb-4 text-left">
              {preview.unclaimed_members.map((m) => (
                <button key={m.id} type="button"
                  onClick={() => setSelectedClaimId(selectedClaimId === m.id ? null : m.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 transition-colors",
                    selectedClaimId === m.id ? "bg-green-50" : "hover:bg-gray-50"
                  )}>
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                    selectedClaimId === m.id ? "bg-green-200 text-green-800" : "bg-gray-100 text-gray-600"
                  )}>{m.display_name[0]?.toUpperCase()}</div>
                  <span className={cn("text-sm font-medium", selectedClaimId === m.id ? "text-green-800" : "text-gray-700")}>
                    {m.display_name}
                  </span>
                  {selectedClaimId === m.id && <UserCheck size={18} className="ml-auto text-green-600" />}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              {selectedClaimId ? (
                <button onClick={() => doJoin(selectedClaimId)}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
                  <UserCheck size={18} />
                  That's me — join as {preview.unclaimed_members.find((m) => m.id === selectedClaimId)?.display_name}
                </button>
              ) : (
                <button onClick={() => doJoin(null)}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
                  <UserPlus size={18} />
                  I'm not listed — join as new member
                </button>
              )}
              {selectedClaimId && (
                <button onClick={() => { setSelectedClaimId(null); }}
                  className="text-sm text-gray-500 hover:text-gray-700">
                  I'm not on the list
                </button>
              )}
            </div>
          </>
        )}

        {/* Joining */}
        {status === "joining" && (
          <>
            <p className="text-sm text-gray-500">Joining the group...</p>
            <div className="mt-4 flex justify-center">
              <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}

        {/* Success */}
        {status === "success" && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">You're in!</h1>
            <p className="text-sm text-gray-500">Redirecting to the group...</p>
            {groupId && (
              <button onClick={() => navigate(`/groups/${groupId}`)} className="mt-4 text-sm text-green-600 underline">Go now</button>
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
