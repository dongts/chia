import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, MoreVertical } from "lucide-react";
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

interface RecentOwed {
  id: string;
  description: string;
  owed_amount: number;
  total_amount: number;
  currency_code: string;
  category_name: string;
  category_icon: string;
  date: string;
}

interface MemberDetail {
  member_id: string;
  member_name: string;
  currency_code: string;
  total_paid: number;
  total_owed: number;
  paid_by_category: CategoryAmount[];
  owed_by_category: CategoryAmount[];
  recent_paid: RecentPaid[];
  recent_owed: RecentOwed[];
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
      {/* Donut */}
      <div className="relative w-40 h-40 mx-auto mb-5">
        <div
          className="w-full h-full rounded-full"
          style={{ background: gradient }}
        />
        {/* White center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-24 h-24 rounded-full bg-surface-container-lowest flex items-center justify-center px-2">
            <span className="text-sm font-bold text-on-surface text-center leading-tight break-all">{formatCompact(total, currencyCode)}</span>
          </div>
        </div>
      </div>

      {/* Legend */}
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

// --- Main Page ---

export default function MemberAnalytics() {
  const { groupId, memberId } = useParams<{ groupId: string; memberId: string }>();
  const navigate = useNavigate();

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

  const net = detail ? detail.total_paid - detail.total_owed : 0;
  const currency = detail?.currency_code ?? "USD";

  // Monthly average: approximate months since we don't have a join date from this endpoint
  // Use earliest expense date as proxy, fallback to 1 month
  const monthsSinceJoin = useMemo(() => {
    if (!detail) return 1;
    const dates = [
      ...detail.recent_paid.map((e) => new Date(e.date).getTime()),
      ...detail.recent_owed.map((e) => new Date(e.date).getTime()),
    ];
    if (dates.length === 0) return 1;
    const earliest = Math.min(...dates);
    const months = Math.max(1, Math.ceil((Date.now() - earliest) / (1000 * 60 * 60 * 24 * 30)));
    return months;
  }, [detail]);

  const monthlyAvg = detail ? detail.total_paid / monthsSinceJoin : 0;

  // Merge recent_paid and recent_owed for full activity history
  const allActivity = useMemo(() => {
    if (!detail) return [];
    const paid = detail.recent_paid.map((e) => ({
      id: e.id,
      type: "paid" as const,
      description: e.description,
      category: e.category_name,
      icon: e.category_icon,
      amount: e.amount,
      currency: e.currency_code,
      date: e.date,
    }));
    const owed = detail.recent_owed.map((e) => ({
      id: e.id + "-owed",
      type: "owed" as const,
      description: e.description,
      category: e.category_name,
      icon: e.category_icon,
      amount: e.owed_amount,
      currency: e.currency_code,
      date: e.date,
    }));
    return [...paid, ...owed].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [detail]);

  return (
    <div>
      {/* ============ DESKTOP HEADER (hidden on mobile) ============ */}
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
            Back to Group Analytics
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-on-surface ml-12">Member Analytics</h1>
      </div>

      {/* ============ MOBILE HEADER (hidden on desktop) ============ */}
      <div className="sm:hidden mb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/groups/${groupId}/reports`)}
              className="p-2 rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
            >
              <ArrowLeft size={18} />
            </button>
            <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Member Details</p>
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
          <p className="font-bold text-on-surface">Failed to load member analytics</p>
          <p className="text-sm text-on-surface-variant mt-1">Please try again later.</p>
        </div>
      )}

      {!loading && !error && detail && (
        <>
          {/* ==================== MOBILE LAYOUT ==================== */}
          <div className="sm:hidden space-y-4">
            {/* Centered avatar + name */}
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary-container/30 flex items-center justify-center text-primary text-2xl font-bold mx-auto mb-3">
                {detail.member_name[0]?.toUpperCase()}
              </div>
              <h2 className="text-2xl font-bold text-on-surface">{detail.member_name}</h2>
              <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mt-1">
                Member
              </p>
            </div>

            {/* Two stat cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Total Paid</p>
                <p className="text-xl font-bold text-on-surface">{formatCurrency(detail.total_paid, currency)}</p>
                <p className="text-xs text-on-surface-variant mt-1">across all expenses</p>
              </div>
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Monthly Avg</p>
                <p className="text-xl font-bold text-on-surface">{formatCurrency(monthlyAvg, currency)}</p>
                <p className="text-xs text-on-surface-variant mt-1">per month</p>
              </div>
            </div>

            {/* Category Spending donut */}
            {detail.paid_by_category.length > 0 && (
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">Category Spending</h2>
                <DonutChart categories={detail.paid_by_category} currencyCode={currency} />
              </div>
            )}

            {/* Activity History */}
            {allActivity.length > 0 && (
              <div>
                <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3 px-1">Activity History</h2>
                <div className="space-y-2">
                  {allActivity.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-surface-container-high/30 transition-colors">
                      <div className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0",
                        item.type === "paid" ? "bg-primary-container/20" : "bg-error-container/20"
                      )}>
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{item.description}</p>
                        <p className="text-xs text-outline">{item.category} · {formatDate(item.date)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={cn("text-sm font-bold", item.type === "paid" ? "text-primary" : "text-error")}>
                          {item.type === "paid" ? "+" : "-"}{formatCurrency(item.amount, item.currency)}
                        </p>
                        <p className="text-[10px] text-outline uppercase font-semibold">
                          {item.type === "paid" ? "Paid" : "Owed"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Settle Balance button */}
            <button className="w-full py-3.5 rounded-2xl bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors">
              Settle Balance
            </button>
          </div>

          {/* ==================== DESKTOP LAYOUT ==================== */}
          <div className="hidden sm:block space-y-5">
            {/* Profile section */}
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary-container/30 flex items-center justify-center text-primary text-2xl font-bold flex-shrink-0">
                  {detail.member_name[0]?.toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-on-surface">{detail.member_name}</h2>
                  <p className="text-sm text-on-surface-variant mt-0.5">Member</p>
                </div>
              </div>
            </div>

            {/* Two stat cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Total Paid</p>
                <p className="text-2xl font-bold text-on-surface">{formatCurrency(detail.total_paid, currency)}</p>
                <p className="text-xs text-on-surface-variant mt-2">across all expenses</p>
              </div>
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Net Balance</p>
                <p className={cn("text-2xl font-bold", net >= 0 ? "text-primary" : "text-error")}>
                  {net >= 0 ? "+" : ""}{formatCurrency(net, currency)}
                </p>
                <p className="text-xs text-on-surface-variant mt-2">
                  {net >= 0 ? "is owed back" : "owes to group"}
                </p>
              </div>
            </div>

            {/* Two-column: Donut + Top Expenses */}
            <div className="grid grid-cols-2 gap-4">
              {/* Left: Spending by Category donut */}
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-5">Spending by Category</h2>
                {detail.paid_by_category.length === 0 ? (
                  <p className="text-sm text-outline text-center py-8">No category data</p>
                ) : (
                  <DonutChart categories={detail.paid_by_category} currencyCode={currency} />
                )}
              </div>

              {/* Right: Top Expenses Paid */}
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">Top Expenses Paid</h2>
                {detail.recent_paid.length === 0 ? (
                  <p className="text-sm text-outline text-center py-8">No expenses</p>
                ) : (
                  <div className="space-y-2">
                    {detail.recent_paid.map((exp) => (
                      <div key={exp.id} className="bg-surface-container-high/30 rounded-xl px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-base flex-shrink-0">
                          {exp.category_icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-on-surface truncate">{exp.description}</p>
                          <p className="text-xs text-outline">{formatDate(exp.date)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-sm font-semibold text-on-surface">{formatCurrency(exp.amount, exp.currency_code)}</span>
                          <span className="text-[10px] font-medium text-on-surface-variant bg-surface-container rounded-full px-2 py-0.5">
                            {exp.category_name}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Activity History */}
            {allActivity.length > 0 && (
              <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden">
                <div className="px-5 py-4">
                  <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Activity History</h2>
                </div>
                <div className="px-2 pb-3 space-y-1">
                  {allActivity.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-surface-container-high/30 transition-colors">
                      <div className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0",
                        item.type === "paid" ? "bg-primary-container/20" : "bg-error-container/20"
                      )}>
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{item.description}</p>
                        <p className="text-xs text-outline">{item.category} · {formatDate(item.date)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={cn("text-sm font-bold", item.type === "paid" ? "text-primary" : "text-error")}>
                          {item.type === "paid" ? "+" : "-"}{formatCurrency(item.amount, item.currency)}
                        </p>
                        <p className="text-[10px] text-outline uppercase font-semibold">
                          {item.type === "paid" ? "Paid" : "Owed"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
