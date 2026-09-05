import { useEffect, useRef, useState } from "react";
import { getAuthConfig } from "@/api/auth";
import { isNative, nativeGoogleSignIn } from "@/native";
import { useTranslation } from "react-i18next";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (
            element: HTMLElement,
            config: Record<string, unknown>
          ) => void;
        };
      };
    };
  }
}

interface Props {
  onCredential: (credential: string) => void;
  disabled?: boolean;
}

export default function GoogleSignIn({ onCredential, disabled }: Props) {
  const { t } = useTranslation("auth");
  const buttonRef = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAuthConfig().then((config) => setClientId(config.google_client_id));
  }, []);

  useEffect(() => {
    // Google Identity Services refuses to run inside an embedded WebView
    // ("disallowed_useragent"); the native app uses the platform sign-in
    // sheet instead (see the native branch of the render below).
    if (isNative || !clientId || !buttonRef.current) return;

    function renderButton() {
      if (!window.google || !buttonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential: string }) => {
          onCredential(response.credential);
        },
      });

      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: buttonRef.current.offsetWidth,
        text: "signin_with",
      });
    }

    // Load Google Identity Services script
    const existing = document.getElementById("google-gsi-script");
    if (!existing) {
      const script = document.createElement("script");
      script.id = "google-gsi-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = renderButton;
      document.head.appendChild(script);
    } else if (window.google) {
      renderButton();
    } else {
      // Script tag exists but hasn't finished loading yet — wait for it
      const interval = setInterval(() => {
        if (window.google) {
          clearInterval(interval);
          renderButton();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [clientId, onCredential]);

  async function handleNativeClick() {
    if (!clientId) return;
    setBusy(true);
    try {
      onCredential(await nativeGoogleSignIn(clientId));
    } catch (err) {
      // User dismissed the account sheet, or Play services is unavailable.
      const message = err instanceof Error ? err.message : String(err);
      if (!/cancel/i.test(message)) window.alert(t("login.error_google"));
    } finally {
      setBusy(false);
    }
  }

  if (!clientId) return null;

  if (isNative) {
    return (
      <button
        type="button"
        onClick={handleNativeClick}
        disabled={disabled || busy}
        className="w-full h-11 flex items-center justify-center gap-3 rounded-full border border-outline-variant/40 bg-surface text-on-surface text-sm font-medium hover:bg-surface-container transition-colors disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/>
          <path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z"/>
          <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.5-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
        </svg>
        {t("login.google_native")}
      </button>
    );
  }

  return (
    <div
      ref={buttonRef}
      className={disabled ? "pointer-events-none opacity-60" : ""}
    />
  );
}
