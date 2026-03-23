import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, TrendingUp, AlertTriangle, Clock, Lightbulb, ChevronRight, Users, Receipt } from "lucide-react";
import client from "@/api/client";
import { formatCurrency, formatAmount } from "@/utils/currency";
import { cn } from "@/lib/utils";

// --- Types ---

interface CategorySummary {
  category_id: string; category_name: string; category_icon: string;
  total_amount: number; expense_count: number; percentage: number;
}
interface MemberSummary {
  member_id: string; member_name: string;
  total_paid: number; total_owed: number; expense_count: number;
}
interface GroupReportSummary {
  currency_code: string; total_spent: number; expense_count: number;
  per_member: MemberSummary[]; per_category: CategorySummary[];
}
interface SuggestedSettlement {
  from_member_id: string; from_member_name: string;
  to_member_id: string; to_member_name: string;
  amount: number;
}

// --- Helpers ---

function LoadingSpinner() {
  return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
}

function CategoryBar({ category, maxAmount, currencyCode }: { category: CategorySummary; maxAmount: number; currencyCode?: string }) {
  const widthPct = maxAmount > 0 ? (category.total_amount / maxAmount) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="text-lg w-7 text-center flex-shrink-0">{category.category_icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5 gap-1">
          <span className="text-sm font-medium text-on-surface truncate">{category.category_name}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-on-surface-variant">{category.percentage.toFixed(0)}%</span>
            <span className="text-sm font-semibold text-on-surface">
              {formatAmount(category.total_amount, currencyCode)}
            </span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-primary-container/20 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-primary-fixed-dim to-primary transition-all duration-500" style={{ width: `${widthPct}%` }} />
        </div>
      </div>
    </div>
  );
}

// --- Main page ---

