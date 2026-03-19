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
} from "lucide-react";
import client from "@/api/client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  users: number;
  groups: number;
  expenses: number;
  settlements: number;
}

interface UserRead {
  id: string;
  email: string | null;
  display_name: string;
  is_verified: boolean;
  created_at: string;
}

interface UserDetail extends UserRead {
  groups: { id: string; name: string; currency_code: string }[];
}

interface GroupItem {
  id: string;
  name: string;
  currency_code: string;
  member_count: number;
  invite_code: string;
  created_at: string;
  expenses_count?: number;
}

interface GroupDetail extends GroupItem {
  members: { id: string; display_name: string; email: string | null }[];
  allowed_currencies: string[];
  expenses_count: number;
}

interface ExpenseItem {
  id: string;
  description: string;
  amount: number;
  currency_code: string;
  paid_by: { display_name: string } | null;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Badge({ children, green }: { children: React.ReactNode; green?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        green ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
      )}
    >
      {children}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", color)}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .get<Stats>("/admin/stats")
      .then((r) => setStats(r.data))
      .catch(() => setError("Failed to load stats"))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (error) return <p className="text-red-500 text-sm">{error}</p>;
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        icon={Users}
        label="Total Users"
        value={stats.users}
        color="bg-blue-50 text-blue-600"
      />
      <StatCard
        icon={Layers}
        label="Total Groups"
        value={stats.groups}
        color="bg-green-50 text-green-600"
      />
      <StatCard
        icon={Receipt}
        label="Total Expenses"
        value={stats.expenses}
        color="bg-amber-50 text-amber-600"
      />
      <StatCard
        icon={LayoutDashboard}
        label="Settlements"
        value={stats.settlements}
        color="bg-purple-50 text-purple-600"
      />
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

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

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get<{ items: UserRead[]; total: number }>("/admin/users", {
        params: { limit, offset: page * limit, search: debouncedSearch || undefined },
      })
      .then((r) => {
        setUsers(r.data.items);
        setTotal(r.data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleExpand(userId: string) {
    if (expandedId === userId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(userId);
    setExpandedDetail(null);
    setLoadingDetail(true);
    try {
      const r = await client.get<UserDetail>(`/admin/users/${userId}`);
      setExpandedDetail(r.data);
    } catch {
      setExpandedDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  function startEdit(user: UserRead) {
    setEditingId(user.id);
    setEditForm({
      display_name: user.display_name,
      email: user.email ?? "",
      is_verified: user.is_verified,
    });
  }

  async function saveEdit(userId: string) {
    setSaving(true);
    try {
      await client.patch(`/admin/users/${userId}`, {
        display_name: editForm.display_name,
        email: editForm.email || null,
        is_verified: editForm.is_verified,
      });
      setEditingId(null);
      load();
    } catch {
      window.alert("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(userId: string) {
    if (!window.confirm("Delete this user? This cannot be undone.")) return;
    setDeletingId(userId);
    try {
      await client.delete(`/admin/users/${userId}`);
      if (expandedId === userId) setExpandedId(null);
      load();
    } catch {
      window.alert("Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
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
                <>
                  <tr
                    key={user.id}
                    className={cn(
                      "border-b border-gray-100 hover:bg-gray-50 cursor-pointer",
                      expandedId === user.id && "bg-green-50/40"
                    )}
                    onClick={() => {
                      if (editingId !== user.id) toggleExpand(user.id);
                    }}
                  >
                    <td className="px-4 py-3 text-gray-400">
                      {expandedId === user.id ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </td>

                    {editingId === user.id ? (
                      <>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-green-500"
                            value={editForm.email}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, email: e.target.value }))
                            }
                          />
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-green-500"
                            value={editForm.display_name}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, display_name: e.target.value }))
                            }
                          />
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() =>
                              setEditForm((f) => ({ ...f, is_verified: !f.is_verified }))
                            }
                            className={cn(
                              "px-2 py-0.5 rounded-full text-xs font-medium border transition-colors",
                              editForm.is_verified
                                ? "bg-green-100 text-green-700 border-green-200"
                                : "bg-gray-100 text-gray-500 border-gray-200"
                            )}
                          >
                            {editForm.is_verified ? "Verified" : "Guest"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{formatDate(user.created_at)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-gray-700">{user.email ?? "—"}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{user.display_name}</td>
                        <td className="px-4 py-3">
                          <Badge green={user.is_verified}>
                            {user.is_verified ? "Verified" : "Guest"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{formatDate(user.created_at)}</td>
                      </>
                    )}

                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {editingId === user.id ? (
                          <>
                            <button
                              disabled={saving}
                              onClick={() => saveEdit(user.id)}
                              className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-50"
                              title="Save"
                            >
                              <Check size={15} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
                              title="Cancel"
                            >
                              <X size={15} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(user)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                              title="Edit"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              disabled={deletingId === user.id}
                              onClick={() => deleteUser(user.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                              title="Delete"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === user.id && (
                    <tr key={`${user.id}-detail`} className="bg-green-50/30">
                      <td colSpan={6} className="px-6 py-4">
                        {loadingDetail ? (
                          <div className="flex items-center gap-2 text-sm text-gray-400">
                            <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                            Loading…
                          </div>
                        ) : expandedDetail ? (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                              Member of {expandedDetail.groups.length} group
                              {expandedDetail.groups.length !== 1 ? "s" : ""}
                            </p>
                            {expandedDetail.groups.length === 0 ? (
                              <p className="text-sm text-gray-400">No groups</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {expandedDetail.groups.map((g) => (
                                  <span
                                    key={g.id}
                                    className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-3 py-1 text-sm text-gray-700"
                                  >
                                    {g.name}
                                    <span className="text-xs text-gray-400">{g.currency_code}</span>
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
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Group Expenses Sub-section ────────────────────────────────────────────────

function GroupExpenses({ groupId }: { groupId: string }) {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 50;
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get<{ items: ExpenseItem[]; total: number }>(`/admin/groups/${groupId}/expenses`, {
        params: { limit, offset: page * limit },
      })
      .then((r) => {
        setExpenses(r.data.items);
        setTotal(r.data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [groupId, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteExpense(expenseId: string) {
    if (!window.confirm("Delete this expense?")) return;
    setDeletingId(expenseId);
    try {
      await client.delete(`/admin/expenses/${expenseId}`);
      load();
    } catch {
      window.alert("Failed to delete expense");
    } finally {
      setDeletingId(null);
    }
  }

  const totalPages = Math.ceil(total / limit);

  if (loading)
    return (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (expenses.length === 0) return <p className="text-sm text-gray-400">No expenses</p>;

  return (
    <div className="space-y-2">
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
                <td className="px-3 py-2 text-gray-700">
                  {exp.amount.toFixed(2)} {exp.currency_code}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {exp.paid_by?.display_name ?? "—"}
                </td>
                <td className="px-3 py-2 text-gray-400">{formatDate(exp.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    disabled={deletingId === exp.id}
                    onClick={() => deleteExpense(exp.id)}
                    className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                    title="Delete expense"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Groups Tab ────────────────────────────────────────────────────────────────

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

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get<{ items: GroupItem[]; total: number }>("/admin/groups", {
        params: { limit, offset: page * limit, search: debouncedSearch || undefined },
      })
      .then((r) => {
        setGroups(r.data.items);
        setTotal(r.data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleExpand(groupId: string) {
    if (expandedId === groupId) {
      setExpandedId(null);
      setExpandedDetail(null);
      setShowExpenses(null);
      return;
    }
    setExpandedId(groupId);
    setExpandedDetail(null);
    setShowExpenses(null);
    setLoadingDetail(true);
    try {
      const r = await client.get<GroupDetail>(`/admin/groups/${groupId}`);
      setExpandedDetail(r.data);
    } catch {
      setExpandedDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function deleteGroup(groupId: string) {
    if (!window.confirm("Delete this group and all its data? This cannot be undone.")) return;
    setDeletingId(groupId);
    try {
      await client.delete(`/admin/groups/${groupId}`);
      if (expandedId === groupId) setExpandedId(null);
      load();
    } catch {
      window.alert("Failed to delete group");
    } finally {
      setDeletingId(null);
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by group name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Invite code</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <>
                  <tr
                    key={group.id}
                    className={cn(
                      "border-b border-gray-100 hover:bg-gray-50 cursor-pointer",
                      expandedId === group.id && "bg-green-50/40"
                    )}
                    onClick={() => toggleExpand(group.id)}
                  >
                    <td className="px-4 py-3 text-gray-400">
                      {expandedId === group.id ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{group.name}</td>
                    <td className="px-4 py-3">
                      <Badge>{group.currency_code}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{group.member_count}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                        {group.invite_code}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(group.created_at)}</td>
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          disabled={deletingId === group.id}
                          onClick={() => deleteGroup(group.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title="Delete group"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {expandedId === group.id && (
                    <tr key={`${group.id}-detail`} className="bg-green-50/20">
                      <td colSpan={7} className="px-6 py-4">
                        {loadingDetail ? (
                          <div className="flex items-center gap-2 text-sm text-gray-400">
                            <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                            Loading…
                          </div>
                        ) : expandedDetail ? (
                          <div className="space-y-4">
                            {/* Members */}
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                Members ({expandedDetail.members.length})
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {expandedDetail.members.map((m) => (
                                  <span
                                    key={m.id}
                                    className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-3 py-1 text-sm text-gray-700"
                                  >
                                    {m.display_name}
                                    {m.email && (
                                      <span className="text-xs text-gray-400">{m.email}</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Currencies */}
                            {expandedDetail.allowed_currencies.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                  Allowed Currencies
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {expandedDetail.allowed_currencies.map((c) => (
                                    <Badge key={c} green={c === expandedDetail.currency_code}>
                                      {c}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Expenses count + link */}
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                Expenses ({expandedDetail.expenses_count})
                              </p>
                              <button
                                onClick={() =>
                                  setShowExpenses(
                                    showExpenses === group.id ? null : group.id
                                  )
                                }
                                className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-medium"
                              >
                                <Receipt size={14} />
                                {showExpenses === group.id ? "Hide expenses" : "View expenses"}
                              </button>

                              {showExpenses === group.id && (
                                <div className="mt-3">
                                  <GroupExpenses groupId={group.id} />
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-red-400">Failed to load details</p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40"
            >
              <ChevronRightIcon size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

type Tab = "dashboard" | "users" | "groups";

export default function Admin() {
  const [isSuperadmin, setIsSuperadmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  useEffect(() => {
    client
      .get("/admin/me")
      .then(() => setIsSuperadmin(true))
      .catch((err: { response?: { status?: number } }) => {
        if (err?.response?.status === 403) {
          setIsSuperadmin(false);
        } else {
          setIsSuperadmin(false);
        }
      });
  }, []);

  if (isSuperadmin === null) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSuperadmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
          <ShieldOff size={28} className="text-red-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 text-sm mt-1">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "groups", label: "Groups", icon: Layers },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage users and groups</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === id
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "groups" && <GroupsTab />}
    </div>
  );
}
