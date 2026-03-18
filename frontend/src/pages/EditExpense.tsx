import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getExpense, updateExpense } from "@/api/expenses";
import { listMembers } from "@/api/members";
import { listGroupCategories } from "@/api/categories";
import type { GroupMember, Category, SplitType, SplitInput, Expense } from "@/types";
import { cn } from "@/lib/utils";

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
        window.alert(`Exact amounts must sum to ${amount}. Currently: ${total.toFixed(2)}`);
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

  if (loading || !expense) return <div className="animate-pulse h-8 bg-gray-200 rounded w-1/3" />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/groups/${groupId}`)} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Edit Expense</h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-lg space-y-5">
        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Amount <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Paid by */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Paid by</label>
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Split type tabs */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Split type</label>
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
            {(["equal", "exact", "percentage", "shares"] as SplitType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSplitType(t)}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors",
                  splitType === t
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {splitType === "equal" && (
            <div className="space-y-2">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={equalChecked[m.id] ?? true}
                    onChange={(e) =>
                      setEqualChecked((prev) => ({ ...prev, [m.id]: e.target.checked }))
                    }
                    className="w-4 h-4 accent-green-600"
                  />
                  <span className="text-sm text-gray-700">{m.display_name}</span>
                </label>
              ))}
            </div>
          )}

          {splitType === "exact" && (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-32 truncate">{m.display_name}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={exactValues[m.id] ?? ""}
                    onChange={(e) =>
                      setExactValues((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="0.00"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              ))}
            </div>
          )}

          {splitType === "percentage" && (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-32 truncate">{m.display_name}</span>
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={percentValues[m.id] ?? ""}
                      onChange={(e) =>
                        setPercentValues((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                      placeholder="0"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-400">
                Sum:{" "}
                {Object.values(percentValues)
                  .reduce((a, v) => a + parseFloat(v || "0"), 0)
                  .toFixed(1)}
                % (must be 100)
              </p>
            </div>
          )}

          {splitType === "shares" && (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-32 truncate">{m.display_name}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={shareValues[m.id] ?? "1"}
                    onChange={(e) =>
                      setShareValues((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="1"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                  <span className="text-sm text-gray-500">share(s)</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(`/groups/${groupId}`)}
            className="flex-1 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
