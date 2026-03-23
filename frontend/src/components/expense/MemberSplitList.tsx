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
  exactValues, onExactChange, totalAmount, currencyCode,
  percentValues, onPercentChange,
  shareValues, onShareChange,
}: MemberSplitListProps) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? members.filter((m) => m.display_name.toLowerCase().includes(search.toLowerCase()))
    : members;

  const selectedCount = members.filter((m) => equalChecked[m.id] ?? true).length;

  return (
    <div>
      {/* Search + All/None */}
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${members.length} members...`}
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        {splitType === "equal" && (
          <div className="flex gap-1 flex-shrink-0">
            <button type="button" onClick={onSelectAll}
              className="text-xs text-green-700 font-medium px-2.5 py-2 rounded-lg border border-green-200 hover:bg-green-50 transition-colors">All</button>
            <button type="button" onClick={onSelectNone}
              className="text-xs text-gray-600 font-medium px-2.5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">None</button>
          </div>
        )}
      </div>

      {/* Counter */}
      {splitType === "equal" && (
        <p className="text-xs text-gray-400 mb-2">{selectedCount} of {members.length} selected</p>
      )}

      {/* Member list */}
      <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-80 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No members found</p>
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
                      checked ? "bg-green-50/50" : "bg-white hover:bg-gray-50"
                    )}
                  >
                    {checked
                      ? <CheckCircle2 size={20} className="text-green-600 flex-shrink-0" />
                      : <Circle size={20} className="text-gray-300 flex-shrink-0" />
                    }
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className={cn("text-sm font-medium truncate", checked ? "text-gray-900" : "text-gray-400")}>
                      {m.display_name}
                    </span>
                    {checked && <Check size={16} className="ml-auto text-green-600 flex-shrink-0" />}
                  </button>
                )}

                {splitType === "exact" && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 flex-1 truncate">{m.display_name}</span>
                    <input type="number" min="0" step="0.01"
                      value={exactValues[m.id] ?? ""}
                      onChange={(e) => onExactChange(m.id, e.target.value)}
                      placeholder="0.00"
                      className="w-24 border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                  </div>
                )}

                {splitType === "percentage" && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 flex-1 truncate">{m.display_name}</span>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="0.01"
                        value={percentValues[m.id] ?? ""}
                        onChange={(e) => onPercentChange(m.id, e.target.value)}
                        placeholder="0"
                        className="w-20 border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                  </div>
                )}

                {splitType === "shares" && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                      {m.display_name[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 flex-1 truncate">{m.display_name}</span>
                    <div className="flex items-center gap-1">
                      <button type="button"
                        onClick={() => onShareChange(m.id, String(Math.max(0, parseFloat(shareValues[m.id] || "1") - 1)))}
                        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center text-lg font-medium">−</button>
                      <input type="number" min="0" step="1"
                        value={shareValues[m.id] ?? "1"}
                        onChange={(e) => onShareChange(m.id, e.target.value)}
                        className="w-12 text-center border border-gray-200 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                      <button type="button"
                        onClick={() => onShareChange(m.id, String(parseFloat(shareValues[m.id] || "1") + 1))}
                        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center text-lg font-medium">+</button>
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
            ? "text-green-600" : "text-amber-500"
        )}>
          Sum: {formatAmount(Object.values(exactValues).reduce((a, v) => a + parseFloat(v || "0"), 0), currencyCode)} / {formatAmount(parseFloat(totalAmount || "0"), currencyCode)}
        </p>
      )}

      {splitType === "percentage" && (
        <p className={cn("text-xs mt-2",
          Math.abs(Object.values(percentValues).reduce((a, v) => a + parseFloat(v || "0"), 0) - 100) < 0.1
            ? "text-green-600" : "text-amber-500"
        )}>
          Sum: {Object.values(percentValues).reduce((a, v) => a + parseFloat(v || "0"), 0).toFixed(1)}% / 100%
        </p>
      )}
    </div>
  );
}
