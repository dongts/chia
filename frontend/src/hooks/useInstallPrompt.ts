import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "chia_install_dismissed";

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInStandaloneMode(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone === true);
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    return localStorage.getItem(DISMISSED_KEY) === "true";
  });

  const isiOS = isIOS();

  useEffect(() => {
    if (isInStandaloneMode()) {
      setIsInstalled(true);
      return;
    }

    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function install() {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === "accepted";
  }

  function dismissBanner() {
    setBannerDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "true");
  }

  const canInstall = (!!deferredPrompt || isiOS) && !isInstalled;
  const showBanner = canInstall && !bannerDismissed;
  const showIOSInstructions = isiOS && !isInstalled;

  return { canInstall, showBanner, showIOSInstructions, isInstalled, install, dismissBanner };
}
