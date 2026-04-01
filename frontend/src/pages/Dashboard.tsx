import { useState, useEffect, useMemo } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Users,
  Wallet,
  X,
  ArrowRight,
  Sparkles,
  ChevronRight,
  Share2,
  Check,
  UserPlus,
} from "lucide-react";
import { listGroups, createGroup } from "@/api/groups";
import type { Group, GroupListItem } from "@/types";
import { formatCurrency } from "@/utils/currency";
import { cn } from "@/lib/utils";
import CurrencySelect from "@/components/CurrencySelect";
import { useAuthStore } from "@/store/authStore";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function AvatarStack({ count, max = 4 }: { count: number; max?: number }) {
  const shown = Math.min(count, max);
  const extra = count - shown;
  const colors = [
    "bg-primary/80",
    "bg-error/60",
    "bg-primary-dim/70",
    "bg-primary-container",
  ];
  return (
    <div className="flex -space-x-2">
      {Array.from({ length: shown }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-7 h-7 rounded-full border-2 border-surface-container-lowest flex items-center justify-center text-[10px] font-bold text-white",
            colors[i % colors.length]
          )}
        >
          {String.fromCharCode(65 + i)}
        </div>
      ))}
      {extra > 0 && (
        <div className="w-7 h-7 rounded-full border-2 border-surface-container-lowest bg-surface-container-high flex items-center justify-center text-[10px] font-semibold text-on-surface-variant">
          +{extra}
        </div>
      )}
    </div>
  );
}

