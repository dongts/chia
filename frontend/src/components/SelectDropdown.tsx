import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;        // emoji or text to show in circle
  sublabel?: string;    // secondary text
}

interface SelectDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchable?: boolean;
  className?: string;
}

export default function SelectDropdown({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchable = false,
  className,
}: SelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  const filtered = searchable && search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        className="w-full flex items-center gap-3 bg-surface-container-high/50 rounded-xl px-4 py-3 text-sm text-left hover:bg-surface-container-high/70 focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
      >
        {selected?.icon && (
          <div className="w-7 h-7 rounded-full bg-primary-container/30 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
            {selected.icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className={selected ? "text-on-surface" : "text-outline"}>
            {selected ? selected.label : placeholder}
          </span>
          {selected?.sublabel && (
            <span className="text-xs text-outline ml-1.5">{selected.sublabel}</span>
          )}
        </div>
        <ChevronDown size={16} className={cn("text-outline flex-shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-surface-container-lowest rounded-2xl shadow-editorial-xl overflow-hidden max-h-64 flex flex-col">
          {/* Search */}
          {searchable && (
            <div className="px-3 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full bg-surface-container-high/50 border-0 rounded-lg pl-8 pr-3 py-2 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          )}

          {/* Options */}
          <div className="overflow-y-auto px-1.5 pb-1.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-outline text-center py-4">No results</p>
            ) : (
              filtered.map((option) => {
                const isActive = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors",
                      isActive
                        ? "bg-primary-container/20 text-primary font-medium"
                        : "text-on-surface hover:bg-surface-container"
                    )}
                  >
                    {option.icon && (
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                        isActive
                          ? "bg-primary-container/40 text-primary"
                          : "bg-surface-container text-on-surface-variant"
                      )}>
                        {option.icon}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{option.label}</span>
                      {option.sublabel && (
                        <span className="text-xs text-outline">{option.sublabel}</span>
                      )}
                    </div>
                    {isActive && (
                      <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
