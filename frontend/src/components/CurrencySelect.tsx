import { useState, useRef, useEffect } from "react";
import type { CurrencyInfo } from "@/utils/currencies";
import { CURRENCIES } from "@/utils/currencies";
import { ChevronDown } from "lucide-react";

interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  /** If provided, only these codes + any extras are shown */
  allowedCodes?: string[];
  /** Extra options to prepend (e.g., group main currency with label) */
  extraOptions?: { code: string; label: string }[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  compact?: boolean;
}

export default function CurrencySelect({
  value,
  onChange,
  allowedCodes,
  extraOptions,
  placeholder = "Select currency",
  className = "",
  disabled = false,
  compact = false,
}: CurrencySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Build filtered list
  let currencies: CurrencyInfo[];
  if (allowedCodes) {
    const codeSet = new Set(allowedCodes.map((c) => c.toUpperCase()));
    currencies = CURRENCIES.filter((c) => codeSet.has(c.code));
  } else {
    currencies = CURRENCIES;
  }

  const query = search.toLowerCase();
  const filtered = query
    ? currencies.filter(
        (c) =>
          c.code.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query) ||
          c.symbol.includes(query)
      )
    : currencies;

  const selectedCurrency = CURRENCIES.find((c) => c.code === value);
  const displayText = selectedCurrency
    ? `${selectedCurrency.code} — ${selectedCurrency.name}`
    : value || placeholder;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
        className={compact
          ? "w-full h-12 flex items-center justify-center bg-surface-container-high/50 rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container-high/70 focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
          : "w-full flex items-center justify-between border border-outline-variant/15 rounded-lg px-3 py-2.5 text-sm text-left focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-60 bg-surface-container-lowest"
        }
      >
        {compact ? (
          <span>{value || "---"}</span>
        ) : (
          <>
            <span className={value ? "text-on-surface" : "text-outline"}>{displayText}</span>
            <ChevronDown size={14} className="text-outline flex-shrink-0" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-surface-container-lowest border border-outline-variant/15 rounded-lg shadow-editorial-lg max-h-64 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-outline-variant/10">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search currency..."
              className="w-full border border-outline-variant/15 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-y-auto">
            {/* Extra options first */}
            {extraOptions?.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  onChange(opt.code);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-container/20 transition-colors ${
                  value === opt.code ? "bg-primary-container/20 text-primary font-medium" : "text-on-surface"
                }`}
              >
                {opt.label}
              </button>
            ))}
            {extraOptions && extraOptions.length > 0 && filtered.length > 0 && (
              <div className="border-t border-outline-variant/10" />
            )}

            {filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  onChange(c.code);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-container/20 transition-colors flex items-center gap-2 ${
                  value === c.code ? "bg-primary-container/20 text-primary font-medium" : "text-on-surface"
                }`}
              >
                <span className="w-10 font-mono text-xs">{c.code}</span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-outline text-xs">{c.symbol}</span>
              </button>
            ))}

            {filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-outline text-center">No currencies found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
