import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Copy, Check, Trash2, Plus, Pencil, X, UserPlus, UserMinus, Shield, Link as LinkIcon } from "lucide-react";
import client from "@/api/client";
import { getGroup, updateGroup, deleteGroup } from "@/api/groups";
import { listMembers, addMember, updateMember, removeMember } from "@/api/members";
import { listGroupCurrencies, addGroupCurrency, updateGroupCurrency, deleteGroupCurrency } from "@/api/groupCurrencies";
import { listMyGroupPaymentMethods, enablePaymentMethodInGroup, disablePaymentMethodInGroup } from "@/api/paymentMethods";
import type { Group, GroupMember, GroupCurrencyRead, MemberRole, MyGroupPaymentMethod } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import CurrencySelect from "@/components/CurrencySelect";
import { getCurrencyName } from "@/utils/currencies";

type MemberLogAction = "joined" | "left" | "removed" | "role_changed" | "renamed" | "claimed";

interface MemberLogEntry {
  id: string;
  member_name: string;
  action: MemberLogAction;
  detail: string;
  performer_name: string | null;
  created_at: string;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ROLE_COLORS: Record<MemberRole, string> = {
  owner: "bg-primary-container/30 text-primary",
  admin: "bg-tertiary-container/30 text-tertiary",
  member: "bg-surface-container text-on-surface-variant",
};

export default function GroupSettings() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [currencies, setCurrencies] = useState<GroupCurrencyRead[]>([]);
  const [newCurrencyCode, setNewCurrencyCode] = useState("");
  const [newCurrencyRate, setNewCurrencyRate] = useState("");
  const [addingCurrency, setAddingCurrency] = useState(false);
  const [renamingMemberId, setRenamingMemberId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [activityLog, setActivityLog] = useState<MemberLogEntry[]>([]);
  const [logLimit, setLogLimit] = useState(20);
  const [myGroupPMs, setMyGroupPMs] = useState<MyGroupPaymentMethod[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [requireVerified, setRequireVerified] = useState(false);
  const [allowLogOnBehalf, setAllowLogOnBehalf] = useState(true);

  useEffect(() => {
    if (!groupId) return;
    loadData();
  }, [groupId]);

  async function loadData() {
    if (!groupId) return;
    try {
      const [g, m, c, logRes, pms] = await Promise.all([
        getGroup(groupId),
        listMembers(groupId),
        listGroupCurrencies(groupId),
        client.get<MemberLogEntry[]>(`/groups/${groupId}/members/log`),
        listMyGroupPaymentMethods(groupId),
      ]);
      setGroup(g);
      setMembers(m);
      setCurrencies(c);
      setActivityLog(logRes.data);
      setMyGroupPMs(pms);
      setName(g.name);
      setDescription(g.description ?? "");
      setRequireVerified(g.require_verified_users);
      setAllowLogOnBehalf(g.allow_log_on_behalf);
    } catch {
      window.alert("Failed to load group settings");
    } finally {
      setLoading(false);
    }
  }

  // Find current user's member record and role
  const myMember = members.find((m) => m.user_id === user?.id);
  const isOwner = myMember?.role === "owner";
  const isAdminOrOwner = myMember?.role === "owner" || myMember?.role === "admin";

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!groupId) return;
    setSaving(true);
    try {
      const updated = await updateGroup(groupId, {
        name,
        description: description || null,
        require_verified_users: requireVerified,
        allow_log_on_behalf: allowLogOnBehalf,
      });
      setGroup(updated);
      window.alert("Settings saved!");
    } catch {
      window.alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function copyInviteLink() {
    if (!group) return;
    const link = `${window.location.origin}${import.meta.env.BASE_URL}join/${group.invite_code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleRoleChange(memberId: string, role: MemberRole) {
    if (!groupId) return;
    try {
      const updated = await updateMember(groupId, memberId, { role });
      setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to update role";
      window.alert(msg);
    }
  }

  async function handleRemoveMember(memberId: string, memberName: string) {
    if (!groupId) return;
    if (!window.confirm(`Remove ${memberName} from the group?`)) return;
    try {
      await removeMember(groupId, memberId);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to remove member";
      window.alert(msg);
    }
  }

  async function handleAddCurrency(e: FormEvent) {
    e.preventDefault();
    if (!groupId || !newCurrencyCode.trim() || !newCurrencyRate) return;
    setAddingCurrency(true);
    try {
      const gc = await addGroupCurrency(groupId, {
        currency_code: newCurrencyCode.trim().toUpperCase(),
        exchange_rate: parseFloat(newCurrencyRate),
      });
      setCurrencies((prev) => [...prev, gc]);
      setNewCurrencyCode("");
      setNewCurrencyRate("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to add currency";
      window.alert(msg);
    } finally {
      setAddingCurrency(false);
    }
  }

  async function handleUpdateCurrencyRate(currencyId: string, rate: string) {
    if (!groupId) return;
    const parsed = parseFloat(rate);
    if (!parsed || parsed <= 0) return;
    try {
      const updated = await updateGroupCurrency(groupId, currencyId, { exchange_rate: parsed });
      setCurrencies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      window.alert("Failed to update exchange rate");
    }
  }

  async function handleDeleteCurrency(currencyId: string, code: string) {
    if (!groupId) return;
    if (!window.confirm(`Remove ${code} from allowed currencies?`)) return;
    try {
      await deleteGroupCurrency(groupId, currencyId);
      setCurrencies((prev) => prev.filter((c) => c.id !== currencyId));
    } catch {
      window.alert("Failed to remove currency");
    }
  }

  async function handleTogglePaymentMethod(pmId: string, currentlyEnabled: boolean) {
    if (!groupId || togglingId) return;
    setTogglingId(pmId);
    try {
      if (currentlyEnabled) {
        await disablePaymentMethodInGroup(groupId, pmId);
      } else {
        await enablePaymentMethodInGroup(groupId, pmId);
      }
      setMyGroupPMs((prev) =>
        prev.map((p) =>
          p.payment_method.id === pmId ? { ...p, enabled: !currentlyEnabled } : p
        )
      );
    } catch {
      window.alert("Failed to update payment method visibility");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRenameMember() {
    if (!groupId || !renamingMemberId || !renamingValue.trim()) return;
    setSavingRename(true);
    try {
      const updated = await updateMember(groupId, renamingMemberId, { display_name: renamingValue.trim() });
      setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setRenamingMemberId(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to rename";
      window.alert(msg);
    } finally { setSavingRename(false); }
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (!groupId || !newMemberName.trim()) return;
    setAddingMember(true);
    try {
      const member = await addMember(groupId, { display_name: newMemberName.trim() });
      setMembers((prev) => [...prev, member]);
      setNewMemberName("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to add member";
      window.alert(msg);
    } finally {
      setAddingMember(false);
    }
  }

  async function handleDeleteGroup() {
    if (!groupId || !group) return;
    if (!window.confirm(`Permanently delete "${group.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteGroup(groupId);
      navigate("/dashboard");
    } catch {
      window.alert("Failed to delete group");
      setDeleting(false);
    }
  }

  function relativeTime(isoString: string): string {
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diffMs = now - then;
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    return new Date(isoString).toLocaleDateString();
  }

  function ActionIcon({ action }: { action: MemberLogAction }) {
    const cls = "w-4 h-4 flex-shrink-0";
    if (action === "joined" || action === "claimed") return <UserPlus className={cls} />;
    if (action === "left" || action === "removed") return <UserMinus className={cls} />;
    if (action === "role_changed") return <Shield className={cls} />;
    if (action === "renamed") return <Pencil className={cls} />;
    return <LinkIcon className={cls} />;
  }

  function actionColor(action: MemberLogAction): string {
    if (action === "joined" || action === "claimed") return "text-primary bg-primary-container/20";
    if (action === "left") return "text-on-surface-variant bg-surface-container";
    if (action === "removed") return "text-error bg-error-container/20";
    if (action === "role_changed") return "text-tertiary bg-tertiary-container/20";
    if (action === "renamed") return "text-on-tertiary-container bg-tertiary-container/20";
    return "text-secondary bg-secondary-container/20";
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 pt-4">
        <div className="bg-surface-container-high rounded-2xl h-12 animate-pulse" />
        <div className="bg-surface-container-high rounded-2xl h-64 animate-pulse" />
        <div className="bg-surface-container-high rounded-2xl h-48 animate-pulse" />
        <div className="bg-surface-container-high rounded-2xl h-48 animate-pulse" />
      </div>
    );
  }
  if (!group) return null;

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(`/groups/${groupId}`)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-bold text-on-surface">Group Settings</h1>
      </div>

