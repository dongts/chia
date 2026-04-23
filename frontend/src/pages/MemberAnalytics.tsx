import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRightLeft, MoreVertical } from "lucide-react";
import client from "@/api/client";
import { formatCurrency } from "@/utils/currency";
import { cn } from "@/lib/utils";

// --- Types ---

interface CategoryAmount {
  category_name: string;
  category_icon: string;
  total_amount: number;
}

interface RecentPaid {
  id: string;
  description: string;
  amount: number;
  currency_code: string;
  category_name: string;
  category_icon: string;
  date: string;
}

type ActivityKind = "expense" | "transfer" | "settle_up";

interface BalanceActivity {
  id: string;
  kind: ActivityKind;
  description: string;
  category_name: string | null;
  category_icon: string | null;
  net_effect: number;
  date: string;
}

interface MemberDetail {
  member_id: string;
  member_name: string;
  currency_code: string;
  total_paid: number;
  total_owed: number;
  initial_balance: number;
  net_balance: number;
  owed_by_category: CategoryAmount[];
  recent_paid: RecentPaid[];
  balance_activity: BalanceActivity[];
}

// --- Helpers ---

const DONUT_COLORS = [
  "var(--color-primary)",
  "var(--color-error)",
  "var(--color-tertiary)",
  "var(--color-secondary)",
  "var(--color-outline)",
  "var(--color-primary-dim, var(--color-primary-fixed-dim))",
];

const DONUT_DOT_CLASSES = [
  "bg-primary",
  "bg-error",
  "bg-tertiary",
  "bg-secondary",
  "bg-outline",
  "bg-primary-fixed-dim",
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCompact(amount: number, currencyCode: string = "USD"): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(amount / 1_000).toFixed(0)}K`;
  return formatCurrency(amount, currencyCode);
}

function formatSigned(amount: number, currency: string): string {
  if (amount === 0) return formatCurrency(0, currency);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatCurrency(amount, currency)}`;
}

