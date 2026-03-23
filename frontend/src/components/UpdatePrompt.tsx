import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";

export default function UpdatePrompt() {
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
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-gray-900 text-white rounded-xl shadow-2xl p-4 flex items-center gap-3 animate-in slide-in-from-bottom">
      <RefreshCw size={20} className="text-green-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Update available</p>
        <p className="text-xs text-gray-400">A new version of Chia is ready.</p>
      </div>
      <button
        onClick={handleUpdate}
        className="flex-shrink-0 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
      >
        Update
      </button>
    </div>
  );
}
