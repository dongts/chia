import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Sprout, ArrowRight, UserCheck, UserPlus, Pencil } from "lucide-react";
import { joinGroup, previewGroup } from "@/api/groups";
import type { GroupPreview } from "@/api/groups";
import { useAuthStore } from "@/store/authStore";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Status = "loading" | "choose_identity" | "joining" | "success" | "error";

export default function JoinGroup() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { guestLogin } = useAuth();

  const [status, setStatus] = useState<Status>("loading");
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);

  // Claim selection
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [joinAsNew, setJoinAsNew] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);

  // Load preview (no auth needed)
  useEffect(() => {
    if (!inviteCode) { setStatus("error"); setErrorMsg("Invalid invite link"); return; }
    previewGroup(inviteCode)
      .then((p) => { setPreview(p); setStatus("choose_identity"); })
      .catch(() => { setStatus("error"); setErrorMsg("Invalid or expired invite link"); });
  }, [inviteCode]);

  // When user selects a claim, pre-fill the display name
  useEffect(() => {
    if (selectedClaimId && preview) {
      const m = preview.unclaimed_members.find((m) => m.id === selectedClaimId);
      if (m) setDisplayName(m.display_name);
      setJoinAsNew(false);
    }
  }, [selectedClaimId, preview]);

  async function ensureAuthenticated(): Promise<boolean> {
    if (isAuthenticated) return true;
    try {
      await guestLogin(displayName || "Guest");
      return true;
    } catch {
      setErrorMsg("Failed to create account");
      setStatus("error");
      return false;
    }
  }

  async function handleJoin() {
    if (!inviteCode) return;

    // Validate
    if (joinAsNew && !displayName.trim()) {
      window.alert("Please enter your name");
      return;
    }

    setStatus("joining");

    // Auto-create guest if not logged in
    const authed = await ensureAuthenticated();
    if (!authed) return;

    const claimId = joinAsNew ? undefined : (selectedClaimId || undefined);
    const name = displayName.trim() || undefined;

    try {
      const group = await joinGroup(inviteCode, claimId, name);
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

  // Save invite code for redirect after login/register
  useEffect(() => {
    if (inviteCode) localStorage.setItem("chia_pending_invite", inviteCode);
  }, [inviteCode]);

  const selectedMember = preview?.unclaimed_members.find((m) => m.id === selectedClaimId);
  const hasUnclaimed = (preview?.unclaimed_members.length ?? 0) > 0;
  const canJoin = joinAsNew ? displayName.trim().length > 0 : true;

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="text-center max-w-sm w-full">
        <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Sprout size={26} className="text-on-primary" />
        </div>

        {/* Group name */}
        {preview && status !== "error" && (
          <>
            <p className="text-xs text-outline uppercase tracking-wide mb-1">You're invited to</p>
            <h1 className="text-xl font-bold text-on-surface mb-1">{preview.name}</h1>
            <p className="text-xs text-outline mb-6">{preview.member_count} members · {preview.currency_code}</p>
          </>
        )}

        {/* Loading */}
        {status === "loading" && (
          <div className="mt-4 flex justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Choose identity — works for both authed and unauthed users */}
        {status === "choose_identity" && preview && (
          <div className="text-left">
            {/* Unclaimed members */}
            {hasUnclaimed && (
              <>
                <p className="text-sm font-medium text-on-surface mb-2">Are you one of these people?</p>
                <div className="border border-outline-variant/15 rounded-xl overflow-hidden divide-y divide-outline-variant/10 mb-3">
                  {preview.unclaimed_members.map((m) => {
                    const isSelected = selectedClaimId === m.id && !joinAsNew;
                    return (
                      <button key={m.id} type="button"
                        onClick={() => { setSelectedClaimId(m.id); setJoinAsNew(false); setEditingName(false); }}
                        className={cn("w-full flex items-center gap-3 px-4 py-3 transition-colors",
                          isSelected ? "bg-primary-container/20" : "hover:bg-surface-container"
                        )}>
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                          isSelected ? "bg-primary-container/50 text-on-primary-container" : "bg-surface-container text-on-surface-variant"
                        )}>{m.display_name[0]?.toUpperCase()}</div>
                        <span className={cn("text-sm font-medium flex-1 text-left", isSelected ? "text-on-primary-container" : "text-on-surface")}>
                          {m.display_name}
                        </span>
                        {isSelected && <UserCheck size={18} className="text-primary flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Join as new */}
            <button type="button"
              onClick={() => { setJoinAsNew(true); setSelectedClaimId(null); setDisplayName(""); }}
              className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors mb-4",
                joinAsNew ? "bg-tertiary-container/20 border-tertiary-container" : "border-outline-variant/15 hover:bg-surface-container"
              )}>
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                joinAsNew ? "bg-tertiary-container/50 text-on-tertiary-container" : "bg-surface-container text-on-surface-variant"
              )}><UserPlus size={16} /></div>
              <span className={cn("text-sm font-medium", joinAsNew ? "text-on-tertiary-container" : "text-on-surface")}>
                {hasUnclaimed ? "I'm not on the list — join as someone new" : "Join this group"}
              </span>
            </button>

            {/* Name input — for new member or editing claimed name */}
            {joinAsNew && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-on-surface mb-1">Your name</label>
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your name"
                  autoFocus
                  className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
              </div>
            )}

            {/* Show editable name for claimed member */}
            {selectedClaimId && !joinAsNew && selectedMember && (
              <div className="mb-4 bg-primary-container/20 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-on-primary-container">
                    Joining as <strong>{editingName ? "" : displayName}</strong>
                  </p>
                  {!editingName && (
                    <button onClick={() => setEditingName(true)}
                      className="text-xs text-primary hover:text-primary flex items-center gap-1">
                      <Pencil size={12} /> Change name
                    </button>
                  )}
                </div>
                {editingName && (
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    autoFocus
                    onBlur={() => { if (!displayName.trim()) setDisplayName(selectedMember.display_name); setEditingName(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") setEditingName(false); }}
                    className="mt-2 w-full border border-primary-container rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
                )}
              </div>
            )}

            {/* Join button */}
            <button onClick={handleJoin} disabled={!canJoin}
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 px-6 rounded-xl transition-colors">
              <ArrowRight size={18} />
              {!isAuthenticated ? "Join (as guest)" : "Join group"}
            </button>

            {/* Auth options for unauthenticated users */}
            {!isAuthenticated && !authLoading && (
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-xs text-outline">Or sign in for a permanent account:</p>
                <div className="flex gap-2">
                  <Link to={`/login?redirect=/join/${inviteCode}`}
                    className="flex-1 text-center text-sm text-primary hover:text-primary font-medium py-2 border border-outline-variant/15 rounded-lg hover:bg-surface-container">
                    Log In
                  </Link>
                  <Link to={`/register?redirect=/join/${inviteCode}`}
                    className="flex-1 text-center text-sm text-primary hover:text-primary font-medium py-2 border border-outline-variant/15 rounded-lg hover:bg-surface-container">
                    Sign Up
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Joining */}
        {status === "joining" && (
          <>
            <p className="text-sm text-on-surface-variant">Joining the group...</p>
            <div className="mt-4 flex justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}

        {/* Success */}
        {status === "success" && (
          <>
            <h1 className="text-xl font-bold text-on-surface mb-2">You're in!</h1>
            <p className="text-sm text-on-surface-variant">Redirecting to the group...</p>
            {groupId && (
              <button onClick={() => navigate(`/groups/${groupId}`)} className="mt-4 text-sm text-primary underline hover:text-primary">Go now</button>
            )}
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <>
            <h1 className="text-xl font-bold text-on-surface mb-2">Couldn't join</h1>
            <p className="text-sm text-error mb-4">{errorMsg}</p>
            <button onClick={() => navigate("/dashboard")} className="text-sm text-primary hover:underline hover:text-primary font-medium">
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