function MiniBarChart() {
  const bars = [40, 65, 50, 80, 55, 70, 90];
  return (
    <div className="flex items-end gap-1 h-10">
      {bars.map((h, i) => (
        <div
          key={i}
          className={cn(
            "w-1.5 rounded-full transition-all",
            i === bars.length - 1
              ? "bg-primary"
              : "bg-primary/20"
          )}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("USD");

  // Post-creation state
  const [createdGroup, setCreatedGroup] = useState<Group | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const firstName = user?.display_name?.split(" ")[0] ?? "there";

  useEffect(() => {
    loadGroups();
  }, []);

  async function loadGroups() {
    try {
      const data = await listGroups();
      setGroups(data);
    } catch {
      window.alert("Failed to load groups");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const newGroup = await createGroup({ name, description: description || null, currency_code: currency });
      setShowForm(false);
      setName("");
      setDescription("");
      setCurrency("USD");
      setCreatedGroup(newGroup);
      await loadGroups();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to create group";
      window.alert(msg);
    } finally {
      setCreating(false);
    }
  }

  function copyCreatedGroupLink() {
    if (!createdGroup) return;
    const link = `${window.location.origin}${import.meta.env.BASE_URL}join/${createdGroup.invite_code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  }

  const totalBalance = useMemo(
    () => groups.reduce((sum, g) => sum + g.my_balance, 0),
    [groups]
  );

  const groupsWithDebt = useMemo(
    () => groups.filter((g) => g.my_balance < 0),
    [groups]
  );

  const pendingPaymentCount = groupsWithDebt.length;

  // Use the first group's currency for the total, or default to USD
  const primaryCurrency = groups.length > 0 ? groups[0].currency_code : "USD";

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-on-surface-variant font-medium">
            {getGreeting()}, {firstName}
          </p>
          <h1 className="text-2xl font-bold text-on-surface mt-0.5">Dashboard</h1>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary-dim text-on-primary font-semibold px-5 py-2.5 rounded-full text-sm transition-colors shadow-editorial"
        >
          <Plus size={16} strokeWidth={2.5} />
          New Group
        </button>
      </div>

      {/* Create Group Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="bg-surface-container-lowest rounded-2xl shadow-editorial-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <h2 className="text-lg font-bold text-on-surface">Create Group</h2>
              <button
                onClick={() => setShowForm(false)}
                className="w-8 h-8 rounded-full bg-surface-container-high/50 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 pb-6 pt-2 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                  Group name <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Italy Trip 2025"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                  Currency
                </label>
                <CurrencySelect value={currency} onChange={setCurrency} />
              </div>
              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-surface-container-high/50 text-on-surface font-semibold py-3 rounded-full text-sm hover:bg-surface-container-high transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full text-sm transition-colors shadow-editorial"
                >
                  {creating ? "Creating..." : "Create Group"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Post-Creation Modal */}
      {createdGroup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="bg-surface-container-lowest rounded-2xl shadow-editorial-xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-8 pb-6 text-center space-y-4">
              <div className="text-5xl">🎉</div>
              <h2 className="text-xl font-bold text-on-surface">Group Created!</h2>
              <p className="text-sm text-on-surface-variant">
                <span className="font-semibold text-on-surface">{createdGroup.name}</span> is ready. Invite people to start splitting expenses.
              </p>

              <div className="space-y-3 pt-2">
                <button
                  onClick={copyCreatedGroupLink}
                  className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dim text-on-primary font-semibold py-3 rounded-full text-sm transition-colors shadow-editorial"
                >
                  {copiedLink ? <Check size={16} /> : <Share2 size={16} />}
                  {copiedLink ? "Link Copied!" : "Copy Invite Link"}
                </button>
                <button
                  onClick={() => { setCreatedGroup(null); navigate(`/groups/${createdGroup.id}`); }}
                  className="w-full flex items-center justify-center gap-2 bg-surface-container-high/50 hover:bg-surface-container-high text-on-surface font-semibold py-3 rounded-full text-sm transition-colors"
                >
                  <UserPlus size={16} />
                  Go to Group
                </button>
                <button
                  onClick={() => setCreatedGroup(null)}
                  className="w-full text-sm text-on-surface-variant hover:text-on-surface font-medium py-2 transition-colors"
                >
                  Stay on Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="space-y-4">
          <div className="bg-surface-container-lowest rounded-2xl p-6 animate-pulse shadow-editorial">
            <div className="h-5 bg-surface-container-high rounded-full w-1/3 mb-4" />
            <div className="h-10 bg-surface-container-high rounded-full w-1/2 mb-2" />
            <div className="h-3 bg-surface-container rounded-full w-1/4" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="bg-surface-container-lowest rounded-2xl p-5 animate-pulse shadow-editorial">
                <div className="h-4 bg-surface-container-high rounded-full w-3/4 mb-3" />
                <div className="h-3 bg-surface-container rounded-full w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ) : groups.length === 0 ? (
        /* Empty State */
        <div className="text-center py-20">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 bg-primary/10 rounded-3xl rotate-6" />
            <div className="absolute inset-0 bg-primary/5 rounded-3xl -rotate-3" />
            <div className="relative w-full h-full bg-primary-container/30 rounded-3xl flex items-center justify-center">
              <Wallet size={40} className="text-primary" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-on-surface mb-2">No groups yet</h3>
          <p className="text-sm text-on-surface-variant mb-8 max-w-xs mx-auto">
            Create your first group to start splitting expenses with friends and family
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-dim text-on-primary font-semibold px-6 py-3 rounded-full text-sm transition-colors shadow-editorial"
          >
            <Plus size={16} strokeWidth={2.5} />
            Create your first group
          </button>
        </div>
      ) : (
        <>
          {/* Total Balance Hero */}
          <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-editorial">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                  Total Balance
                </p>
                <span
                  className={cn(
                    "text-3xl font-bold tracking-tight",
                    totalBalance > 0
                      ? "text-primary"
                      : totalBalance < 0
                      ? "text-error"
                      : "text-on-surface"
                  )}
                >
                  {totalBalance > 0 ? "+" : ""}
                  {formatCurrency(totalBalance, primaryCurrency)}
                </span>
                <p className="text-xs text-on-surface-variant mt-1.5">
                  Across {groups.length} group{groups.length !== 1 ? "s" : ""}
                </p>
              </div>
              <MiniBarChart />
            </div>
          </div>

          {/* Settle CTA */}
          {pendingPaymentCount > 0 && (
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary-dim to-primary-container p-5 shadow-editorial-lg">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-20 h-20 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
              <div className="relative flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles size={16} className="text-on-primary/80" />
                    <p className="text-sm font-bold text-on-primary">Ready to settle?</p>
                  </div>
                  <p className="text-xs text-on-primary/70">
                    You have {pendingPaymentCount} pending payment{pendingPaymentCount !== 1 ? "s" : ""} across{" "}
                    {groupsWithDebt.length} group{groupsWithDebt.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <Link
                  to={`/groups/${groupsWithDebt[0].id}`}
                  className="shrink-0 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-on-primary font-semibold px-5 py-2.5 rounded-full text-sm transition-colors flex items-center gap-1.5"
                >
                  Settle Now
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          )}

          {/* Active Groups */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-on-surface uppercase tracking-wider">
                Your Groups
              </h2>
              <span className="text-xs text-on-surface-variant font-medium">
                {groups.length} group{groups.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  to={`/groups/${g.id}`}
                  className="group bg-surface-container-lowest rounded-2xl p-5 hover:shadow-editorial-lg transition-all shadow-editorial block"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-primary-container/30 rounded-xl flex items-center justify-center">
                      <Wallet size={20} className="text-primary" />
                    </div>
                  </div>

                  <h3 className="font-bold text-on-surface mb-0.5 group-hover:text-primary transition-colors">
                    {g.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant mb-4 flex-wrap">
                    <Users size={12} />
                    <span>{g.member_count} member{g.member_count !== 1 ? "s" : ""}</span>
                    <span className="text-outline">|</span>
                    <span>{g.currency_code}</span>
                    {g.created_at && (
                      <>
                        <span className="text-outline">|</span>
                        <span>{new Date(g.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-end justify-between">
                    <div className="space-y-2">
                      <div>
                        <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">
                          Your Balance
                        </p>
                        <p
                          className={cn(
                            "text-lg font-bold",
                            g.my_balance > 0
                              ? "text-primary"
                              : g.my_balance < 0
                              ? "text-error"
                              : "text-outline"
                          )}
                        >
                          {g.my_balance > 0 ? "+" : ""}
                          {formatCurrency(g.my_balance, g.currency_code)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <AvatarStack count={g.member_count} />
                      <ChevronRight
                        size={16}
                        className="text-outline group-hover:text-primary transition-colors"
                      />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
