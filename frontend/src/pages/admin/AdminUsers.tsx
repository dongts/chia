import { useState, useEffect, useCallback, useRef } from "react";
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
  KeyRound,
  UserPlus,
  Merge,
} from "lucide-react";
import client from "@/api/client";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface UserRead {
  id: string; email: string | null; display_name: string;
  is_verified: boolean; created_at: string;
}
interface UserDetail extends UserRead {
  groups: { id: string; name: string; currency_code: string; role: string }[];
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

// ── User Row ─────────────────────────────────────────────────────────────────

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

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminUsers() {
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
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-on-surface">Users</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">Manage user accounts</p>
      </div>

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
    </div>
  );
}
