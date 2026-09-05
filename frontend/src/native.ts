import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Clipboard } from "@capacitor/clipboard";
import { SocialLogin } from "@capgo/capacitor-social-login";

/** True when running inside the Capacitor Android/iOS shell. */
export const isNative = Capacitor.isNativePlatform();

/** Fired (with the in-app path as `detail`) when the app is opened via a link. */
export const DEEP_LINK_EVENT = "chia:deeplink";

/**
 * Wire up native-only behaviour. Safe to call on the web: it is a no-op there.
 */
export function setupNative() {
  if (!isNative) return;

  // Android hardware/gesture back: walk the in-app history, and leave the app
  // once there's nothing left to go back to (the default would close it on
  // every press, since the WebView never navigates between documents).
  CapacitorApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack && window.history.length > 1) {
      window.history.back();
    } else {
      CapacitorApp.exitApp();
    }
  });

  // App Links (https://chia.dongtran.asia/join/CODE …): hand the path to the
  // router instead of letting the WebView load the website.
  CapacitorApp.addListener("appUrlOpen", ({ url }) => {
    try {
      const { pathname, search, hash } = new URL(url);
      window.dispatchEvent(
        new CustomEvent(DEEP_LINK_EVENT, { detail: pathname + search + hash }),
      );
    } catch {
      // Not a URL we can route; ignore.
    }
  });
}

/** Copy text, using the native clipboard inside the app. */
export async function copyText(text: string): Promise<void> {
  if (isNative) {
    await Clipboard.write({ string: text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

let googleInitialised: string | null = null;

/**
 * Native Google sign-in (Android Credential Manager). Resolves to a Google ID
 * token whose audience is the web client id, so the backend verifies it with
 * the same `/auth/google` endpoint the website uses.
 */
export async function nativeGoogleSignIn(webClientId: string): Promise<string> {
  if (googleInitialised !== webClientId) {
    await SocialLogin.initialize({ google: { webClientId, mode: "online" } });
    googleInitialised = webClientId;
  }
  const { result } = await SocialLogin.login({
    provider: "google",
    options: { scopes: ["email", "profile"] },
  });
  if (result.responseType !== "online" || !result.idToken) {
    throw new Error("Google sign-in returned no ID token");
  }
  return result.idToken;
}
