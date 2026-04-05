import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function UpdatePrompt() {
  const { t } = useTranslation("common");
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onUpdate() {
      setShow(true);
    }
    window.addEventListener("sw-update-available", onUpdate);
    return () => window.removeEventListener("sw-update-available", onUpdate);
  }, []);

  function handleUpdate() {
    // Tell the waiting SW to skip waiting and take over
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-on-surface text-on-primary rounded-xl shadow-editorial-xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom">
      <RefreshCw size={20} className="text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{t("update_available")}</p>
        <p className="text-xs text-outline">{t("update_available_detail")}</p>
      </div>
      <button
        onClick={handleUpdate}
        className="flex-shrink-0 bg-primary hover:bg-primary-dim text-on-primary text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
      >
        {t("update")}
      </button>
    </div>
  );
}
