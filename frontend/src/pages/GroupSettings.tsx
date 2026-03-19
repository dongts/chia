import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, Check, Trash2, Plus } from "lucide-react";
import { getGroup, updateGroup, deleteGroup } from "@/api/groups";
import { listMembers, addMember, updateMember, removeMember } from "@/api/members";
import { listGroupCurrencies, addGroupCurrency, updateGroupCurrency, deleteGroupCurrency } from "@/api/groupCurrencies";
import type { Group, GroupMember, GroupCurrencyRead, MemberRole } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import CurrencySelect from "@/components/CurrencySelect";
import { getCurrencyName } from "@/utils/currencies";

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
      const [g, m, c] = await Promise.all([getGroup(groupId), listMembers(groupId), listGroupCurrencies(groupId)]);
      setGroup(g);
      setMembers(m);
      setCurrencies(c);
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
                    "w-10 h-6 rounded-full transition-colors relative",
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
                    "w-10 h-6 rounded-full transition-colors relative",
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
                    <p className="text-sm font-medium text-gray-800 truncate">{m.display_name}</p>
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
