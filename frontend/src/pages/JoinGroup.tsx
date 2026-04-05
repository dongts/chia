import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("group");
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
    if (!inviteCode) { setStatus("error"); setErrorMsg(t("join.error_title")); return; }
    previewGroup(inviteCode)
      .then((p) => { setPreview(p); setStatus("choose_identity"); })
      .catch(() => { setStatus("error"); setErrorMsg(t("join.error_title")); });
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
      await guestLogin(displayName || t("join.join_button_guest"));
      return true;
    } catch {
      setErrorMsg(t("join.error_title"));
      setStatus("error");
      return false;
    }
  }

  async function handleJoin() {
    if (!inviteCode) return;

    // Validate
    if (joinAsNew && !displayName.trim()) {
      window.alert(t("join.your_name_placeholder"));
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
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t("join.error_title");
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
            <p className="text-xs text-outline uppercase tracking-wide mb-1">{t("join.invited_to")}</p>
            <h1 className="text-xl font-bold text-on-surface mb-1">{preview.name}</h1>
            <p className="text-xs text-outline mb-6">{t("join.members_count", { count: preview.member_count, currency: preview.currency_code })}</p>
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
                <p className="text-sm font-medium text-on-surface mb-2">{t("join.choose_identity")}</p>
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
                {hasUnclaimed ? t("join.join_as_new") : t("join.join_first")}
              </span>
            </button>

            {/* Name input — for new member or editing claimed name */}
            {joinAsNew && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5">{t("join.your_name_label")}</label>
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("join.your_name_placeholder")}
                  autoFocus
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}

            {/* Show editable name for claimed member */}
            {selectedClaimId && !joinAsNew && selectedMember && (
              <div className="mb-4 bg-primary-container/20 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-on-primary-container">
                    {t("join.joining_as")} <strong>{editingName ? "" : displayName}</strong>
                  </p>
                  {!editingName && (
                    <button onClick={() => setEditingName(true)}
                      className="text-xs text-primary hover:text-primary flex items-center gap-1">
                      <Pencil size={12} /> {t("join.change_name")}
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
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3.5 px-6 rounded-full transition-colors shadow-editorial">
              <ArrowRight size={18} />
              {!isAuthenticated ? t("join.join_button_guest") : t("join.join_button")}
            </button>

            {/* Auth options for unauthenticated users */}
            {!isAuthenticated && !authLoading && (
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-xs text-outline">{t("join.sign_in_hint")}</p>
                <div className="flex gap-2">
                  <Link to={`/login?redirect=/join/${inviteCode}`}
                    className="flex-1 text-center text-sm text-primary font-medium py-2.5 bg-surface-container hover:bg-surface-container-high rounded-full transition-colors">
                    {t("join.log_in")}
                  </Link>
                  <Link to={`/register?redirect=/join/${inviteCode}`}
                    className="flex-1 text-center text-sm text-primary font-medium py-2.5 bg-surface-container hover:bg-surface-container-high rounded-full transition-colors">
                    {t("join.sign_up")}
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Joining */}
        {status === "joining" && (
          <>
            <p className="text-sm text-on-surface-variant">{t("join.joining")}</p>
            <div className="mt-4 flex justify-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          </>
        )}

        {/* Success */}
        {status === "success" && (
          <>
            <h1 className="text-xl font-bold text-on-surface mb-2">{t("join.success_title")}</h1>
            <p className="text-sm text-on-surface-variant">{t("join.success_subtitle")}</p>
            {groupId && (
              <button onClick={() => navigate(`/groups/${groupId}`)} className="mt-4 text-sm text-primary underline hover:text-primary">{t("join.success_go_now")}</button>
            )}
          </>
        )}

        {/* Error */}
        {status === "error" && (
          <>
            <h1 className="text-xl font-bold text-on-surface mb-2">{t("join.error_title")}</h1>
            <p className="text-sm text-error mb-4">{errorMsg}</p>
            <button onClick={() => navigate("/dashboard")} className="text-sm text-primary hover:underline hover:text-primary font-medium">
              {t("join.error_go_dashboard")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
