import { useEffect, useState } from "react";

/**
 * Dark mode — a `data-theme="dark"` attribute on <html>, driven entirely by
 * the CSS variables in styles.css. Persisted per device; defaults to the OS
 * preference on first visit.
 */
const STORAGE_KEY = "captracker-theme";

export type Theme = "light" | "dark";

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  // Keep the browser/PWA chrome in step with the surface behind it.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0B1220" : "#001D3A";
}

/** Called once at boot (main.tsx) so the first paint is already themed. */
export function initTheme(): void {
  apply(storedTheme() ?? systemTheme());
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** Hook for the header toggle buttons — reads live, toggles + persists. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" ? currentTheme() : "light"
  );

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // private-mode storage failure — theme still applies for this session
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggleTheme };
}
