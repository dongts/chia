import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, X, Sparkles, FileText, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createExpense, uploadReceipt } from "@/api/expenses";
import { parseExpense } from "@/api/expenseParse";
import { getGroup } from "@/api/groups";
import { listMembers } from "@/api/members";
import { listGroupCategories } from "@/api/categories";
import { listGroupCurrencies } from "@/api/groupCurrencies";
import { listFunds } from "@/api/funds";
import type { Group, GroupMember, GroupCurrencyRead, Category, SplitType, SplitInput, Fund } from "@/types";
import { cn } from "@/lib/utils";
import { formatAmount, formatCurrency } from "@/utils/currency";
import CurrencySelect from "@/components/CurrencySelect";
import DatePicker from "@/components/DatePicker";
import SelectDropdown from "@/components/SelectDropdown";
import MoneyInput from "@/components/MoneyInput";
import MemberSplitList from "@/components/expense/MemberSplitList";

export default function AddExpense() {
  const { t } = useTranslation("expense");
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allowedCurrencies, setAllowedCurrencies] = useState<GroupCurrencyRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundDeductions, setFundDeductions] = useState<Array<{ fundId: string; amount: string }>>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

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

  const [nlText, setNlText] = useState("");
  const [nlParsing, setNlParsing] = useState(false);
  const [nlHidden, setNlHidden] = useState(false);
  const [nlExpanded, setNlExpanded] = useState(false);
  const nlInputRef = useRef<HTMLInputElement>(null);

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
    if (!groupId) return;
    listFunds(groupId).then((f) => setFunds(f.filter((fund) => fund.is_active)));
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
            shares[mem.id] = "0";
          });
          setEqualChecked(checked);
          setExactValues(exact);
          setPercentValues(pct);
          setShareValues(shares);
        }
        if (c.length > 0) setCategoryId(c[0].id);
      })
      .catch(() => window.alert(t("failed_to_load", { ns: "common" })))
      .finally(() => setLoading(false));
  }, [groupId]);

  function buildSplits(): SplitInput[] | null {
    if (splitType === "equal") {
      const selected = members.filter((m) => equalChecked[m.id]);
      if (selected.length === 0) {
        window.alert(t("validation.select_member"));
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
        window.alert(t("validation.exact_sum", { target: formatAmount(splittableAmount, group?.currency_code), current: formatAmount(total, group?.currency_code) }));
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
        window.alert(t("validation.percent_sum", { current: total.toFixed(2) }));
        return null;
      }
      return splits;
    }

    if (splitType === "shares") {
      const splits = members
        .map((m) => ({ group_member_id: m.id, value: parseFloat(shareValues[m.id] || "0") }))
        .filter((s) => s.value > 0);
      if (splits.length === 0) {
        window.alert(t("validation.shares_required"));
        return null;
      }
      return splits;
    }

    return null;
  }

  const handleNlParse = async () => {
    if (!groupId || !nlText.trim()) return;
    setNlParsing(true);
    try {
      const draft = await parseExpense(groupId, nlText.trim());
      if (draft.description) setDescription(draft.description);
      if (draft.amount != null) setAmount(String(draft.amount));
      if (draft.date) setDate(draft.date);
      if (draft.paid_by_member_id) setPaidBy(draft.paid_by_member_id);
      if (draft.category_id) setCategoryId(draft.category_id);
      if (draft.currency_code) setCurrencyCode(draft.currency_code);
      if (draft.split_type) setSplitType(draft.split_type as SplitType);

      // Pre-fill equal split checkboxes from returned splits
      if (draft.splits && draft.splits.length > 0) {
        if (!draft.split_type || draft.split_type === "equal") {
          const checked: Record<string, boolean> = {};
          members.forEach((m) => { checked[m.id] = false; });
          draft.splits.forEach((s) => { checked[s.group_member_id] = true; });
          setEqualChecked(checked);
        } else if (draft.split_type === "exact") {
          const exact: Record<string, string> = {};
          members.forEach((m) => { exact[m.id] = ""; });
          draft.splits.forEach((s) => { exact[s.group_member_id] = String(s.value); });
          setExactValues(exact);
        } else if (draft.split_type === "percentage") {
          const pct: Record<string, string> = {};
          members.forEach((m) => { pct[m.id] = ""; });
          draft.splits.forEach((s) => { pct[s.group_member_id] = String(s.value); });
          setPercentValues(pct);
        } else if (draft.split_type === "shares") {
          const shares: Record<string, string> = {};
          members.forEach((m) => { shares[m.id] = "0"; });
          draft.splits.forEach((s) => { shares[s.group_member_id] = String(s.value); });
          setShareValues(shares);
        }
      }

      // Pre-fill fund deductions
      if (draft.fund_deductions && draft.fund_deductions.length > 0) {
        setFundDeductions(
          draft.fund_deductions.map((fd) => ({
            fundId: fd.fund_id,
            amount: String(fd.amount),
          }))
        );
      }

      setNlText("");
      setNlExpanded(false);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr.response?.status === 503) {
        setNlHidden(true);
        window.alert(t("ai_input.error_not_configured"));
      } else {
        window.alert(t("ai_input.error_parse"));
      }
    } finally {
      setNlParsing(false);
    }
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!groupId) return;
    const splits = buildSplits();
    if (!splits) return;

    const isDifferentCurrency = group && currencyCode !== group.currency_code;

    setSubmitting(true);
    try {
      const created = await createExpense(groupId, {
        description,
        amount: parseFloat(amount),
        currency_code: isDifferentCurrency ? currencyCode : undefined,
        exchange_rate: isDifferentCurrency && exchangeRate ? parseFloat(exchangeRate) : undefined,
        date,
        paid_by: paidBy,
        category_id: categoryId,
        fund_deductions: fundDeductions
          .filter((d) => d.fundId && parseFloat(d.amount) > 0)
          .map((d) => ({ fund_id: d.fundId, amount: parseFloat(d.amount) })),
        split_type: splitType,
        splits,
      });
      if (receiptFile) {
        try {
          await uploadReceipt(groupId, created.id, receiptFile);
        } catch {
          // Expense created but receipt failed — not critical
        }
      }
      navigate(`/groups/${groupId}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        t("failed_to_load", { ns: "common" });
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
    <div className="max-w-lg lg:max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(`/groups/${groupId}`)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-on-surface">{t("add_title")}</h1>
          <button
            onClick={() => navigate(`/groups/${groupId}`, { state: { openTransfer: true } })}
            className="text-xs text-outline hover:text-primary transition-colors"
          >
            {t("transfer_hint")}
          </button>
        </div>
      </div>

      {!nlHidden && (
        <div
          className={cn(
            "mb-6 transition-all duration-300 ease-out",
            nlExpanded
              ? "bg-gradient-to-r from-primary-container/10 via-tertiary-container/10 to-primary-container/10 rounded-2xl shadow-editorial p-5 relative overflow-hidden"
              : "cursor-pointer"
          )}
        >
          {nlExpanded && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_3s_ease-in-out_infinite]" />
          )}

          {!nlExpanded ? (
            <div
              onClick={() => { setNlExpanded(true); setTimeout(() => nlInputRef.current?.focus(), 100); }}
              className="flex items-center gap-2.5 bg-surface-container-lowest/80 border border-outline-variant/20 rounded-xl px-4 py-3 hover:border-primary/30 transition-colors group"
            >
              <Sparkles size={15} className="text-primary/60 group-hover:text-primary transition-colors" />
              <span className="text-sm text-outline group-hover:text-on-surface-variant transition-colors">{t("ai_input.collapsed")}</span>
            </div>
          ) : (
            <div className="relative">
              <label className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Sparkles size={14} className="text-primary animate-pulse" />
                <span className="bg-gradient-to-r from-primary to-tertiary bg-clip-text text-transparent">{t("ai_input.label")}</span>
              </label>
              <div className="flex gap-2">
                <input
                  ref={nlInputRef}
                  type="text"
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleNlParse(); }
                    if (e.key === "Escape" && !nlText.trim()) { setNlExpanded(false); }
                  }}
                  onBlur={() => { if (!nlText.trim() && !nlParsing) setNlExpanded(false); }}
                  placeholder={t("ai_input.placeholder")}
                  className="flex-1 bg-surface-container-lowest/80 border border-primary/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:border-primary/40 transition-colors"
                  disabled={nlParsing}
                />
                <button
                  type="button"
                  onClick={handleNlParse}
                  disabled={nlParsing || !nlText.trim()}
                  className="px-4 py-3 bg-primary text-on-primary rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {nlParsing ? (
                    <><div className="w-3.5 h-3.5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" /> {t("ai_input.parsing")}</>
                  ) : (
                    <><Sparkles size={14} /> {t("ai_input.parse")}</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-6 lg:space-y-0">
        {/* Left Column */}
        <div className="space-y-6">
        {/* Compact Details Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5 space-y-3">
          {/* Row 1: Description + Category + Receipt */}
          <div>
            <span className="text-[10px] font-medium text-outline uppercase tracking-wider">{t("description")}</span>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("description_placeholder")}
                className="flex-1 min-w-0 bg-surface-container-high/50 border-0 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors"
              />
              <SelectDropdown
                value={categoryId}
                onChange={setCategoryId}
                options={categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                  icon: c.icon,
                }))}
                placeholder="📦"
                compact
              />
              {receiptFile ? (
                <button
                  type="button"
                  onClick={() => { setReceiptFile(null); setReceiptPreview(null); }}
                  className="w-12 h-12 flex-shrink-0 rounded-xl border border-primary/30 bg-primary-container/10 flex items-center justify-center text-primary hover:bg-error-container/20 hover:text-error hover:border-error/30 transition-colors relative overflow-hidden"
                  title={receiptFile.name}
                >
                  {receiptPreview ? (
                    <img src={receiptPreview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
                  ) : (
                    <FileText size={18} className="text-primary/60 absolute" />
                  )}
                  <X size={16} className="relative z-10" />
                </button>
              ) : (
                <label className="w-12 h-12 flex-shrink-0 rounded-xl bg-surface-container-high/50 flex items-center justify-center cursor-pointer hover:bg-surface-container-high/70 transition-colors text-outline hover:text-on-surface-variant">
                  <Paperclip size={18} />
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setReceiptFile(file);
                      setReceiptPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Row 2: Currency + Amount */}
          <div>
            <span className="text-[10px] font-medium text-outline uppercase tracking-wider">{t("amount")}</span>
            <div className="flex gap-2 mt-1">
              <div className="w-20 flex-shrink-0">
                {allowedCurrencies.length > 0 && group ? (
                  <CurrencySelect
                    value={currencyCode}
                    allowedCodes={[group.currency_code, ...allowedCurrencies.map((c) => c.currency_code)]}
                    extraOptions={[{ code: group.currency_code, label: `${group.currency_code} — Main` }]}
                    onChange={(code) => {
                      setCurrencyCode(code);
                      if (code === group.currency_code) {
                        setExchangeRate("");
                      } else {
                        const gc = allowedCurrencies.find((c) => c.currency_code === code);
                        setExchangeRate(gc ? String(gc.exchange_rate) : "");
                      }
                    }}
                    compact
                  />
                ) : (
                  <div className="h-12 bg-surface-container-high/50 rounded-xl px-3 flex items-center justify-center text-sm text-on-surface-variant font-medium">
                    {group?.currency_code || "---"}
                  </div>
                )}
              </div>
              <div className="flex-1">
                <MoneyInput value={amount} onChange={setAmount} required placeholder="0" />
              </div>
            </div>
          </div>

          {/* Exchange rate (conditional) */}
          {group && currencyCode && currencyCode !== group.currency_code && (
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs text-on-surface-variant whitespace-nowrap">1 {currencyCode} =</span>
              <input
                type="number"
                min="0.000001"
                step="any"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                placeholder="0.00"
                className="w-24 bg-surface-container-high/50 border-0 rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
              />
              <span className="text-xs text-on-surface-variant">{group.currency_code}</span>
              {amount && exchangeRate && parseFloat(exchangeRate) > 0 && (
                <span className="text-xs text-outline ml-auto">
                  ≈ {formatAmount(parseFloat(amount) * parseFloat(exchangeRate), group.currency_code)}
                </span>
              )}
            </div>
          )}

          {/* Row 3: Paid by + Date */}
          <div className="flex gap-2">
            <div className="flex-[3]">
              <span className="text-[10px] font-medium text-outline uppercase tracking-wider">{t("paid_by")}</span>
              <div className="mt-1">
                <SelectDropdown
                  value={paidBy}
                  onChange={setPaidBy}
                  searchable={members.length > 5}
                  options={members.map((m) => ({
                    value: m.id,
                    label: m.display_name,
                    icon: m.display_name[0]?.toUpperCase(),
                  }))}
                  placeholder={t("select_person")}
                />
              </div>
            </div>
            <div className="flex-[2]">
              <span className="text-[10px] font-medium text-outline uppercase tracking-wider">{t("date")}</span>
              <div className="mt-1">
                <DatePicker value={date} onChange={setDate} />
              </div>
            </div>
          </div>

          {/* Receipt preview (if uploaded) */}
          {receiptFile && (
            <div className="relative rounded-xl overflow-hidden border border-outline-variant/10">
              {receiptPreview ? (
                <img src={receiptPreview} alt="Receipt preview" className="w-full max-h-32 object-contain bg-surface-container" />
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 bg-surface-container">
                  <FileText size={16} className="text-outline" />
                  <span className="text-xs text-on-surface-variant truncate">{receiptFile.name}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fund Deductions */}
        {funds.length > 0 && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">{t("fund_deductions")}</h2>
              <button
                type="button"
                onClick={addFundDeduction}
                disabled={fundDeductions.length >= funds.length}
                className="text-xs font-semibold text-primary hover:text-primary-dim disabled:opacity-40 transition-colors"
              >
                {t("add_fund")}
              </button>
            </div>

            {fundDeductions.length === 0 && (
              <p className="text-xs text-outline">{t("no_fund_deductions")}</p>
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
                      <option value="">{t("select_fund")}</option>
                      {availableFunds.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} (bal: {formatCurrency(f.balance, group?.currency_code || "VND")})
                        </option>
                      ))}
                    </select>
                    <MoneyInput
                      value={d.amount}
                      onChange={(v) => updateFundDeduction(i, "amount", v)}
                      placeholder={t("amount_from_fund")}
                    />
                    {deductionExceedsBalance && (
                      <p className="text-xs text-error">
                        {t("exceeds_fund_balance", { balance: formatCurrency(selectedFund.balance, group?.currency_code || "VND") })}
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
                  <span className="text-on-surface-variant">{t("total_from_funds")}:</span>
                  <span className="font-semibold text-on-surface">
                    {formatCurrency(totalFundDeductions, group?.currency_code || "VND")}
                  </span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-on-surface-variant">{t("amount_to_split")}:</span>
                  <span className={cn("font-semibold", splittableAmount < 0 ? "text-error" : "text-on-surface")}>
                    {formatCurrency(splittableAmount, group?.currency_code || "VND")}
                  </span>
                </div>
                {totalFundDeductions > (parseFloat(amount) || 0) && (
                  <p className="text-xs text-error mt-1">{t("exceeds_expense")}</p>
                )}
              </div>
            )}
          </div>
        )}

        </div>{/* End Left Column */}

        {/* Right Column */}
        <div className="space-y-6">
        {/* Split Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-6 space-y-4">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">{t("split_type")}</h2>
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
            currencyCode={group?.currency_code}
            percentValues={percentValues}
            onPercentChange={(id, v) => setPercentValues((prev) => ({ ...prev, [id]: v }))}
            shareValues={shareValues}
            onShareChange={(id, v) => setShareValues((prev) => ({ ...prev, [id]: v }))}
          />
        </div>

        </div>{/* End Right Column */}
        </div>{/* End Grid */}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2 pb-6 mt-6 lg:mt-8 lg:max-w-md lg:mx-auto">
          <button
            type="button"
            onClick={() => navigate(`/groups/${groupId}`)}
            className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold py-3 rounded-full text-sm transition-colors"
          >
            {t("split_cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-primary hover:bg-primary-dim disabled:opacity-60 text-on-primary font-semibold py-3 rounded-full text-sm transition-colors"
          >
            {submitting ? t("adding") : t("add_expense")}
          </button>
        </div>
      </form>
    </div>
  );
}
