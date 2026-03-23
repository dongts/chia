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
  return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /></div>;
}

function CategoryBar({ category, maxAmount, currencyCode }: { category: CategorySummary; maxAmount: number; currencyCode?: string }) {
  const widthPct = maxAmount > 0 ? (category.total_amount / maxAmount) * 100 : 0;
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="text-lg sm:text-xl w-6 sm:w-7 text-center flex-shrink-0">{category.category_icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1 gap-1">
          <span className="text-xs sm:text-sm font-medium text-gray-800 truncate">{category.category_name}</span>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <span className="text-[10px] sm:text-xs text-gray-500">{category.percentage.toFixed(0)}%</span>
            <span className="text-xs sm:text-sm font-semibold text-gray-900">
              {formatAmount(category.total_amount, currencyCode)}
            </span>
          </div>
        </div>
        <div className="h-1.5 sm:h-2 rounded-full bg-green-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-green-400 to-green-600 transition-all duration-500" style={{ width: `${widthPct}%` }} />
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
    <div className="mt-4 bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 sm:px-5 py-4 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-700">
              {memberName[0]?.toUpperCase()}
            </div>
            <h3 className="text-base font-semibold text-gray-900">{memberName}</h3>
          </div>
          {detail && (
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-3">
              <div>
                <p className="text-[10px] sm:text-xs text-gray-400 uppercase">Paid</p>
                <p className="text-sm font-semibold text-gray-800">{formatCurrency(detail.total_paid, currency)}</p>
              </div>
              <div>
                <p className="text-[10px] sm:text-xs text-gray-400 uppercase">Owed</p>
                <p className="text-sm font-semibold text-gray-800">{formatCurrency(detail.total_owed, currency)}</p>
              </div>
              <div>
                <p className="text-[10px] sm:text-xs text-gray-400 uppercase">Net</p>
                <p className={cn("text-sm font-semibold", net >= 0 ? "text-green-600" : "text-red-500")}>
                  {net >= 0 ? "+" : ""}{formatCurrency(net, currency)}
                </p>
              </div>
            </div>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg flex-shrink-0"><X size={18} /></button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <p className="px-5 py-8 text-center text-sm text-gray-500">Failed to load details.</p>}

      {detail && !loading && (
        <div className="p-4 sm:p-5 space-y-6">
          {/* Category breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Paid by Category</h4>
              {detail.paid_by_category.length === 0 ? <p className="text-sm text-gray-400">No data</p> : (
                <div className="space-y-2">
                  {detail.paid_by_category.map((cat) => (
                    <div key={cat.category_name} className="flex items-center gap-2">
                      <span className="text-base">{cat.category_icon}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate">{cat.category_name}</span>
                      <span className="text-sm font-medium text-gray-900 flex-shrink-0">{formatCurrency(cat.total_amount, currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Owed by Category</h4>
              {detail.owed_by_category.length === 0 ? <p className="text-sm text-gray-400">No data</p> : (
                <div className="space-y-2">
                  {detail.owed_by_category.map((cat) => (
                    <div key={cat.category_name} className="flex items-center gap-2">
                      <span className="text-base">{cat.category_icon}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate">{cat.category_name}</span>
                      <span className="text-sm font-medium text-gray-900 flex-shrink-0">{formatCurrency(cat.total_amount, currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent paid — card layout on mobile, table on desktop */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Expenses Paid</h4>
            {detail.recent_paid.length === 0 ? <p className="text-sm text-gray-400">No recent expenses</p> : (
              <div className="space-y-2">
                {detail.recent_paid.map((exp) => (
                  <div key={exp.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-base flex-shrink-0">{exp.category_icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{exp.description}</p>
                      <p className="text-xs text-gray-400">{exp.category_name} · {formatDate(exp.date)}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 flex-shrink-0">{formatCurrency(exp.amount, exp.currency_code)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent owed */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Expenses Owed</h4>
            {detail.recent_owed.length === 0 ? <p className="text-sm text-gray-400">No recent expenses</p> : (
              <div className="space-y-2">
                {detail.recent_owed.map((exp) => (
                  <div key={exp.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-base flex-shrink-0">{exp.category_icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{exp.description}</p>
                      <p className="text-xs text-gray-400">{exp.category_name} · {formatDate(exp.date)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-red-500">{formatCurrency(exp.owed_amount, exp.currency_code)}</p>
                      <p className="text-[10px] text-gray-400">of {formatCurrency(exp.total_amount, exp.currency_code)}</p>
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

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/groups/${groupId}`)} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Reports</h1>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">📊</p>
          <p className="font-medium text-gray-700">Failed to load reports</p>
        </div>
      )}

      {!loading && !error && summary && (
        <div className="space-y-4 sm:space-y-5">
          {summary.expense_count === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">📊</p>
              <p className="font-medium text-gray-700">No expenses yet</p>
              <p className="text-sm text-gray-500 mt-1">Add some expenses to see reports.</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-4 sm:p-5">
                  <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Spent</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900 leading-tight">{formatCurrency(summary.total_spent, summary.currency_code)}</p>
                </div>
                <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-4 sm:p-5">
                  <p className="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Expenses</p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900 leading-tight">{summary.expense_count}</p>
                  <p className="text-[10px] sm:text-xs text-gray-400 mt-1">total</p>
                </div>
              </div>

              {/* Category breakdown */}
              {sortedCategories.length > 0 && (
                <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-4 sm:p-5">
                  <h2 className="text-xs sm:text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 sm:mb-4">By Category</h2>
                  <div className="space-y-3">
                    {sortedCategories.map((cat) => (
                      <CategoryBar key={cat.category_id} category={cat} maxAmount={maxCategoryAmount} currencyCode={summary.currency_code} />
                    ))}
                  </div>
                </div>
              )}

              {/* Per-member — card layout on mobile */}
              {summary.per_member.length > 0 && (
                <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-100">
                    <h2 className="text-xs sm:text-sm font-semibold text-gray-500 uppercase tracking-wide">Members</h2>
                    <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">Tap to see details</p>
                  </div>

                  {/* Mobile: card layout */}
                  <div className="sm:hidden divide-y divide-gray-100">
                    {summary.per_member.map((member) => {
                      const net = member.total_paid - member.total_owed;
                      const isSelected = selectedMember?.member_id === member.member_id;
                      return (
                        <div key={member.member_id}>
                          <button
                            onClick={() => setSelectedMember(isSelected ? null : member)}
                            className={cn("w-full text-left px-4 py-3", isSelected ? "bg-green-50" : "hover:bg-gray-50")}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                                  isSelected ? "bg-green-200 text-green-800" : "bg-gray-100 text-gray-600"
                                )}>{member.member_name[0]?.toUpperCase()}</div>
                                <span className="text-sm font-medium text-gray-800">{member.member_name}</span>
                              </div>
                              <span className={cn("text-sm font-semibold", net > 0 ? "text-green-600" : net < 0 ? "text-red-500" : "text-gray-400")}>
                                {net > 0 ? "+" : ""}{formatCurrency(net, summary.currency_code)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-2 ml-9">
                              <div>
                                <p className="text-[10px] text-gray-400">Paid</p>
                                <p className="text-xs font-medium text-gray-700">{formatCurrency(member.total_paid, summary.currency_code)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-gray-400">Owed</p>
                                <p className="text-xs font-medium text-gray-700">{formatCurrency(member.total_owed, summary.currency_code)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-gray-400">Expenses</p>
                                <p className="text-xs font-medium text-gray-700">{member.expense_count}</p>
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
                        <tr className="bg-gray-50 text-left">
                          <th className="px-5 py-3 text-xs font-medium text-gray-500">Name</th>
                          <th className="px-3 py-3 text-xs font-medium text-gray-500 text-right">Paid</th>
                          <th className="px-3 py-3 text-xs font-medium text-gray-500 text-right">Owed</th>
                          <th className="px-3 py-3 text-xs font-medium text-gray-500 text-right">Net</th>
                          <th className="px-3 py-3 text-xs font-medium text-gray-500 text-right">Expenses</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {summary.per_member.map((member) => {
                          const net = member.total_paid - member.total_owed;
                          const isSelected = selectedMember?.member_id === member.member_id;
                          return (
                            <tr key={member.member_id} onClick={() => setSelectedMember(isSelected ? null : member)}
                              className={cn("cursor-pointer", isSelected ? "bg-green-50" : "hover:bg-gray-50")}>
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-2">
                                  <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                                    isSelected ? "bg-green-200 text-green-800" : "bg-gray-100 text-gray-600"
                                  )}>{member.member_name[0]?.toUpperCase()}</div>
                                  <span className="font-medium text-gray-800">{member.member_name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-3.5 text-right text-gray-700">{formatCurrency(member.total_paid, summary.currency_code)}</td>
                              <td className="px-3 py-3.5 text-right text-gray-700">{formatCurrency(member.total_owed, summary.currency_code)}</td>
                              <td className={cn("px-3 py-3.5 text-right font-semibold", net > 0 ? "text-green-600" : net < 0 ? "text-red-500" : "text-gray-400")}>
                                {net > 0 ? "+" : ""}{formatCurrency(net, summary.currency_code)}
                              </td>
                              <td className="px-3 py-3.5 text-right text-gray-500">{member.expense_count}</td>
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