export default function GroupReports() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<GroupReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [settlements, setSettlements] = useState<SuggestedSettlement[]>([]);

  useEffect(() => {
    if (!groupId) return;
    setLoading(true); setError(false);
    Promise.all([
      client.get<GroupReportSummary>(`/groups/${groupId}/reports/summary`),
      client.get<{ name: string }>(`/groups/${groupId}`).catch(() => ({ data: { name: "" } })),
      client.get<SuggestedSettlement[]>(`/groups/${groupId}/settlements/suggested`).catch(() => ({ data: [] as SuggestedSettlement[] })),
    ])
      .then(([summaryRes, groupRes, settlementsRes]) => {
        setSummary(summaryRes.data);
        setGroupName(groupRes.data.name || "");
        setSettlements(settlementsRes.data);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [groupId]);

  const sortedCategories = summary ? [...summary.per_category].sort((a, b) => b.total_amount - a.total_amount) : [];
  const maxCategoryAmount = sortedCategories[0]?.total_amount ?? 0;

  // Find most active member and top category for summary cards
  const mostActiveMember = summary?.per_member.reduce((max, m) => m.expense_count > max.expense_count ? m : max, summary.per_member[0]);
  const topCategory = sortedCategories[0];

  const highestSpender = summary?.per_member.reduce((max, m) => m.total_paid > max.total_paid ? m : max, summary.per_member[0]);

  return (
    <div>
      {/* ============ DESKTOP HEADER (hidden on mobile) ============ */}
      <div className="hidden sm:block mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/groups/${groupId}`)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Analytics Report</p>
              <h1 className="text-2xl font-bold text-on-surface">{groupName || "Group Report"}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-xs font-medium text-on-surface-variant">
              <Clock size={13} />
              Last 30 Days
            </span>
            <button className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-colors">
              <Receipt size={13} />
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* ============ MOBILE HEADER (hidden on desktop) ============ */}
      <div className="sm:hidden mb-5">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(`/groups/${groupId}`)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
          >
            <ArrowLeft size={18} />
          </button>
          <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Analytics Report</p>
        </div>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-12 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="font-bold text-on-surface">Failed to load reports</p>
        </div>
      )}

      {!loading && !error && summary && (
        <>
          {summary.expense_count === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-12 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="font-bold text-on-surface">No expenses yet</p>
              <p className="text-sm text-on-surface-variant mt-1">Add some expenses to see reports.</p>
            </div>
          ) : (
            <>
              {/* ==================== MOBILE LAYOUT ==================== */}
              <div className="sm:hidden space-y-4">
                {/* Hero card */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary-dim to-primary-container p-6">
                  {/* Decorative shapes */}
                  <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full" />
                  <div className="absolute bottom-4 -left-4 w-16 h-16 bg-white/5 rounded-full" />
                  <div className="absolute top-1/2 right-1/4 w-10 h-10 bg-white/5 rounded-full" />
                  <div className="relative z-10">
                    <p className="text-[11px] font-semibold text-on-primary/70 uppercase tracking-wider mb-1">Total Group Spend</p>
                    <p className="text-3xl font-bold text-on-primary leading-tight">{formatCurrency(summary.total_spent, summary.currency_code)}</p>
                    <p className="text-xs text-on-primary/60 mt-1.5">{summary.expense_count} expense{summary.expense_count !== 1 ? "s" : ""} recorded</p>
                  </div>
                </div>

                {/* Two mini cards */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Top Contributor */}
                  {mostActiveMember && (
                    <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4">
                      <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2.5">Top Contributor</p>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                          {mostActiveMember.member_name[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-on-surface truncate">{mostActiveMember.member_name}</p>
                          <p className="text-xs text-on-surface-variant">{mostActiveMember.expense_count} txns</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Main Expense (top category) */}
                  {topCategory && (
                    <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4">
                      <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2.5">Main Expense</p>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl flex-shrink-0">{topCategory.category_icon}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-on-surface truncate">{topCategory.category_name}</p>
                          <p className="text-xs text-on-surface-variant">{topCategory.percentage.toFixed(0)}% of total</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Category Breakdown */}
                {sortedCategories.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                    <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">Category Breakdown</h2>
                    <div className="space-y-3.5">
                      {sortedCategories.map((cat) => (
                        <CategoryBar key={cat.category_id} category={cat} maxAmount={maxCategoryAmount} currencyCode={summary.currency_code} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Member Balance */}
                {summary.per_member.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Member Balance</h2>
                      <button className="text-xs font-medium text-primary">View Split Details</button>
                    </div>
                    <div className="space-y-2.5">
                      {summary.per_member.map((member) => {
                        const net = member.total_paid - member.total_owed;
                        return (
                          <Link
                            key={member.member_id}
                            to={`/groups/${groupId}/reports/member/${member.member_id}`}
                            className="block bg-surface-container-lowest rounded-2xl shadow-editorial p-4 hover:shadow-editorial-lg transition-all"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-sm font-bold text-on-surface-variant flex-shrink-0">
                                  {member.member_name[0]?.toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-on-surface">{member.member_name}</p>
                                  <p className="text-xs text-on-surface-variant">Paid {formatCurrency(member.total_paid, summary.currency_code)}</p>
                                </div>
                              </div>
                              <span className={cn("text-sm font-bold", net > 0 ? "text-primary" : net < 0 ? "text-error" : "text-outline")}>
                                {net > 0 ? "+" : ""}{formatCurrency(net, summary.currency_code)}
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ==================== DESKTOP LAYOUT ==================== */}
              <div className="hidden sm:block space-y-5">
                {/* 3 Summary Cards */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Total Spent */}
                  <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                    <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Total Spent</p>
                    <p className="text-2xl sm:text-3xl font-bold text-on-surface leading-tight">{formatCurrency(summary.total_spent, summary.currency_code)}</p>
                    <p className="text-xs text-on-surface-variant mt-2 flex items-center gap-1">
                      <TrendingUp size={12} className="text-primary" />
                      <span className="text-primary font-medium">+{summary.expense_count}</span> expense{summary.expense_count !== 1 ? "s" : ""} recorded
                    </p>
                  </div>

                  {/* Most Active Member */}
                  {mostActiveMember && (
                    <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                      <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3">Most Active Member</p>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-container/30 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                          {mostActiveMember.member_name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-base font-bold text-on-surface">{mostActiveMember.member_name}</p>
                          <p className="text-xs text-on-surface-variant">{mostActiveMember.expense_count} Transaction{mostActiveMember.expense_count !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Top Category */}
                  {topCategory && (
                    <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                      <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3">Top Category</p>
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{topCategory.category_icon}</span>
                        <div>
                          <p className="text-base font-bold text-on-surface">{topCategory.category_name}</p>
                          <p className="text-xs text-on-surface-variant">{topCategory.percentage.toFixed(0)}% of total volume</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Two-column: Category Breakdown + Recent Pulse */}
                <div className="grid grid-cols-5 gap-4">
                  {/* Left: Category Breakdown (3 cols) */}
                  {sortedCategories.length > 0 && (
                    <div className="col-span-3 bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                      <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-5">Category Breakdown</h2>
                      <div className="space-y-4">
                        {sortedCategories.map((cat) => (
                          <CategoryBar key={cat.category_id} category={cat} maxAmount={maxCategoryAmount} currencyCode={summary.currency_code} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Right: Recent Pulse (2 cols) */}
                  <div className={cn("bg-surface-container-lowest rounded-2xl shadow-editorial p-5", sortedCategories.length > 0 ? "col-span-2" : "col-span-5")}>
                    <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">Recent Pulse</h2>
                    <div className="space-y-3">
                      {/* Large Expense Flagged */}
                      {highestSpender && (
                        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-error-container/10">
                          <div className="w-9 h-9 rounded-full bg-error-container/30 flex items-center justify-center flex-shrink-0">
                            <AlertTriangle size={16} className="text-error" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-on-surface">Large Expense Flagged</p>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                              {highestSpender.member_name} paid {formatCurrency(highestSpender.total_paid, summary.currency_code)} total
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Settlement Pending */}
                      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-tertiary-container/10">
                        <div className="w-9 h-9 rounded-full bg-tertiary-container/30 flex items-center justify-center flex-shrink-0">
                          <Clock size={16} className="text-tertiary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-on-surface">Settlement Pending</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">
                            {settlements.length} suggested settlement{settlements.length !== 1 ? "s" : ""} to resolve
                          </p>
                        </div>
                      </div>

                      {/* Savings Opportunity */}
                      {topCategory && (
                        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-primary-container/10">
                          <div className="w-9 h-9 rounded-full bg-primary-container/30 flex items-center justify-center flex-shrink-0">
                            <Lightbulb size={16} className="text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-on-surface">Savings Opportunity</p>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                              {topCategory.category_icon} {topCategory.category_name} is your highest spend at {formatCurrency(topCategory.total_amount, summary.currency_code)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Member Breakdown Table */}
                {summary.per_member.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden">
                    <div className="px-5 py-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Member Breakdown</h2>
                        <p className="text-xs text-outline mt-0.5">Click a member to see details</p>
                      </div>
                      <div className="flex items-center gap-1 text-on-surface-variant">
                        <Users size={15} />
                        <span className="text-xs font-medium">{summary.per_member.length}</span>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-surface-container-high/30">
                            <th className="px-5 py-3 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider text-left">Name</th>
                            <th className="px-3 py-3 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider text-right">Paid</th>
                            <th className="px-3 py-3 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider text-right">Owed</th>
                            <th className="px-3 py-3 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider text-right">Net Balance</th>
                            <th className="px-3 py-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {summary.per_member.map((member) => {
                            const net = member.total_paid - member.total_owed;
                            return (
                              <tr key={member.member_id}
                                onClick={() => navigate(`/groups/${groupId}/reports/member/${member.member_id}`)}
                                className="cursor-pointer transition-colors hover:bg-surface-container-high/30">
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-xs font-bold text-on-surface-variant flex-shrink-0">
                                      {member.member_name[0]?.toUpperCase()}
                                    </div>
                                    <span className="font-semibold text-on-surface">{member.member_name}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-3.5 text-right text-on-surface">{formatCurrency(member.total_paid, summary.currency_code)}</td>
                                <td className="px-3 py-3.5 text-right text-on-surface">{formatCurrency(member.total_owed, summary.currency_code)}</td>
                                <td className={cn("px-3 py-3.5 text-right font-bold", net > 0 ? "text-primary" : net < 0 ? "text-error" : "text-outline")}>
                                  {net > 0 ? "+" : ""}{formatCurrency(net, summary.currency_code)}
                                </td>
                                <td className="px-3 py-3.5 text-center">
                                  <ChevronRight size={16} className="text-outline inline-block" />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
