import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users,
  LayoutDashboard,
  Layers,
  ShieldOff,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Receipt,
  KeyRound,
  UserPlus,
  Plus,
  Merge,
} from "lucide-react";
import client from "@/api/client";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/currency";

// ── Types ────────────────────────────────────────────────────────────────────

interface Stats { users: number; groups: number; expenses: number; settlements: number }

interface UserRead {
  id: string; email: string | null; display_name: string;
  is_verified: boolean; created_at: string;
}
interface UserDetail extends UserRead {
  groups: { id: string; name: string; currency_code: string; role: string }[];
}
interface GroupItem {
  id: string; name: string; currency_code: string; member_count: number;
  invite_code: string; created_at: string;
}
interface GroupDetail {
  id: string; name: string; currency_code: string; invite_code: string;
  description: string | null;
  require_verified_users: boolean; allow_log_on_behalf: boolean;
  created_at: string;
  members: { id: string; display_name: string; role: string; user_id: string | null; email: string | null; is_active: boolean }[];
  currencies: { id: string; currency_code: string; exchange_rate: number }[];
  expenses_count: number;
}
interface ExpenseItem {
  id: string; description: string; amount: number; currency_code: string;
  payer_name: string | null; date: string; created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Badge({ children, green }: { children: React.ReactNode; green?: boolean }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
      green ? "bg-primary-container/30 text-primary" : "bg-surface-container text-on-surface-variant"
    )}>
      {children}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 p-5 flex items-center gap-4">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", color)}><Icon size={22} /></div>
      <div>
        <p className="text-2xl font-bold text-on-surface">{value.toLocaleString()}</p>
        <p className="text-sm text-on-surface-variant">{label}</p>
      </div>
    </div>
  );
}

// ── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get<Stats>("/admin/stats").then((r) => setStats(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard icon={Users} label="Total Users" value={stats.users} color="bg-tertiary-container/20 text-tertiary" />
      <StatCard icon={Layers} label="Total Groups" value={stats.groups} color="bg-primary-container/20 text-primary" />
      <StatCard icon={Receipt} label="Total Expenses" value={stats.expenses} color="bg-amber-50 text-amber-600" />
      <StatCard icon={LayoutDashboard} label="Settlements" value={stats.settlements} color="bg-purple-50 text-purple-600" />
    </div>
  );
}

// ── Merge User Modal ─────────────────────────────────────────────────────────

