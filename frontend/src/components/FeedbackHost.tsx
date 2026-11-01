import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFeedbackStore, type ToastKind } from "@/lib/feedback";

const TOAST_STYLE: Record<ToastKind, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-primary" },
  error: { icon: AlertCircle, className: "text-error" },
  info: { icon: Info, className: "text-on-surface-variant" },
};

function Toasts() {
  const { t } = useTranslation("common");
  const toasts = useFeedbackStore((s) => s.toasts);
  const dismiss = useFeedbackStore((s) => s.dismissToast);

  return (
    // Above the mobile bottom nav (≈64px) on small screens
    <div
      className="fixed z-[60] left-4 right-4 bottom-20 md:bottom-6 md:left-auto md:right-6 md:w-96 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      role="status"
    >
      {toasts.map((toast) => {
        const { icon: Icon, className } = TOAST_STYLE[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : undefined}
            className="pointer-events-auto flex items-start gap-3 bg-surface-container-lowest text-on-surface rounded-xl shadow-editorial-xl border border-outline-variant/15 px-4 py-3 animate-in slide-in-from-bottom"
          >
            <Icon size={18} className={cn("flex-shrink-0 mt-0.5", className)} />
            <p className="flex-1 min-w-0 text-sm whitespace-pre-line break-words">{toast.message}</p>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label={t("close")}
              className="flex-shrink-0 -m-1 p-1.5 text-outline hover:text-on-surface rounded-lg hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ConfirmModal() {
  const { t } = useTranslation("common");
  const confirm = useFeedbackStore((s) => s.confirm);
  const settle = useFeedbackStore((s) => s.settleConfirm);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirm) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Destructive → focus Cancel so a stray Enter doesn't delete anything
    (confirm.destructive ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
      if (e.key === "Tab") {
        // Two-button focus trap
        const els = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
        const idx = els.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        els[(idx + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [confirm, settle]);

  if (!confirm) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={() => settle(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full sm:max-w-sm bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl shadow-editorial-xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-base font-bold text-on-surface mb-2">
          {confirm.title ?? (confirm.destructive ? t("confirm_dialog.title_destructive") : t("confirm_dialog.title"))}
        </h2>
        <p id="confirm-message" className="text-sm text-on-surface-variant whitespace-pre-line break-words mb-6">
          {confirm.message}
        </p>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={() => settle(false)}
            className="h-11 px-4 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {confirm.cancelLabel ?? t("cancel")}
          </button>
          <button
            ref={confirmRef}
            onClick={() => settle(true)}
            className={cn(
              "h-11 px-5 rounded-xl text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              confirm.destructive
                ? "bg-error text-on-error hover:opacity-90 focus-visible:ring-error"
                : "bg-primary text-on-primary hover:bg-primary-dim focus-visible:ring-primary"
            )}
          >
            {confirm.confirmLabel ?? (confirm.destructive ? t("delete") : t("confirm"))}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FeedbackHost() {
  return (
    <>
      <Toasts />
      <ConfirmModal />
    </>
  );
}
