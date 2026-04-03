import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Plus, Share2, Settings, ArrowLeft, Check, BarChart3, Pencil, Trash2,
  ArrowLeftRight, Landmark, UserPlus, ImageIcon, ChevronRight,
  ArrowRight, X, Search, Filter, ChevronDown,
} from "lucide-react";
import { getGroup } from "@/api/groups";
import { listExpenses, deleteExpense } from "@/api/expenses";
import { getBalances, createSettlement, updateSettlement, listSettlements, getSuggestedSettlements } from "@/api/settlements";
import { listGroupCategories } from "@/api/categories";
import { listMembers, addMember } from "@/api/members";
import { listGroupPaymentMethods } from "@/api/paymentMethods";
import { listFunds, createFund } from "@/api/funds";
import type { Group, GroupMember, Expense, Balance, Settlement, SuggestedSettlement, Category, GroupPaymentMethod, Fund } from "@/types";
import MoneyInput from "@/components/MoneyInput";
import PaymentInfoModal from "@/components/PaymentInfoModal";
import PaymentMethodCards from "@/components/PaymentMethodCards";
import { formatCurrency } from "@/utils/currency";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";

type Tab = "expenses" | "balances" | "settlements" | "funds";

const PAGE_SIZE = 20;

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function groupExpensesByDate(expenses: Expense[]): { date: string; label: string; expenses: Expense[] }[] {
  const groups: { date: string; label: string; expenses: Expense[] }[] = [];
  let currentDate = "";
  for (const expense of expenses) {
    const dateKey = new Date(expense.date).toDateString();
    if (dateKey !== currentDate) {
      currentDate = dateKey;
      groups.push({ date: dateKey, label: formatRelativeDate(expense.date), expenses: [] });
    }
    groups[groups.length - 1].expenses.push(expense);
  }
  return groups;
}

