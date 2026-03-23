import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { createExpense } from "@/api/expenses";
import { getGroup } from "@/api/groups";
import { listMembers } from "@/api/members";
import { listGroupCategories } from "@/api/categories";
import { listGroupCurrencies } from "@/api/groupCurrencies";
import type { Group, GroupMember, GroupCurrencyRead, Category, SplitType, SplitInput } from "@/types";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/currency";
import CurrencySelect from "@/components/CurrencySelect";
import DatePicker from "@/components/DatePicker";
import SelectDropdown from "@/components/SelectDropdown";
import MemberSplitList from "@/components/expense/MemberSplitList";

export default function AddExpense() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allowedCurrencies, setAllowedCurrencies] = useState<GroupCurrencyRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [paidBy, setPaidBy] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [splitType, setSplitType] = useState<SplitType>("equal");

  // Split-specific state
  const [equalChecked, setEqualChecked] = useState<Record<string, boolean>>({});
  const [exactValues, setExactValues] = useState<Record<string, string>>({});
  const [percentValues, setPercentValues] = useState<Record<string, string>>({});
  const [shareValues, setShareValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!groupId) return;
    Promise.all([getGroup(groupId), listMembers(groupId), listGroupCategories(groupId), listGroupCurrencies(groupId)])
      .then(([g, m, c, gc]) => {
        setGroup(g);
        setCurrencyCode(g.currency_code);
        setMembers(m);
        setCategories(c);
        setAllowedCurrencies(gc);
        if (m.length > 0) {
          setPaidBy(m[0].id);
          const checked: Record<string, boolean> = {};
          const exact: Record<string, string> = {};
          const pct: Record<string, string> = {};
          const shares: Record<string, string> = {};
          const checkAll = m.length < 10;
          m.forEach((mem) => {
            checked[mem.id] = checkAll;
            exact[mem.id] = "";
            pct[mem.id] = "";
            shares[mem.id] = "1";
          });
          setEqualChecked(checked);
          setExactValues(exact);
          setPercentValues(pct);
          setShareValues(shares);
        }
        if (c.length > 0) setCategoryId(c[0].id);
      })
      .catch(() => window.alert("Failed to load group data"))
      .finally(() => setLoading(false));
  }, [groupId]);

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
        window.alert(`Exact amounts must sum to ${amount}. Currently: ${formatAmount(total, group?.currency_code)}`);
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
    if (!groupId) return;
    const splits = buildSplits();
    if (!splits) return;

    const isDifferentCurrency = group && currencyCode !== group.currency_code;

    setSubmitting(true);
    try {
      await createExpense(groupId, {
        description,
        amount: parseFloat(amount),
        currency_code: isDifferentCurrency ? currencyCode : undefined,
        exchange_rate: isDifferentCurrency && exchangeRate ? parseFloat(exchangeRate) : undefined,
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
        "Failed to create expense";
      window.alert(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 pt-4">
        <div className="bg-surface-container-high rounded-2xl h-12 animate-pulse" />
        <div className="bg-surface-container-high rounded-2xl h-48 animate-pulse" />
        <div className="bg-surface-container-high rounded-2xl h-32 animate-pulse" />
      </div>
    );
  }

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
        <h1 className="text-xl font-bold text-on-surface">Add Expense</h1>
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
              placeholder="e.g. Dinner at Roma"
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
              placeholder="0.00"
              className="w-full bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors"
            />
          </div>

          {/* Currency */}
          {allowedCurrencies.length > 0 && group && (
            <div>
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Currency</label>
              <CurrencySelect
                value={currencyCode}
                allowedCodes={[group.currency_code, ...allowedCurrencies.map((c) => c.currency_code)]}
                extraOptions={[{ code: group.currency_code, label: `${group.currency_code} — Main currency` }]}
                onChange={(code) => {
                  setCurrencyCode(code);
                  if (code === group.currency_code) {
                    setExchangeRate("");
                  } else {
                    const gc = allowedCurrencies.find((c) => c.currency_code === code);
                    setExchangeRate(gc ? String(gc.exchange_rate) : "");
                  }
                }}
              />
            </div>
          )}

          {/* Exchange rate */}
          {group && currencyCode && currencyCode !== group.currency_code && (
            <div>
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">
                Exchange rate
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-on-surface-variant whitespace-nowrap">1 {currencyCode} =</span>
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors"
                />
                <span className="text-sm text-on-surface-variant">{group.currency_code}</span>
              </div>
              {amount && exchangeRate && parseFloat(exchangeRate) > 0 && (
                <p className="text-xs text-on-surface-variant mt-1.5">
                  ≈ {formatAmount(parseFloat(amount) * parseFloat(exchangeRate), group.currency_code)} {group.currency_code}
                </p>
              )}
              <p className="text-xs text-outline mt-1">
                Pre-filled from default rate. Edit if needed.
              </p>
            </div>
          )}

          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">Date</label>
            <DatePicker value={date} onChange={setDate} />
          </div>
        </div>

        {/* Paid By Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Paid by</h2>
          <SelectDropdown
            value={paidBy}
            onChange={setPaidBy}
            searchable={members.length > 5}
            options={members.map((m) => ({
              value: m.id,
              label: m.display_name,
              icon: m.display_name[0]?.toUpperCase(),
            }))}
            placeholder="Select person..."
          />
        </div>

        {/* Category Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Category</h2>
          <SelectDropdown
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({
              value: c.id,
              label: c.name,
              icon: c.icon,
            }))}
            placeholder="Select category..."
          />
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
            currencyCode={group?.currency_code}
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
            {submitting ? "Adding..." : "Add Expense"}
          </button>
        </div>
      </form>
    </div>
  );
}
