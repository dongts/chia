import { useEffect, useRef, useState } from "react";
import { getAuthConfig } from "@/api/auth";

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
  const buttonRef = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    getAuthConfig().then((config) => setClientId(config.google_client_id));
  }, []);

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;

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

  if (!clientId) return null;

  return (
    <div
      ref={buttonRef}
      className={disabled ? "pointer-events-none opacity-60" : ""}
    />
  );
}
