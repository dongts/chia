import { create } from "zustand";
import i18n from "@/i18n";

/**
 * In-app replacements for window.alert / window.confirm.
 * Native dialogs look foreign in the Capacitor app, block the page and can't be
 * styled or translated, so everything goes through this store instead.
 * Rendered by <FeedbackHost /> (mounted once in App).
 */

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for deletes/removals. */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface FeedbackState {
  toasts: ToastItem[];
  confirm: PendingConfirm | null;
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
  settleConfirm: (ok: boolean) => void;
}

let nextId = 1;
const TOAST_MS: Record<ToastKind, number> = { success: 3000, info: 4000, error: 6000 };

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  toasts: [],
  confirm: null,
  pushToast: (kind, message) => {
    const id = nextId++;
    // Same message already visible (e.g. double click) → don't stack duplicates
    if (get().toasts.some((t) => t.message === message && t.kind === kind)) return;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), TOAST_MS[kind]);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  settleConfirm: (ok) => {
    const pending = get().confirm;
    set({ confirm: null });
    pending?.resolve(ok);
  },
}));

/**
 * Server errors are often passed straight through (`response.data.detail`), which for
 * FastAPI 422s is an array of {msg} objects — rendering that would crash React.
 */
function toMessage(message: unknown): string {
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const parts = message
      .map((m) => (typeof m === "string" ? m : (m as { msg?: unknown })?.msg))
      .filter((m): m is string => typeof m === "string");
    if (parts.length) return parts.join("\n");
  }
  if (message && typeof message === "object" && typeof (message as { message?: unknown }).message === "string") {
    return (message as { message: string }).message;
  }
  return i18n.t("error_generic", { ns: "common" });
}

export const toast = {
  success: (message: unknown) => useFeedbackStore.getState().pushToast("success", toMessage(message)),
  error: (message: unknown) => useFeedbackStore.getState().pushToast("error", toMessage(message)),
  info: (message: unknown) => useFeedbackStore.getState().pushToast("info", toMessage(message)),
};

/** Promise-based confirm dialog: `if (!(await confirmDialog({ message }))) return;` */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise((resolve) => {
    // A second confirm while one is open cancels the first
    useFeedbackStore.getState().confirm?.resolve(false);
    useFeedbackStore.setState({ confirm: { ...opts, resolve } });
  });
}