      <div className="space-y-6">
        {/* General Info */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-5">General Info</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Group name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Currency</label>
              <p className="text-sm text-on-surface-variant bg-surface-container-high/50 rounded-xl px-4 py-3">
                {group.currency_code}{" "}
                <span className="text-outline text-xs">(cannot be changed after creation)</span>
              </p>
            </div>

            {/* Toggles */}
            <div className="space-y-4 pt-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-on-surface">Require verified users</p>
                  <p className="text-xs text-outline mt-0.5">Only email-verified users can join</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireVerified((v) => !v)}
                  className={cn(
                    "w-11 h-6 rounded-full transition-colors relative hover:opacity-80 flex-shrink-0",
                    requireVerified ? "bg-primary" : "bg-surface-container-high"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                      requireVerified ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-on-surface">Allow log on behalf</p>
                  <p className="text-xs text-outline mt-0.5">
                    Members can add expenses on behalf of others
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowLogOnBehalf((v) => !v)}
                  className={cn(
                    "w-11 h-6 rounded-full transition-colors relative hover:opacity-80 flex-shrink-0",
                    allowLogOnBehalf ? "bg-primary" : "bg-surface-container-high"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                      allowLogOnBehalf ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </label>
            </div>

            <button
              type="submit"
              disabled={saving || !isOwner}
              className="w-full bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full text-sm transition-colors mt-2"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </form>
        </section>

        {/* Invite Link */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-4">Invite Link</h2>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-surface-container-high/50 rounded-xl px-4 py-3 font-mono truncate text-on-surface-variant">
              {window.location.origin}{import.meta.env.BASE_URL}join/{group.invite_code}
            </code>
            <button
              onClick={copyInviteLink}
              className={cn(
                "flex items-center gap-1.5 text-sm font-semibold px-4 py-3 rounded-full transition-colors whitespace-nowrap",
                copied
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container hover:bg-surface-container-high text-on-surface"
              )}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>

        {/* Allowed Currencies */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Allowed Currencies</h2>
          <p className="text-xs text-outline mb-5">
            Main currency: <span className="font-semibold text-on-surface-variant">{group.currency_code}</span>.
            Add other currencies with default exchange rates for expenses.
          </p>

          {/* Existing currencies */}
          {currencies.length > 0 && (
            <div className="space-y-2 mb-4">
              {currencies.map((gc) => (
                <div key={gc.id} className="flex items-center gap-2 bg-surface-container-high/50 rounded-xl px-4 py-3">
                  <span className="text-sm font-semibold text-on-surface w-12">{gc.currency_code}</span>
                  <span className="text-xs text-outline truncate max-w-[100px]">{getCurrencyName(gc.currency_code)}</span>
                  <span className="text-xs text-outline">1 {gc.currency_code} =</span>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    defaultValue={gc.exchange_rate}
                    onBlur={(e) => handleUpdateCurrencyRate(gc.id, e.target.value)}
                    disabled={!isAdminOrOwner}
                    className="w-24 bg-surface-container-lowest border-0 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                  />
                  <span className="text-xs text-outline">{group.currency_code}</span>
                  {isAdminOrOwner && (
                    <button
                      onClick={() => handleDeleteCurrency(gc.id, gc.currency_code)}
                      className="ml-auto text-outline-variant hover:text-error transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add currency form */}
          {isAdminOrOwner && (
            <form onSubmit={handleAddCurrency} className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Currency</label>
                  <CurrencySelect
                    value={newCurrencyCode}
                    onChange={setNewCurrencyCode}
                  />
                </div>
                <div className="w-28">
                  <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Rate → {group.currency_code}</label>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    value={newCurrencyRate}
                    onChange={(e) => setNewCurrencyRate(e.target.value)}
                    placeholder="1.00"
                    className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <button
                  type="submit"
                  disabled={addingCurrency || !newCurrencyCode.trim() || !newCurrencyRate}
                  className="flex items-center gap-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold px-4 py-3 rounded-full text-sm transition-colors whitespace-nowrap"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </form>
          )}
        </section>

        {/* My Payment Methods */}
        {myMember?.user_id && (
          <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
            <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">My Payment Methods</h2>
            <p className="text-xs text-outline mb-5">Choose which payment methods are visible to this group</p>

            {myGroupPMs.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                No payment methods saved yet.{" "}
                <Link to="/profile" className="text-primary hover:underline font-medium">
                  Add one in your profile
                </Link>
              </p>
            ) : (
              <div className="space-y-4">
                {myGroupPMs.map(({ payment_method: pm, enabled }) => (
                  <div key={pm.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-on-surface">{pm.label}</p>
                      {pm.bank_name && (
                        <p className="text-xs text-outline mt-0.5">{pm.bank_name}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={togglingId === pm.id}
                      onClick={() => handleTogglePaymentMethod(pm.id, enabled)}
                      className={cn(
                        "w-11 h-6 rounded-full transition-colors relative hover:opacity-80 disabled:opacity-50 flex-shrink-0",
                        enabled ? "bg-primary" : "bg-surface-container-high"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                          enabled ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Members */}
        <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-5">Members</h2>

          {/* Add member form */}
          {isAdminOrOwner && (
            <form onSubmit={handleAddMember} className="flex items-center gap-2 mb-5">
              <input
                type="text"
                required
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="New member name"
                className="flex-1 bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="submit"
                disabled={addingMember || !newMemberName.trim()}
                className="bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold px-4 py-3 rounded-full text-sm transition-colors whitespace-nowrap"
              >
                {addingMember ? "Adding..." : "Add Member"}
              </button>
            </form>
          )}

          {/* Member list */}
          <div className="space-y-1">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl hover:bg-surface-container-high/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary-container/20 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                    {m.display_name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    {renamingMemberId === m.id ? (
                      <div className="flex items-center gap-1">
                        <input type="text" value={renamingValue} onChange={(e) => setRenamingValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRenameMember(); if (e.key === "Escape") setRenamingMemberId(null); }}
                          autoFocus
                          className="bg-surface-container-high/50 border-0 rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-primary" />
                        <button onClick={handleRenameMember} disabled={savingRename || !renamingValue.trim()}
                          className="p-1 text-primary hover:bg-primary-container/20 rounded-full disabled:opacity-50"><Check size={14} /></button>
                        <button onClick={() => setRenamingMemberId(null)}
                          className="p-1 text-outline hover:bg-surface-container rounded-full"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-on-surface truncate">{m.display_name}</p>
                        {isAdminOrOwner && (
                          <button onClick={() => { setRenamingMemberId(m.id); setRenamingValue(m.display_name); }}
                            className="p-0.5 text-outline-variant hover:text-on-surface-variant rounded" title="Rename"><Pencil size={12} /></button>
                        )}
                      </div>
                    )}
                    {m.user_id ? (
                      <p className="text-xs text-outline">Linked account</p>
                    ) : (
                      <p className="text-xs text-outline">Guest slot</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isOwner && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value as MemberRole)}
                      className="text-xs bg-surface-container-high/50 border-0 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary font-medium"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        ROLE_COLORS[m.role]
                      )}
                    >
                      {ROLE_LABELS[m.role]}
                    </span>
                  )}
                  {isAdminOrOwner && m.role !== "owner" && m.id !== myMember?.id && (
                    <button
                      onClick={() => handleRemoveMember(m.id, m.display_name)}
                      className="p-1.5 text-outline-variant hover:text-error hover:bg-error-container/10 rounded-full transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Activity Log */}
        {activityLog.length > 0 && (
          <section className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6">
            <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-5">Activity Log</h2>
            <div className="space-y-3">
              {activityLog.slice(0, logLimit).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <div className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0", actionColor(entry.action))}>
                    <ActionIcon action={entry.action} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-on-surface">
                      <span className="font-semibold">{entry.member_name}</span>{" "}
                      <span className="text-on-surface-variant">{entry.detail}</span>
                    </p>
                    <p className="text-xs text-outline mt-0.5">{relativeTime(entry.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            {activityLog.length > logLimit && (
              <button
                type="button"
                onClick={() => setLogLimit((prev) => prev + 20)}
                className="mt-4 text-sm text-primary hover:text-primary-dim font-semibold"
              >
                Show more
              </button>
            )}
          </section>
        )}

        {/* Danger Zone */}
        {isOwner && (
          <section className="bg-error-container/10 rounded-2xl p-6">
            <h2 className="text-xs font-semibold text-error uppercase tracking-wide mb-2">Danger Zone</h2>
            <p className="text-sm text-on-surface-variant mb-4">
              Deleting this group will permanently remove all expenses, members, and settlements.
            </p>
            <button
              onClick={handleDeleteGroup}
              disabled={deleting}
              className="flex items-center gap-2 text-sm text-on-primary bg-error hover:bg-error/80 font-semibold px-5 py-2.5 rounded-full transition-colors disabled:opacity-60"
            >
              <Trash2 size={14} />
              {deleting ? "Deleting..." : "Delete Group"}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
