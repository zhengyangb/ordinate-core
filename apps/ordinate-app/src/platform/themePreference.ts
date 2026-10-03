import type { ThemeMode } from "../types/ui";

export const THEME_STORAGE_KEY = "ordinate-theme-mode";

export function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}
