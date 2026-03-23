import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Plus, Copy, Settings, ArrowLeft, Check, BarChart3, Pencil, Trash2,
  ArrowLeftRight, List, LayoutGrid, Landmark,
  ArrowRight, X,
} from "lucide-react";
import { getGroup } from "@/api/groups";
import { listExpenses, deleteExpense } from "@/api/expenses";
import { getBalances, getSuggestedSettlements, createSettlement, listSettlements } from "@/api/settlements";
import { listGroupCategories } from "@/api/categories";
import { listMembers } from "@/api/members";
import { listGroupPaymentMethods } from "@/api/paymentMethods";
import type { Group, GroupMember, Expense, Balance, SuggestedSettlement, Settlement, Category, GroupPaymentMethod } from "@/types";
import PaymentInfoModal from "@/components/PaymentInfoModal";
import PaymentMethodCards from "@/components/PaymentMethodCards";
import { formatCurrency } from "@/utils/currency";
import { cn } from "@/lib/utils";

type Tab = "expenses" | "balances" | "settlements";

export default function GroupView() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [suggested, setSuggested] = useState<SuggestedSettlement[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupPMs, setGroupPMs] = useState<GroupPaymentMethod[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [compactView, setCompactView] = useState(() => localStorage.getItem("chia-compact-view") === "true");

  useEffect(() => {
    if (!groupId) return;
    loadAll();
  }, [groupId]);

  async function loadAll() {
    if (!groupId) return;
    setLoading(true);
    try {
      const [g, exp, bal, sug, set, cats, mem, pms] = await Promise.all([
        getGroup(groupId),
        listExpenses(groupId),
        getBalances(groupId),
        getSuggestedSettlements(groupId),
        listSettlements(groupId),
        listGroupCategories(groupId),
        listMembers(groupId),
        listGroupPaymentMethods(groupId),
      ]);
      setGroup(g);
      setExpenses(exp);
      setBalances(bal);
      setSuggested(sug);
      setSettlements(set);
      setCategories(cats);
      setMembers(mem);
      setGroupPMs(pms);
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

  function openTransferModal(type: "transfer" | "settle_up", from?: string, to?: string, amount?: number) {
    setTransferType(type);
    setTransferFrom(from ?? "");
    setTransferTo(to ?? "");
    setTransferAmount(amount ? String(amount) : "");
    setTransferNote("");
    setShowTransfer(true);
  }

  async function handleTransfer() {
    if (!groupId || !transferFrom || !transferTo || !transferAmount) return;
    if (transferFrom === transferTo) { window.alert("Cannot transfer to the same person"); return; }
    setTransferring(true);
    try {
      await createSettlement(groupId, {
        from_member: transferFrom,
        to_member: transferTo,
        amount: parseFloat(transferAmount),
        description: transferNote || null,
        type: transferType,
      });
      setShowTransfer(false);
      setTransferFrom(""); setTransferTo(""); setTransferAmount(""); setTransferNote("");
      await loadAll();
    } catch { window.alert("Failed to record transfer"); }
    finally { setTransferring(false); }
  }

  function getMemberPaymentMethods(memberId: string) {
    return groupPMs.filter((pm) => pm.member_id === memberId);
  }

  function getCategoryIcon(categoryId: string) {
    return categories.find((c) => c.id === categoryId)?.icon ?? "📦";
  }

  // Computed balance summaries
  const totalGroupBalance = balances.reduce((sum, b) => sum + Math.abs(Number(b.balance)), 0) / 2;
  const youAreOwed = balances.filter((b) => Number(b.balance) > 0).reduce((sum, b) => sum + Number(b.balance), 0);
  const youOwe = balances.filter((b) => Number(b.balance) < 0).reduce((sum, b) => sum + Math.abs(Number(b.balance)), 0);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-container-high rounded w-1/3" />
        <div className="h-4 bg-surface-container rounded w-1/4" />
      </div>
    );
  }

  if (!group) return null;

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
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-on-surface">{group.name}</h1>
              <span className="text-[11px] font-semibold tracking-wide uppercase bg-primary-container/20 text-primary px-2.5 py-0.5 rounded-full">
                Active
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-on-surface-variant">{group.member_count ?? "?"} members</span>
              <span className="text-outline">·</span>
              <span className="text-xs font-medium text-outline">{group.currency_code}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={copyInviteCode}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
            title={copied ? "Copied!" : "Copy invite link"}
          >
            {copied ? <Check size={18} className="text-primary" /> : <Copy size={18} />}
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

      {/* ── Balance Summary Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4">
          <p className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide mb-1">Total Balance</p>
          <p className="text-lg font-bold text-on-surface">
            {formatCurrency(totalGroupBalance, group.currency_code)}
          </p>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4">
          <p className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide mb-1">You are owed</p>
          <p className={cn("text-lg font-bold", youAreOwed > 0 ? "text-primary" : "text-outline")}>
            {formatCurrency(youAreOwed, group.currency_code)}
          </p>
        </div>
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4">
          <p className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide mb-1">You owe</p>
          <p className={cn("text-lg font-bold", youOwe > 0 ? "text-error" : "text-outline")}>
            {formatCurrency(youOwe, group.currency_code)}
          </p>
        </div>
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex gap-1 bg-surface-container rounded-full p-1">
        {(["expenses", "balances", "settlements"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 rounded-full text-sm font-medium capitalize transition-colors",
              tab === t
                ? "bg-primary text-on-primary shadow-editorial"
                : "text-on-surface-variant hover:text-on-surface"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          EXPENSES TAB
         ══════════════════════════════════════════════════════════ */}
      {tab === "expenses" && (
        <div className="space-y-4">
          {/* Action row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const next = !compactView;
                  setCompactView(next);
                  localStorage.setItem("chia-compact-view", String(next));
                }}
                className={cn(
                  "p-2 rounded-full transition-colors",
                  compactView
                    ? "bg-primary-container/20 text-primary"
                    : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                )}
                title={compactView ? "Card view" : "Compact view"}
              >
                {compactView ? <LayoutGrid size={16} /> : <List size={16} />}
              </button>
            </div>

            <div className="flex items-center gap-2">
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
          </div>

          {/* Expense list */}
          {expenses.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial py-16 text-center">
              <div className="text-5xl mb-4">🧾</div>
              <p className="font-semibold text-on-surface text-base">No expenses yet</p>
              <p className="text-sm text-on-surface-variant mt-1">Add the first expense for this group</p>
            </div>
          ) : compactView ? (
            /* ── Compact / table view ── */
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
                  {expenses.map((expense) => (
                    <tr
                      key={expense.id}
                      className="border-b border-outline-variant/5 last:border-0 hover:bg-surface-container/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="text-base flex-shrink-0">{getCategoryIcon(expense.category_id)}</span>
                          <span className="font-medium text-on-surface truncate">{expense.description}</span>
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
                </tbody>
              </table>
            </div>
          ) : (
            /* ── Card view ── */
            <div className="space-y-3">
              {expenses.map((expense) => {
                const myShare = expense.splits?.[0]?.resolved_amount;
                return (
                  <div
                    key={expense.id}
                    className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4 flex items-center gap-4"
                  >
                    <div className="w-11 h-11 rounded-xl bg-surface-container flex items-center justify-center text-xl flex-shrink-0">
                      {getCategoryIcon(expense.category_id)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-on-surface truncate">{expense.description}</p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {new Date(expense.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        {" · "}
                        <span className="text-outline">{new Date(expense.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                      </p>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Paid by <span className="font-medium text-on-surface">{expense.payer_name ?? "Unknown"}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        {expense.currency_code !== group.currency_code ? (
                          <>
                            <p className="font-bold text-on-surface">
                              {formatCurrency(Number(expense.amount), expense.currency_code)}
                            </p>
                            <p className="text-[11px] text-outline">
                              ≈ {formatCurrency(Number(expense.converted_amount), group.currency_code)}
                            </p>
                          </>
                        ) : (
                          <p className="font-bold text-on-surface">
                            {formatCurrency(Number(expense.amount), group.currency_code)}
                          </p>
                        )}
                        {myShare !== undefined && (
                          <p className="text-[11px] text-on-surface-variant">
                            Your share: {formatCurrency(Number(myShare), group.currency_code)}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <Link
                          to={`/groups/${groupId}/expenses/${expense.id}/edit`}
                          className="p-1.5 rounded-full text-outline hover:text-tertiary hover:bg-tertiary-container/20 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </Link>
                        <button
                          onClick={() => handleDeleteExpense(expense.id)}
                          className="p-1.5 rounded-full text-outline hover:text-error hover:bg-error-container/20 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          BALANCES TAB
         ══════════════════════════════════════════════════════════ */}
      {tab === "balances" && (
        <div className="space-y-6">
          {/* Member balances */}
          <div className="space-y-3">
            {balances.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial py-12 text-center">
                <p className="text-on-surface-variant text-sm">No balances yet</p>
              </div>
            ) : (
              balances.map((b) => {
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
                      <div>
                        <p className="font-semibold text-on-surface text-sm">{b.member_name}</p>
                        <p className={cn(
                          "text-xs font-medium mt-0.5",
                          isPositive ? "text-primary" : isNegative ? "text-error" : "text-outline"
                        )}>
                          {isPositive
                            ? `Owes you ${formatCurrency(bal, group.currency_code)}`
                            : isNegative
                            ? `You owe ${formatCurrency(Math.abs(bal), group.currency_code)}`
                            : "Settled up"}
                        </p>
                      </div>
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

          {/* Suggested settlements */}
          {suggested.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3 px-1">
                Suggested Settlements
              </p>
              <div className="space-y-3">
                {suggested.map((s) => {
                  const key = `${s.from_member}-${s.to_member}`;
                  return (
                    <div
                      key={key}
                      className="bg-surface-container-lowest rounded-2xl shadow-editorial px-4 py-3.5 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="font-semibold text-on-surface">{s.from_member_name}</span>
                        <ArrowRight size={14} className="text-outline" />
                        <span className="font-semibold text-on-surface">{s.to_member_name}</span>
                        {getMemberPaymentMethods(s.to_member).length > 0 && (
                          <button
                            onClick={() => { setPaymentInfoMemberId(s.to_member); setPaymentInfoAmount(Number(s.amount)); }}
                            className="p-1 text-outline hover:text-primary hover:bg-primary-container/20 rounded-full transition-colors"
                            title="Payment info"
                          >
                            <Landmark size={14} />
                          </button>
                        )}
                        <span className="text-primary font-bold ml-1">
                          {formatCurrency(Number(s.amount), group.currency_code)}
                        </span>
                      </div>
                      <button
                        onClick={() => openTransferModal("settle_up", s.from_member, s.to_member, Number(s.amount))}
                        className="bg-primary hover:bg-primary-dim text-on-primary font-medium text-xs px-4 py-2 rounded-full transition-colors"
                      >
                        Settle Up
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
              </div>
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
                  {transferType === "settle_up" ? "Settle Up" : "Money Transfer"}
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
                <select
                  value={transferFrom}
                  onChange={(e) => setTransferFrom(e.target.value)}
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select person...</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">To</label>
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select person...</option>
                  {members.filter((m) => m.id !== transferFrom).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  Amount ({group.currency_code})
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
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
                  {transferring ? "Recording..." : transferType === "settle_up" ? "Settle Up" : "Record Transfer"}
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
