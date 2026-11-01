import { getNumberLocale } from "@/utils/currency";

/**
 * Date formatting that follows the app language (like the number formatting),
 * so a Vietnamese UI never shows "Sun, Nov 1" and an English UI never shows
 * "1 thg 11".
 */

/** Parse "YYYY-MM-DD" (or an ISO timestamp) without the UTC shift `new Date("2026-11-01")` causes. */
export function parseDay(value: string | Date): Date {
  if (value instanceof Date) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(value: string | Date, options: Intl.DateTimeFormatOptions): string {
  const d = parseDay(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(getNumberLocale(), options);
}

/** 1 Nov 2026 / 1 thg 11, 2026 */
export function formatDate(value: string | Date): string {
  return fmt(value, { day: "numeric", month: "short", year: "numeric" });
}

/** Sun, 1 Nov 2026 / CN, 1 thg 11, 2026 */
export function formatDateWithWeekday(value: string | Date): string {
  return fmt(value, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** 1 Nov / 1 thg 11 — omits the year only when it's the current year. */
export function formatDateCompact(value: string | Date): string {
  const d = parseDay(value);
  return d.getFullYear() === new Date().getFullYear()
    ? fmt(d, { day: "numeric", month: "short" })
    : formatDate(d);
}

/** "November 2026" / "tháng 11 năm 2026" */
export function formatMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(getNumberLocale(), { month: "long", year: "numeric" });
}

/** Compact weekday names starting Monday: Mo Tu … / T2 T3 … CN */
export function weekdayNamesMondayFirst(): string[] {
  const locale = getNumberLocale();
  // 2024-01-01 was a Monday. Vietnamese "narrow" is already T2…CN; English narrow
  // (M T W T F S S) is ambiguous, so use the first two letters of the short name.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i);
    return locale.startsWith("vi")
      ? d.toLocaleDateString(locale, { weekday: "narrow" })
      : d.toLocaleDateString(locale, { weekday: "short" }).slice(0, 2);
  });
}

/** "today" | "yesterday" | null for a YYYY-MM-DD / Date, for list section headers. */
export function relativeDay(value: string | Date): "today" | "yesterday" | null {
  const key = toDayKey(parseDay(value));
  const now = new Date();
  if (key === toDayKey(now)) return "today";
  now.setDate(now.getDate() - 1);
  if (key === toDayKey(now)) return "yesterday";
  return null;
}

/** "Just now" / "5 min ago" / "Yesterday" / "3 days ago" / date — in the app language. */
export function formatRelativeTime(value: string | Date, t: (key: string) => string): string {
  const date = parseDay(value);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const rtf = new Intl.RelativeTimeFormat(getNumberLocale(), { numeric: "auto", style: "short" });
  if (diffMins < 1) return t("relative_time.just_now");
  if (diffMins < 60) return rtf.format(-diffMins, "minute");
  if (diffHours < 24) return rtf.format(-diffHours, "hour");
  if (diffDays === 1) return t("relative_time.yesterday");
  if (diffDays < 7) return rtf.format(-diffDays, "day");
  return formatDate(date);
}
