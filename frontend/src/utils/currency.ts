// Zero-decimal currencies that should never show .00
const ZERO_DECIMAL_CURRENCIES = new Set([
  "VND", "JPY", "KRW", "CLP", "ISK", "UGX", "GNF", "BIF", "DJF",
  "KMF", "MGA", "PYG", "RWF", "VUV", "XAF", "XOF", "XPF",
]);

export function formatCurrency(amount: number, currencyCode: string = "USD"): string {
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currencyCode) ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(decimals === 0 ? Math.round(amount) : amount);
}

export function formatAmount(amount: number, currencyCode?: string): string {
  const decimals = currencyCode && ZERO_DECIMAL_CURRENCIES.has(currencyCode) ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(decimals === 0 ? Math.round(amount) : amount);
}
