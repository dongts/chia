import { useState, useEffect, useCallback } from "react";
import {
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
  Plus,
  Merge,
} from "lucide-react";
import client from "@/api/client";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/currency";

// ── Types ────────────────────────────────────────────────────────────────────

interface UserRead {
  id: string; email: string | null; display_name: string;
  is_verified: boolean; created_at: string;
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
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

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

// ── Group Row ─────────────────────────────────────────────────────────────────

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

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminGroups() {
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
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-on-surface">Groups</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">Manage groups and their members</p>
      </div>

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
    </div>
  );
}
