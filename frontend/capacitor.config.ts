import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "asia.dongtran.chia",
  appName: "Chia",
  webDir: "dist",
  // Serve the bundled web app from https://localhost so secure-context APIs
  // (crypto, clipboard, etc.) behave the same as on the web.
  server: {
    androidScheme: "https",
  },
  android: {
    // Keep content out from under the status/navigation bars on Android 15+.
    adjustMarginsForEdgeToEdge: "auto",
  },
  plugins: {
    // Route XHR/fetch through the native HTTP stack. The API is on a different
    // origin than the bundled app, and this avoids needing a CORS entry for
    // the app's WebView origin.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
