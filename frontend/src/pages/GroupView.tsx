import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Plus, Copy, Settings, ArrowLeft, Check, BarChart3, Pencil, Trash2, ArrowLeftRight, List, LayoutGrid, Landmark } from "lucide-react";
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

  // Transfer modal
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
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

  async function handleSettle(s: SuggestedSettlement) {
    if (!groupId) return;
    const key = `${s.from_member}-${s.to_member}`;
    setSettlingId(key);
    try {
      await createSettlement(groupId, {
        from_member: s.from_member,
        to_member: s.to_member,
        amount: s.amount,
        type: "settle_up",
      });
      await loadAll();
    } catch {
      window.alert("Failed to record settlement");
    } finally {
      setSettlingId(null);
    }
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
        type: "transfer",
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

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-100 rounded w-1/4" />
      </div>
    );
  }

  if (!group) return null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="mt-1 text-gray-400 hover:text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{group.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                {group.currency_code}
              </span>
              <span className="text-xs text-gray-500">{group.member_count ?? "?"} members</span>
              <button
                onClick={copyInviteCode}
                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied!" : "Copy invite link"}
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to={`/groups/${groupId}/reports`}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            title="Reports"
          >
            <BarChart3 size={20} />
          </Link>
          <Link
            to={`/groups/${groupId}/settings`}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            title="Settings"
          >
            <Settings size={20} />
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
        {(["expenses", "balances", "settlements"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors",
              tab === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Expenses Tab */}
      {tab === "expenses" && (
        <div>
          <div className="flex justify-end gap-2 mb-4">
            <button
              onClick={() => {
                const next = !compactView;
                setCompactView(next);
                localStorage.setItem("chia-compact-view", String(next));
              }}
              className={cn(
                "p-2 rounded-lg border transition-colors",
                compactView
                  ? "border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
                  : "border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              )}
              title={compactView ? "Card view" : "Compact view"}
            >
              {compactView ? <LayoutGrid size={16} /> : <List size={16} />}
            </button>
            <button
              onClick={() => setShowTransfer(true)}
              className="flex items-center gap-2 border border-green-600 text-green-700 hover:bg-green-50 font-medium px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <ArrowLeftRight size={16} />
              Transfer
            </button>
            <Link
              to={`/groups/${groupId}/add-expense`}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <Plus size={16} />
              Add Expense
            </Link>
          </div>
          {expenses.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-4xl mb-3">🧾</p>
              <p className="font-medium text-gray-700">No expenses yet</p>
              <p className="text-sm mt-1">Add the first expense for this group</p>
            </div>
          ) : compactView ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Expense</th>
                    <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Paid by</th>
                    <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Date</th>
                    <th className="px-3 py-2.5 font-medium text-right">Amount</th>
                    <th className="px-3 py-2.5 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base flex-shrink-0">{getCategoryIcon(expense.category_id)}</span>
                          <span className="font-medium text-gray-900 truncate">{expense.description}</span>
                        </div>
                        <p className="text-xs text-gray-400 sm:hidden mt-0.5">
                          {expense.payer_name ?? "Unknown"} · {new Date(expense.date).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-gray-600 hidden sm:table-cell">{expense.payer_name ?? "Unknown"}</td>
                      <td className="px-3 py-2 text-gray-400 hidden sm:table-cell">{new Date(expense.date).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">
                        {expense.currency_code !== group.currency_code ? (
                          <div>
                            <span>{formatCurrency(Number(expense.amount), expense.currency_code)}</span>
                            <p className="text-xs text-gray-400 font-normal">≈ {formatCurrency(Number(expense.converted_amount), group.currency_code)}</p>
                          </div>
                        ) : (
                          formatCurrency(Number(expense.amount), group.currency_code)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-0.5 justify-end">
                          <Link to={`/groups/${groupId}/expenses/${expense.id}/edit`}
                            className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit">
                            <Pencil size={13} />
                          </Link>
                          <button onClick={() => handleDeleteExpense(expense.id)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
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
            <div className="space-y-3">
              {expenses.map((expense) => (
                <div
                  key={expense.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4"
                >
                  <div className="text-2xl w-10 text-center flex-shrink-0">
                    {getCategoryIcon(expense.category_id)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{expense.description}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Paid by <span className="font-medium">{expense.payer_name ?? "Unknown"}</span>{" "}
                      · {new Date(expense.date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      {expense.currency_code !== group.currency_code ? (
                        <>
                          <span className="font-semibold text-gray-900">
                            {formatCurrency(Number(expense.amount), expense.currency_code)}
                          </span>
                          <p className="text-xs text-gray-400">
                            ≈ {formatCurrency(Number(expense.converted_amount), group.currency_code)}
                          </p>
                        </>
                      ) : (
                        <span className="font-semibold text-gray-900">
                          {formatCurrency(Number(expense.amount), group.currency_code)}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Link
                        to={`/groups/${groupId}/expenses/${expense.id}/edit`}
                        className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={15} />
                      </Link>
                      <button
                        onClick={() => handleDeleteExpense(expense.id)}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Balances Tab */}
      {tab === "balances" && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Member Balances
            </h3>
            {balances.length === 0 ? (
              <p className="text-sm text-gray-400">No balances yet</p>
            ) : (
              <div className="space-y-2">
                {balances.map((b) => (
                  <div
                    key={b.member_id}
                    className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
                        {b.member_name[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium text-gray-800">{b.member_name}</span>
                      {getMemberPaymentMethods(b.member_id).length > 0 && (
                        <button
                          onClick={() => { setPaymentInfoMemberId(b.member_id); setPaymentInfoAmount(undefined); }}
                          className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Payment info"
                        >
                          <Landmark size={14} />
                        </button>
                      )}
                    </div>
                    <span
                      className={cn(
                        "font-semibold",
                        Number(b.balance) > 0
                          ? "text-green-600"
                          : Number(b.balance) < 0
                          ? "text-red-500"
                          : "text-gray-400"
                      )}
                    >
                      {Number(b.balance) > 0 ? "+" : ""}
                      {formatCurrency(Number(b.balance), group.currency_code)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {suggested.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Suggested Settlements
              </h3>
              <div className="space-y-2">
                {suggested.map((s) => {
                  const key = `${s.from_member}-${s.to_member}`;
                  return (
                    <div
                      key={key}
                      className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between"
                    >
                      <p className="text-sm text-gray-700 flex items-center gap-1 flex-wrap">
                        <span className="font-semibold">{s.from_member_name}</span>
                        {" pays "}
                        <span className="font-semibold">{s.to_member_name}</span>
                        {getMemberPaymentMethods(s.to_member).length > 0 && (
                          <button
                            onClick={() => { setPaymentInfoMemberId(s.to_member); setPaymentInfoAmount(Number(s.amount)); }}
                            className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Payment info"
                          >
                            <Landmark size={14} />
                          </button>
                        )}
                        {" "}
                        <span className="text-green-700 font-semibold">
                          {formatCurrency(Number(s.amount), group.currency_code)}
                        </span>
                      </p>
                      <button
                        onClick={() => handleSettle(s)}
                        disabled={settlingId === key}
                        className="ml-4 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {settlingId === key ? "..." : "Mark Settled"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settlements Tab */}
      {tab === "settlements" && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Settlement History
          </h3>
          {settlements.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-4xl mb-3">✅</p>
              <p className="font-medium text-gray-700">No settlements recorded</p>
            </div>
          ) : (
            <div className="space-y-2">
              {settlements.map((s) => (
                <div
                  key={s.id}
                  className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      {s.type === "transfer" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          <ArrowLeftRight size={10} /> Transfer
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                          <Check size={10} /> Settle up
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mt-1">
                      <span className="font-semibold">{s.from_member_name ?? "?"}</span>
                      {" → "}
                      <span className="font-semibold">{s.to_member_name ?? "?"}</span>
                    </p>
                    {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(s.settled_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-semibold text-green-700">
                    {formatCurrency(Number(s.amount), group.currency_code)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Transfer modal */}
      {showTransfer && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowTransfer(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-5">
              <ArrowLeftRight size={20} className="text-green-600" />
              <h3 className="text-lg font-bold text-gray-900">Money Transfer</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
                <select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Select person...</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Select person...</option>
                  {members.filter((m) => m.id !== transferFrom).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </select>
                {transferTo && getMemberPaymentMethods(transferTo).length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-gray-500 mb-1">Payment info</p>
                    <PaymentMethodCards
                      methods={getMemberPaymentMethods(transferTo).map((pm) => pm.payment_method)}
                      compact
                      amount={transferAmount ? parseFloat(transferAmount) : undefined}
                      qrMessage={`Chia: ${group.name}`}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount ({group.currency_code})</label>
                <input type="number" min="0.01" step="0.01" value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)} placeholder="0.00"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={transferNote} onChange={(e) => setTransferNote(e.target.value)}
                  placeholder="e.g. Cash payment, bank transfer..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowTransfer(false)}
                className="flex-1 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleTransfer}
                disabled={transferring || !transferFrom || !transferTo || !transferAmount}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm">
                {transferring ? "Recording..." : "Record Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}
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
