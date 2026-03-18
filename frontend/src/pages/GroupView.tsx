import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Plus, Copy, Settings, ArrowLeft, Check } from "lucide-react";
import { getGroup } from "@/api/groups";
import { listExpenses, deleteExpense } from "@/api/expenses";
import { getBalances, getSuggestedSettlements, createSettlement, listSettlements } from "@/api/settlements";
import { listGroupCategories } from "@/api/categories";
import type { Group, Expense, Balance, SuggestedSettlement, Settlement, Category } from "@/types";
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
  const [tab, setTab] = useState<Tab>("expenses");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    loadAll();
  }, [groupId]);

  async function loadAll() {
    if (!groupId) return;
    setLoading(true);
    try {
      const [g, exp, bal, sug, set, cats] = await Promise.all([
        getGroup(groupId),
        listExpenses(groupId),
        getBalances(groupId),
        getSuggestedSettlements(groupId),
        listSettlements(groupId),
        listGroupCategories(groupId),
      ]);
      setGroup(g);
      setExpenses(exp);
      setBalances(bal);
      setSuggested(sug);
      setSettlements(set);
      setCategories(cats);
    } catch {
      window.alert("Failed to load group data");
    } finally {
      setLoading(false);
    }
  }

  function copyInviteCode() {
    if (!group) return;
    const link = `${window.location.origin}/join/${group.invite_code}`;
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
      });
      await loadAll();
    } catch {
      window.alert("Failed to record settlement");
    } finally {
      setSettlingId(null);
    }
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
        <Link
          to={`/groups/${groupId}/settings`}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <Settings size={20} />
        </Link>
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
          <div className="flex justify-end mb-4">
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
                    <span className="font-semibold text-gray-900">
                      {formatCurrency(Number(expense.amount), group.currency_code)}
                    </span>
                    <div className="flex gap-1">
                      <Link
                        to={`/groups/${groupId}/expenses/${expense.id}/edit`}
                        className="text-xs text-blue-500 hover:underline"
                      >
                        Edit
                      </Link>
                      <span className="text-gray-300">·</span>
                      <button
                        onClick={() => handleDeleteExpense(expense.id)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Delete
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
                      <p className="text-sm text-gray-700">
                        <span className="font-semibold">{s.from_member_name}</span>
                        {" pays "}
                        <span className="font-semibold">{s.to_member_name}</span>
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
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold">{s.from_member_name ?? "?"}</span>
                      {" paid "}
                      <span className="font-semibold">{s.to_member_name ?? "?"}</span>
                    </p>
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
    </div>
  );
}
