import { useState } from "react";
import { Search, CheckCircle2, Circle, Check } from "lucide-react";
import type { GroupMember, SplitType } from "@/types";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/utils/currency";

interface MemberSplitListProps {
  members: GroupMember[];
  splitType: SplitType;
  // Equal
  equalChecked: Record<string, boolean>;
  onEqualToggle: (memberId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  // Exact
  exactValues: Record<string, string>;
  onExactChange: (memberId: string, value: string) => void;
  totalAmount?: string;
  splittableAmount?: string;
  currencyCode?: string;
  // Percentage
  percentValues: Record<string, string>;
  onPercentChange: (memberId: string, value: string) => void;
  // Shares
  shareValues: Record<string, string>;
  onShareChange: (memberId: string, value: string) => void;
}

export default function MemberSplitList({
  members, splitType,
  equalChecked, onEqualToggle, onSelectAll, onSelectNone,
  exactValues, onExactChange, totalAmount, splittableAmount, currencyCode,
  percentValues, onPercentChange,
  shareValues, onShareChange,
}: MemberSplitListProps) {
  const [search, setSearch] = useState("");

  // Sort: for equal mode keep stable order (alphabetical only) to avoid scroll jumps.
  // For other modes, sort active values first then alphabetical.
  const sorted = [...members].sort((a, b) => {
    if (splitType !== "equal") {
      let aActive = false;
      let bActive = false;
      if (splitType === "exact") {
        aActive = parseFloat(exactValues[a.id] || "0") > 0;
        bActive = parseFloat(exactValues[b.id] || "0") > 0;
      } else if (splitType === "percentage") {
        aActive = parseFloat(percentValues[a.id] || "0") > 0;
        bActive = parseFloat(percentValues[b.id] || "0") > 0;
      } else if (splitType === "shares") {
        aActive = parseFloat(shareValues[a.id] || "0") > 0;
        bActive = parseFloat(shareValues[b.id] || "0") > 0;
      }
      if (aActive !== bActive) return aActive ? -1 : 1;
    }
    return a.display_name.localeCompare(b.display_name);
  });

  const filtered = search
    ? sorted.filter((m) => m.display_name.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const selectedCount = members.filter((m) => equalChecked[m.id] ?? true).length;
  const amt = parseFloat(splittableAmount || totalAmount || "0");
  const totalShares = Object.values(shareValues).reduce((a, v) => a + parseFloat(v || "0"), 0);

  function getPerPersonAmount(memberId: string): number | null {
    if (!amt || amt <= 0) return null;
    if (splitType === "equal") {
      return selectedCount > 0 && (equalChecked[memberId] ?? true) ? amt / selectedCount : null;
    }
    if (splitType === "percentage") {
      const pct = parseFloat(percentValues[memberId] || "0");
      return pct > 0 ? (amt * pct) / 100 : null;
    }
    if (splitType === "shares") {
      const share = parseFloat(shareValues[memberId] || "0");
      return share > 0 && totalShares > 0 ? (amt * share) / totalShares : null;
    }
    return null;
  }

  return (
    <div>
      {/* Search + All/None */}
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${members.length} members...`}
            className="w-full pl-8 pr-3 py-2 border border-outline-variant/15 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
        {splitType === "equal" && (
          <div className="flex gap-1 flex-shrink-0">
            <button type="button" onClick={onSelectAll}
              className="text-xs text-primary font-medium px-2.5 py-2 rounded-lg border border-primary-container hover:bg-primary-container/20 transition-colors">All</button>
            <button type="button" onClick={onSelectNone}
              className="text-xs text-on-surface-variant font-medium px-2.5 py-2 rounded-lg border border-outline-variant/15 hover:bg-surface-container transition-colors">None</button>
          </div>
        )}
      </div>

      {/* Counter */}
      {splitType === "equal" && (
        <p className="text-xs text-outline mb-2">{selectedCount} of {members.length} selected</p>
      )}

      {/* Member list */}
      <div className="border border-outline-variant/15 rounded-xl overflow-hidden divide-y divide-outline-variant/10 max-h-80 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-outline text-center py-6">No members found</p>
        ) : (
          filtered.map((m) => {
            const checked = equalChecked[m.id] ?? true;

            return (
              <div key={m.id}>
                {splitType === "equal" && (
                  <button
                    type="button"
                    onClick={() => onEqualToggle(m.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                      checked ? "bg-primary-container/20" : "bg-surface-container-lowest hover:bg-surface-container"
                    )}
                  >
                    {checked
                      ? <CheckCircle2 size={20} className="text-primary flex-shrink-0" />
                      : <Circle size={20} className="text-outline-variant flex-shrink-0" />
                    }
                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-sm font-bold text-on-surface-variant flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className={cn("text-sm font-medium truncate", checked ? "text-on-surface" : "text-outline")}>
                      {m.display_name}
                    </span>
                    {checked && getPerPersonAmount(m.id) != null && (
                      <span className="ml-auto text-xs text-primary font-medium flex-shrink-0 mr-1">
                        {formatAmount(getPerPersonAmount(m.id)!, currencyCode)}
                      </span>
                    )}
                    {checked && <Check size={16} className="text-primary flex-shrink-0" />}
                  </button>
                )}

                {splitType === "exact" && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-sm font-bold text-on-surface-variant flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-on-surface flex-1 truncate">{m.display_name}</span>
                    <input type="number" min="0" step="0.01"
                      value={exactValues[m.id] ?? ""}
                      onChange={(e) => onExactChange(m.id, e.target.value)}
                      placeholder="0.00"
                      className="w-24 border border-outline-variant/15 rounded-lg px-2.5 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
                  </div>
                )}

                {splitType === "percentage" && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-sm font-bold text-on-surface-variant flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-on-surface flex-1 truncate">{m.display_name}</span>
                    {getPerPersonAmount(m.id) != null && (
                      <span className="text-xs text-primary font-medium">{formatAmount(getPerPersonAmount(m.id)!, currencyCode)}</span>
                    )}
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="0.01"
                        value={percentValues[m.id] ?? ""}
                        onChange={(e) => onPercentChange(m.id, e.target.value)}
                        placeholder="0"
                        className="w-20 border border-outline-variant/15 rounded-lg px-2.5 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
                      <span className="text-xs text-outline">%</span>
                    </div>
                  </div>
                )}

                {splitType === "shares" && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-sm font-bold text-on-surface-variant flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-on-surface flex-1 truncate">{m.display_name}</span>
                    {getPerPersonAmount(m.id) != null && (
                      <span className="text-xs text-primary font-medium">{formatAmount(getPerPersonAmount(m.id)!, currencyCode)}</span>
                    )}
                    <div className="flex items-center gap-1">
                      <button type="button"
                        onClick={() => onShareChange(m.id, String(Math.max(0, parseFloat(shareValues[m.id] || "0") - 1)))}
                        className="w-8 h-8 rounded-lg border border-outline-variant/15 text-on-surface-variant hover:bg-surface-container flex items-center justify-center text-lg font-medium">−</button>
                      <input type="number" min="0" step="1"
                        value={shareValues[m.id] ?? "1"}
                        onChange={(e) => onShareChange(m.id, e.target.value)}
                        className="w-12 text-center border border-outline-variant/15 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
                      <button type="button"
                        onClick={() => onShareChange(m.id, String(parseFloat(shareValues[m.id] || "0") + 1))}
                        className="w-8 h-8 rounded-lg border border-outline-variant/15 text-on-surface-variant hover:bg-surface-container flex items-center justify-center text-lg font-medium">+</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Validation summaries */}
      {splitType === "exact" && totalAmount && (
        <p className={cn("text-xs mt-2",
          Math.abs(Object.values(exactValues).reduce((a, v) => a + parseFloat(v || "0"), 0) - parseFloat(totalAmount)) < 0.02
            ? "text-primary" : "text-on-tertiary-container"
        )}>
          Sum: {formatAmount(Object.values(exactValues).reduce((a, v) => a + parseFloat(v || "0"), 0), currencyCode)} / {formatAmount(parseFloat(totalAmount || "0"), currencyCode)}
        </p>
      )}

      {splitType === "percentage" && (
        <p className={cn("text-xs mt-2",
          Math.abs(Object.values(percentValues).reduce((a, v) => a + parseFloat(v || "0"), 0) - 100) < 0.1
            ? "text-primary" : "text-on-tertiary-container"
        )}>
          Sum: {Object.values(percentValues).reduce((a, v) => a + parseFloat(v || "0"), 0).toFixed(1)}% / 100%
        </p>
      )}
    </div>
  );
}