/** Searchable member dropdown used in the transfer modal */
function MemberSearchSelect({
  value,
  onChange,
  members,
  placeholder,
  excludeId,
}: {
  value: string;
  onChange: (id: string) => void;
  members: GroupMember[];
  placeholder: string;
  excludeId?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = members.find((m) => m.id === value);
  const filtered = members
    .filter((m) => m.id !== excludeId)
    .filter((m) => m.display_name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
        <input
          type="text"
          value={open ? search : selected ? selected.display_name : ""}
          onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setSearch(""); }}
          placeholder={selected ? selected.display_name : placeholder}
          className="w-full bg-surface-container-high/50 border-0 rounded-xl pl-9 pr-8 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors"
        />
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-outline" />
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-surface-container-lowest rounded-xl shadow-editorial-xl border border-outline-variant/10 max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-outline">No results</p>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => { onChange(m.id); setSearch(""); setOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm hover:bg-surface-container transition-colors",
                  m.id === value ? "text-primary font-semibold" : "text-on-surface"
                )}
              >
                {m.display_name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function GroupView() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupPMs, setGroupPMs] = useState<GroupPaymentMethod[]>([]);
  const [suggestedSettlements, setSuggestedSettlements] = useState<SuggestedSettlement[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [showCreateFund, setShowCreateFund] = useState(false);
  const [newFundName, setNewFundName] = useState("");
  const [newFundDescription, setNewFundDescription] = useState("");
  const [newFundHolder, setNewFundHolder] = useState("");
  const [paymentInfoMemberId, setPaymentInfoMemberId] = useState<string | null>(null);
  const [paymentInfoAmount, setPaymentInfoAmount] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("expenses");

  // Transfer/settle modal
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferType, setTransferType] = useState<"transfer" | "settle_up">("transfer");
  const [editingSettlementId, setEditingSettlementId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Settlement suggestions
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Add member modal
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  const currentUser = useAuthStore((s) => s.user);

  // Filters
  const [filterCategory, setFilterCategory] = useState("");
  const [filterPaidBy, setFilterPaidBy] = useState("");

  // Infinite scroll
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!groupId) return;
    loadAll();
  }, [groupId]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filterCategory, filterPaidBy]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => prev + PAGE_SIZE);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, filterCategory, filterPaidBy, expenses.length]);

  async function loadAll() {
    if (!groupId) return;
    setLoading(true);
    try {
      const [g, exp, bal, set, cats, mem, pms, fds, suggested] = await Promise.all([
        getGroup(groupId),
        listExpenses(groupId),
        getBalances(groupId),
        listSettlements(groupId),
        listGroupCategories(groupId),
        listMembers(groupId),
        listGroupPaymentMethods(groupId),
        listFunds(groupId),
        getSuggestedSettlements(groupId).catch(() => [] as SuggestedSettlement[]),
      ]);
      setGroup(g);
      setExpenses(exp);
      setBalances(bal);
      setSettlements(set);
      setCategories(cats);
      setMembers(mem);
      setGroupPMs(pms);
      setFunds(fds);
      setSuggestedSettlements(suggested);
    } catch {
      window.alert("Failed to load group data");
    } finally {
      setLoading(false);
    }
  }

  function copyInviteCode() {
    if (!group) return;
    const link = `${window.location.origin}${import.meta.env.BASE_URL}join/${group.invite_code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleDeleteExpense(expenseId: string) {
    if (!groupId) return;
    if (!window.confirm("Delete this expense?")) return;
    try {
      await deleteExpense(groupId, expenseId);
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
    } catch {
      window.alert("Failed to delete expense");
    }
  }

  function openTransferModal(type: "transfer" | "settle_up", from?: string, to?: string, amount?: number, settlementId?: string, note?: string) {
    setTransferType(type);
    setTransferFrom(from ?? "");
    setTransferTo(to ?? "");
    setTransferAmount(amount ? String(amount) : "");
    setTransferNote(note ?? "");
    setEditingSettlementId(settlementId ?? null);
    setShowTransfer(true);
  }

  async function handleTransfer() {
    if (!groupId || !transferFrom || !transferTo || !transferAmount) return;
    if (transferFrom === transferTo) { window.alert("Cannot transfer to the same person"); return; }
    setTransferring(true);
    try {
      if (editingSettlementId) {
        await updateSettlement(groupId, editingSettlementId, {
          from_member: transferFrom,
          to_member: transferTo,
          amount: parseFloat(transferAmount),
          description: transferNote || null,
          type: transferType,
        });
      } else {
        await createSettlement(groupId, {
          from_member: transferFrom,
          to_member: transferTo,
          amount: parseFloat(transferAmount),
          description: transferNote || null,
          type: transferType,
        });
      }
      setShowTransfer(false);
      setTransferFrom(""); setTransferTo(""); setTransferAmount(""); setTransferNote("");
      setEditingSettlementId(null);
      await loadAll();
    } catch { window.alert(editingSettlementId ? "Failed to update transfer" : "Failed to record transfer"); }
    finally { setTransferring(false); }
  }

  function getMemberPaymentMethods(memberId: string) {
    return groupPMs.filter((pm) => pm.member_id === memberId);
  }

  function getCategoryIcon(categoryId: string) {
    return categories.find((c) => c.id === categoryId)?.icon ?? "📦";
  }

  // Find the current user's member ID in this group
  const myMemberId = members.find((m) => m.user_id === currentUser?.id)?.id;


  // Filter expenses
  const filteredExpenses = expenses.filter((e) => {
    if (filterCategory && e.category_id !== filterCategory) return false;
    if (filterPaidBy && e.paid_by !== filterPaidBy) return false;
    return true;
  });

  const visibleExpenses = filteredExpenses.slice(0, visibleCount);
  const hasMore = visibleCount < filteredExpenses.length;

  // Computed balance summaries — relative to current user
  const myBalance = myMemberId ? Number(balances.find((b) => b.member_id === myMemberId)?.balance ?? 0) : 0;

  // Settlement suggestions involving the current user
  const mySettlementSuggestions = myMemberId
    ? suggestedSettlements.filter((s) => s.from_member === myMemberId || s.to_member === myMemberId)
    : [];

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-container-high rounded w-1/3" />
        <div className="h-4 bg-surface-container rounded w-1/4" />
      </div>
    );
  }

  if (!group) return null;

  const dateGroups = groupExpensesByDate(visibleExpenses);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-on-surface">{group.name}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-on-surface-variant">{group.member_count ?? "?"} members</span>
              <span className="text-outline">·</span>
              <span className="text-xs font-medium text-outline">{group.currency_code}</span>
              {group.created_at && (
                <>
                  <span className="text-outline">·</span>
                  <span className="text-xs text-outline">Created {new Date(group.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAddMember(true)}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
            title="Add member"
          >
            <UserPlus size={18} />
          </button>
          <button
            onClick={copyInviteCode}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
            title={copied ? "Copied!" : "Share invite link"}
          >
            {copied ? <Check size={18} className="text-primary" /> : <Share2 size={18} />}
          </button>
          <Link
            to={`/groups/${groupId}/reports`}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
            title="Reports"
          >
            <BarChart3 size={18} />
          </Link>
          <Link
            to={`/groups/${groupId}/settings`}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
            title="Settings"
          >
            <Settings size={18} />
          </Link>
        </div>
      </div>

      {/* ── Balance Summary Card ── */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4">
        <p className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide mb-1">
          {myBalance > 0 ? "You are owed" : myBalance < 0 ? "You owe" : "Your balance"}
        </p>
        <p className={cn("text-lg font-bold", myBalance > 0 ? "text-primary" : myBalance < 0 ? "text-error" : "text-outline")}>
          {myBalance > 0 ? "+" : ""}{formatCurrency(Math.abs(myBalance), group.currency_code)}
        </p>
      </div>

      {/* ── Settlement Suggestions for Current User (collapsible) ── */}
      {mySettlementSuggestions.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden">
          <button
            onClick={() => setShowSuggestions((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-container/40 transition-colors"
          >
            <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
              Suggested Settlements ({mySettlementSuggestions.length})
            </p>
            <ChevronRight size={16} className={cn("text-outline transition-transform", showSuggestions && "rotate-90")} />
          </button>
          {showSuggestions && (
            <div className="px-4 pb-3 space-y-2">
              {mySettlementSuggestions.map((s, i) => {
                const iOwe = s.from_member === myMemberId;
                return (
                  <div
                    key={i}
                    className="bg-surface-container/30 rounded-xl px-4 py-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold",
                        iOwe ? "bg-error-container/20 text-error" : "bg-primary-container/20 text-primary"
                      )}>
                        {iOwe ? s.to_member_name[0]?.toUpperCase() : s.from_member_name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-on-surface">
                          {iOwe
                            ? <>You owe <span className="font-semibold">{s.to_member_name}</span></>
                            : <><span className="font-semibold">{s.from_member_name}</span> owes you</>
                          }
                        </p>
                        <p className={cn("text-sm font-bold", iOwe ? "text-error" : "text-primary")}>
                          {formatCurrency(Number(s.amount), group.currency_code)}
                        </p>
                      </div>
                    </div>
                    {iOwe && (
                      <button
                        onClick={() => openTransferModal("settle_up", s.from_member, s.to_member, Number(s.amount))}
                        className="flex items-center gap-1.5 bg-primary hover:bg-primary-dim text-on-primary font-medium px-4 py-2 rounded-full text-xs transition-colors"
                      >
                        Settle Up
                      </button>
                    )}
                    {!iOwe && getMemberPaymentMethods(s.from_member).length > 0 && (
                      <button
                        onClick={() => { setPaymentInfoMemberId(s.from_member); setPaymentInfoAmount(Number(s.amount)); }}
                        className="p-2 text-outline hover:text-primary hover:bg-primary-container/20 rounded-full transition-colors"
                        title="Payment info"
                      >
                        <Landmark size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Onboarding CTA (empty group) ── */}
      {members.length <= 1 && expenses.length === 0 && (
        <div className="bg-primary-container/20 border border-primary-container/40 rounded-2xl p-5 text-center space-y-3">
          <div className="text-4xl">👋</div>
          <p className="font-semibold text-on-surface">Get started by inviting people</p>
          <p className="text-sm text-on-surface-variant">Share the invite link or add members to start splitting expenses together.</p>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              onClick={() => setShowAddMember(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary-dim text-on-primary font-medium px-5 py-2.5 rounded-full text-sm transition-colors"
            >
              <UserPlus size={16} />
              Add Member
            </button>
            <button
              onClick={copyInviteCode}
              className="flex items-center gap-2 bg-surface-container-lowest hover:bg-surface-container text-on-surface font-medium px-5 py-2.5 rounded-full text-sm transition-colors shadow-editorial"
            >
              {copied ? <Check size={16} className="text-primary" /> : <Share2 size={16} />}
              {copied ? "Copied!" : "Share Link"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab Navigation ── */}
      <div className="flex gap-1 bg-surface-container rounded-full p-1">
        {(["expenses", "balances", "settlements", "funds"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 rounded-full text-sm font-medium capitalize transition-colors",
              tab === t
                ? "bg-primary text-on-primary shadow-editorial"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50"
            )}
          >
            {t === "settlements" ? "Transfers" : t}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          EXPENSES TAB
         ══════════════════════════════════════════════════════════ */}
      {tab === "expenses" && (
        <div className="space-y-4">
          {/* Action row */}
          <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => openTransferModal("transfer")}
                className="flex items-center gap-2 bg-surface-container hover:bg-surface-container-high text-on-surface font-medium px-4 py-2 rounded-full text-sm transition-colors"
              >
                <ArrowLeftRight size={16} />
                Transfer
              </button>
              <Link
                to={`/groups/${groupId}/add-expense`}
                className="flex items-center gap-2 bg-primary hover:bg-primary-dim text-on-primary font-medium px-4 py-2 rounded-full text-sm transition-colors"
              >
                <Plus size={16} />
                Add Expense
              </Link>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-outline flex-shrink-0" />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-surface-container-high/50 border-0 rounded-full px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors appearance-none cursor-pointer"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
            <select
              value={filterPaidBy}
              onChange={(e) => setFilterPaidBy(e.target.value)}
              className="bg-surface-container-high/50 border-0 rounded-full px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors appearance-none cursor-pointer"
            >
              <option value="">All members</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.display_name}</option>
              ))}
            </select>
            {(filterCategory || filterPaidBy) && (
              <button
                onClick={() => { setFilterCategory(""); setFilterPaidBy(""); }}
                className="text-xs text-primary hover:text-primary-dim font-medium px-2 py-1 rounded-full hover:bg-primary-container/20 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Expense list */}
          {filteredExpenses.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial py-16 text-center">
              <div className="text-5xl mb-4">🧾</div>
              <p className="font-semibold text-on-surface text-base">
                {expenses.length === 0 ? "No expenses yet" : "No expenses match filters"}
              </p>
              <p className="text-sm text-on-surface-variant mt-1">
                {expenses.length === 0 ? "Add the first expense for this group" : "Try adjusting your filters"}
              </p>
            </div>
          ) : (
            /* ── Expense table ── */
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/10 text-left text-[11px] text-on-surface-variant uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium">Expense</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Paid by</th>
                    <th className="px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {dateGroups.map((dg) => (
                    <>
                      <tr key={`date-${dg.date}`}>
                        <td colSpan={5} className="px-4 pt-4 pb-1">
                          <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">{dg.label}</p>
                        </td>
                      </tr>
                      {dg.expenses.map((expense) => (
                        <tr
                          key={expense.id}
                          className="border-b border-outline-variant/5 last:border-0 hover:bg-surface-container/40 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="text-base flex-shrink-0">{getCategoryIcon(expense.category_id)}</span>
                              <Link to={`/groups/${groupId}/expenses/${expense.id}/edit`} className="font-medium text-on-surface truncate hover:text-primary transition-colors">{expense.description}</Link>
                              {expense.receipt_url && (
                                <span title="Has receipt"><ImageIcon size={12} className="text-outline flex-shrink-0" /></span>
                              )}
                              {expense.fund_name && (
                                <span className="ml-1.5 text-[10px] bg-primary-container/30 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                  {expense.fund_name}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-outline sm:hidden mt-0.5">
                              {expense.payer_name ?? "Unknown"} · {new Date(expense.date).toLocaleDateString()}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-on-surface-variant hidden sm:table-cell">{expense.payer_name ?? "Unknown"}</td>
                          <td className="px-4 py-3 text-outline hidden sm:table-cell">{new Date(expense.date).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-right font-semibold text-on-surface whitespace-nowrap">
                            {expense.currency_code !== group.currency_code ? (
                              <div>
                                <span>{formatCurrency(Number(expense.amount), expense.currency_code)}</span>
                                <p className="text-xs text-outline font-normal">
                                  ≈ {formatCurrency(Number(expense.converted_amount), group.currency_code)}
                                </p>
                              </div>
                            ) : (
                              formatCurrency(Number(expense.amount), group.currency_code)
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-0.5 justify-end">
                              <Link
                                to={`/groups/${groupId}/expenses/${expense.id}/edit`}
                                className="p-1.5 rounded-full text-outline hover:text-tertiary hover:bg-tertiary-container/20 transition-colors"
                                title="Edit"
                              >
                                <Pencil size={13} />
                              </Link>
                              <button
                                onClick={() => handleDeleteExpense(expense.id)}
                                className="p-1.5 rounded-full text-outline hover:text-error hover:bg-error-container/20 transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Infinite scroll sentinel + count */}
          {filteredExpenses.length > 0 && (
            <div className="text-center space-y-2">
              <p className="text-xs text-outline">
                Showing {Math.min(visibleCount, filteredExpenses.length)} of {filteredExpenses.length} expenses
              </p>
              {hasMore && (
                <div ref={loadMoreRef} className="h-10 flex items-center justify-center">
                  <p className="text-xs text-outline animate-pulse">Loading more...</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          BALANCES TAB
         ══════════════════════════════════════════════════════════ */}
      {tab === "balances" && (
        <div className="space-y-6">
          {/* Member balances — sorted alphabetically */}
          <div className="space-y-3">
            {balances.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial py-12 text-center">
                <p className="text-on-surface-variant text-sm">No balances yet</p>
              </div>
            ) : (
              [...balances].sort((a, b) => a.member_name.localeCompare(b.member_name)).map((b) => {
                const bal = Number(b.balance);
                const isPositive = bal > 0;
                const isNegative = bal < 0;
                return (
                  <div
                    key={b.member_id}
                    className="bg-surface-container-lowest rounded-2xl shadow-editorial px-4 py-3.5 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-sm font-bold text-on-surface-variant">
                        {b.member_name[0]?.toUpperCase()}
                      </div>
                      <p className="font-semibold text-on-surface text-sm">{b.member_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getMemberPaymentMethods(b.member_id).length > 0 && (
                        <button
                          onClick={() => { setPaymentInfoMemberId(b.member_id); setPaymentInfoAmount(undefined); }}
                          className="p-2 text-outline hover:text-primary hover:bg-primary-container/20 rounded-full transition-colors"
                          title="Payment info"
                        >
                          <Landmark size={16} />
                        </button>
                      )}
                      <span
                        className={cn(
                          "font-bold text-sm",
                          isPositive ? "text-primary" : isNegative ? "text-error" : "text-outline"
                        )}
                      >
                        {bal > 0 ? "+" : ""}
                        {formatCurrency(bal, group.currency_code)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          SETTLEMENTS TAB
         ══════════════════════════════════════════════════════════ */}
      {tab === "settlements" && (
        <div className="space-y-3">
          {settlements.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial py-16 text-center">
              <div className="text-5xl mb-4">✅</div>
              <p className="font-semibold text-on-surface text-base">No settlements recorded</p>
              <p className="text-sm text-on-surface-variant mt-1">Settle up debts to see them here</p>
            </div>
          ) : (
            settlements.map((s) => (
              <div
                key={s.id}
                className="bg-surface-container-lowest rounded-2xl shadow-editorial px-4 py-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    s.type === "transfer"
                      ? "bg-tertiary-container/20 text-tertiary"
                      : "bg-primary-container/20 text-primary"
                  )}>
                    {s.type === "transfer" ? <ArrowLeftRight size={18} /> : <Check size={18} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="font-semibold text-on-surface">{s.from_member_name ?? "?"}</span>
                      <ArrowRight size={12} className="text-outline" />
                      <span className="font-semibold text-on-surface">{s.to_member_name ?? "?"}</span>
                    </div>
                    {s.description && (
                      <p className="text-xs text-on-surface-variant mt-0.5">{s.description}</p>
                    )}
                    <p className="text-[11px] text-outline mt-0.5">
                      {new Date(s.settled_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary text-sm">
                    {formatCurrency(Number(s.amount), group.currency_code)}
                  </p>
                  <span className={cn(
                    "text-[10px] font-medium uppercase tracking-wide",
                    s.type === "transfer" ? "text-tertiary" : "text-primary"
                  )}>
                    {s.type === "transfer" ? "Transfer" : "Settlement"}
                  </span>
                </div>
                <button
                  onClick={() => openTransferModal(
                    (s.type as "transfer" | "settle_up") || "settle_up",
                    s.from_member, s.to_member, Number(s.amount), s.id, s.description ?? ""
                  )}
                  className="p-1.5 rounded-full text-outline hover:text-tertiary hover:bg-tertiary-container/20 transition-colors"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          FUNDS TAB
         ══════════════════════════════════════════════════════════ */}
      {tab === "funds" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-on-surface">Group Funds</h3>
            <button
              onClick={() => setShowCreateFund(true)}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-dim text-on-primary font-medium px-4 py-2 rounded-full text-sm transition-colors"
            >
              <Plus size={16} /> New Fund
            </button>
          </div>

          {funds.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial py-16 text-center">
              <div className="text-5xl mb-4">💰</div>
              <p className="font-semibold text-on-surface text-base">No funds yet</p>
              <p className="text-sm text-on-surface-variant mt-1">Create a shared fund for this group</p>
            </div>
          ) : (
            funds.map((fund) => (
              <Link
                key={fund.id}
                to={`/groups/${groupId}/funds/${fund.id}`}
                className={cn(
                  "block bg-surface-container-lowest rounded-2xl shadow-editorial px-4 py-4 transition-shadow hover:shadow-editorial-xl",
                  !fund.is_active && "opacity-50"
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-on-surface text-sm">{fund.name}</span>
                      {!fund.is_active && (
                        <span className="text-[10px] bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                          Closed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Holder: {fund.holder_name} · {fund.transaction_count} transactions
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "text-base font-bold",
                      fund.balance > 0 ? "text-primary" : "text-outline"
                    )}>
                      {formatCurrency(fund.balance, group.currency_code)}
                    </p>
                    <p className="text-[10px] text-outline uppercase tracking-wide">Balance</p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TRANSFER / SETTLE MODAL
         ══════════════════════════════════════════════════════════ */}
      {showTransfer && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
          onClick={() => setShowTransfer(false)}
        >
          <div
            className="bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-editorial-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-primary-container/20 flex items-center justify-center">
                  <ArrowLeftRight size={18} className="text-primary" />
                </div>
                <h3 className="text-lg font-bold text-on-surface">
                  {editingSettlementId ? "Edit Transfer" : transferType === "settle_up" ? "Settle Up" : "Money Transfer"}
                </h3>
              </div>
              <button
                onClick={() => setShowTransfer(false)}
                className="p-2 text-outline hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-6 pb-6 pt-3 space-y-4">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">From</label>
                <MemberSearchSelect
                  value={transferFrom}
                  onChange={setTransferFrom}
                  members={members}
                  placeholder="Search person..."
                  excludeId={transferTo}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">To</label>
                <MemberSearchSelect
                  value={transferTo}
                  onChange={setTransferTo}
                  members={members}
                  placeholder="Search person..."
                  excludeId={transferFrom}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  Amount ({group.currency_code})
                </label>
                <MoneyInput
                  value={transferAmount}
                  onChange={setTransferAmount}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  Note <span className="text-outline font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  placeholder="e.g. Cash payment, bank transfer..."
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors"
                />
              </div>

              {/* Payment info + QR */}
              {transferTo && getMemberPaymentMethods(transferTo).length > 0 && (
                <div className="pt-3 border-t border-outline-variant/10">
                  <p className="text-xs font-medium text-on-surface-variant mb-2">
                    Payment info for {members.find((m) => m.id === transferTo)?.display_name}
                  </p>
                  <PaymentMethodCards
                    methods={getMemberPaymentMethods(transferTo).map((pm) => pm.payment_method)}
                    amount={transferAmount ? parseFloat(transferAmount) : undefined}
                    qrMessage={transferNote || `Chia: ${group.name}`}
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowTransfer(false)}
                  className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface font-medium py-2.5 rounded-full text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={transferring || !transferFrom || !transferTo || !transferAmount}
                  className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-50 text-on-primary font-medium py-2.5 rounded-full text-sm transition-colors"
                >
                  {transferring ? "Saving..." : editingSettlementId ? "Save Changes" : transferType === "settle_up" ? "Settle Up" : "Record Transfer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Fund Modal ── */}
      {showCreateFund && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
          onClick={() => setShowCreateFund(false)}
        >
          <div
            className="bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-editorial-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <h3 className="text-lg font-bold text-on-surface">New Fund</h3>
              <button
                onClick={() => setShowCreateFund(false)}
                className="p-2 text-outline hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 pb-6 pt-3 space-y-4">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Name *</label>
                <input
                  type="text"
                  value={newFundName}
                  onChange={(e) => setNewFundName(e.target.value)}
                  placeholder="e.g. Quỹ tiền phạt"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  Description <span className="text-outline font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newFundDescription}
                  onChange={(e) => setNewFundDescription(e.target.value)}
                  placeholder="What is this fund for?"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Holder</label>
                <select
                  value={newFundHolder}
                  onChange={(e) => setNewFundHolder(e.target.value)}
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors appearance-none cursor-pointer"
                >
                  <option value="">Myself (default)</option>
                  {members.filter((m) => m.is_active).map((m) => (
                    <option key={m.id} value={m.id}>{m.display_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowCreateFund(false)}
                  className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface font-medium py-2.5 rounded-full text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!newFundName.trim() || !groupId) return;
                    try {
                      await createFund(groupId, {
                        name: newFundName.trim(),
                        description: newFundDescription.trim() || null,
                        holder_id: newFundHolder || null,
                      });
                      setShowCreateFund(false);
                      setNewFundName("");
                      setNewFundDescription("");
                      setNewFundHolder("");
                      await loadAll();
                    } catch {
                      window.alert("Failed to create fund");
                    }
                  }}
                  disabled={!newFundName.trim()}
                  className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-50 text-on-primary font-medium py-2.5 rounded-full text-sm transition-colors"
                >
                  Create Fund
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Member Modal ── */}
      {showAddMember && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
          onClick={() => setShowAddMember(false)}
        >
          <div
            className="bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-editorial-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-primary-container/20 flex items-center justify-center">
                  <UserPlus size={18} className="text-primary" />
                </div>
                <h3 className="text-lg font-bold text-on-surface">Add Member</h3>
              </div>
              <button
                onClick={() => setShowAddMember(false)}
                className="p-2 text-outline hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 pb-6 pt-3 space-y-4">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Display name *</label>
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="e.g. John"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (newMemberName.trim() && groupId) {
                        setAddingMember(true);
                        addMember(groupId, { display_name: newMemberName.trim() })
                          .then(() => { setShowAddMember(false); setNewMemberName(""); loadAll(); })
                          .catch(() => window.alert("Failed to add member"))
                          .finally(() => setAddingMember(false));
                      }
                    }
                  }}
                />
              </div>
              <p className="text-xs text-on-surface-variant">
                Or share the invite link so they can join themselves:
              </p>
              <button
                onClick={copyInviteCode}
                className="w-full flex items-center justify-center gap-2 bg-surface-container hover:bg-surface-container-high text-on-surface font-medium px-4 py-2.5 rounded-full text-sm transition-colors"
              >
                {copied ? <Check size={16} className="text-primary" /> : <Share2 size={16} />}
                {copied ? "Link Copied!" : "Copy Invite Link"}
              </button>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowAddMember(false)}
                  className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface font-medium py-2.5 rounded-full text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!newMemberName.trim() || !groupId) return;
                    setAddingMember(true);
                    try {
                      await addMember(groupId, { display_name: newMemberName.trim() });
                      setShowAddMember(false);
                      setNewMemberName("");
                      await loadAll();
                    } catch {
                      window.alert("Failed to add member");
                    } finally {
                      setAddingMember(false);
                    }
                  }}
                  disabled={!newMemberName.trim() || addingMember}
                  className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-50 text-on-primary font-medium py-2.5 rounded-full text-sm transition-colors"
                >
                  {addingMember ? "Adding..." : "Add Member"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment Info Modal ── */}
      <PaymentInfoModal
        memberName={members.find((m) => m.id === paymentInfoMemberId)?.display_name ?? ""}
        methods={paymentInfoMemberId ? getMemberPaymentMethods(paymentInfoMemberId) : []}
        isOpen={!!paymentInfoMemberId}
        onClose={() => { setPaymentInfoMemberId(null); setPaymentInfoAmount(undefined); }}
        amount={paymentInfoAmount}
        qrMessage={`Chia: ${group.name}`}
      />
    </div>
  );
}
