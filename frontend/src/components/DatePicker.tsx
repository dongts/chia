import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default function DatePicker({ value, onChange, className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? parseDate(value) : new Date();
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = parseDate(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { day: number; month: "prev" | "current" | "next"; dateStr: string }[] = [];

  // Previous month trailing days
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({ day: d, month: "prev", dateStr: toDateStr(new Date(y, m, d)) });
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: "current", dateStr: toDateStr(new Date(viewYear, viewMonth, d)) });
  }

  // Next month leading days
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({ day: d, month: "next", dateStr: toDateStr(new Date(y, m, d)) });
  }

  const today = toDateStr(new Date());

  // Format display value
  const displayText = value
    ? parseDate(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "Select date";

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-surface-container-high/50 rounded-xl px-4 py-3 text-sm text-on-surface hover:bg-surface-container-high/70 focus:outline-none focus:ring-2 focus:ring-primary transition-colors text-left"
      >
        <span className={value ? "text-on-surface" : "text-outline"}>{displayText}</span>
        <Calendar size={16} className="text-outline flex-shrink-0" />
      </button>

      {/* Dropdown calendar */}
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-surface-container-lowest rounded-2xl shadow-editorial-xl p-4 w-[300px]">
          {/* Month/Year header */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold text-on-surface">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day names header */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-outline uppercase py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const isSelected = cell.dateStr === value;
              const isToday = cell.dateStr === today;
              const isCurrent = cell.month === "current";
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(cell.dateStr);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-9 w-full rounded-lg text-xs font-medium transition-colors",
                    isSelected
                      ? "bg-primary text-on-primary"
                      : isToday
                        ? "bg-primary-container/30 text-primary font-bold"
                        : isCurrent
                          ? "text-on-surface hover:bg-surface-container"
                          : "text-outline/40 hover:bg-surface-container/50"
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mt-3 pt-3 border-t border-outline-variant/10">
            <button
              type="button"
              onClick={() => { onChange(today); setOpen(false); }}
              className="flex-1 text-xs font-semibold text-primary bg-primary-container/15 hover:bg-primary-container/25 py-2 rounded-full transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                const y = new Date();
                y.setDate(y.getDate() - 1);
                onChange(toDateStr(y));
                setOpen(false);
              }}
              className="flex-1 text-xs font-semibold text-on-surface-variant bg-surface-container hover:bg-surface-container-high py-2 rounded-full transition-colors"
            >
              Yesterday
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
