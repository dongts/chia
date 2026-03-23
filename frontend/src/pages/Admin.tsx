import { useState, useEffect, useCallback } from "react";
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
      green ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
    )}>
      {children}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", color)}><Icon size={22} /></div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
        <p className="text-sm text-gray-500">{label}</p>
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

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard icon={Users} label="Total Users" value={stats.users} color="bg-blue-50 text-blue-600" />
      <StatCard icon={Layers} label="Total Groups" value={stats.groups} color="bg-green-50 text-green-600" />
      <StatCard icon={Receipt} label="Total Expenses" value={stats.expenses} color="bg-amber-50 text-amber-600" />
      <StatCard icon={LayoutDashboard} label="Settlements" value={stats.settlements} color="bg-purple-50 text-purple-600" />
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
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Reset Password</h3>
            <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-green-500" />
            <div className="flex gap-2">
              <button onClick={() => setResetPwUserId(null)} className="flex-1 border border-gray-200 text-gray-700 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleResetPassword} disabled={resettingPw || !newPassword}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm">{resettingPw ? "Resetting..." : "Reset"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add to group modal */}
      {addToGroupUserId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setAddToGroupUserId(null)}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Add User to Group</h3>
            <select value={addGroupId} onChange={(e) => setAddGroupId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">Select group...</option>
              {allGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={addGroupRole} onChange={(e) => setAddGroupRole(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setAddToGroupUserId(null)} className="flex-1 border border-gray-200 text-gray-700 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleAddToGroup} disabled={addingToGroup || !addGroupId}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm">{addingToGroup ? "Adding..." : "Add to Group"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search by email or name..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : users.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-10">No users found</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-6" />
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
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
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"><ChevronLeft size={16} /></button>
            <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"><ChevronRightIcon size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// User row component to avoid React key issues with fragments
function UserRow({ user, isExpanded, isEditing, editForm, saving, deletingId, expandedDetail, loadingDetail,
  onToggleExpand, onStartEdit, onSaveEdit, onCancelEdit, onDelete, onEditFormChange, onResetPassword, onAddToGroup,
}: {
  user: UserRead; isExpanded: boolean; isEditing: boolean;
  editForm: { display_name: string; email: string; is_verified: boolean };
  saving: boolean; deletingId: string | null;
  expandedDetail: UserDetail | null; loadingDetail: boolean;
  onToggleExpand: () => void; onStartEdit: () => void; onSaveEdit: () => void;
  onCancelEdit: () => void; onDelete: () => void;
  onEditFormChange: (f: { display_name: string; email: string; is_verified: boolean }) => void;
  onResetPassword: () => void; onAddToGroup: () => void;
}) {
  return (
    <>
      <tr className={cn("border-b border-gray-100 hover:bg-gray-50 cursor-pointer", isExpanded && "bg-green-50/40")} onClick={onToggleExpand}>
        <td className="px-4 py-3 text-gray-400">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        {isEditing ? (
          <>
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <input className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-green-500"
                value={editForm.email} onChange={(e) => onEditFormChange({ ...editForm, email: e.target.value })} />
            </td>
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <input className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-green-500"
                value={editForm.display_name} onChange={(e) => onEditFormChange({ ...editForm, display_name: e.target.value })} />
            </td>
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onEditFormChange({ ...editForm, is_verified: !editForm.is_verified })}
                className={cn("px-2 py-0.5 rounded-full text-xs font-medium border",
                  editForm.is_verified ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"
                )}>{editForm.is_verified ? "Verified" : "Guest"}</button>
            </td>
            <td className="px-4 py-3 text-gray-400">{formatDate(user.created_at)}</td>
          </>
        ) : (
          <>
            <td className="px-4 py-3 text-gray-700">{user.email ?? "—"}</td>
            <td className="px-4 py-3 font-medium text-gray-900">{user.display_name}</td>
            <td className="px-4 py-3"><Badge green={user.is_verified}>{user.is_verified ? "Verified" : "Guest"}</Badge></td>
            <td className="px-4 py-3 text-gray-400">{formatDate(user.created_at)}</td>
          </>
        )}
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {isEditing ? (
              <>
                <button disabled={saving} onClick={onSaveEdit} className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-50" title="Save"><Check size={15} /></button>
                <button onClick={onCancelEdit} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="Cancel"><X size={15} /></button>
              </>
            ) : (
              <>
                <button onClick={onStartEdit} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Edit"><Pencil size={15} /></button>
                <button onClick={onResetPassword} className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50" title="Reset password"><KeyRound size={15} /></button>
                <button onClick={onAddToGroup} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Add to group"><UserPlus size={15} /></button>
                <button disabled={deletingId === user.id} onClick={onDelete} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50" title="Delete"><Trash2 size={15} /></button>
              </>
            )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-green-50/30">
          <td colSpan={6} className="px-6 py-4">
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-sm text-gray-400"><div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /> Loading...</div>
            ) : expandedDetail ? (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Member of {expandedDetail.groups.length} group{expandedDetail.groups.length !== 1 ? "s" : ""}
                </p>
                {expandedDetail.groups.length === 0 ? (
                  <p className="text-sm text-gray-400">No groups</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {expandedDetail.groups.map((g) => (
                      <span key={g.id} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700">
                        <span className="font-medium">{g.name}</span>
                        <Badge>{g.currency_code}</Badge>
                        <Badge green={g.role === "owner"}>{g.role}</Badge>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-red-400">Failed to load details</p>
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

  if (loading) return <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (expenses.length === 0) return <p className="text-sm text-gray-400">No expenses</p>;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left px-3 py-2 font-medium text-gray-600">Description</th>
            <th className="text-left px-3 py-2 font-medium text-gray-600">Amount</th>
            <th className="text-left px-3 py-2 font-medium text-gray-600">Paid by</th>
            <th className="text-left px-3 py-2 font-medium text-gray-600">Date</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {expenses.map((exp) => (
            <tr key={exp.id} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-2 text-gray-800">{exp.description}</td>
              <td className="px-3 py-2 text-gray-700">{formatAmount(exp.amount, exp.currency_code)} {exp.currency_code}</td>
              <td className="px-3 py-2 text-gray-500">{exp.payer_name ?? "—"}</td>
              <td className="px-3 py-2 text-gray-400">{formatDate(exp.date)}</td>
              <td className="px-3 py-2 text-right">
                <button disabled={deletingId === exp.id} onClick={() => deleteExpense(exp.id)}
                  className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40" title="Delete"><Trash2 size={13} /></button>
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
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Add Member to Group</h3>
            <input type="text" placeholder="Display name" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500" />
            <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setAddMemberGroupId(null)} className="flex-1 border border-gray-200 text-gray-700 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleAddMember} disabled={addingMember || !newMemberName.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm">{addingMember ? "Adding..." : "Add Member"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search by group name..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : groups.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-10">No groups found</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-6" />
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Currency</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Members</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Invite</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
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
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"><ChevronLeft size={16} /></button>
            <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"><ChevronRightIcon size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRow({ group, isExpanded, expandedDetail, loadingDetail, showExpenses, deletingId,
  onToggleExpand, onDelete, onToggleExpenses, onAddMember, onMemberRenamed,
}: {
  group: GroupItem; isExpanded: boolean; expandedDetail: GroupDetail | null;
  loadingDetail: boolean; showExpenses: boolean; deletingId: string | null;
  onToggleExpand: () => void; onDelete: () => void; onToggleExpenses: () => void; onAddMember: () => void;
  onMemberRenamed: (memberId: string, newName: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);

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
      <tr className={cn("border-b border-gray-100 hover:bg-gray-50 cursor-pointer", isExpanded && "bg-green-50/40")} onClick={onToggleExpand}>
        <td className="px-4 py-3 text-gray-400">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="px-4 py-3 font-medium text-gray-900">{group.name}</td>
        <td className="px-4 py-3"><Badge>{group.currency_code}</Badge></td>
        <td className="px-4 py-3 text-gray-600">{group.member_count}</td>
        <td className="px-4 py-3"><code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">{group.invite_code}</code></td>
        <td className="px-4 py-3 text-gray-400">{formatDate(group.created_at)}</td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <button onClick={onAddMember} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Add member"><Plus size={15} /></button>
            <button disabled={deletingId === group.id} onClick={onDelete} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50" title="Delete"><Trash2 size={15} /></button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-green-50/20">
          <td colSpan={7} className="px-6 py-4">
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-sm text-gray-400"><div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /> Loading...</div>
            ) : expandedDetail ? (
              <div className="space-y-4">
                {/* Members */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Members ({expandedDetail.members.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {expandedDetail.members.map((m) => (
                      <span key={m.id} className={cn("inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm",
                        m.is_active ? "bg-white border-gray-200 text-gray-700" : "bg-gray-50 border-gray-100 text-gray-400 line-through"
                      )}>
                        {renamingId === m.id ? (
                          <>
                            <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRename(m.id); if (e.key === "Escape") setRenamingId(null); }}
                              autoFocus className="border border-gray-200 rounded px-1.5 py-0.5 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-green-500" />
                            <button onClick={() => handleRename(m.id)} disabled={savingRename} className="text-green-600 hover:text-green-700"><Check size={13} /></button>
                            <button onClick={() => setRenamingId(null)} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">{m.display_name}</span>
                            <button onClick={() => { setRenamingId(m.id); setRenameValue(m.display_name); }}
                              className="text-gray-300 hover:text-gray-500" title="Rename"><Pencil size={11} /></button>
                          </>
                        )}
                        {m.email && <span className="text-xs text-gray-400">{m.email}</span>}
                        <Badge green={m.role === "owner"}>{m.role}</Badge>
                        {!m.user_id && <span className="text-xs text-amber-500">unclaimed</span>}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Currencies */}
                {expandedDetail.currencies.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Allowed Currencies</p>
                    <div className="flex flex-wrap gap-2">
                      {expandedDetail.currencies.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-3 py-1 text-sm text-gray-700">
                          <span className="font-medium">{c.currency_code}</span>
                          <span className="text-xs text-gray-400">rate: {c.exchange_rate}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expenses */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Expenses ({expandedDetail.expenses_count})</p>
                  <button onClick={onToggleExpenses} className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-medium">
                    <Receipt size={14} />{showExpenses ? "Hide expenses" : "View expenses"}
                  </button>
                  {showExpenses && <div className="mt-3"><GroupExpenses groupId={group.id} /></div>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-red-400">Failed to load details</p>
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

  if (isSuperadmin === null) return <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /></div>;

  if (!isSuperadmin) return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center"><ShieldOff size={28} className="text-red-500" /></div>
      <div><h2 className="text-xl font-bold text-gray-900">Access Denied</h2><p className="text-gray-500 text-sm mt-1">You don't have permission to access this page.</p></div>
    </div>
  );

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "groups", label: "Groups", icon: Layers },
  ];

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-bold text-gray-900">Admin</h1><p className="text-sm text-gray-500 mt-0.5">Manage users and groups</p></div>
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)} className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === id ? "border-green-600 text-green-700" : "border-transparent text-gray-500 hover:text-gray-700"
          )}><Icon size={15} />{label}</button>
        ))}
      </div>
      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "groups" && <GroupsTab />}
    </div>
  );
}
