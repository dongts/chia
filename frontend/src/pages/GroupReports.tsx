import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
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
interface CategoryAmount { category_name: string; category_icon: string; total_amount: number }
interface RecentPaid {
  id: string; description: string; amount: number; currency_code: string;
  category_name: string; category_icon: string; date: string;
}
interface RecentOwed {
  id: string; description: string; owed_amount: number; total_amount: number;
  currency_code: string; category_name: string; category_icon: string; date: string;
}
interface MemberDetail {
  member_id: string; member_name: string; currency_code: string;
  total_paid: number; total_owed: number;
  paid_by_category: CategoryAmount[]; owed_by_category: CategoryAmount[];
  recent_paid: RecentPaid[]; recent_owed: RecentOwed[];
}

// --- Helpers ---

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function LoadingSpinner() {
  return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
}

function CategoryBar({ category, maxAmount, currencyCode }: { category: CategorySummary; maxAmount: number; currencyCode?: string }) {
  const widthPct = maxAmount > 0 ? (category.total_amount / maxAmount) * 100 : 0;
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="text-lg sm:text-xl w-6 sm:w-7 text-center flex-shrink-0">{category.category_icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1 gap-1">
          <span className="text-xs sm:text-sm font-medium text-on-surface truncate">{category.category_name}</span>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <span className="text-[10px] sm:text-xs text-on-surface-variant">{category.percentage.toFixed(0)}%</span>
            <span className="text-xs sm:text-sm font-semibold text-on-surface">
              {formatAmount(category.total_amount, currencyCode)}
            </span>
          </div>
        </div>
        <div className="h-1.5 sm:h-2 rounded-full bg-primary-container/30 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-primary-fixed-dim to-primary transition-all duration-500" style={{ width: `${widthPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function MemberDetailPanel({ groupId, memberId, memberName, currencyCode, onClose }: {
  groupId: string; memberId: string; memberName: string; currencyCode: string; onClose: () => void;
}) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true); setError(false);
    client.get<MemberDetail>(`/groups/${groupId}/reports/member/${memberId}`)
      .then((r) => setDetail(r.data)).catch(() => setError(true)).finally(() => setLoading(false));
  }, [groupId, memberId]);

  const net = detail ? detail.total_paid - detail.total_owed : 0;
  const currency = detail?.currency_code ?? currencyCode;

  return (
    <div className="mt-4 bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-outline-variant/10">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-primary-container/30 flex items-center justify-center text-sm font-bold text-primary">
              {memberName[0]?.toUpperCase()}
            </div>
            <h3 className="text-base font-bold text-on-surface">{memberName}</h3>
          </div>
          {detail && (
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-3">
              <div>
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Paid</p>
                <p className="text-sm font-semibold text-on-surface">{formatCurrency(detail.total_paid, currency)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Owed</p>
                <p className="text-sm font-semibold text-on-surface">{formatCurrency(detail.total_owed, currency)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Net</p>
                <p className={cn("text-sm font-semibold", net >= 0 ? "text-primary" : "text-error")}>
                  {net >= 0 ? "+" : ""}{formatCurrency(net, currency)}
                </p>
              </div>
            </div>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 text-outline hover:text-on-surface-variant hover:bg-surface-container rounded-full flex-shrink-0"><X size={18} /></button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <p className="px-5 py-8 text-center text-sm text-on-surface-variant">Failed to load details.</p>}

      {detail && !loading && (
        <div className="p-5 space-y-6">
          {/* Category breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-3">Paid by Category</h4>
              {detail.paid_by_category.length === 0 ? <p className="text-sm text-outline">No data</p> : (
                <div className="space-y-2">
                  {detail.paid_by_category.map((cat) => (
                    <div key={cat.category_name} className="flex items-center gap-2 bg-surface-container-high/30 rounded-xl px-3 py-2">
                      <span className="text-base">{cat.category_icon}</span>
                      <span className="flex-1 text-sm text-on-surface truncate">{cat.category_name}</span>
                      <span className="text-sm font-semibold text-on-surface flex-shrink-0">{formatCurrency(cat.total_amount, currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-3">Owed by Category</h4>
              {detail.owed_by_category.length === 0 ? <p className="text-sm text-outline">No data</p> : (
                <div className="space-y-2">
                  {detail.owed_by_category.map((cat) => (
                    <div key={cat.category_name} className="flex items-center gap-2 bg-surface-container-high/30 rounded-xl px-3 py-2">
                      <span className="text-base">{cat.category_icon}</span>
                      <span className="flex-1 text-sm text-on-surface truncate">{cat.category_name}</span>
                      <span className="text-sm font-semibold text-on-surface flex-shrink-0">{formatCurrency(cat.total_amount, currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent paid */}
          <div>
            <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-3">Recent Expenses Paid</h4>
            {detail.recent_paid.length === 0 ? <p className="text-sm text-outline">No recent expenses</p> : (
              <div className="space-y-2">
                {detail.recent_paid.map((exp) => (
                  <div key={exp.id} className="flex items-center gap-2 bg-surface-container-high/30 rounded-xl px-3 py-2.5">
                    <span className="text-base flex-shrink-0">{exp.category_icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{exp.description}</p>
                      <p className="text-xs text-outline">{exp.category_name} · {formatDate(exp.date)}</p>
                    </div>
                    <span className="text-sm font-semibold text-on-surface flex-shrink-0">{formatCurrency(exp.amount, exp.currency_code)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent owed */}
          <div>
            <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-3">Recent Expenses Owed</h4>
            {detail.recent_owed.length === 0 ? <p className="text-sm text-outline">No recent expenses</p> : (
              <div className="space-y-2">
                {detail.recent_owed.map((exp) => (
                  <div key={exp.id} className="flex items-center gap-2 bg-surface-container-high/30 rounded-xl px-3 py-2.5">
                    <span className="text-base flex-shrink-0">{exp.category_icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{exp.description}</p>
                      <p className="text-xs text-outline">{exp.category_name} · {formatDate(exp.date)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-error">{formatCurrency(exp.owed_amount, exp.currency_code)}</p>
                      <p className="text-[10px] text-outline">of {formatCurrency(exp.total_amount, exp.currency_code)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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
  const [selectedMember, setSelectedMember] = useState<MemberSummary | null>(null);

  useEffect(() => {
    if (!groupId) return;
    setLoading(true); setError(false);
    client.get<GroupReportSummary>(`/groups/${groupId}/reports/summary`)
      .then((r) => setSummary(r.data)).catch(() => setError(true)).finally(() => setLoading(false));
  }, [groupId]);

  const sortedCategories = summary ? [...summary.per_category].sort((a, b) => b.total_amount - a.total_amount) : [];
  const maxCategoryAmount = sortedCategories[0]?.total_amount ?? 0;

  // Find most active member and top category for summary cards
  const mostActiveMember = summary?.per_member.reduce((max, m) => m.expense_count > max.expense_count ? m : max, summary.per_member[0]);
  const topCategory = sortedCategories[0];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(`/groups/${groupId}`)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface-variant"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-on-surface">Analytics Dashboard</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">Group spending overview</p>
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
        <div className="space-y-5">
          {summary.expense_count === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-12 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="font-bold text-on-surface">No expenses yet</p>
              <p className="text-sm text-on-surface-variant mt-1">Add some expenses to see reports.</p>
            </div>
          ) : (
            <>
              {/* Summary cards row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Total Spent */}
                <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5 col-span-2 sm:col-span-1">
                  <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Total Spent</p>
                  <p className="text-2xl font-bold text-on-surface leading-tight">{formatCurrency(summary.total_spent, summary.currency_code)}</p>
                  <p className="text-xs text-outline mt-1">{summary.expense_count} expense{summary.expense_count !== 1 ? "s" : ""}</p>
                </div>

                {/* Most Active Member */}
                {mostActiveMember && (
                  <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                    <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Most Active</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-7 h-7 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                        {mostActiveMember.member_name[0]?.toUpperCase()}
                      </div>
                      <p className="text-sm font-bold text-on-surface truncate">{mostActiveMember.member_name}</p>
                    </div>
                    <p className="text-xs text-outline mt-1">{mostActiveMember.expense_count} expenses</p>
                  </div>
                )}

                {/* Top Category */}
                {topCategory && (
                  <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                    <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-1">Top Category</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xl">{topCategory.category_icon}</span>
                      <p className="text-sm font-bold text-on-surface truncate">{topCategory.category_name}</p>
                    </div>
                    <p className="text-xs text-outline mt-1">{topCategory.percentage.toFixed(0)}% of total</p>
                  </div>
                )}
              </div>

              {/* Category breakdown */}
              {sortedCategories.length > 0 && (
                <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-5">
                  <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-4">Category Breakdown</h2>
                  <div className="space-y-3">
                    {sortedCategories.map((cat) => (
                      <CategoryBar key={cat.category_id} category={cat} maxAmount={maxCategoryAmount} currencyCode={summary.currency_code} />
                    ))}
                  </div>
                </div>
              )}

              {/* Per-member breakdown */}
              {summary.per_member.length > 0 && (
                <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden">
                  <div className="px-5 py-4">
                    <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Member Breakdown</h2>
                    <p className="text-xs text-outline mt-0.5">Tap a member to see details</p>
                  </div>

                  {/* Mobile: card layout */}
                  <div className="sm:hidden divide-y divide-outline-variant/10">
                    {summary.per_member.map((member) => {
                      const net = member.total_paid - member.total_owed;
                      const isSelected = selectedMember?.member_id === member.member_id;
                      return (
                        <div key={member.member_id}>
                          <button
                            onClick={() => setSelectedMember(isSelected ? null : member)}
                            className={cn("w-full text-left px-4 py-3.5 transition-colors", isSelected ? "bg-primary-container/10" : "hover:bg-surface-container-high/30")}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5">
                                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                                  isSelected ? "bg-primary-container/50 text-primary" : "bg-surface-container text-on-surface-variant"
                                )}>{member.member_name[0]?.toUpperCase()}</div>
                                <span className="text-sm font-semibold text-on-surface">{member.member_name}</span>
                              </div>
                              <span className={cn("text-sm font-bold", net > 0 ? "text-primary" : net < 0 ? "text-error" : "text-outline")}>
                                {net > 0 ? "+" : ""}{formatCurrency(net, summary.currency_code)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-2 ml-10">
                              <div>
                                <p className="text-[10px] text-outline uppercase font-semibold">Paid</p>
                                <p className="text-xs font-medium text-on-surface">{formatCurrency(member.total_paid, summary.currency_code)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-outline uppercase font-semibold">Owed</p>
                                <p className="text-xs font-medium text-on-surface">{formatCurrency(member.total_owed, summary.currency_code)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-outline uppercase font-semibold">Expenses</p>
                                <p className="text-xs font-medium text-on-surface">{member.expense_count}</p>
                              </div>
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: table layout */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-container-high/30">
                          <th className="px-5 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide text-left">Name</th>
                          <th className="px-3 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide text-right">Paid</th>
                          <th className="px-3 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide text-right">Owed</th>
                          <th className="px-3 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide text-right">Net</th>
                          <th className="px-3 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide text-right">Expenses</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {summary.per_member.map((member) => {
                          const net = member.total_paid - member.total_owed;
                          const isSelected = selectedMember?.member_id === member.member_id;
                          return (
                            <tr key={member.member_id} onClick={() => setSelectedMember(isSelected ? null : member)}
                              className={cn("cursor-pointer transition-colors", isSelected ? "bg-primary-container/10" : "hover:bg-surface-container-high/30")}>
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-2.5">
                                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                                    isSelected ? "bg-primary-container/50 text-primary" : "bg-surface-container text-on-surface-variant"
                                  )}>{member.member_name[0]?.toUpperCase()}</div>
                                  <span className="font-semibold text-on-surface">{member.member_name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-3.5 text-right text-on-surface">{formatCurrency(member.total_paid, summary.currency_code)}</td>
                              <td className="px-3 py-3.5 text-right text-on-surface">{formatCurrency(member.total_owed, summary.currency_code)}</td>
                              <td className={cn("px-3 py-3.5 text-right font-bold", net > 0 ? "text-primary" : net < 0 ? "text-error" : "text-outline")}>
                                {net > 0 ? "+" : ""}{formatCurrency(net, summary.currency_code)}
                              </td>
                              <td className="px-3 py-3.5 text-right text-on-surface-variant">{member.expense_count}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Member detail panel */}
                  {selectedMember && groupId && (
                    <div className="px-3 sm:px-5 pb-4 sm:pb-5">
                      <MemberDetailPanel groupId={groupId} memberId={selectedMember.member_id}
                        memberName={selectedMember.member_name} currencyCode={summary.currency_code}
                        onClose={() => setSelectedMember(null)} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
