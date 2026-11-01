import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadErrorProps {
  onRetry: () => void;
  /** Show a "Back" link next to retry (full-page errors). */
  showBack?: boolean;
  compact?: boolean;
  message?: string;
  className?: string;
}

/** Shown instead of a blank page / endless skeleton when a load request fails. */
export default function LoadError({ onRetry, showBack, compact, message, className }: LoadErrorProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  if (compact) {
    return (
      <div role="alert" className={cn("flex items-center justify-center gap-3 py-4 text-sm text-on-surface-variant", className)}>
        <span>{message ?? t("load_more_failed")}</span>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-primary font-medium hover:bg-primary-container/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <RefreshCw size={14} />
          {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center text-center py-16 px-6", className)}>
      <div className="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center mb-4">
        <CloudOff size={24} className="text-outline" />
      </div>
      <h2 className="text-base font-bold text-on-surface mb-1">{t("load_error_title")}</h2>
      <p className="text-sm text-on-surface-variant mb-6">{message ?? t("load_error_detail")}</p>
      <div className="flex gap-2">
        {showBack && (
          <button
            onClick={() => navigate(-1)}
            className="h-11 px-4 rounded-xl text-sm font-medium text-on-surface-variant hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("back")}
          </button>
        )}
        <button
          onClick={onRetry}
          className="h-11 px-5 rounded-xl text-sm font-semibold bg-primary text-on-primary hover:bg-primary-dim inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <RefreshCw size={16} />
          {t("retry")}
        </button>
      </div>
    </div>
  );
}
