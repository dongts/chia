// Zero-decimal currencies that should never show .00
const ZERO_DECIMAL_CURRENCIES = new Set([
  "VND", "JPY", "KRW", "CLP", "ISK", "UGX", "GNF", "BIF", "DJF",
  "KMF", "MGA", "PYG", "RWF", "VUV", "XAF", "XOF", "XPF",
]);

export function formatCurrency(amount: number, currencyCode: string = "USD"): string {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currencyCode);
  const isWholeNumber = Number.isInteger(amount);
  const decimals = isZeroDecimal ? 0 : isWholeNumber ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(isZeroDecimal ? Math.round(amount) : amount);
}

export function formatAmount(amount: number, currencyCode?: string): string {
  const isZeroDecimal = currencyCode ? ZERO_DECIMAL_CURRENCIES.has(currencyCode) : false;
  const isWholeNumber = Number.isInteger(amount);
  const decimals = isZeroDecimal ? 0 : isWholeNumber ? 0 : 2;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(isZeroDecimal ? Math.round(amount) : amount);
}