function amountColorClass(amount: number): string {
  if (amount > 0) return "text-primary";
  if (amount < 0) return "text-error";
  return "text-on-surface-variant";
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function DonutChart({ categories, currencyCode }: { categories: CategoryAmount[]; currencyCode: string }) {
  const total = categories.reduce((sum, c) => sum + c.total_amount, 0);

  const gradient = useMemo(() => {
    if (categories.length === 0) return "var(--color-outline-variant)";
    let accumulated = 0;
    const stops: string[] = [];
    categories.forEach((cat, i) => {
      const pct = total > 0 ? (cat.total_amount / total) * 100 : 0;
      const color = DONUT_COLORS[i % DONUT_COLORS.length];
      stops.push(`${color} ${accumulated}% ${accumulated + pct}%`);
      accumulated += pct;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }, [categories, total]);

  return (
    <div>
      <div className="relative w-40 h-40 mx-auto mb-5">
        <div
          className="w-full h-full rounded-full"
          style={{ background: gradient }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-24 h-24 rounded-full bg-surface-container-lowest flex items-center justify-center px-2">
            <span className="text-sm font-bold text-on-surface text-center leading-tight break-all">{formatCompact(total, currencyCode)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {categories.map((cat, i) => (
          <div key={cat.category_name} className="flex items-center gap-2.5">
            <div className={cn("w-3 h-3 rounded-full flex-shrink-0", DONUT_DOT_CLASSES[i % DONUT_DOT_CLASSES.length])} />
            <span className="flex-1 text-sm text-on-surface truncate">{cat.category_name}</span>
            <span className="text-sm font-semibold text-on-surface flex-shrink-0">
              {formatCurrency(cat.total_amount, currencyCode)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Balance breakdown ---

function BalanceBreakdown({
  initial,
  expenseEffect,
  transferEffect,
  net,
  currency,
  t,
}: {
  initial: number;
  expenseEffect: number;
  transferEffect: number;
  net: number;
  currency: string;
  t: (k: string) => string;
}) {
  // Show only non-zero lines; if everything is zero, show the initial row alone.
  const rows: { label: string; value: number }[] = [];
  if (initial !== 0) rows.push({ label: t("balance_breakdown_initial"), value: initial });
  if (expenseEffect !== 0) rows.push({ label: t("balance_breakdown_expenses"), value: expenseEffect });
  if (transferEffect !== 0) rows.push({ label: t("balance_breakdown_transfers"), value: transferEffect });
  if (rows.length === 0) rows.push({ label: t("balance_breakdown_initial"), value: 0 });

  return (
    <div className="mt-4 pt-4 border-t border-outline-variant/20 space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between text-xs">
          <span className="text-on-surface-variant">{row.label}</span>
          <span className={cn("font-semibold tabular-nums", amountColorClass(row.value))}>
            {formatSigned(row.value, currency)}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs pt-1.5 border-t border-outline-variant/10">
        <span className="font-semibold text-on-surface">{t("balance_breakdown_net")}</span>
        <span className={cn("font-bold tabular-nums", amountColorClass(net))}>
          {formatSigned(net, currency)}
        </span>
      </div>
    </div>
  );
}

// --- Transaction rows ---

function ActivityRow({ item, currency, t }: { item: BalanceActivity; currency: string; t: (k: string) => string }) {
  const isTransfer = item.kind !== "expense";
  const label = isTransfer
    ? (item.kind === "transfer" ? t("kind_transfer") : t("kind_settle_up"))
    : item.category_name ?? "";
  const description = item.description || (isTransfer ? label : "");
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-surface-container-high/30 transition-colors">
      <div className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0",
        isTransfer ? "bg-tertiary-container/30 text-tertiary" : "bg-primary-container/20",
      )}>
        {isTransfer ? <ArrowRightLeft size={18} /> : item.category_icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">{description}</p>
        <p className="text-xs text-outline">{label}{label ? " · " : ""}{formatDate(item.date)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={cn("text-sm font-bold tabular-nums", amountColorClass(item.net_effect))}>
          {formatSigned(item.net_effect, currency)}
        </p>
      </div>
    </div>
  );
}

function PaidRow({ item }: { item: RecentPaid }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-surface-container-high/30 transition-colors">
      <div className="w-9 h-9 rounded-full bg-primary-container/20 flex items-center justify-center text-lg flex-shrink-0">
        {item.category_icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">{item.description}</p>
        <p className="text-xs text-outline">{item.category_name} · {formatDate(item.date)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-on-surface tabular-nums">
          {formatCurrency(item.amount, item.currency_code)}
        </p>
      </div>
    </div>
  );
}

// --- Tabs ---

type TransactionTab = "activity" | "paid";

function TransactionTabs({
  balanceActivity,
  recentPaid,
  currency,
  t,
}: {
  balanceActivity: BalanceActivity[];
  recentPaid: RecentPaid[];
  currency: string;
  t: (k: string) => string;
}) {
  const [tab, setTab] = useState<TransactionTab>("activity");

  const tabButtonClass = (active: boolean) =>
    cn(
      "flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors",
      active
        ? "bg-primary text-on-primary"
        : "text-on-surface-variant hover:bg-surface-container-high/40",
    );

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden">
      <div className="p-2 flex gap-2 border-b border-outline-variant/20">
        <button className={tabButtonClass(tab === "activity")} onClick={() => setTab("activity")}>
          {t("tab_affecting_balance")}
        </button>
        <button className={tabButtonClass(tab === "paid")} onClick={() => setTab("paid")}>
          {t("tab_paid_by_member")}
        </button>
      </div>
      <div className="px-2 py-3 space-y-1">
        {tab === "activity" && (
          balanceActivity.length === 0
            ? <p className="text-sm text-outline text-center py-8">{t("no_transactions")}</p>
            : balanceActivity.map((item) => (
                <ActivityRow key={`${item.kind}-${item.id}`} item={item} currency={currency} t={t} />
              ))
        )}
        {tab === "paid" && (
          recentPaid.length === 0
            ? <p className="text-sm text-outline text-center py-8">{t("no_expenses_yet")}</p>
            : recentPaid.map((item) => <PaidRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

// --- Main Page ---

export default function MemberAnalytics() {
  const { groupId, memberId } = useParams<{ groupId: string; memberId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("reports");

  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!groupId || !memberId) return;
    setLoading(true);
    setError(false);
    client
      .get<MemberDetail>(`/groups/${groupId}/reports/member/${memberId}`)
      .then((r) => setDetail(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [groupId, memberId]);

  const currency = detail?.currency_code ?? "USD";
  const net = detail?.net_balance ?? 0;
  const initial = detail?.initial_balance ?? 0;

  // Derive the expenses vs transfers contribution from balance_activity so the
  // breakdown always reconciles with the big number.
  const { expenseEffect, transferEffect } = useMemo(() => {
    if (!detail) return { expenseEffect: 0, transferEffect: 0 };
    let exp = 0;
    let xfer = 0;
    for (const a of detail.balance_activity) {
      if (a.kind === "expense") exp += a.net_effect;
      else xfer += a.net_effect;
    }
    return { expenseEffect: exp, transferEffect: xfer };
  }, [detail]);

  return (
    <div>
      {/* ============ DESKTOP HEADER ============ */}
      <div className="hidden sm:block mb-8">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate(`/groups/${groupId}/reports`)}
            className="p-2 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
          >
            <ArrowLeft size={18} />
          </button>
          <Link
            to={`/groups/${groupId}/reports`}
            className="text-sm text-primary hover:underline"
          >
            {t("back_to_analytics")}
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-on-surface ml-12">{t("member_analytics")}</h1>
      </div>

      {/* ============ MOBILE HEADER ============ */}
      <div className="sm:hidden mb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/groups/${groupId}/reports`)}
              className="p-2 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
            >
              <ArrowLeft size={18} />
            </button>
            <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">{t("member_details")}</p>
          </div>
          <button className="p-2 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant">
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-12 text-center">
          <p className="text-4xl mb-3">👤</p>
          <p className="font-bold text-on-surface">{t("failed_to_load_member")}</p>
          <p className="text-sm text-on-surface-variant mt-1">{t("try_again")}</p>
        </div>
      )}

      {!loading && !error && detail && (
        <>
          {/* ==================== MOBILE LAYOUT ==================== */}
          <div className="sm:hidden space-y-4">
            {/* Profile */}
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary-container/30 flex items-center justify-center text-primary text-2xl font-bold mx-auto mb-3">
                {detail.member_name[0]?.toUpperCase()}
              </div>
              <h2 className="text-2xl font-bold text-on-surface">{detail.member_name}</h2>
              <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mt-1">
                {t("member_role")}
              </p>
            </div>

            {/* Card 1: Balance */}
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
              <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">{t("net_balance")}</p>
              <p className={cn("text-3xl font-bold tabular-nums", amountColorClass(net))}>
                {formatSigned(net, currency)}
              </p>
              <p className="text-xs text-on-surface-variant mt-1">
                {net > 0 ? t("is_owed_back") : net < 0 ? t("owes_to_group") : t("settled_up")}
              </p>
              <BalanceBreakdown
                initial={initial}
                expenseEffect={expenseEffect}
                transferEffect={transferEffect}
                net={net}
                currency={currency}
                t={t}
              />
            </div>

            {/* Card 2: Category of expense */}
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
              <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">{t("category_of_expense")}</h2>
              {detail.owed_by_category.length === 0 ? (
                <p className="text-sm text-outline text-center py-8">{t("no_expenses_yet")}</p>
              ) : (
                <DonutChart categories={detail.owed_by_category} currencyCode={currency} />
              )}
            </div>

            {/* Transactions tabs */}
            <TransactionTabs
              balanceActivity={detail.balance_activity}
              recentPaid={detail.recent_paid}
              currency={currency}
              t={t}
            />

            <button className="w-full py-3.5 rounded-2xl bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors">
              {t("settle_balance")}
            </button>
          </div>

          {/* ==================== DESKTOP LAYOUT ==================== */}
          <div className="hidden sm:block space-y-5">
            {/* Profile */}
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary-container/30 flex items-center justify-center text-primary text-2xl font-bold flex-shrink-0">
                  {detail.member_name[0]?.toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-on-surface">{detail.member_name}</h2>
                  <p className="text-sm text-on-surface-variant mt-0.5">{t("member_role")}</p>
                </div>
              </div>
            </div>

            {/* Two-column: Balance + Category of expense */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">{t("net_balance")}</p>
                <p className={cn("text-3xl font-bold tabular-nums", amountColorClass(net))}>
                  {formatSigned(net, currency)}
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {net > 0 ? t("is_owed_back") : net < 0 ? t("owes_to_group") : t("settled_up")}
                </p>
                <BalanceBreakdown
                  initial={initial}
                  expenseEffect={expenseEffect}
                  transferEffect={transferEffect}
                  net={net}
                  currency={currency}
                  t={t}
                />
              </div>

              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-5">{t("category_of_expense")}</h2>
                {detail.owed_by_category.length === 0 ? (
                  <p className="text-sm text-outline text-center py-8">{t("no_expenses_yet")}</p>
                ) : (
                  <DonutChart categories={detail.owed_by_category} currencyCode={currency} />
                )}
              </div>
            </div>

            {/* Transactions tabs */}
            <TransactionTabs
              balanceActivity={detail.balance_activity}
              recentPaid={detail.recent_paid}
              currency={currency}
              t={t}
            />
          </div>
        </>
      )}
    </div>
  );
}
