import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Minus, Trash2 } from "lucide-react";
import { getFund, listFundTransactions, createFundTransaction, deleteFundTransaction } from "@/api/funds";
import { listMembers } from "@/api/members";
import { getGroup } from "@/api/groups";
import type { FundDetail as FundDetailType, FundTransaction, GroupMember, Group } from "@/types";
import { formatCurrency } from "@/utils/currency";
import { cn } from "@/lib/utils";
import MoneyInput from "@/components/MoneyInput";
import { X } from "lucide-react";

export default function FundDetailPage() {
  const { groupId, fundId } = useParams<{ groupId: string; fundId: string }>();
  const { t } = useTranslation("group");

  const TX_TYPE_CONFIG = {
    contribute: { label: t("fund_detail.tx_type.contribute"), color: "text-primary", icon: "▲" },
    withdraw: { label: t("fund_detail.tx_type.withdraw"), color: "text-error", icon: "▼" },
    expense: { label: t("fund_detail.tx_type.expense"), color: "text-error", icon: "▼" },
    holder_change: { label: t("fund_detail.tx_type.holder_change"), color: "text-tertiary", icon: "↔" },
  } as const;

  const [fund, setFund] = useState<FundDetailType | null>(null);
  const [transactions, setTransactions] = useState<FundTransaction[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [showModal, setShowModal] = useState<"contribute" | "withdraw" | null>(null);
  const [txAmount, setTxAmount] = useState("");
  const [txMemberId, setTxMemberId] = useState("");
  const [txNote, setTxNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = () => {
    if (!groupId || !fundId) return;
    getFund(groupId, fundId).then(setFund);
    listFundTransactions(groupId, fundId).then(setTransactions);
    listMembers(groupId).then(setMembers);
    getGroup(groupId).then(setGroup);
  };

  useEffect(loadData, [groupId, fundId]);

  const handleCreateTransaction = async () => {
    if (!groupId || !fundId || !txAmount || !txMemberId || !showModal) return;
    setSubmitting(true);
    try {
      await createFundTransaction(groupId, fundId, {
        type: showModal,
        amount: parseFloat(txAmount),
        member_id: txMemberId,
        note: txNote.trim() || null,
      });
      closeModal();
      loadData();
    } catch {
      window.alert(t("fund_detail.failed_create_tx"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTransaction = async (txId: string) => {
    if (!groupId || !fundId) return;
    if (!window.confirm(t("fund_detail.confirm_delete_tx"))) return;
    try {
      await deleteFundTransaction(groupId, fundId, txId);
      loadData();
    } catch {
      window.alert(t("fund_detail.failed_delete_tx"));
    }
  };

  const closeModal = () => {
    setShowModal(null);
    setTxAmount("");
    setTxMemberId("");
    setTxNote("");
  };

  if (!fund || !group) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-container-high rounded w-1/3" />
        <div className="h-4 bg-surface-container rounded w-1/4" />
      </div>
    );
  }

  const currency = group.currency_code;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          to={`/groups/${groupId}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-dim transition-colors mb-3"
        >
          <ArrowLeft size={16} /> {t("fund_detail.back")}
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-on-surface">{fund.name}</h1>
            {fund.description && (
              <p className="text-sm text-on-surface-variant mt-1">{fund.description}</p>
            )}
            <p className="text-xs text-on-surface-variant mt-1">
              {t("fund_detail.holder")}: {fund.holder_name}
              {!fund.is_active && (
                <span className="ml-2 text-[10px] bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                  {t("fund_detail.closed")}
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className={cn(
              "text-2xl font-bold",
              fund.balance > 0 ? "text-primary" : "text-outline"
            )}>
              {formatCurrency(fund.balance, currency)}
            </p>
            <p className="text-[10px] text-outline uppercase tracking-wide">{t("funds.balance")}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      {fund.is_active && (
        <div className="flex gap-2">
          <button
            onClick={() => setShowModal("contribute")}
            className="flex items-center gap-1.5 bg-primary hover:bg-primary-dim text-on-primary font-medium px-4 py-2 rounded-full text-sm transition-colors"
          >
            <Plus size={16} /> {t("fund_detail.contribute")}
          </button>
          <button
            onClick={() => setShowModal("withdraw")}
            className="flex items-center gap-1.5 bg-error hover:bg-error/80 text-on-error font-medium px-4 py-2 rounded-full text-sm transition-colors"
          >
            <Minus size={16} /> {t("fund_detail.withdraw")}
          </button>
        </div>
      )}

      {!fund.is_active && (
        <div className="bg-surface-container rounded-2xl p-4 text-center text-sm text-on-surface-variant">
          {t("fund_detail.closed_notice")}
        </div>
      )}

      {/* Contributions by member */}
      {fund.contributions_by_member.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-editorial p-4">
          <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide mb-3">{t("fund_detail.contributions_by_member")}</p>
          <div className="flex flex-wrap gap-3">
            {fund.contributions_by_member.map((c) => (
              <div key={c.member_id} className="flex items-center gap-2 text-sm">
                <div className="w-8 h-8 rounded-full bg-primary-container/20 flex items-center justify-center text-xs font-bold text-primary">
                  {c.member_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-medium text-on-surface">{c.member_name}</p>
                  <p className="text-xs text-on-surface-variant">{formatCurrency(c.total, currency)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div>
        <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide mb-3">{t("fund_detail.transaction_history")}</p>
        {transactions.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-2xl shadow-editorial py-12 text-center">
            <p className="text-on-surface-variant text-sm">{t("fund_detail.no_transactions")}</p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden divide-y divide-outline-variant/10">
            {transactions.map((tx) => {
              const config = TX_TYPE_CONFIG[tx.type];
              return (
                <div key={tx.id} className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      <span className={cn("font-semibold", config.color)}>
                        {config.icon} {config.label}
                      </span>
                      {" · "}
                      {tx.type === "holder_change"
                        ? (tx.note || `Changed to ${tx.member_name}`)
                        : `${tx.member_name} ${formatCurrency(tx.amount, currency)}`}
                    </div>
                    {tx.note && tx.type !== "holder_change" && (
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">{tx.note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <div className="text-right">
                      <p className="text-[11px] text-outline">
                        {new Date(tx.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </p>
                      <p className="text-[10px] text-outline">{t("fund_detail.by")} {tx.created_by_name}</p>
                    </div>
                    {(tx.type === "contribute" || tx.type === "withdraw") && (
                      <button
                        onClick={() => handleDeleteTransaction(tx.id)}
                        className="p-1.5 rounded-full text-outline hover:text-error hover:bg-error-container/20 transition-colors"
                        title={t("delete", { ns: "common" })}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transaction Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
          onClick={closeModal}
        >
          <div
            className="bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-editorial-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-2">
              <h3 className="text-lg font-bold text-on-surface capitalize">{showModal === "contribute" ? t("fund_detail.contribute") : t("fund_detail.withdraw")}</h3>
              <button
                onClick={closeModal}
                className="p-2 text-outline hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 pb-6 pt-3 space-y-4">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">{t("fund_detail.modal.member_label")} *</label>
                <select
                  value={txMemberId}
                  onChange={(e) => setTxMemberId(e.target.value)}
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors appearance-none cursor-pointer"
                >
                  <option value="">{t("fund_detail.modal.member_placeholder")}</option>
                  {members.filter((m) => m.is_active).map((m) => (
                    <option key={m.id} value={m.id}>{m.display_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  {t("fund_detail.modal.amount_label")} ({currency}) *
                </label>
                <MoneyInput value={txAmount} onChange={setTxAmount} />
              </div>
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  {t("fund_detail.modal.note_label")} <span className="text-outline font-normal">({t("fund_detail.modal.note_optional")})</span>
                </label>
                <input
                  type="text"
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  placeholder="e.g. Tiền phạt thua trận"
                  className="w-full bg-surface-container-high/50 border-0 rounded-xl px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container transition-colors"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeModal}
                  className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface font-medium py-2.5 rounded-full text-sm transition-colors"
                >
                  {t("fund_detail.modal.cancel")}
                </button>
                <button
                  onClick={handleCreateTransaction}
                  disabled={submitting || !txMemberId || !txAmount}
                  className={cn(
                    "flex-1 disabled:opacity-50 text-white font-medium py-2.5 rounded-full text-sm transition-colors",
                    showModal === "contribute"
                      ? "bg-primary hover:bg-primary-dim"
                      : "bg-error hover:bg-error/80"
                  )}
                >
                  {submitting ? t("fund_detail.modal.saving") : showModal === "contribute" ? t("fund_detail.modal.add_contribution") : t("fund_detail.modal.record_withdrawal")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
