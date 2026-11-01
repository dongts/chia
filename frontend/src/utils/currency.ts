import i18n from "@/i18n";

// Zero-decimal currencies that should never show .00
const ZERO_DECIMAL_CURRENCIES = new Set([
  "VND", "JPY", "KRW", "CLP", "ISK", "UGX", "GNF", "BIF", "DJF",
  "KMF", "MGA", "PYG", "RWF", "VUV", "XAF", "XOF", "XPF",
]);

const LANGUAGE_LOCALES: Record<string, string> = {
  en: "en-US",
  vi: "vi-VN",
};

/** Number locale follows the app language (not the browser), so amounts typed
 *  in MoneyInput and amounts displayed everywhere use the same separators. */
export function getNumberLocale(): string {
  const lang = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  return LANGUAGE_LOCALES[lang] ?? "en-US";
}

export function isZeroDecimalCurrency(currencyCode?: string | null): boolean {
  return !!currencyCode && ZERO_DECIMAL_CURRENCIES.has(currencyCode.toUpperCase());
}

/** Group/decimal separators for the current number locale. */
export function getSeparators(): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(getNumberLocale()).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

function toNumber(amount: number | string | null | undefined): number {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function fractionDigits(amount: number, currencyCode?: string | null): number {
  if (isZeroDecimalCurrency(currencyCode)) return 0;
  // Compare at cent precision so 12.000001 doesn't render as "12.00"
  return Math.round(amount * 100) % 100 === 0 ? 0 : 2;
}

export function formatCurrency(amount: number | string, currencyCode: string = "USD"): string {
  const n = toNumber(amount);
  const decimals = fractionDigits(n, currencyCode);
  try {
    return new Intl.NumberFormat(getNumberLocale(), {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    // Unknown/invalid currency code — still show a grouped number
    return `${formatAmount(n, currencyCode)} ${currencyCode}`;
  }
}

export function formatAmount(amount: number | string, currencyCode?: string | null): string {
  const n = toNumber(amount);
  const decimals = fractionDigits(n, currencyCode);
  return new Intl.NumberFormat(getNumberLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Plain counts (expenses, members, users…) with thousand separators. */
export function formatNumber(value: number | string, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(getNumberLocale(), { maximumFractionDigits }).format(toNumber(value));
}

/** Exchange rates and other non-money decimals: grouped, up to 6 decimals. */
export function formatRate(value: number | string): string {
  return formatNumber(value, 6);
}

/** Percent given on a 0–100 scale. Tiny non-zero shares show "<1%" instead of "0%". */
export function formatPercent(value: number, maximumFractionDigits = 0): string {
  const fmt = new Intl.NumberFormat(getNumberLocale(), { maximumFractionDigits });
  const min = 1 / 10 ** maximumFractionDigits;
  if (value > 0 && value < min) return `<${fmt.format(min)}%`;
  return `${fmt.format(value)}%`;
}

/** Short label for charts/axes, e.g. 1.5M ₫ / $12K. */
export function formatCompactCurrency(amount: number | string, currencyCode?: string | null): string {
  const n = toNumber(amount);
  const opts: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: 1 };
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(getNumberLocale(), { ...opts, style: "currency", currency: currencyCode }).format(n);
    } catch {
      /* fall through to plain compact */
    }
  }
  return new Intl.NumberFormat(getNumberLocale(), opts).format(n);
}
