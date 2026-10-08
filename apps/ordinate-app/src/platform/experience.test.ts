import { afterEach, describe, expect, it, vi } from "vitest";
import { isOnlineExperience } from "./experience";
import { createLocalStorageDraftStore, type LocalDraftRecord } from "../store/fileSessionStore";

afterEach(() => vi.unstubAllGlobals());
describe("experience isolation", () => {
  it("selects online explicitly, not from the host or platform", () => {
    expect(isOnlineExperience()).toBe(false);
    vi.stubGlobal("document", { documentElement: { dataset: { experience: "online" } } });
    expect(isOnlineExperience()).toBe(true);
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    expect(isOnlineExperience()).toBe(false);
  });
  it("keeps online drafts separate from the ordinary browser editor", async () => {
    const entries = new Map<string, string>();
    const storage: Storage = {
      get length() { return entries.size; }, clear: () => entries.clear(), key: index => [...entries.keys()][index] ?? null,
      getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); },
    };
    const editor = createLocalStorageDraftStore(storage);
    const online = createLocalStorageDraftStore(storage, "ordinate:online:file-draft:");
    const record: LocalDraftRecord = { key: "untitled:browser-untitled", text: "# Draft\n| kept |", version: "v1", updatedAt: Date.now(), draftName: "My draft" };
    await editor.set(record);
    expect(await online.get(record.key)).toBeNull();
    await online.set({ ...record, text: "# Online\n| separate |" });
    expect((await editor.get(record.key))?.text).toBe(record.text);
    await online.remove(record.key);
    expect(await editor.get(record.key)).toEqual(record);
  });
});
