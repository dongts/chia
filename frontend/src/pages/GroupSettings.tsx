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
  owner: "bg-yellow-100 text-yellow-700",
  admin: "bg-blue-100 text-blue-700",
  member: "bg-gray-100 text-gray-600",
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
    if (action === "joined" || action === "claimed") return "text-green-600 bg-green-50";
    if (action === "left") return "text-gray-500 bg-gray-100";
    if (action === "removed") return "text-red-500 bg-red-50";
    if (action === "role_changed") return "text-blue-600 bg-blue-50";
    if (action === "renamed") return "text-amber-600 bg-amber-50";
    return "text-purple-600 bg-purple-50";
  }

  if (loading) return <div className="animate-pulse h-8 bg-gray-200 rounded w-1/3" />;
  if (!group) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(`/groups/${groupId}`)}
          className="text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Group Settings</h1>
      </div>

      <div className="max-w-lg space-y-8">
        {/* Basic settings */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">General</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2.5">
                {group.currency_code}{" "}
                <span className="text-gray-400 text-xs">(cannot be changed after creation)</span>
              </p>
            </div>

            {/* Toggles */}
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-gray-700">Require verified users</p>
                  <p className="text-xs text-gray-400">Only email-verified users can join</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireVerified((v) => !v)}
                  className={cn(
                    "w-10 h-6 rounded-full transition-colors relative hover:opacity-80",
                    requireVerified ? "bg-green-600" : "bg-gray-200"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                      requireVerified ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-gray-700">Allow log on behalf</p>
                  <p className="text-xs text-gray-400">
                    Members can add expenses on behalf of others
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowLogOnBehalf((v) => !v)}
                  className={cn(
                    "w-10 h-6 rounded-full transition-colors relative hover:opacity-80",
                    allowLogOnBehalf ? "bg-green-600" : "bg-gray-200"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                      allowLogOnBehalf ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </label>
            </div>

            <button
              type="submit"
              disabled={saving || !isOwner}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </form>
        </section>

        {/* Invite link */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Invite Link</h2>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono truncate text-gray-600">
              {window.location.origin}{import.meta.env.BASE_URL}join/{group.invite_code}
            </code>
            <button
              onClick={copyInviteLink}
              className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-700 font-medium px-3 py-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>

        {/* Allowed Currencies */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Allowed Currencies</h2>
          <p className="text-xs text-gray-400 mb-4">
            Main currency: <span className="font-medium text-gray-600">{group.currency_code}</span>.
            Add other currencies with default exchange rates for expenses.
          </p>

          {/* Existing currencies */}
          {currencies.length > 0 && (
            <div className="space-y-2 mb-4">
              {currencies.map((gc) => (
                <div key={gc.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-gray-800 w-12">{gc.currency_code}</span>
                  <span className="text-xs text-gray-400 truncate max-w-[100px]">{getCurrencyName(gc.currency_code)}</span>
                  <span className="text-xs text-gray-400">1 {gc.currency_code} =</span>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    defaultValue={gc.exchange_rate}
                    onBlur={(e) => handleUpdateCurrencyRate(gc.id, e.target.value)}
                    disabled={!isAdminOrOwner}
                    className="w-24 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-60"
                  />
                  <span className="text-xs text-gray-400">{group.currency_code}</span>
                  {isAdminOrOwner && (
                    <button
                      onClick={() => handleDeleteCurrency(gc.id, gc.currency_code)}
                      className="ml-auto text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add currency form — owner/admin only */}
          {isAdminOrOwner && (
            <form onSubmit={handleAddCurrency} className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Currency</label>
                  <CurrencySelect
                    value={newCurrencyCode}
                    onChange={setNewCurrencyCode}
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs text-gray-500 mb-1">Rate → {group.currency_code}</label>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    value={newCurrencyRate}
                    onChange={(e) => setNewCurrencyRate(e.target.value)}
                    placeholder="1.00"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <button
                  type="submit"
                  disabled={addingCurrency || !newCurrencyCode.trim() || !newCurrencyRate}
                  className="flex items-center gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </form>
          )}
        </section>

        {/* My Payment Methods — only for linked members */}
        {myMember?.user_id && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">My Payment Methods</h2>
            <p className="text-xs text-gray-400 mb-4">Choose which payment methods are visible to this group</p>

            {myGroupPMs.length === 0 ? (
              <p className="text-sm text-gray-500">
                No payment methods saved yet.{" "}
                <Link to="/profile" className="text-green-600 hover:underline">
                  Add one in your profile
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {myGroupPMs.map(({ payment_method: pm, enabled }) => (
                  <div key={pm.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">{pm.label}</p>
                      {pm.bank_name && (
                        <p className="text-xs text-gray-400">{pm.bank_name}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={togglingId === pm.id}
                      onClick={() => handleTogglePaymentMethod(pm.id, enabled)}
                      className={cn(
                        "w-10 h-6 rounded-full transition-colors relative hover:opacity-80 disabled:opacity-50",
                        enabled ? "bg-green-600" : "bg-gray-200"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                          enabled ? "translate-x-4" : "translate-x-0"
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
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Members</h2>

          {/* Add member form — owner/admin only */}
          {isAdminOrOwner && (
            <form onSubmit={handleAddMember} className="flex items-center gap-2 mb-4">
              <input
                type="text"
                required
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="New member name"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={addingMember || !newMemberName.trim()}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
              >
                {addingMember ? "Adding..." : "Add Member"}
              </button>
            </form>
          )}

          <div className="space-y-3">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                    {m.display_name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    {renamingMemberId === m.id ? (
                      <div className="flex items-center gap-1">
                        <input type="text" value={renamingValue} onChange={(e) => setRenamingValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRenameMember(); if (e.key === "Escape") setRenamingMemberId(null); }}
                          autoFocus
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-green-500" />
                        <button onClick={handleRenameMember} disabled={savingRename || !renamingValue.trim()}
                          className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"><Check size={14} /></button>
                        <button onClick={() => setRenamingMemberId(null)}
                          className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.display_name}</p>
                        {isAdminOrOwner && (
                          <button onClick={() => { setRenamingMemberId(m.id); setRenamingValue(m.display_name); }}
                            className="p-0.5 text-gray-300 hover:text-gray-500" title="Rename"><Pencil size={12} /></button>
                        )}
                      </div>
                    )}
                    {m.user_id ? (
                      <p className="text-xs text-gray-400">Linked account</p>
                    ) : (
                      <p className="text-xs text-gray-400">Guest slot</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isOwner && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value as MemberRole)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span
                      className={cn(
                        "text-xs font-medium px-2 py-1 rounded-full",
                        ROLE_COLORS[m.role]
                      )}
                    >
                      {ROLE_LABELS[m.role]}
                    </span>
                  )}
                  {isAdminOrOwner && m.role !== "owner" && m.id !== myMember?.id && (
                    <button
                      onClick={() => handleRemoveMember(m.id, m.display_name)}
                      className="text-gray-300 hover:text-red-400 transition-colors"
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
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Activity Log</h2>
            <div className="space-y-3">
              {activityLog.slice(0, logLimit).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <div className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0", actionColor(entry.action))}>
                    <ActionIcon action={entry.action} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800">
                      <span className="font-semibold">{entry.member_name}</span>{" "}
                      <span className="text-gray-600">{entry.detail}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{relativeTime(entry.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            {activityLog.length > logLimit && (
              <button
                type="button"
                onClick={() => setLogLimit((prev) => prev + 20)}
                className="mt-4 text-sm text-green-600 hover:text-green-700 font-medium"
              >
                Show more
              </button>
            )}
          </section>
        )}

        {/* Danger zone */}
        {isOwner && (
          <section className="bg-red-50 rounded-2xl border border-red-100 p-6">
            <h2 className="text-base font-semibold text-red-700 mb-2">Danger Zone</h2>
            <p className="text-sm text-red-600 mb-4">
              Deleting this group will permanently remove all expenses, members, and settlements.
            </p>
            <button
              onClick={handleDeleteGroup}
              disabled={deleting}
              className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-100 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
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
