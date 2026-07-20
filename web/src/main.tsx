import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initTheme } from "./lib/theme";

// Dark mode — set <html data-theme> before the first paint.
initTheme();

// §9 (built) — PWA installability + what makes Web Push reach the user with
// the tab closed. Registering it is unconditional and harmless on its own;
// nothing subscribes to push without the user's explicit opt-in.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Not fatal -- in-app notifications and browser Notification popups still work.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
