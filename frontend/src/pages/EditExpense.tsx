import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar } from "lucide-react";
import { getExpense, updateExpense } from "@/api/expenses";
import { listMembers } from "@/api/members";
import { listGroupCategories } from "@/api/categories";
import type { GroupMember, Category, SplitType, SplitInput, Expense } from "@/types";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/currency";
import MemberSplitList from "@/components/expense/MemberSplitList";

export default function EditExpense() {
  const { groupId, expenseId } = useParams<{ groupId: string; expenseId: string }>();
  const navigate = useNavigate();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [splitType, setSplitType] = useState<SplitType>("equal");

  // Split-specific state
  const [equalChecked, setEqualChecked] = useState<Record<string, boolean>>({});
  const [exactValues, setExactValues] = useState<Record<string, string>>({});
  const [percentValues, setPercentValues] = useState<Record<string, string>>({});
  const [shareValues, setShareValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!groupId || !expenseId) return;
    Promise.all([
      getExpense(groupId, expenseId),
      listMembers(groupId),
      listGroupCategories(groupId),
    ])
      .then(([exp, m, c]) => {
        setExpense(exp);
        setMembers(m);
        setCategories(c);

        // Pre-fill form
        setDescription(exp.description);
        setAmount(String(exp.amount));
        setDate(exp.date);
        setPaidBy(exp.paid_by);
        setCategoryId(exp.category_id);
        setSplitType(exp.splits[0]?.split_type ?? "equal");

        const checked: Record<string, boolean> = {};
        const exact: Record<string, string> = {};
        const pct: Record<string, string> = {};
        const shares: Record<string, string> = {};

        m.forEach((mem) => {
          const existingSplit = exp.splits.find((s) => s.group_member_id === mem.id);
          checked[mem.id] = !!existingSplit;
          exact[mem.id] = existingSplit ? String(existingSplit.resolved_amount) : "";
          pct[mem.id] = existingSplit ? String(existingSplit.value) : "";
          shares[mem.id] = existingSplit ? String(existingSplit.value) : "1";
        });

        setEqualChecked(checked);
        setExactValues(exact);
        setPercentValues(pct);
        setShareValues(shares);
      })
      .catch(() => window.alert("Failed to load expense"))
      .finally(() => setLoading(false));
  }, [groupId, expenseId]);

  function buildSplits(): SplitInput[] | null {
    if (splitType === "equal") {
      const selected = members.filter((m) => equalChecked[m.id]);
      if (selected.length === 0) {
        window.alert("Select at least one member for splitting");
        return null;
      }
      const each = 1 / selected.length;
      return selected.map((m) => ({ group_member_id: m.id, value: each }));
    }

    if (splitType === "exact") {
      const splits = members
        .map((m) => ({ group_member_id: m.id, value: parseFloat(exactValues[m.id] || "0") }))
        .filter((s) => s.value > 0);
      const total = splits.reduce((a, b) => a + b.value, 0);
      const amtNum = parseFloat(amount);
      if (Math.abs(total - amtNum) > 0.01) {
        window.alert(`Exact amounts must sum to ${amount}. Currently: ${formatAmount(total, expense?.currency_code ?? undefined)}`);
        return null;
      }
      return splits;
    }

    if (splitType === "percentage") {
      const splits = members
        .map((m) => ({ group_member_id: m.id, value: parseFloat(percentValues[m.id] || "0") }))
        .filter((s) => s.value > 0);
      const total = splits.reduce((a, b) => a + b.value, 0);
      if (Math.abs(total - 100) > 0.01) {
        window.alert(`Percentages must sum to 100. Currently: ${total.toFixed(2)}`);
        return null;
      }
      return splits;
    }

    if (splitType === "shares") {
      const splits = members
        .map((m) => ({ group_member_id: m.id, value: parseFloat(shareValues[m.id] || "0") }))
        .filter((s) => s.value > 0);
      if (splits.length === 0) {
        window.alert("Enter shares for at least one member");
        return null;
      }
      return splits;
    }

    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!groupId || !expenseId) return;
    const splits = buildSplits();
    if (!splits) return;

    setSubmitting(true);
    try {
      await updateExpense(groupId, expenseId, {
        description,
        amount: parseFloat(amount),
        date,
        paid_by: paidBy,
        category_id: categoryId,
        split_type: splitType,
        splits,
      });
      navigate(`/groups/${groupId}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to update expense";
      window.alert(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !expense) {
    return (
      <div className="max-w-lg mx-auto space-y-4 pt-4">
        <div className="bg-surface-container-high rounded-2xl h-12 animate-pulse" />
        <div className="bg-surface-container-high rounded-2xl h-48 animate-pulse" />
        <div className="bg-surface-container-high rounded-2xl h-32 animate-pulse" />
      </div>
    );
  }

  const selectedPayer = members.find((m) => m.id === paidBy);

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(`/groups/${groupId}`)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-bold text-on-surface">Edit Expense</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Main Details Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Details</h2>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">
              Description <span className="text-error">*</span>
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors"
            />
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">
              Amount <span className="text-error">*</span>
            </label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors"
            />
          </div>

          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Date</label>
            <div className="relative">
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
              <Calendar size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Paid By Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Paid by</h2>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary pointer-events-none">
              {selectedPayer?.display_name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="w-full bg-surface-container-high/50 border-0 rounded-xl pl-12 pr-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer hover:bg-surface-container-high/70 transition-colors"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Category Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Category</h2>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer hover:bg-surface-container-high/70 transition-colors"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Split Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Split type</h2>
          <div className="flex gap-1 bg-surface-container rounded-xl p-1">
            {(["equal", "exact", "percentage", "shares"] as SplitType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSplitType(t)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-colors",
                  splitType === t
                    ? "bg-surface-container-lowest text-on-surface shadow-editorial"
                    : "text-on-surface-variant hover:text-on-surface"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <MemberSplitList
            members={members}
            splitType={splitType}
            equalChecked={equalChecked}
            onEqualToggle={(id) => setEqualChecked((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))}
            onSelectAll={() => { const u = { ...equalChecked }; members.forEach((m) => { u[m.id] = true; }); setEqualChecked(u); }}
            onSelectNone={() => { const u = { ...equalChecked }; members.forEach((m) => { u[m.id] = false; }); setEqualChecked(u); }}
            exactValues={exactValues}
            onExactChange={(id, v) => setExactValues((prev) => ({ ...prev, [id]: v }))}
            totalAmount={amount}
            currencyCode={expense?.currency_code ?? undefined}
            percentValues={percentValues}
            onPercentChange={(id, v) => setPercentValues((prev) => ({ ...prev, [id]: v }))}
            shareValues={shareValues}
            onShareChange={(id, v) => setShareValues((prev) => ({ ...prev, [id]: v }))}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2 pb-6">
          <button
            type="button"
            onClick={() => navigate(`/groups/${groupId}`)}
            className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold py-3 rounded-full text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full text-sm transition-colors"
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
