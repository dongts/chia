import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ImagePlus, Trash2, Loader2, X } from "lucide-react";
import { getExpense, updateExpense, uploadReceipt, deleteReceipt } from "@/api/expenses";
import { getGroup } from "@/api/groups";
import { listMembers } from "@/api/members";
import { listGroupCategories } from "@/api/categories";
import { listFunds } from "@/api/funds";
import type { Group, GroupMember, Category, SplitType, SplitInput, Expense, Fund } from "@/types";
import { cn } from "@/lib/utils";
import { formatAmount, formatCurrency } from "@/utils/currency";
import MemberSplitList from "@/components/expense/MemberSplitList";
import DatePicker from "@/components/DatePicker";
import SelectDropdown from "@/components/SelectDropdown";
import MoneyInput from "@/components/MoneyInput";

export default function EditExpense() {
  const { groupId, expenseId } = useParams<{ groupId: string; expenseId: string }>();
  const navigate = useNavigate();

  const [expense, setExpense] = useState<Expense | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundDeductions, setFundDeductions] = useState<Array<{ fundId: string; amount: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

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

  function addFundDeduction() {
    setFundDeductions((prev) => [...prev, { fundId: "", amount: "" }]);
  }

  function removeFundDeduction(index: number) {
    setFundDeductions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateFundDeduction(index: number, field: "fundId" | "amount", value: string) {
    setFundDeductions((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value } : d))
    );
  }

  const totalFundDeductions = fundDeductions.reduce(
    (sum, d) => sum + (parseFloat(d.amount) || 0), 0
  );

  const splittableAmount = Math.max(0, (parseFloat(amount) || 0) - totalFundDeductions);

  useEffect(() => {
    if (!groupId || !expenseId) return;
    listFunds(groupId).then((f) => setFunds(f.filter((fund) => fund.is_active)));
    getGroup(groupId).then((g) => setGroup(g));
    Promise.all([
      getExpense(groupId, expenseId),
      listMembers(groupId),
      listGroupCategories(groupId),
    ])
      .then(([exp, m, c]) => {
        setExpense(exp);
        setMembers(m);
        setCategories(c);
        setFundDeductions(
          (exp.fund_deductions || []).map((d) => ({
            fundId: d.fund_id,
            amount: String(d.amount),
          }))
        );
        setReceiptUrl(exp.receipt_url);

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
          exact[mem.id] = existingSplit ? String(parseFloat(String(existingSplit.resolved_amount))) : "";
          pct[mem.id] = existingSplit ? String(existingSplit.value) : "";
          shares[mem.id] = existingSplit ? String(existingSplit.value) : "0";
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
      if (Math.abs(total - splittableAmount) > 0.01) {
        window.alert(`Exact amounts must sum to ${formatAmount(splittableAmount, expense?.currency_code ?? undefined)}. Currently: ${formatAmount(total, expense?.currency_code ?? undefined)}`);
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
        fund_deductions: fundDeductions
          .filter((d) => d.fundId && parseFloat(d.amount) > 0)
          .map((d) => ({ fund_id: d.fundId, amount: parseFloat(d.amount) })),
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
            <MoneyInput value={amount} onChange={setAmount} required />
          </div>

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

        {/* Fund Deductions */}
        {funds.length > 0 && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Pay from funds</h2>
              <button
                type="button"
                onClick={addFundDeduction}
                disabled={fundDeductions.length >= funds.length}
                className="text-xs font-semibold text-primary hover:text-primary-dim disabled:opacity-40 transition-colors"
              >
                + Add fund
              </button>
            </div>

            {fundDeductions.length === 0 && (
              <p className="text-xs text-outline">No fund deductions — full amount will be split among members.</p>
            )}

            {fundDeductions.map((d, i) => {
              const selectedIds = fundDeductions.map((dd) => dd.fundId).filter((id) => id && id !== d.fundId);
              const availableFunds = funds.filter((f) => !selectedIds.includes(f.id));
              const selectedFund = funds.find((f) => f.id === d.fundId);
              const deductionExceedsBalance = selectedFund && parseFloat(d.amount) > selectedFund.balance;

              return (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <select
                      value={d.fundId}
                      onChange={(e) => updateFundDeduction(i, "fundId", e.target.value)}
                      className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors appearance-none cursor-pointer"
                    >
                      <option value="">Select fund...</option>
                      {availableFunds.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} (bal: {formatCurrency(f.balance, group?.currency_code || "VND")})
                        </option>
                      ))}
                    </select>
                    <MoneyInput
                      value={d.amount}
                      onChange={(v) => updateFundDeduction(i, "amount", v)}
                      placeholder="Amount from fund"
                    />
                    {deductionExceedsBalance && (
                      <p className="text-xs text-error">
                        Exceeds fund balance ({formatCurrency(selectedFund.balance, group?.currency_code || "VND")})
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFundDeduction(i)}
                    className="mt-2 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-error hover:bg-error-container/10 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}

            {fundDeductions.length > 0 && amount && (
              <div className="pt-2 border-t border-outline-variant/10">
                <div className="flex justify-between text-xs">
                  <span className="text-on-surface-variant">Total from funds:</span>
                  <span className="font-semibold text-on-surface">
                    {formatCurrency(totalFundDeductions, group?.currency_code || "VND")}
                  </span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-on-surface-variant">Amount to split:</span>
                  <span className={cn("font-semibold", splittableAmount < 0 ? "text-error" : "text-on-surface")}>
                    {formatCurrency(splittableAmount, group?.currency_code || "VND")}
                  </span>
                </div>
                {totalFundDeductions > (parseFloat(amount) || 0) && (
                  <p className="text-xs text-error mt-1">Total fund deductions exceed expense amount!</p>
                )}
              </div>
            )}
          </div>
        )}

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
            splittableAmount={String(splittableAmount)}
            currencyCode={expense?.currency_code ?? undefined}
            percentValues={percentValues}
            onPercentChange={(id, v) => setPercentValues((prev) => ({ ...prev, [id]: v }))}
            shareValues={shareValues}
            onShareChange={(id, v) => setShareValues((prev) => ({ ...prev, [id]: v }))}
          />
        </div>

        {/* Receipt / Image Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Receipt / Image</h2>
          {receiptUrl ? (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden border border-outline-variant/10">
                <img
                  src={receiptUrl}
                  alt="Receipt"
                  className="w-full max-h-64 object-contain bg-surface-container"
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!groupId || !expenseId) return;
                  if (!window.confirm("Remove receipt image?")) return;
                  setUploadingReceipt(true);
                  try {
                    await deleteReceipt(groupId, expenseId);
                    setReceiptUrl(null);
                  } catch {
                    window.alert("Failed to remove receipt");
                  } finally {
                    setUploadingReceipt(false);
                  }
                }}
                disabled={uploadingReceipt}
                className="flex items-center gap-2 text-error hover:text-error/80 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-error-container/10 transition-colors"
              >
                <Trash2 size={14} />
                Remove Image
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-outline-variant/30 rounded-xl cursor-pointer hover:border-primary/40 hover:bg-primary-container/5 transition-colors">
              {uploadingReceipt ? (
                <Loader2 size={24} className="text-primary animate-spin" />
              ) : (
                <ImagePlus size={24} className="text-outline" />
              )}
              <span className="text-xs text-on-surface-variant font-medium">
                {uploadingReceipt ? "Uploading..." : "Click to upload receipt image"}
              </span>
              <span className="text-[10px] text-outline">JPEG, PNG, or WebP</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !groupId || !expenseId) return;
                  setUploadingReceipt(true);
                  try {
                    const updated = await uploadReceipt(groupId, expenseId, file);
                    setReceiptUrl(updated.receipt_url);
                  } catch {
                    window.alert("Failed to upload receipt");
                  } finally {
                    setUploadingReceipt(false);
                  }
                }}
              />
            </label>
          )}
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
