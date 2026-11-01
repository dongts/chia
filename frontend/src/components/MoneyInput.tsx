import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatCompactCurrency, getSeparators, isZeroDecimalCurrency } from "@/utils/currency";

interface MoneyInputProps {
  /** Canonical value: digits with optional "." decimal point and leading "-", e.g. "1500000" or "12.5". */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  containerClassName?: string;
  currencyCode?: string;
  /** Overrides the currency-derived limit (0 for VND/JPY…, 2 otherwise). */
  maxDecimals?: number;
  allowNegative?: boolean;
  showQuickAmounts?: boolean;
  "aria-label"?: string;
}

const QUICK_AMOUNTS: Record<string, number[]> = {
  VND: [10_000, 20_000, 50_000, 100_000, 200_000, 500_000],
  CNY: [10, 20, 50, 100, 200, 500],
};

/**
 * Turn whatever the user typed or pasted into a canonical number string.
 * Accepts the locale's separators plus common foreign ones:
 * "1.000.000" / "1,000,000" / "1 000 000" → "1000000"; "12,5" or "12.5" → "12.5".
 */
function parseMoneyInput(raw: string, maxDecimals: number, allowNegative = false): string | null {
  const negative = allowNegative && raw.trim().startsWith("-");
  const s = raw.replace(/[^0-9.,]/g, "");
  if (!s) return negative ? "-" : "";

  const { decimal } = getSeparators();
  let intPart = s;
  let fracPart: string | undefined;

  if (maxDecimals > 0) {
    const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    if (lastSep >= 0) {
      const sepChar = s[lastSep];
      const after = s.slice(lastSep + 1);
      const sepCount = s.split(sepChar).length - 1;
      // The locale decimal mark means decimal. The other mark is a group separator,
      // except when it is typed as the very last char ("12." on a keypad that only
      // offers "." while the app is in a "," locale) — then it starts the decimals.
      const isDecimal =
        sepCount === 1 &&
        (sepChar === decimal || (!s.includes(decimal) && after.length === 0));
      if (isDecimal) {
        intPart = s.slice(0, lastSep);
        fracPart = after;
      }
    }
  } else {
    // Zero-decimal currency (VND, JPY…): a single locale decimal mark that isn't
    // followed by exactly 3 digits is a fraction ("150000.00", "1250000.5") — drop it
    // rather than gluing the digits on (which would silently multiply the amount).
    const idx = s.lastIndexOf(decimal);
    const after = idx >= 0 ? s.slice(idx + 1) : "";
    if (idx >= 0 && s.split(decimal).length === 2 && after.length !== 3 && /^\d*$/.test(after)) {
      intPart = s.slice(0, idx);
    }
  }

  intPart = intPart.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
  if (fracPart !== undefined) {
    fracPart = fracPart.replace(/[.,]/g, "");
    if (fracPart.length > maxDecimals) return null; // reject the keystroke
    if (!intPart) intPart = "0";
  }
  const out = fracPart !== undefined ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${out}` : out;
}

/** Canonical "1234567.5" → locale display "1,234,567.5" / "1.234.567,5". */
function formatMoneyDisplay(val: string): string {
  if (!val) return "";
  const { group, decimal } = getSeparators();
  const negative = val.startsWith("-");
  const body = negative ? val.slice(1) : val;
  const [intPart, fracPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const out = fracPart !== undefined ? `${grouped}${decimal}${fracPart}` : grouped;
  return negative ? `-${out}` : out;
}

/** Canonical value from the parent/API ("150000.00", "12.50") → trimmed to the allowed decimals. */
function normalizeExternal(val: string, maxDecimals: number): string {
  if (!val || !val.includes(".")) return val;
  const [intPart, fracPart] = val.split(".");
  let frac = fracPart;
  while (frac.length > maxDecimals && frac.endsWith("0")) frac = frac.slice(0, -1);
  if (maxDecimals === 0 && frac === "") return intPart;
  return frac.length > maxDecimals ? val : `${intPart}.${frac}`;
}

/** Count of characters that survive re-formatting (digits, decimal mark, minus). */
function significantCount(text: string, decimal: string): number {
  let n = 0;
  for (const ch of text) if (/[0-9-]/.test(ch) || ch === decimal) n++;
  return n;
}

export default function MoneyInput({
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  disabled,
  className,
  containerClassName,
  currencyCode,
  maxDecimals,
  allowNegative = false,
  showQuickAmounts = true,
  "aria-label": ariaLabel,
}: MoneyInputProps) {
  const { i18n } = useTranslation();
  const decimals = maxDecimals ?? (isZeroDecimalCurrency(currencyCode) ? 0 : 2);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [display, setDisplay] = useState(() => formatMoneyDisplay(normalizeExternal(value, decimals)));

  useEffect(() => {
    // Sync when the value changes from outside (reset, AI fill, quick chip…)
    const current = parseMoneyInput(display, decimals, allowNegative);
    const incoming = normalizeExternal(value, decimals);
    if (current !== incoming) setDisplay(formatMoneyDisplay(incoming));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Re-render separators when the app language (and thus number locale) changes.
  useEffect(() => {
    setDisplay(formatMoneyDisplay(normalizeExternal(value, decimals)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  // Keep the caret next to the digit the user just typed/deleted, even after separators move.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || pendingCaret.current == null || document.activeElement !== el) return;
    const { decimal } = getSeparators();
    let target = pendingCaret.current;
    let pos = 0;
    while (pos < display.length && target > 0) {
      if (significantCount(display[pos], decimal) > 0) target--;
      pos++;
    }
    el.setSelectionRange(pos, pos);
    pendingCaret.current = null;
  }, [display]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const numeric = parseMoneyInput(raw, decimals, allowNegative);
    if (numeric === null) return;
    const { decimal } = getSeparators();
    const caret = e.target.selectionStart ?? raw.length;
    // Count significant chars before the caret in the *normalised* text so a pasted
    // foreign separator doesn't throw the count off.
    const before = formatMoneyDisplay(parseMoneyInput(raw.slice(0, caret), decimals, allowNegative) ?? "");
    pendingCaret.current = significantCount(before, decimal);
    setDisplay(formatMoneyDisplay(numeric));
    onChange(numeric === "-" ? "" : numeric);
  }

  const quickAmounts =
    showQuickAmounts && currencyCode ? QUICK_AMOUNTS[currencyCode.toUpperCase()] : undefined;

  return (
    <div className={containerClassName}>
      <input
        ref={inputRef}
        type="text"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        value={display}
        onChange={handleChange}
        onBlur={onBlur}
        placeholder={placeholder ?? (decimals > 0 ? formatMoneyDisplay("0.00") : "0")}
        className={cn(
          "w-full h-12 bg-surface-container-high/50 border-0 rounded-xl px-4 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors tabular-nums disabled:opacity-60",
          className
        )}
      />
      {quickAmounts && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {quickAmounts.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => {
                const newVal = String(amt);
                setDisplay(formatMoneyDisplay(newVal));
                onChange(newVal);
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors tabular-nums",
                value === String(amt)
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              )}
            >
              {formatCompactCurrency(amt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
