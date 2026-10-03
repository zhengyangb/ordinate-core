import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createNativeStorage } from "../../desktop/fileStorage";
import { watchDocument } from "../../desktop/fileWatcher";
import { createFileSessionStore, createMemoryLocalDraftStore } from "../store/fileSessionStore";
import { startFileSync } from "./fileSync";
import type { StorageAdapter } from "./storage";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ordinate-sync-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "document.ord");
  await writeFile(filename, "original");
  const native = createNativeStorage({ open: async () => filename, save: async () => path.join(directory, "copy.ord") });
  const read = vi.fn(native.readCurrent);
  const adapter: StorageAdapter = {
    ...native, kind: "electron", readCurrent: read,
    capabilities: () => ({ canWatchBackingFile: true, canReadCurrentBackingFile: true, canAutosaveToBackingFile: true, canAtomicCompareAndWrite: false }),
    watch: (file, notify) => watchDocument(native.documentPath(file), notify),
  };
  let text = "original";
  let editing = false;
  const replace = vi.fn((next: string) => { text = next; });
  const store = createFileSessionStore({
    adapter, localDraftStore: createMemoryLocalDraftStore(),
    editor: { getPersistableText: () => ({ text, validity: "valid_document", source: "table" }), replaceDocumentText: replace },
  });
  await store.getState().open();
  replace.mockClear();
  const sync = startFileSync(store, adapter, () => editing);
  cleanup.push(sync.dispose);
  await vi.waitFor(() => {
    expect(store.getState().lastError).toBeNull();
    expect(read).toHaveBeenCalled();
  });
  await vi.waitFor(() => expect(store.getState().operation).toBeNull());
  return { directory, filename, store, sync, adapter, read, replace,
    getText: () => text, edit: (next: string) => { text = next; },
    setEditing: (value: boolean) => { editing = value; sync.refresh(); },
  };
}

it("watches repeated atomic replacements and ignores unrelated files", async () => {
  const f = await fixture();
  const readCount = f.read.mock.calls.length;
  await writeFile(path.join(f.directory, "unrelated.ord"), "unrelated");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(f.read).toHaveBeenCalledTimes(readCount);
  for (const text of ["external one", "external two"]) {
    const temp = path.join(f.directory, "replacement.tmp");
    await writeFile(temp, text);
    await rename(temp, f.filename);
    await vi.waitFor(() => expect(f.getText()).toBe(text));
    expect(f.store.getState().conflict).toBeNull();
    expect(f.replace).toHaveBeenLastCalledWith(text, { preserveView: true });
  }
});

it("acknowledges self-writes without replacing the editor or losing undo history", async () => {
  const f = await fixture();
  f.edit("local change");
  await f.store.getState().autosaveNow();
  const count = f.read.mock.calls.length;
  await vi.waitFor(() => expect(f.read.mock.calls.length).toBeGreaterThan(count));
  expect(f.replace).not.toHaveBeenCalled();
  expect(f.store.getState()).toMatchObject({ documentDirty: "clean", conflict: null });
});

it("defers uncommitted editing, refreshes after cancel and conflicts after commit", async () => {
  const f = await fixture();
  f.setEditing(true);
  await writeFile(f.filename, "external");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(f.getText()).toBe("original");
  f.setEditing(false);
  await vi.waitFor(() => expect(f.getText()).toBe("external"));
  f.setEditing(true);
  await writeFile(f.filename, "external again");
  f.edit("local commit");
  f.setEditing(false);
  await vi.waitFor(() => expect(f.store.getState().conflict?.diskText).toBe("external again"));
  expect(f.getText()).toBe("local commit");
  expect(await readFile(f.filename, "utf8")).toBe("external again");
});

it("reports deletion without erasing the editor, and resumes when the file is recreated", async () => {
  const f = await fixture();
  await rm(f.filename);
  await vi.waitFor(() => expect(f.store.getState().lastError).toEqual({ kind: "not_found" }));
  expect(f.getText()).toBe("original");
  await writeFile(f.filename, "recreated");
  await vi.waitFor(() => expect(f.getText()).toBe("recreated"));
  expect(f.store.getState().lastError).toBeNull();
});

it("moves the subscription after Save As and stops on disposal", async () => {
  const f = await fixture();
  await f.store.getState().saveAs();
  await writeFile(f.filename, "old path change");
  await writeFile(path.join(f.directory, "copy.ord"), "new path change");
  await vi.waitFor(() => expect(f.getText()).toBe("new path change"));
  f.sync.dispose();
  const count = f.read.mock.calls.length;
  await writeFile(path.join(f.directory, "copy.ord"), "after dispose");
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(f.getText()).toBe("new path change");
  expect(f.read).toHaveBeenCalledTimes(count);
});

it("waits for an in-flight write before processing its own watch event", async () => {
  const f = await fixture();
  const originalSave = f.adapter.save;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let written = false;
  f.adapter.save = async (...args) => {
    const result = await originalSave(...args);
    written = true;
    await gate;
    return result;
  };
  f.edit("saved while watching");
  const saving = f.store.getState().autosaveNow();
  try {
    await vi.waitFor(() => expect(written).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(f.store.getState().conflict).toBeNull();
    expect(f.replace).not.toHaveBeenCalled();
  } finally { release(); }
  await saving;
  await vi.waitFor(() => expect(f.store.getState().operation).toBeNull());
  expect(f.store.getState().backingText).toBe("saved while watching");
  expect(f.replace).not.toHaveBeenCalled();
});

it("fails early for adapters without file watching", async () => {
  const f = await fixture();
  expect(() => startFileSync(f.store, { ...f.adapter, watch: undefined }, () => false)).toThrow("requires a watching storage adapter");
});
