import type { ThemeMode } from "../types/ui";
import { THEME_STORAGE_KEY } from "../platform/themePreference";
import { isAgentDiagnosticLevel, type AgentDiagnosticLevel } from "../agent/diagnosticLevel";
import { isAgentReasoningEffort, type AgentReasoningEffort } from "../agent/reasoningEffort";

export type DateTimeDisplay = "locale" | "iso";
export type ColumnWidthMode = "standard" | "wide";
export type Preferences = { dateTimeDisplay: DateTimeDisplay; appearance: ThemeMode; columnWidthMode: ColumnWidthMode; agentDiagnosticLevel: AgentDiagnosticLevel; agentReasoningEffort: AgentReasoningEffort };
export const DEFAULT_PREFERENCES: Preferences = { dateTimeDisplay: "locale", appearance: "auto", columnWidthMode: "standard", agentDiagnosticLevel: "off", agentReasoningEffort: "medium" };
export const DISPLAY_STORAGE_KEY = "ordinate-display-preferences-v2";
const LEGACY_DISPLAY_STORAGE_KEY = "ordinate-display-preferences";
export const PREFERENCE_STORAGE_KEYS = [DISPLAY_STORAGE_KEY, LEGACY_DISPLAY_STORAGE_KEY, THEME_STORAGE_KEY];
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object") throw new Error("Invalid preferences");
  const prefs = value as Preferences;
  if (prefs.dateTimeDisplay !== "locale" && prefs.dateTimeDisplay !== "iso") throw new Error("Invalid date and time display preference");
  if (!["auto", "light", "dark"].includes(prefs.appearance)) throw new Error("Invalid appearance preference");
  if (prefs.columnWidthMode !== "standard" && prefs.columnWidthMode !== "wide") throw new Error("Invalid table width preference");
  if (!isAgentDiagnosticLevel(prefs.agentDiagnosticLevel)) throw new Error("Invalid assistant diagnostics level");
  if (!isAgentReasoningEffort(prefs.agentReasoningEffort)) throw new Error("Invalid assistant reasoning effort");
  return { dateTimeDisplay: prefs.dateTimeDisplay, appearance: prefs.appearance, columnWidthMode: prefs.columnWidthMode, agentDiagnosticLevel: prefs.agentDiagnosticLevel, agentReasoningEffort: prefs.agentReasoningEffort };
}

export function readPreferences(storage: PreferenceStorage): Preferences {
  const display = storage.getItem(DISPLAY_STORAGE_KEY);
  const legacy = display === null ? storage.getItem(LEGACY_DISPLAY_STORAGE_KEY) : null;
  const stored = display !== null ? JSON.parse(display) as Partial<Preferences>
    : legacy !== null ? JSON.parse(legacy) as Partial<Preferences> : {};
  if (legacy !== null) {
    const legacyWidth = (stored as { columnWidthMode?: string }).columnWidthMode;
    if (legacyWidth === "compact") stored.columnWidthMode = "standard";
    else if (legacyWidth === "standard") stored.columnWidthMode = "wide";
  }
  return validatePreferences({
    ...DEFAULT_PREFERENCES,
    ...stored,
    appearance: storage.getItem(THEME_STORAGE_KEY) ?? "auto",
  });
}

export function writePreferences(storage: PreferenceStorage, prefs: Preferences) {
  validatePreferences(prefs);
  storage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({ dateTimeDisplay: prefs.dateTimeDisplay, columnWidthMode: prefs.columnWidthMode, agentDiagnosticLevel: prefs.agentDiagnosticLevel, agentReasoningEffort: prefs.agentReasoningEffort }));
  storage.setItem(THEME_STORAGE_KEY, prefs.appearance);
}

export function automaticRegion(): string {
  const raw = window.ordinateDesktop ? window.ordinateDesktop.systemLocale : window.navigator.language;
  const locale = Intl.getCanonicalLocales(raw)[0];
  if (!locale || !Intl.DateTimeFormat.supportedLocalesOf(locale).length) throw new Error(`Unsupported system locale: ${raw}`);
  return locale;
}
