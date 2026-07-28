import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register the PWA service worker. New deployments activate immediately and
// this page reloads once when the new worker takes control.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register(
      import.meta.env.BASE_URL + "sw.js",
      { updateViaCache: "none" },
    ).then((reg) => {
      // Check immediately and keep open sessions current after deployments.
      reg.update();
      setInterval(() => reg.update(), 60_000);
    }).catch(() => {});
  });
}