function MergeUserModal({ sourceUser, onClose, onMerged }: {
  sourceUser: UserRead;
  onClose: () => void;
  onMerged: (detail: string) => void;
}) {
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeSearchResults, setMergeSearchResults] = useState<UserRead[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<UserRead | null>(null);
  const [merging, setMerging] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!mergeSearch.trim()) { setMergeSearchResults([]); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      client.get<{ items: UserRead[]; total: number }>("/admin/users", { params: { search: mergeSearch, limit: 10 } })
        .then((r) => setMergeSearchResults(r.data.items.filter((u) => u.id !== sourceUser.id)))
        .catch(() => setMergeSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [mergeSearch, sourceUser.id]);

  async function handleMerge() {
    if (!selectedTarget) return;
    setMerging(true);
    try {
      const response = await client.post<{ detail: string }>(`/admin/users/${sourceUser.id}/merge-into/${selectedTarget.id}`);
      onMerged(response.data.detail);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to merge users";
      window.alert(msg);
    } finally { setMerging(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-editorial-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-bold text-on-surface">Merge User</h3>
          <p className="text-sm text-on-surface-variant mt-1">
            Merge <span className="font-medium text-on-surface">{sourceUser.display_name}</span> into another account
          </p>

          {/* Search input */}
          <div className="relative mt-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={mergeSearch}
              onChange={(e) => { setMergeSearch(e.target.value); setSelectedTarget(null); }}
              className="w-full pl-9 pr-4 py-2.5 bg-surface-container-high/50 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>

          {/* Search results */}
          {mergeSearch.trim() && (
            <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-outline-variant/15">
              {searching ? (
                <div className="flex justify-center py-4">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : mergeSearchResults.length === 0 ? (
                <p className="text-sm text-outline text-center py-4">No users found</p>
              ) : (
                mergeSearchResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelectedTarget(u)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container transition-colors border-b border-outline-variant/10 last:border-0",
                      selectedTarget?.id === u.id && "bg-primary-container/20"
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-tertiary-container/30 flex items-center justify-center text-xs font-bold text-tertiary shrink-0">
                      {u.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-on-surface truncate">{u.display_name}</p>
                      <p className="text-xs text-on-surface-variant truncate">{u.email ?? "No email"}</p>
                    </div>
                    <Badge green={u.is_verified}>{u.is_verified ? "Verified" : "Guest"}</Badge>
                    {selectedTarget?.id === u.id && <Check size={16} className="text-primary shrink-0" />}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Selected target summary */}
          {selectedTarget && (
            <div className="mt-3 flex items-center gap-2 bg-primary-container/10 rounded-xl px-4 py-2.5 border border-primary/20">
              <Check size={14} className="text-primary shrink-0" />
              <span className="text-sm text-on-surface">
                Merge into: <span className="font-medium">{selectedTarget.display_name}</span>
                {selectedTarget.email && <span className="text-on-surface-variant"> ({selectedTarget.email})</span>}
              </span>
            </div>
          )}

          {/* Warning */}
          <p className="text-xs text-on-surface-variant mt-4 leading-relaxed">
            All group memberships, expenses, and payment methods will be transferred. The source account will be deleted.
          </p>

          {/* Actions */}
          <div className="flex gap-2 mt-5">
            <button
              onClick={onClose}
              className="flex-1 border border-outline-variant/15 text-on-surface py-2.5 rounded-full text-sm hover:bg-surface-container"
            >
              Cancel
            </button>
            <button
              onClick={handleMerge}
              disabled={merging || !selectedTarget}
              className="flex-1 bg-error hover:bg-error/80 disabled:opacity-60 text-on-error py-2.5 rounded-full text-sm font-medium"
            >
              {merging ? "Merging..." : "Merge"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Merge Member Inline (used in Groups tab) ────────────────────────────────

function MergeMemberInline({ memberName, sourceUserId, onClose, onMerged }: {
  memberName: string;
  sourceUserId: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserRead[]>([]);
  const [searching, setSearching] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function doSearch(q: string) {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    client.get<{ items: UserRead[] }>("/admin/users", { params: { q, limit: 10 } })
      .then((r) => setResults(r.data.items.filter((u) => u.id !== sourceUserId)))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }

  function handleSearchChange(val: string) {
    setSearch(val);
    setTargetId(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  }

  async function handleMerge() {
    if (!targetId) return;
    setMerging(true);
    try {
      const r = await client.post(`/admin/users/${sourceUserId}/merge-into/${targetId}`);
      window.alert(r.data.detail);
      onMerged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Merge failed";
      window.alert(msg);
    } finally { setMerging(false); }
  }

  const selectedUser = results.find((u) => u.id === targetId);

  return (
    <div className="mt-3 p-4 bg-surface rounded-xl border border-outline-variant/15 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-on-surface">
          Merge "{memberName}" into:
        </p>
        <button onClick={onClose} className="text-outline hover:text-on-surface-variant"><X size={14} /></button>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search target user by name or email..."
          autoFocus
          className="w-full pl-8 pr-3 py-2 bg-surface-container-high/50 border-0 rounded-lg text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {searching && <p className="text-xs text-outline">Searching...</p>}
      {!searching && results.length > 0 && !targetId && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {results.map((u) => (
            <button key={u.id} onClick={() => setTargetId(u.id)}
              className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-container transition-colors">
              <div className="w-7 h-7 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                {u.display_name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface truncate">{u.display_name}</p>
                <p className="text-xs text-outline truncate">{u.email || "No email"}</p>
              </div>
              {u.is_verified && <span className="text-[10px] font-semibold text-primary bg-primary-container/20 px-1.5 py-0.5 rounded-full">Verified</span>}
            </button>
          ))}
        </div>
      )}
      {selectedUser && (
        <div className="flex items-center gap-2 bg-primary-container/10 rounded-lg px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
            {selectedUser.display_name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-on-surface">{selectedUser.display_name}</p>
            <p className="text-xs text-outline">{selectedUser.email || "No email"}</p>
          </div>
          <button onClick={() => setTargetId(null)} className="text-xs text-outline hover:text-on-surface-variant">Change</button>
        </div>
      )}
      {targetId && (
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface py-2 rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleMerge} disabled={merging}
            className="flex-1 bg-error hover:bg-error/80 disabled:opacity-60 text-on-error py-2 rounded-lg text-sm font-semibold transition-colors">
            {merging ? "Merging..." : "Merge"}
          </button>
        </div>
      )}
    </div>
  );
}

function MergeGroupMemberInline({ groupId, sourceMemberId, sourceMemberName, members, onClose, onMerged }: {
  groupId: string;
  sourceMemberId: string;
  sourceMemberName: string;
  members: { id: string; display_name: string; user_id: string | null; email: string | null }[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = members.filter((m) =>
    m.display_name.toLowerCase().includes(filter.toLowerCase())
  );

  async function handleMerge() {
    if (!targetId) return;
    setMerging(true);
    try {
      const r = await client.post<{ detail: string }>(`/admin/groups/${groupId}/members/${sourceMemberId}/merge-into/${targetId}`);
      window.alert(r.data.detail);
      onMerged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Merge failed";
      window.alert(msg);
    } finally { setMerging(false); }
  }

  const selectedMember = members.find((m) => m.id === targetId);

  return (
    <div className="mt-3 p-4 bg-surface rounded-xl border border-outline-variant/15 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-on-surface">
          Merge "{sourceMemberName}" into:
        </p>
        <button onClick={onClose} className="text-outline hover:text-on-surface-variant"><X size={14} /></button>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
        <input
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setTargetId(null); }}
          placeholder="Filter members..."
          autoFocus
          className="w-full pl-8 pr-3 py-2 bg-surface-container-high/50 border-0 rounded-lg text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {!targetId && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {filtered.map((m) => (
            <button key={m.id} onClick={() => setTargetId(m.id)}
              className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-container transition-colors">
              <div className="w-7 h-7 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                {m.display_name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-on-surface truncate">{m.display_name}</p>
                <p className="text-xs text-outline truncate">{m.user_id ? m.email || "Claimed" : "Unclaimed"}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-outline text-center py-2">No matching members</p>}
        </div>
      )}
      {selectedMember && (
        <div className="flex items-center gap-2 bg-primary-container/10 rounded-lg px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
            {selectedMember.display_name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-on-surface">{selectedMember.display_name}</p>
            <p className="text-xs text-outline">{selectedMember.user_id ? selectedMember.email || "Claimed" : "Unclaimed"}</p>
          </div>
          <button onClick={() => setTargetId(null)} className="text-xs text-outline hover:text-on-surface-variant">Change</button>
        </div>
      )}
      {targetId && (
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface py-2 rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleMerge} disabled={merging}
            className="flex-1 bg-error hover:bg-error/80 disabled:opacity-60 text-on-error py-2 rounded-lg text-sm font-semibold transition-colors">
            {merging ? "Merging..." : "Merge"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<UserRead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<UserDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ display_name: "", email: "", is_verified: false });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reset password
  const [resetPwUserId, setResetPwUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPw, setResettingPw] = useState(false);

  // Add to group
  const [addToGroupUserId, setAddToGroupUserId] = useState<string | null>(null);
  const [addGroupId, setAddGroupId] = useState("");
  const [addGroupRole, setAddGroupRole] = useState("member");
  const [addingToGroup, setAddingToGroup] = useState(false);

  // Merge user
  const [mergeSourceUser, setMergeSourceUser] = useState<UserRead | null>(null);

  // All groups for the dropdown
  const [allGroups, setAllGroups] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    client.get<{ items: UserRead[]; total: number }>("/admin/users", {
      params: { limit, offset: page * limit, search: debouncedSearch || undefined },
    }).then((r) => { setUsers(r.data.items); setTotal(r.data.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  // Load all groups once for the add-to-group dropdown
  useEffect(() => {
    client.get<{ items: { id: string; name: string }[]; total: number }>("/admin/groups", { params: { limit: 200 } })
      .then((r) => setAllGroups(r.data.items)).catch(() => {});
  }, []);

  async function toggleExpand(userId: string) {
    if (expandedId === userId) { setExpandedId(null); setExpandedDetail(null); return; }
    setExpandedId(userId); setExpandedDetail(null); setLoadingDetail(true);
    try { const r = await client.get<UserDetail>(`/admin/users/${userId}`); setExpandedDetail(r.data); }
    catch { setExpandedDetail(null); }
    finally { setLoadingDetail(false); }
  }

  function startEdit(user: UserRead) {
    setEditingId(user.id);
    setEditForm({ display_name: user.display_name, email: user.email ?? "", is_verified: user.is_verified });
  }

  async function saveEdit(userId: string) {
    setSaving(true);
    try {
      await client.patch(`/admin/users/${userId}`, { display_name: editForm.display_name, email: editForm.email || null, is_verified: editForm.is_verified });
      setEditingId(null); load();
    } catch { window.alert("Failed to save"); } finally { setSaving(false); }
  }

  async function deleteUser(userId: string) {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    setDeletingId(userId);
    try { await client.delete(`/admin/users/${userId}`); if (expandedId === userId) setExpandedId(null); load(); }
    catch { window.alert("Failed to delete"); } finally { setDeletingId(null); }
  }

  async function handleResetPassword() {
    if (!resetPwUserId || !newPassword) return;
    setResettingPw(true);
    try {
      await client.post(`/admin/users/${resetPwUserId}/reset-password`, { new_password: newPassword });
      window.alert("Password reset successfully");
      setResetPwUserId(null); setNewPassword("");
    } catch { window.alert("Failed to reset password"); } finally { setResettingPw(false); }
  }

  async function handleAddToGroup() {
    if (!addToGroupUserId || !addGroupId) return;
    setAddingToGroup(true);
    try {
      await client.post(`/admin/users/${addToGroupUserId}/add-to-group`, { group_id: addGroupId, role: addGroupRole });
      window.alert("User added to group");
      setAddToGroupUserId(null); setAddGroupId(""); setAddGroupRole("member");
      if (expandedId === addToGroupUserId) { toggleExpand(addToGroupUserId); toggleExpand(addToGroupUserId); }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed";
      window.alert(msg);
    } finally { setAddingToGroup(false); }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Reset password modal */}
      {resetPwUserId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setResetPwUserId(null)}>
          <div className="bg-surface-container-lowest rounded-2xl p-6 w-96 shadow-editorial-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-on-surface mb-4">Reset Password</h3>
            <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-primary" />
            <div className="flex gap-2">
              <button onClick={() => setResetPwUserId(null)} className="flex-1 border border-outline-variant/15 text-on-surface py-2 rounded-lg text-sm hover:bg-surface-container">Cancel</button>
              <button onClick={handleResetPassword} disabled={resettingPw || !newPassword}
                className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary py-2 rounded-lg text-sm">{resettingPw ? "Resetting..." : "Reset"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add to group modal */}
      {addToGroupUserId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setAddToGroupUserId(null)}>
          <div className="bg-surface-container-lowest rounded-2xl p-6 w-96 shadow-editorial-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-on-surface mb-4">Add User to Group</h3>
            <select value={addGroupId} onChange={(e) => setAddGroupId(e.target.value)}
              className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select group...</option>
              {allGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={addGroupRole} onChange={(e) => setAddGroupRole(e.target.value)}
              className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setAddToGroupUserId(null)} className="flex-1 border border-outline-variant/15 text-on-surface py-2 rounded-lg text-sm hover:bg-surface-container">Cancel</button>
              <button onClick={handleAddToGroup} disabled={addingToGroup || !addGroupId}
                className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary py-2 rounded-lg text-sm">{addingToGroup ? "Adding..." : "Add to Group"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Merge user modal */}
      {mergeSourceUser && (
        <MergeUserModal
          sourceUser={mergeSourceUser}
          onClose={() => setMergeSourceUser(null)}
          onMerged={(detail) => {
            setMergeSourceUser(null);
            if (expandedId === mergeSourceUser.id) setExpandedId(null);
            window.alert(detail);
            load();
          }}
        />
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
        <input type="text" placeholder="Search by email or name..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-outline-variant/15 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : users.length === 0 ? (
          <p className="text-center text-outline text-sm py-10">No users found</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface border-b border-outline-variant/10">
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant w-6" />
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Email</th>
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Name</th>
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Status</th>
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow key={user.id} user={user}
                  isExpanded={expandedId === user.id} isEditing={editingId === user.id}
                  editForm={editForm} saving={saving} deletingId={deletingId}
                  expandedDetail={expandedDetail} loadingDetail={loadingDetail && expandedId === user.id}
                  onToggleExpand={() => { if (editingId !== user.id) toggleExpand(user.id); }}
                  onStartEdit={() => startEdit(user)} onSaveEdit={() => saveEdit(user.id)}
                  onCancelEdit={() => setEditingId(null)} onDelete={() => deleteUser(user.id)}
                  onEditFormChange={setEditForm}
                  onResetPassword={() => { setResetPwUserId(user.id); setNewPassword(""); }}
                  onAddToGroup={() => { setAddToGroupUserId(user.id); setAddGroupId(""); setAddGroupRole("member"); }}
                  onMerge={() => setMergeSourceUser(user)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-on-surface-variant">
          <span>{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-40"><ChevronLeft size={16} /></button>
            <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-40"><ChevronRightIcon size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// User row component to avoid React key issues with fragments
function UserRow({ user, isExpanded, isEditing, editForm, saving, deletingId, expandedDetail, loadingDetail,
  onToggleExpand, onStartEdit, onSaveEdit, onCancelEdit, onDelete, onEditFormChange, onResetPassword, onAddToGroup, onMerge,
}: {
  user: UserRead; isExpanded: boolean; isEditing: boolean;
  editForm: { display_name: string; email: string; is_verified: boolean };
  saving: boolean; deletingId: string | null;
  expandedDetail: UserDetail | null; loadingDetail: boolean;
  onToggleExpand: () => void; onStartEdit: () => void; onSaveEdit: () => void;
  onCancelEdit: () => void; onDelete: () => void;
  onEditFormChange: (f: { display_name: string; email: string; is_verified: boolean }) => void;
  onResetPassword: () => void; onAddToGroup: () => void; onMerge: () => void;
}) {
  return (
    <>
      <tr className={cn("border-b border-outline-variant/10 hover:bg-surface-container cursor-pointer", isExpanded && "bg-primary-container/20")} onClick={onToggleExpand}>
        <td className="px-4 py-3 text-outline">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        {isEditing ? (
          <>
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <input className="border border-outline-variant/15 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary"
                value={editForm.email} onChange={(e) => onEditFormChange({ ...editForm, email: e.target.value })} />
            </td>
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <input className="border border-outline-variant/15 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary"
                value={editForm.display_name} onChange={(e) => onEditFormChange({ ...editForm, display_name: e.target.value })} />
            </td>
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onEditFormChange({ ...editForm, is_verified: !editForm.is_verified })}
                className={cn("px-2 py-0.5 rounded-full text-xs font-medium border hover:opacity-80 transition-opacity",
                  editForm.is_verified ? "bg-primary-container/30 text-primary border-primary" : "bg-surface-container text-on-surface-variant border-outline-variant/15"
                )}>{editForm.is_verified ? "Verified" : "Guest"}</button>
            </td>
            <td className="px-4 py-3 text-outline">{formatDate(user.created_at)}</td>
          </>
        ) : (
          <>
            <td className="px-4 py-3 text-on-surface">{user.email ?? "—"}</td>
            <td className="px-4 py-3 font-medium text-on-surface">{user.display_name}</td>
            <td className="px-4 py-3"><Badge green={user.is_verified}>{user.is_verified ? "Verified" : "Guest"}</Badge></td>
            <td className="px-4 py-3 text-outline">{formatDate(user.created_at)}</td>
          </>
        )}
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {isEditing ? (
              <>
                <button disabled={saving} onClick={onSaveEdit} className="p-1.5 rounded-lg text-primary hover:bg-primary-container/20 disabled:opacity-50" title="Save"><Check size={15} /></button>
                <button onClick={onCancelEdit} className="p-1.5 rounded-lg text-outline hover:bg-surface-container" title="Cancel"><X size={15} /></button>
              </>
            ) : (
              <>
                <button onClick={onStartEdit} className="p-1.5 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container" title="Edit"><Pencil size={15} /></button>
                <button onClick={onResetPassword} className="p-1.5 rounded-lg text-outline hover:text-amber-600 hover:bg-amber-50" title="Reset password"><KeyRound size={15} /></button>
                <button onClick={onAddToGroup} className="p-1.5 rounded-lg text-outline hover:text-tertiary hover:bg-tertiary-container/20" title="Add to group"><UserPlus size={15} /></button>
                <button onClick={onMerge} className="p-1.5 rounded-lg text-outline hover:text-error hover:bg-error-container/20" title="Merge into another user"><Merge size={15} /></button>
                <button disabled={deletingId === user.id} onClick={onDelete} className="p-1.5 rounded-lg text-outline hover:text-error hover:bg-error-container/20 disabled:opacity-50" title="Delete"><Trash2 size={15} /></button>
              </>
            )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-primary-container/20">
          <td colSpan={6} className="px-6 py-4">
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-sm text-outline"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Loading...</div>
            ) : expandedDetail ? (
              <div>
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">
                  Member of {expandedDetail.groups.length} group{expandedDetail.groups.length !== 1 ? "s" : ""}
                </p>
                {expandedDetail.groups.length === 0 ? (
                  <p className="text-sm text-outline">No groups</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {expandedDetail.groups.map((g) => (
                      <span key={g.id} className="inline-flex items-center gap-1.5 bg-surface-container-lowest border border-outline-variant/15 rounded-lg px-3 py-1.5 text-sm text-on-surface">
                        <span className="font-medium">{g.name}</span>
                        <Badge>{g.currency_code}</Badge>
                        <Badge green={g.role === "owner"}>{g.role}</Badge>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-error">Failed to load details</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Group Expenses Sub-section ───────────────────────────────────────────────

function GroupExpenses({ groupId }: { groupId: string }) {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    client.get<{ items: ExpenseItem[]; total: number }>(`/admin/groups/${groupId}/expenses`, { params: { limit: 100 } })
      .then((r) => setExpenses(r.data.items)).catch(() => {}).finally(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  async function deleteExpense(expenseId: string) {
    if (!window.confirm("Delete this expense?")) return;
    setDeletingId(expenseId);
    try { await client.delete(`/admin/expenses/${expenseId}`); load(); }
    catch { window.alert("Failed to delete expense"); } finally { setDeletingId(null); }
  }

  if (loading) return <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (expenses.length === 0) return <p className="text-sm text-outline">No expenses</p>;

  return (
    <div className="rounded-lg border border-outline-variant/15 overflow-hidden bg-surface-container-lowest">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface border-b border-outline-variant/10">
            <th className="text-left px-3 py-2 font-medium text-on-surface-variant">Description</th>
            <th className="text-left px-3 py-2 font-medium text-on-surface-variant">Amount</th>
            <th className="text-left px-3 py-2 font-medium text-on-surface-variant">Paid by</th>
            <th className="text-left px-3 py-2 font-medium text-on-surface-variant">Date</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {expenses.map((exp) => (
            <tr key={exp.id} className="border-b border-outline-variant/10 last:border-0">
              <td className="px-3 py-2 text-on-surface">{exp.description}</td>
              <td className="px-3 py-2 text-on-surface">{formatAmount(exp.amount, exp.currency_code)} {exp.currency_code}</td>
              <td className="px-3 py-2 text-on-surface-variant">{exp.payer_name ?? "—"}</td>
              <td className="px-3 py-2 text-outline">{formatDate(exp.date)}</td>
              <td className="px-3 py-2 text-right">
                <button disabled={deletingId === exp.id} onClick={() => deleteExpense(exp.id)}
                  className="p-1 rounded text-outline hover:text-error hover:bg-error-container/20 disabled:opacity-40" title="Delete"><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Groups Tab ───────────────────────────────────────────────────────────────

function GroupsTab() {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<GroupDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showExpenses, setShowExpenses] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add member form
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");
  const [addingMember, setAddingMember] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    client.get<{ items: GroupItem[]; total: number }>("/admin/groups", {
      params: { limit, offset: page * limit, search: debouncedSearch || undefined },
    }).then((r) => { setGroups(r.data.items); setTotal(r.data.total); }).catch(() => {}).finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  async function toggleExpand(groupId: string) {
    if (expandedId === groupId) { setExpandedId(null); setExpandedDetail(null); setShowExpenses(null); return; }
    setExpandedId(groupId); setExpandedDetail(null); setShowExpenses(null); setLoadingDetail(true);
    try { const r = await client.get<GroupDetail>(`/admin/groups/${groupId}`); setExpandedDetail(r.data); }
    catch { setExpandedDetail(null); } finally { setLoadingDetail(false); }
  }

  async function deleteGroup(groupId: string) {
    if (!window.confirm("Delete this group and all its data?")) return;
    setDeletingId(groupId);
    try { await client.delete(`/admin/groups/${groupId}`); if (expandedId === groupId) setExpandedId(null); load(); }
    catch { window.alert("Failed to delete group"); } finally { setDeletingId(null); }
  }

  async function handleAddMember() {
    if (!addMemberGroupId || !newMemberName.trim()) return;
    setAddingMember(true);
    try {
      await client.post(`/admin/groups/${addMemberGroupId}/members`, { display_name: newMemberName.trim(), role: newMemberRole });
      window.alert("Member added");
      setNewMemberName(""); setNewMemberRole("member"); setAddMemberGroupId(null);
      if (expandedId === addMemberGroupId) { const gid = addMemberGroupId; setExpandedId(null); setTimeout(() => toggleExpand(gid), 100); }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed";
      window.alert(msg);
    } finally { setAddingMember(false); }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Add member modal */}
      {addMemberGroupId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setAddMemberGroupId(null)}>
          <div className="bg-surface-container-lowest rounded-2xl p-6 w-96 shadow-editorial-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-on-surface mb-4">Add Member to Group</h3>
            <input type="text" placeholder="Display name" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)}
              className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary" />
            <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)}
              className="w-full border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setAddMemberGroupId(null)} className="flex-1 border border-outline-variant/15 text-on-surface py-2 rounded-lg text-sm hover:bg-surface-container">Cancel</button>
              <button onClick={handleAddMember} disabled={addingMember || !newMemberName.trim()}
                className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary py-2 rounded-lg text-sm">{addingMember ? "Adding..." : "Add Member"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
        <input type="text" placeholder="Search by group name..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-outline-variant/15 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>

      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : groups.length === 0 ? (
          <p className="text-center text-outline text-sm py-10">No groups found</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface border-b border-outline-variant/10">
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant w-6" />
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Name</th>
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Currency</th>
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Members</th>
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Invite</th>
                <th className="text-left px-4 py-3 font-medium text-on-surface-variant">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupRow key={group.id} group={group}
                  isExpanded={expandedId === group.id} expandedDetail={expandedDetail}
                  loadingDetail={loadingDetail && expandedId === group.id}
                  showExpenses={showExpenses === group.id} deletingId={deletingId}
                  onToggleExpand={() => toggleExpand(group.id)}
                  onDelete={() => deleteGroup(group.id)}
                  onToggleExpenses={() => setShowExpenses(showExpenses === group.id ? null : group.id)}
                  onAddMember={() => { setAddMemberGroupId(group.id); setNewMemberName(""); setNewMemberRole("member"); }}
                  onMemberRenamed={(memberId, newName) => {
                    if (expandedDetail) {
                      setExpandedDetail({
                        ...expandedDetail,
                        members: expandedDetail.members.map((m) => m.id === memberId ? { ...m, display_name: newName } : m),
                      });
                    }
                  }}
                  onRefresh={() => { load(); toggleExpand(group.id); }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-on-surface-variant">
          <span>{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-40"><ChevronLeft size={16} /></button>
            <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-40"><ChevronRightIcon size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRow({ group, isExpanded, expandedDetail, loadingDetail, showExpenses, deletingId,
  onToggleExpand, onDelete, onToggleExpenses, onAddMember, onMemberRenamed, onRefresh,
}: {
  group: GroupItem; isExpanded: boolean; expandedDetail: GroupDetail | null;
  loadingDetail: boolean; showExpenses: boolean; deletingId: string | null;
  onToggleExpand: () => void; onDelete: () => void; onToggleExpenses: () => void; onAddMember: () => void;
  onMemberRenamed: (memberId: string, newName: string) => void; onRefresh: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [mergeMemberId, setMergeMemberId] = useState<string | null>(null);
  const [mergeMemberName, setMergeMemberName] = useState("");
  const [mergeMemberUserId, setMergeMemberUserId] = useState<string | null>(null);
  const [mergeType, setMergeType] = useState<"user" | "member">("user");
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);

  async function handleDeleteMember(memberId: string, memberName: string) {
    if (!window.confirm(`Permanently delete member "${memberName}" and ALL their expenses, splits, and settlements? This cannot be undone.`)) return;
    setDeletingMemberId(memberId);
    try {
      const r = await client.delete<{ detail: string }>(`/admin/groups/${group.id}/members/${memberId}`);
      window.alert(r.data.detail);
      onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Delete failed";
      window.alert(msg);
    } finally { setDeletingMemberId(null); }
  }

  async function handleRename(memberId: string) {
    if (!renameValue.trim()) return;
    setSavingRename(true);
    try {
      await client.patch(`/admin/groups/${group.id}/members/${memberId}`, { display_name: renameValue.trim() });
      onMemberRenamed(memberId, renameValue.trim());
      setRenamingId(null);
    } catch { window.alert("Failed to rename"); }
    finally { setSavingRename(false); }
  }
  return (
    <>
      <tr className={cn("border-b border-outline-variant/10 hover:bg-surface-container cursor-pointer", isExpanded && "bg-primary-container/20")} onClick={onToggleExpand}>
        <td className="px-4 py-3 text-outline">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="px-4 py-3 font-medium text-on-surface">{group.name}</td>
        <td className="px-4 py-3"><Badge>{group.currency_code}</Badge></td>
        <td className="px-4 py-3 text-on-surface-variant">{group.member_count}</td>
        <td className="px-4 py-3"><code className="text-xs bg-surface-container px-2 py-0.5 rounded text-on-surface-variant">{group.invite_code}</code></td>
        <td className="px-4 py-3 text-outline">{formatDate(group.created_at)}</td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <button onClick={onAddMember} className="p-1.5 rounded-lg text-outline hover:text-tertiary hover:bg-tertiary-container/20" title="Add member"><Plus size={15} /></button>
            <button disabled={deletingId === group.id} onClick={onDelete} className="p-1.5 rounded-lg text-outline hover:text-error hover:bg-error-container/20 disabled:opacity-50" title="Delete"><Trash2 size={15} /></button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-primary-container/20">
          <td colSpan={7} className="px-6 py-4">
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-sm text-outline"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Loading...</div>
            ) : expandedDetail ? (
              <div className="space-y-4">
                {/* Members */}
                <div>
                  <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Members ({expandedDetail.members.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {expandedDetail.members.map((m) => (
                      <span key={m.id} className={cn("inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm",
                        m.is_active ? "bg-surface-container-lowest border-outline-variant/15 text-on-surface" : "bg-surface border-outline-variant/10 text-outline line-through"
                      )}>
                        {renamingId === m.id ? (
                          <>
                            <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRename(m.id); if (e.key === "Escape") setRenamingId(null); }}
                              autoFocus className="border border-outline-variant/15 rounded px-1.5 py-0.5 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-primary" />
                            <button onClick={() => handleRename(m.id)} disabled={savingRename} className="text-primary hover:text-primary"><Check size={13} /></button>
                            <button onClick={() => setRenamingId(null)} className="text-outline hover:text-on-surface-variant"><X size={13} /></button>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">{m.display_name}</span>
                            <button onClick={() => { setRenamingId(m.id); setRenameValue(m.display_name); }}
                              className="text-outline-variant hover:text-on-surface-variant" title="Rename"><Pencil size={11} /></button>
                          </>
                        )}
                        {m.email && <span className="text-xs text-outline">{m.email}</span>}
                        <Badge green={m.role === "owner"}>{m.role}</Badge>
                        {!m.user_id && <span className="text-xs text-amber-500">unclaimed</span>}
                        {m.is_active && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setMergeMemberId(m.id);
                                setMergeMemberName(m.display_name);
                                setMergeMemberUserId(m.user_id);
                                setMergeType(m.user_id ? "user" : "member");
                              }}
                              className="text-outline-variant hover:text-primary transition-colors" title="Merge this member into another"
                            ><Merge size={11} /></button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteMember(m.id, m.display_name); }}
                              disabled={deletingMemberId === m.id}
                              className="text-outline-variant hover:text-error transition-colors disabled:opacity-50" title="Permanently delete member"
                            ><Trash2 size={11} /></button>
                          </>
                        )}
                      </span>
                    ))}
                  </div>

                  {/* Merge member modal */}
                  {mergeMemberId && mergeType === "user" && mergeMemberUserId && (
                    <MergeMemberInline
                      memberName={mergeMemberName}
                      sourceUserId={mergeMemberUserId}
                      onClose={() => { setMergeMemberId(null); setMergeMemberUserId(null); }}
                      onMerged={() => { setMergeMemberId(null); setMergeMemberUserId(null); onRefresh(); }}
                    />
                  )}
                  {mergeMemberId && mergeType === "member" && (
                    <MergeGroupMemberInline
                      groupId={group.id}
                      sourceMemberId={mergeMemberId}
                      sourceMemberName={mergeMemberName}
                      members={expandedDetail?.members.filter((m) => m.id !== mergeMemberId && m.is_active) ?? []}
                      onClose={() => { setMergeMemberId(null); setMergeMemberUserId(null); }}
                      onMerged={() => { setMergeMemberId(null); setMergeMemberUserId(null); onRefresh(); }}
                    />
                  )}
                </div>

                {/* Currencies */}
                {expandedDetail.currencies.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Allowed Currencies</p>
                    <div className="flex flex-wrap gap-2">
                      {expandedDetail.currencies.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1 bg-surface-container-lowest border border-outline-variant/15 rounded-lg px-3 py-1 text-sm text-on-surface">
                          <span className="font-medium">{c.currency_code}</span>
                          <span className="text-xs text-outline">rate: {c.exchange_rate}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expenses */}
                <div>
                  <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Expenses ({expandedDetail.expenses_count})</p>
                  <button onClick={onToggleExpenses} className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary font-medium">
                    <Receipt size={14} />{showExpenses ? "Hide expenses" : "View expenses"}
                  </button>
                  {showExpenses && <div className="mt-3"><GroupExpenses groupId={group.id} /></div>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-error">Failed to load details</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Admin Page ──────────────────────────────────────────────────────────

type Tab = "dashboard" | "users" | "groups";

export default function Admin() {
  const [isSuperadmin, setIsSuperadmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  useEffect(() => {
    client.get("/admin/me").then(() => setIsSuperadmin(true)).catch(() => setIsSuperadmin(false));
  }, []);

  if (isSuperadmin === null) return <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  if (!isSuperadmin) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-error-container/20 flex items-center justify-center"><ShieldOff size={28} className="text-error" /></div>
      <div><h2 className="text-xl font-bold text-on-surface">Access Denied</h2><p className="text-on-surface-variant text-sm mt-1">You don't have permission to access this page.</p></div>
    </div>
  );

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "groups", label: "Groups", icon: Layers },
  ];

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-bold text-on-surface">Admin</h1><p className="text-sm text-on-surface-variant mt-0.5">Manage users and groups</p></div>
      <div className="flex gap-1 mb-6 border-b border-outline-variant/15">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)} className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === id ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
          )}><Icon size={15} />{label}</button>
        ))}
      </div>
      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "groups" && <GroupsTab />}
    </div>
  );
}
