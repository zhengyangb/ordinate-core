import { create } from "zustand";
import { useEffect, useMemo } from "react";
import { automaticRegion, DEFAULT_PREFERENCES, PREFERENCE_STORAGE_KEYS, readPreferences, validatePreferences, writePreferences, type Preferences, type PreferenceStorage } from "./preferences";
import { createCellDisplayFormatter } from "./temporalDisplay";

export function createPreferencesStore(storage: PreferenceStorage | null) {
  return create<{ preferences: Preferences; update: (patch: Partial<Preferences>) => void; reload: () => void }>((set, get) => ({
    preferences: storage ? readPreferences(storage) : DEFAULT_PREFERENCES,
    update: patch => {
      const preferences = validatePreferences({ ...get().preferences, ...patch });
      if (storage) writePreferences(storage, preferences);
      set({ preferences });
    },
    reload: () => { if (storage) set({ preferences: readPreferences(storage) }); },
  }));
}

export const usePreferencesStore = createPreferencesStore(typeof window === "undefined" ? null : window.localStorage);

export function usePreferences() {
  const { preferences, update, reload } = usePreferencesStore();
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === null || PREFERENCE_STORAGE_KEYS.includes(event.key))) reload();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [reload]);
  const systemLocale = useMemo(automaticRegion, []);
  const displayCell = useMemo(() => createCellDisplayFormatter(preferences.dateTimeDisplay, systemLocale), [preferences.dateTimeDisplay, systemLocale]);
  return { preferences, update, systemLocale, displayCell };
}
