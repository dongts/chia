import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface MoneyInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  currencyCode?: string;
}

const QUICK_AMOUNTS: Record<string, number[]> = {
  VND: [10_000, 20_000, 50_000, 100_000, 200_000, 500_000],
  CNY: [10, 20, 50, 100, 200, 500],
};

function formatChipLabel(amount: number): string {
  if (amount >= 1_000_000) return `${amount / 1_000_000}M`;
  if (amount >= 1_000) return `${amount / 1_000}K`;
  return String(amount);
}

function formatWithSeparator(val: string): string {
  if (!val) return "";
  const parts = val.split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
}

function stripSeparator(val: string): string {
  return val.replace(/,/g, "");
}

export default function MoneyInput({ value, onChange, placeholder = "0.00", required, className, currencyCode }: MoneyInputProps) {
  const [display, setDisplay] = useState(() => formatWithSeparator(value));

  useEffect(() => {
    // Sync if value changed externally
    const stripped = stripSeparator(display);
    if (stripped !== value) {
      setDisplay(formatWithSeparator(value));
    }
  }, [value]);

  function handleChange(raw: string) {
    // Allow only digits, dots, and commas
    const cleaned = raw.replace(/[^0-9.,]/g, "");
    // Strip commas for the real value
    const numeric = stripSeparator(cleaned);

    // Validate: at most one dot, max 2 decimal places
    const dotCount = (numeric.match(/\./g) || []).length;
    if (dotCount > 1) return;

    const parts = numeric.split(".");
    if (parts[1] && parts[1].length > 2) return;

    // Update display with formatting
    setDisplay(formatWithSeparator(numeric));
    onChange(numeric);
  }

  const quickAmounts = currencyCode ? QUICK_AMOUNTS[currencyCode.toUpperCase()] : undefined;

  return (
    <div>
      <input
        type="text"
        inputMode="decimal"
        required={required}
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full h-12 bg-surface-container-high/50 border-0 rounded-xl px-4 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary hover:bg-surface-container-high/70 transition-colors tabular-nums",
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
                setDisplay(formatWithSeparator(newVal));
                onChange(newVal);
              }}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                value === String(amt)
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              )}
            >
              {formatChipLabel(amt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
