import { afterEach, describe, expect, it, vi } from "vitest";
import { automaticRegion, DEFAULT_PREFERENCES, DISPLAY_STORAGE_KEY, readPreferences, type PreferenceStorage } from "./preferences";
import { createPreferencesStore } from "./preferencesStore";
import { THEME_STORAGE_KEY } from "../platform/themePreference";

function storage(): PreferenceStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
afterEach(() => vi.unstubAllGlobals());
describe("user preferences, separate from documents", () => {
  it("defaults to regional display, automatic region and system appearance", () => {
    expect(readPreferences(storage())).toEqual(DEFAULT_PREFERENCES);
  });
  it("keeps the existing appearance choice with one storage owner", () => {
    const memory = storage();
    memory.setItem(THEME_STORAGE_KEY, "dark");
    const store = createPreferencesStore(memory);
    expect(store.getState().preferences.appearance).toBe("dark");
    store.getState().update({ dateTimeDisplay: "iso" });
    expect(readPreferences(memory)).toEqual({ appearance: "dark", dateTimeDisplay: "iso" });
    expect(JSON.parse(memory.getItem(DISPLAY_STORAGE_KEY)!)).not.toHaveProperty("appearance");
  });
  it("synchronizes preferences from another window without overwriting them", () => {
    const memory = storage();
    const first = createPreferencesStore(memory), second = createPreferencesStore(memory);
    first.getState().update({ dateTimeDisplay: "iso" });
    second.getState().reload();
    expect(second.getState().preferences.dateTimeDisplay).toBe("iso");
    second.getState().update({ appearance: "light" });
    first.getState().reload();
    expect(first.getState().preferences).toEqual({ dateTimeDisplay: "iso", appearance: "light" });
  });
  it("rejects malformed storage and invalid choices early", () => {
    const memory = storage();
    memory.setItem(DISPLAY_STORAGE_KEY, '{"dateTimeDisplay":"invalid"}');
    expect(() => readPreferences(memory)).toThrow("date and time");
    memory.setItem(DISPLAY_STORAGE_KEY, '{');
    expect(() => readPreferences(memory)).toThrow();
    const store = createPreferencesStore(null);
    expect(() => store.getState().update({ appearance: "invalid" as "auto" })).toThrow("appearance");
    expect(store.getState().preferences).toEqual(DEFAULT_PREFERENCES);
  });
  it("stores only editable preferences; region is always determined by the host", () => {
    const memory = storage();
    memory.setItem(DISPLAY_STORAGE_KEY, '{"dateTimeDisplay":"locale","region":"en-GB"}');
    const store = createPreferencesStore(memory);
    expect(store.getState().preferences).not.toHaveProperty("region");
    store.getState().update({ dateTimeDisplay: "iso" });
    expect(JSON.parse(memory.getItem(DISPLAY_STORAGE_KEY)!)).toEqual({ dateTimeDisplay: "iso" });
  });
  it("does not publish changes when persistence fails", () => {
    const store = createPreferencesStore({ getItem: () => null, setItem: () => { throw new Error("Unavailable storage"); } });
    expect(() => store.getState().update({ dateTimeDisplay: "iso" })).toThrow("Unavailable storage");
    expect(store.getState().preferences.dateTimeDisplay).toBe("locale");
  });
  it("uses browser language on the web, but macOS region in the desktop host", () => {
    vi.stubGlobal("window", { navigator: { language: "en-GB" } });
    expect(automaticRegion()).toBe("en-GB");
    vi.stubGlobal("window", { navigator: { language: "en-US" }, ordinateDesktop: { systemLocale: "zh-CN" } });
    expect(automaticRegion()).toBe("zh-CN");
  });
});
