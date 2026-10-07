import type { ThemeMode } from "../types/ui";
import { THEME_STORAGE_KEY } from "../platform/themePreference";

export type DateTimeDisplay = "locale" | "iso";
export type Preferences = { dateTimeDisplay: DateTimeDisplay; appearance: ThemeMode };
export const DEFAULT_PREFERENCES: Preferences = { dateTimeDisplay: "locale", appearance: "auto" };
export const DISPLAY_STORAGE_KEY = "ordinate-display-preferences";
export const PREFERENCE_STORAGE_KEYS = [DISPLAY_STORAGE_KEY, THEME_STORAGE_KEY];
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object") throw new Error("Invalid preferences");
  const prefs = value as Preferences;
  if (prefs.dateTimeDisplay !== "locale" && prefs.dateTimeDisplay !== "iso") throw new Error("Invalid date and time display preference");
  if (!["auto", "light", "dark"].includes(prefs.appearance)) throw new Error("Invalid appearance preference");
  return { dateTimeDisplay: prefs.dateTimeDisplay, appearance: prefs.appearance };
}

export function readPreferences(storage: PreferenceStorage): Preferences {
  const display = storage.getItem(DISPLAY_STORAGE_KEY);
  return validatePreferences({
    ...(display === null ? { dateTimeDisplay: "locale" } : JSON.parse(display)),
    appearance: storage.getItem(THEME_STORAGE_KEY) ?? "auto",
  });
}

export function writePreferences(storage: PreferenceStorage, prefs: Preferences) {
  validatePreferences(prefs);
  storage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({ dateTimeDisplay: prefs.dateTimeDisplay }));
  storage.setItem(THEME_STORAGE_KEY, prefs.appearance);
}

export function automaticRegion(): string {
  const raw = window.ordinateDesktop ? window.ordinateDesktop.systemLocale : window.navigator.language;
  const locale = Intl.getCanonicalLocales(raw)[0];
  if (!locale || !Intl.DateTimeFormat.supportedLocalesOf(locale).length) throw new Error(`Unsupported system locale: ${raw}`);
  return locale;
}
