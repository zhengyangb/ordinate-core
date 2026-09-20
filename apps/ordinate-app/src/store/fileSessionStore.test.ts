import { describe, expect, it } from "vitest";

import {
  createBrowserStorageAdapter,
  createFileSessionStore,
  createMemoryLocalDraftStore,
  createMemoryStorageAdapter,
  getPersistableText,
  hashText,
  type LocalDraftStore,
  type MemoryStorageAdapter,
  type PersistableText,
} from "./fileSessionStore";
import type { FileSnapshot, SaveOptions, StorageResult } from "../platform/storage";
import { useEditorStore } from "./editorStore";

const DOC_A = `
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 1    |
`.trim();

const DOC_B = `
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 2    |
`.trim();

const DOC_C = `
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 3    |
`.trim();

const DOC_D = `
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 4    |
`.trim();

const INVALID_SOURCE = `
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || = sum(
`.trim();

type TestEditor = {
  getText: () => string;
  setText: (text: string, validity?: PersistableText["validity"]) => void;
  bridge: {
    getPersistableText: () => PersistableText;
    replaceDocumentText: (text: string) => void;
  };
};

function createTestEditor(initialText = DOC_A): TestEditor {
  let text = initialText;
  let validity: PersistableText["validity"] = "valid_document";
  let source: PersistableText["source"] = "table";

  return {
    getText: () => text,
    setText: (nextText, nextValidity = "valid_document") => {
      text = nextText;
      validity = nextValidity;
      source = nextValidity === "invalid_source" ? "source" : "table";
    },
    bridge: {
      getPersistableText: () => ({ text, validity, source }),
      replaceDocumentText: (nextText) => {
        text = nextText;
        validity = "valid_document";
        source = "table";
      },
    },
  };
}

function createHarness(options?: {
  editorText?: string;
  adapter?: MemoryStorageAdapter;
  localDraftStore?: LocalDraftStore;
}) {
  const editor = createTestEditor(options?.editorText ?? DOC_A);
  const adapter = options?.adapter ?? createMemoryStorageAdapter({
    "file-a": { displayName: "Budget.ord", text: DOC_A },
  });
  const localDraftStore = options?.localDraftStore ?? createMemoryLocalDraftStore();
  let operationNumber = 1;
  let clock = 1000;
  const store = createFileSessionStore({
    adapter,
    localDraftStore,
    editor: editor.bridge,
    now: () => {
      clock += 1;
      return clock;
    },
    createOperationId: () => `op-${operationNumber++}`,
    createUntitledId: () => "untitled-test",
  });

  return { store, editor, adapter, localDraftStore };
}

async function openHarness() {
  const harness = createHarness();
  await harness.store.getState().open();
  return harness;
}

describe("external file refresh", () => {
  it("reloads a clean document without presenting a conflict", async () => {
    const { store, editor, adapter } = await openHarness();
    await adapter.setDiskText("file-a", DOC_B);
    await store.getState().refreshFromDisk(() => true);
    expect(editor.getText()).toBe(DOC_B);
    expect(store.getState()).toMatchObject({ backingFileState: "clean", documentDirty: "clean", conflict: null, externalSnapshot: null });
  });

  it("does not overwrite either side when local edits have not been saved", async () => {
    const { store, editor, adapter } = await openHarness();
    editor.setText(DOC_B);
    await adapter.setDiskText("file-a", DOC_C);
    await store.getState().refreshFromDisk(() => true);
    expect(editor.getText()).toBe(DOC_B);
    expect(adapter.getDiskText("file-a")).toBe(DOC_C);
    expect(store.getState().conflict).toMatchObject({ editorText: DOC_B, diskText: DOC_C, baselineText: DOC_A });
    await adapter.setDiskText("file-a", DOC_D);
    await store.getState().refreshFromDisk(() => true);
    expect(store.getState().conflict?.diskText).toBe(DOC_D);
  });

  it("acknowledges identical disk/local contents without replacing the editor", async () => {
    const { store, editor, adapter } = await openHarness();
    editor.setText(DOC_B);
    await adapter.setDiskText("file-a", DOC_B);
    await store.getState().refreshFromDisk(() => true);
    expect(store.getState()).toMatchObject({ backingText: DOC_B, documentDirty: "clean", conflict: null });
    expect(editor.getText()).toBe(DOC_B);
  });

  it("defers refresh while a cell edit is uncommitted", async () => {
    const { store, editor, adapter } = await openHarness();
    await adapter.setDiskText("file-a", DOC_B);
    await store.getState().refreshFromDisk(() => false);
    expect(editor.getText()).toBe(DOC_A);
    expect(store.getState().conflict).toBeNull();
    await store.getState().refreshFromDisk(() => true);
    expect(editor.getText()).toBe(DOC_B);
  });

  it("rechecks cell editing and dirty contents after an asynchronous read", async () => {
    const { store, editor, adapter } = await openHarness();
    await adapter.setDiskText("file-a", DOC_C);
    let editing = false;
    const refresh = store.getState().refreshFromDisk(() => !editing);
    editing = true;
    await refresh;
    expect(editor.getText()).toBe(DOC_A);
    editing = false;
    const second = store.getState().refreshFromDisk(() => !editing);
    editor.setText(DOC_B);
    await second;
    expect(editor.getText()).toBe(DOC_B);
    expect(store.getState().conflict?.diskText).toBe(DOC_C);
  });

  it("clears a conflict if the external editor reverts its changes", async () => {
    const { store, editor, adapter } = await openHarness();
    editor.setText(DOC_B);
    await adapter.setDiskText("file-a", DOC_C);
    await store.getState().refreshFromDisk(() => true);
    await adapter.setDiskText("file-a", DOC_A);
    await store.getState().refreshFromDisk(() => true);
    expect(store.getState()).toMatchObject({ conflict: null, documentDirty: "dirty", backingText: DOC_A });
    expect(editor.getText()).toBe(DOC_B);
  });

  it("does not treat edits during draft cleanup as already saved", async () => {
    let duringRemove = () => {};
    const drafts = createMemoryLocalDraftStore();
    const { store, editor, adapter } = createHarness({ localDraftStore: {
      ...drafts, remove: async (key) => { duringRemove(); await drafts.remove(key); },
    } });
    await store.getState().open();
    editor.setText(DOC_B, "invalid_source");
    await store.getState().autosaveNow();
    editor.setText(DOC_A);
    await adapter.setDiskText("file-a", DOC_B);
    duringRemove = () => editor.setText(DOC_C);
    await store.getState().refreshFromDisk(() => true);
    // The later edit must be persisted by a follow-up, never falsely marked saved against B.
    expect(editor.getText()).toBe(DOC_C);
    expect(adapter.getDiskText("file-a")).toBe(DOC_C);
    expect(store.getState().backingText).toBe(DOC_C);
  });
});

async function currentSnapshot(adapter: MemoryStorageAdapter, fileId = "file-a"): Promise<FileSnapshot> {
  const text = adapter.getDiskText(fileId);
  if (text == null) throw new Error(`expected disk text for '${fileId}'`);
  return {
    file: { id: fileId, displayName: "Budget.ord", adapterKind: "memory" },
    text,
    version: await hashText(text),
  };
}

function createDeferredSaveAdapter(base: MemoryStorageAdapter) {
  type PendingSave = {
    file: FileSnapshot["file"];
    text: string;
    options: SaveOptions;
    resolve: (result: StorageResult<FileSnapshot>) => void;
  };

  const pending: PendingSave[] = [];
  const adapter: MemoryStorageAdapter = {
    ...base,
    save: async (file, text, options) => {
      return await new Promise<StorageResult<FileSnapshot>>((resolve) => {
        pending.push({ file, text, options, resolve });
      });
    },
  };

  return {
    adapter,
    pendingSaveCount: () => pending.length,
    hasPendingSave: () => pending.length > 0,
    resolvePendingSave: async (index = 0) => {
      const [save] = pending.splice(index, 1);
      if (!save) throw new Error("expected pending save");
      const result = await base.save(save.file, save.text, save.options);
      save.resolve(result);
      return result;
    },
  };
}

function createDeferredDraftStore(base: LocalDraftStore) {
  type PendingSet = {
    record: Parameters<LocalDraftStore["set"]>[0];
    resolve: () => void;
    reject: (error: unknown) => void;
  };

  const pending: PendingSet[] = [];
  let deferNextSet = false;
  const store: LocalDraftStore = {
    get: base.get,
    set: async (record) => {
      if (!deferNextSet) {
        await base.set(record);
        return;
      }
      deferNextSet = false;
      await new Promise<void>((resolve, reject) => {
        pending.push({ record, resolve, reject });
      });
      await base.set(record);
    },
    remove: base.remove,
  };

  return {
    store,
    deferNextSet: () => {
      deferNextSet = true;
    },
    pendingSetCount: () => pending.length,
    resolvePendingSet: () => {
      const next = pending.shift();
      if (!next) throw new Error("expected pending local draft set");
      next.resolve();
    },
    rejectPendingSet: (error: unknown) => {
      const next = pending.shift();
      if (!next) throw new Error("expected pending local draft set");
      next.reject(error);
    },
  };
}

function createFailingDraftStore(options: Partial<LocalDraftStore>): LocalDraftStore {
  const base = createMemoryLocalDraftStore();
  return {
    get: options.get ?? base.get,
    set: options.set ?? base.set,
    remove: options.remove ?? base.remove,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("file session store", () => {
  it("opens a backing file and recomputes dirty state against editor text", async () => {
    const { store, editor } = await openHarness();

    expect(editor.getText()).toBe(DOC_A);
    expect(store.getState()).toMatchObject({
      file: { id: "file-a", displayName: "Budget.ord", adapterKind: "memory" },
      backingText: DOC_A,
      documentDirty: "clean",
      backingFileState: "clean",
      localDraftState: "none",
    });

    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    expect(store.getState()).toMatchObject({
      documentDirty: "dirty",
      backingFileState: "dirty",
    });

    editor.setText(DOC_A);
    store.getState().syncEditorSnapshot();
    expect(store.getState()).toMatchObject({
      documentDirty: "clean",
      backingFileState: "clean",
    });
  });

  it("autosaves to the backing file and clears matching local drafts", async () => {
    const { store, editor, adapter, localDraftStore } = await openHarness();

    adapter.setAvailability({ readPermission: "granted", writePermission: "denied" });
    editor.setText(DOC_B);
    await store.getState().autosaveNow();

    expect(adapter.getDiskText("file-a")).toBe(DOC_A);
    expect(await localDraftStore.get("memory:file-a")).toMatchObject({ text: DOC_B });
    expect(store.getState()).toMatchObject({
      documentDirty: "dirty",
      backingFileState: "dirty",
      localDraftState: "current",
    });

    adapter.setAvailability({ readPermission: "granted", writePermission: "granted" });
    await store.getState().save();

    expect(adapter.getDiskText("file-a")).toBe(DOC_B);
    expect(await localDraftStore.get("memory:file-a")).toBeNull();
    expect(store.getState()).toMatchObject({
      documentDirty: "clean",
      backingFileState: "clean",
      localDraftState: "none",
    });
  });

  it("lets explicit Save request prompt write permission through the adapter", async () => {
    const baseAdapter = createMemoryStorageAdapter({
      "file-a": { displayName: "Budget.ord", text: DOC_A },
    });
    let saveCalls = 0;
    const adapter: MemoryStorageAdapter = {
      ...baseAdapter,
      availability: async () => ({ readPermission: "granted", writePermission: "prompt" }),
      save: async (file, text, options) => {
        saveCalls += 1;
        baseAdapter.setAvailability({ readPermission: "granted", writePermission: "granted" });
        return baseAdapter.save(file, text, options);
      },
    };
    const { store, editor, localDraftStore } = createHarness({ adapter });
    await store.getState().open();

    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    await store.getState().save();

    expect(saveCalls).toBe(1);
    expect(baseAdapter.getDiskText("file-a")).toBe(DOC_B);
    expect(await localDraftStore.get("memory:file-a")).toBeNull();
    expect(store.getState()).toMatchObject({
      documentDirty: "clean",
      backingFileState: "clean",
      lastError: null,
    });
  });

  it("does not let a slow Save preflight overwrite a later Save As", async () => {
    const baseAdapter = createMemoryStorageAdapter({
      "file-a": { displayName: "Budget.ord", text: DOC_A },
    });
    let deferNextAvailability = false;
    const deferredAvailability: {
      resolve?: (availability: { readPermission: "granted"; writePermission: "granted" }) => void;
    } = {};
    const adapter: MemoryStorageAdapter = {
      ...baseAdapter,
      availability: async (file) => {
        if (!deferNextAvailability) return baseAdapter.availability(file);
        deferNextAvailability = false;
        return await new Promise((resolve) => {
          deferredAvailability.resolve = resolve;
        });
      },
    };
    const { store, editor } = createHarness({ adapter });
    await store.getState().open();

    deferNextAvailability = true;
    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    const slowSave = store.getState().save();
    await flushAsyncWork();
    expect(store.getState().operation).toMatchObject({ kind: "save", text: DOC_B });

    await store.getState().saveAs();
    expect(store.getState().file).toMatchObject({ id: "memory-file-1" });
    expect(baseAdapter.getDiskText("memory-file-1")).toBe(DOC_B);

    if (!deferredAvailability.resolve) throw new Error("expected deferred availability");
    deferredAvailability.resolve({ readPermission: "granted", writePermission: "granted" });
    await slowSave;

    expect(baseAdapter.getDiskText("file-a")).toBe(DOC_A);
    expect(store.getState()).toMatchObject({
      file: { id: "memory-file-1" },
      backingText: DOC_B,
      operation: null,
    });
  });

  it("persists the newest editor text when local-draft fallback resolves late", async () => {
    const baseDraftStore = createMemoryLocalDraftStore();
    const deferredDraft = createDeferredDraftStore(baseDraftStore);
    const { store, editor, adapter } = createHarness({ localDraftStore: deferredDraft.store });
    await store.getState().open();
    adapter.setAvailability({ readPermission: "granted", writePermission: "denied" });

    deferredDraft.deferNextSet();
    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    const autosave = store.getState().autosaveNow();
    await flushAsyncWork();
    expect(deferredDraft.pendingSetCount()).toBe(1);

    editor.setText(DOC_C);
    store.getState().syncEditorSnapshot();
    void store.getState().autosaveNow();
    deferredDraft.resolvePendingSet();
    await autosave;

    expect(await baseDraftStore.get("memory:file-a")).toMatchObject({ text: DOC_C });
    expect(store.getState()).toMatchObject({
      localDraftText: DOC_C,
      localDraftState: "current",
      documentDirty: "dirty",
    });
  });

  it("does not change file identity or baseline when Save As is cancelled", async () => {
    const { store, editor, adapter } = createHarness();
    editor.setText(DOC_B);
    adapter.setNextSaveFailure({ kind: "cancelled" });

    await store.getState().saveAs();

    expect(store.getState()).toMatchObject({
      file: null,
      backingText: null,
      backingVersion: null,
      operation: null,
      lastError: { kind: "cancelled" },
    });
  });

  it("does not report browser download fallback as a writable save", async () => {
    const clicks: string[] = [];
    const fakeWindow = {
      document: {
        createElement: (tagName: string) => {
          if (tagName !== "a") throw new Error(`unexpected element '${tagName}'`);
          return {
            href: "",
            download: "",
            click() {
              clicks.push(this.download);
            },
          };
        },
        body: {
          append: () => undefined,
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setTimeout: globalThis.setTimeout,
    } as unknown as Window;
    const adapter = createBrowserStorageAdapter(fakeWindow);

    const result = await adapter.saveAs(DOC_A);

    expect(clicks).toEqual(["Untitled.ord"]);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "write_failed" },
    });
  });

  it("tracks clean external changes separately from dirty conflicts", async () => {
    const { store, editor, adapter } = await openHarness();

    await adapter.setDiskText("file-a", DOC_B);
    store.getState().handleExternalSnapshot(await currentSnapshot(adapter));
    expect(store.getState()).toMatchObject({
      backingFileState: "external_changed",
      conflict: null,
      documentDirty: "clean",
    });

    await store.getState().reloadFromDisk();
    expect(editor.getText()).toBe(DOC_B);
    expect(store.getState()).toMatchObject({
      backingText: DOC_B,
      backingFileState: "clean",
      documentDirty: "clean",
    });

    editor.setText(DOC_C);
    store.getState().syncEditorSnapshot();
    await adapter.setDiskText("file-a", DOC_A);
    store.getState().handleExternalSnapshot(await currentSnapshot(adapter));
    expect(store.getState()).toMatchObject({
      backingFileState: "conflict",
      conflict: {
        diskText: DOC_A,
        baselineText: DOC_B,
        editorText: DOC_C,
      },
      documentDirty: "dirty",
    });

    store.getState().cancelConflict();
    expect(store.getState()).toMatchObject({
      conflict: null,
      backingFileState: "dirty",
      documentDirty: "dirty",
    });
  });

  it("ignores self-observed external snapshots with the current backing version", async () => {
    const { store, adapter } = await openHarness();
    const snapshot = await currentSnapshot(adapter);

    store.getState().handleExternalSnapshot(snapshot);

    expect(store.getState()).toMatchObject({
      externalSnapshot: null,
      conflict: null,
      backingFileState: "clean",
      documentDirty: "clean",
    });
  });

  it("detects external changes after saving an empty backing text", async () => {
    const adapter = createMemoryStorageAdapter({
      "file-a": { displayName: "Empty.ord", text: "" },
    });
    const { store } = createHarness({ adapter, editorText: "" });
    await store.getState().open();

    await adapter.setDiskText("file-a", DOC_A);
    store.getState().handleExternalSnapshot(await currentSnapshot(adapter));

    expect(store.getState()).toMatchObject({
      externalSnapshot: { text: DOC_A },
      backingFileState: "external_changed",
      conflict: null,
    });
  });

  it("keeps current text dirty against the newer disk baseline when dismissing a clean external change", async () => {
    const { store, editor, adapter } = await openHarness();

    await adapter.setDiskText("file-a", DOC_B);
    store.getState().handleExternalSnapshot(await currentSnapshot(adapter));
    store.getState().cancelConflict();

    expect(editor.getText()).toBe(DOC_A);
    expect(store.getState()).toMatchObject({
      backingText: DOC_B,
      externalSnapshot: null,
      documentDirty: "dirty",
      backingFileState: "dirty",
    });
  });

  it("can overwrite a conflict or save it as a new file", async () => {
    const overwrite = await openHarness();
    overwrite.editor.setText(DOC_B);
    overwrite.store.getState().syncEditorSnapshot();
    await overwrite.adapter.setDiskText("file-a", DOC_C);
    overwrite.store.getState().handleExternalSnapshot(await currentSnapshot(overwrite.adapter));

    await overwrite.store.getState().overwriteConflict();
    expect(overwrite.adapter.getDiskText("file-a")).toBe(DOC_B);
    expect(overwrite.store.getState()).toMatchObject({
      file: { id: "file-a" },
      conflict: null,
      documentDirty: "clean",
      backingFileState: "clean",
    });

    const saveCopy = await openHarness();
    saveCopy.editor.setText(DOC_B);
    saveCopy.store.getState().syncEditorSnapshot();
    await saveCopy.adapter.setDiskText("file-a", DOC_C);
    saveCopy.store.getState().handleExternalSnapshot(await currentSnapshot(saveCopy.adapter));

    await saveCopy.store.getState().saveConflictAsNewFile();
    const newFile = saveCopy.store.getState().file;
    expect(newFile?.id).toBe("memory-file-1");
    expect(saveCopy.adapter.getDiskText("memory-file-1")).toBe(DOC_B);
    expect(saveCopy.adapter.getDiskText("file-a")).toBe(DOC_C);
    expect(saveCopy.store.getState()).toMatchObject({
      conflict: null,
      documentDirty: "clean",
      backingFileState: "clean",
    });
  });

  it("re-reads the disk before overwriting a conflict", async () => {
    const { store, editor, adapter } = await openHarness();

    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    await adapter.setDiskText("file-a", DOC_C);
    store.getState().handleExternalSnapshot(await currentSnapshot(adapter));
    await adapter.setDiskText("file-a", DOC_D);

    await store.getState().overwriteConflict();

    expect(adapter.getDiskText("file-a")).toBe(DOC_D);
    expect(store.getState()).toMatchObject({
      backingFileState: "conflict",
      conflict: {
        diskText: DOC_D,
        editorText: DOC_B,
      },
    });
  });

  it("does not mark newer editor text clean when an older autosave resolves", async () => {
    const baseAdapter = createMemoryStorageAdapter({
      "file-a": { displayName: "Budget.ord", text: DOC_A },
    });
    const deferred = createDeferredSaveAdapter(baseAdapter);
    const { store, editor, adapter } = createHarness({ adapter: deferred.adapter });
    await store.getState().open();

    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    const autosave = store.getState().autosaveNow();
    await flushAsyncWork();
    expect(deferred.pendingSaveCount()).toBe(1);

    editor.setText(DOC_C);
    store.getState().syncEditorSnapshot();
    await deferred.resolvePendingSave();
    await flushAsyncWork();
    expect(deferred.pendingSaveCount()).toBe(1);
    expect(store.getState().operation).toMatchObject({ kind: "autosave_backing", text: DOC_C });
    expect(adapter.getDiskText("file-a")).toBe(DOC_B);

    await deferred.resolvePendingSave();
    await autosave;

    expect(adapter.getDiskText("file-a")).toBe(DOC_C);
    expect(editor.getText()).toBe(DOC_C);
    expect(store.getState()).toMatchObject({
      backingText: DOC_C,
      documentDirty: "clean",
      backingFileState: "clean",
    });
  });

  it("lets a manual Save supersede an older autosave result", async () => {
    const baseAdapter = createMemoryStorageAdapter({
      "file-a": { displayName: "Budget.ord", text: DOC_A },
    });
    const deferred = createDeferredSaveAdapter(baseAdapter);
    const { store, editor } = createHarness({ adapter: deferred.adapter });
    await store.getState().open();

    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    const autosave = store.getState().autosaveNow();
    await flushAsyncWork();
    expect(deferred.hasPendingSave()).toBe(true);

    editor.setText(DOC_C);
    store.getState().syncEditorSnapshot();
    const manualSave = store.getState().save();
    await flushAsyncWork();
    expect(deferred.pendingSaveCount()).toBe(2);
    expect(store.getState().operation).toMatchObject({ kind: "save", text: DOC_C });

    await deferred.resolvePendingSave(0);
    await autosave;
    expect(store.getState().operation).toMatchObject({ kind: "save", text: DOC_C });

    await deferred.resolvePendingSave(0);
    await flushAsyncWork();
    expect(deferred.pendingSaveCount()).toBe(1);

    await deferred.resolvePendingSave(0);
    await manualSave;

    expect(store.getState()).toMatchObject({
      backingText: DOC_C,
      documentDirty: "clean",
      backingFileState: "clean",
      operation: null,
    });
  });

  it("keeps invalid source in a local draft unless the user explicitly saves it", async () => {
    const { store, editor, adapter, localDraftStore } = await openHarness();

    editor.setText(INVALID_SOURCE, "invalid_source");
    await store.getState().autosaveNow();

    expect(adapter.getDiskText("file-a")).toBe(DOC_A);
    expect(await localDraftStore.get("memory:file-a")).toMatchObject({ text: INVALID_SOURCE });
    expect(store.getState()).toMatchObject({
      documentDirty: "dirty",
      localDraftState: "current",
    });

    await store.getState().save();
    expect(adapter.getDiskText("file-a")).toBe(DOC_A);
    expect(store.getState()).toMatchObject({
      lastError: { kind: "write_failed" },
      backingFileState: "error",
    });

    await store.getState().save({ allowInvalidSource: true });
    expect(adapter.getDiskText("file-a")).toBe(INVALID_SOURCE);
    expect(await localDraftStore.get("memory:file-a")).toBeNull();
    expect(store.getState()).toMatchObject({
      documentDirty: "clean",
      backingFileState: "clean",
      localDraftState: "none",
    });
  });

  it("surfaces local draft read failures instead of silently ignoring them", async () => {
    const localDraftStore = createFailingDraftStore({
      get: async () => {
        throw new Error("corrupt draft");
      },
    });
    const { store } = createHarness({ localDraftStore });

    await store.getState().open();

    expect(store.getState()).toMatchObject({
      operation: null,
      localDraftState: "error",
      lastError: { kind: "read_failed" },
    });
  });

  it("surfaces local draft write failures during autosave fallback", async () => {
    const localDraftStore = createFailingDraftStore({
      set: async () => {
        throw new Error("quota exceeded");
      },
    });
    const { store, editor, adapter } = createHarness({ localDraftStore });
    await store.getState().open();
    adapter.setAvailability({ readPermission: "granted", writePermission: "denied" });

    editor.setText(DOC_B);
    store.getState().syncEditorSnapshot();
    await store.getState().autosaveNow();

    expect(store.getState()).toMatchObject({
      operation: null,
      localDraftState: "error",
      lastError: { kind: "write_failed" },
    });
  });

  it("loads an untitled local draft into recovery state on startup", async () => {
    const localDraftStore = createMemoryLocalDraftStore({
      "untitled:untitled-test": {
        key: "untitled:untitled-test",
        text: DOC_B,
        version: "draft-v1",
        updatedAt: 1,
      },
    });
    const { store, editor } = createHarness({ localDraftStore });

    await store.getState().loadUntitledDraft();

    expect(editor.getText()).toBe(DOC_A);
    expect(store.getState()).toMatchObject({
      recoveryDraft: { fileText: DOC_A, draft: { text: DOC_B } },
      localDraftText: DOC_B,
      localDraftState: "newer_than_backing",
    });
  });

  it("exposes recover, open saved, and discard branches for local drafts", async () => {
    const draftStore = createMemoryLocalDraftStore({
      "memory:file-a": {
        key: "memory:file-a",
        text: DOC_B,
        version: "draft-v1",
        updatedAt: 1,
      },
    });

    const recover = createHarness({ localDraftStore: draftStore });
    await recover.store.getState().open();
    expect(recover.store.getState().recoveryDraft).toMatchObject({ fileText: DOC_A });
    recover.store.getState().recoverDraft();
    expect(recover.editor.getText()).toBe(DOC_B);
    expect(recover.store.getState()).toMatchObject({
      recoveryDraft: null,
      documentDirty: "dirty",
      backingFileState: "dirty",
      localDraftState: "current",
    });

    const openSaved = createHarness({ localDraftStore: draftStore });
    await openSaved.store.getState().open();
    await openSaved.store.getState().openSavedFile();
    expect(openSaved.editor.getText()).toBe(DOC_A);
    expect(openSaved.store.getState()).toMatchObject({
      recoveryDraft: null,
      documentDirty: "clean",
      backingFileState: "clean",
    });

    const discard = createHarness({ localDraftStore: draftStore });
    await discard.store.getState().open();
    await discard.store.getState().discardDraft();
    expect(await draftStore.get("memory:file-a")).toBeNull();
    expect(discard.store.getState()).toMatchObject({
      recoveryDraft: null,
      localDraftState: "none",
    });
  });

  it("replaces the editor document and clears app history when reloading from disk", async () => {
    useEditorStore.getState().replaceDocumentText(DOC_A);
    const adapter = createMemoryStorageAdapter({
      "file-a": { displayName: "Budget.ord", text: DOC_A },
    });
    const store = createFileSessionStore({
      adapter,
      localDraftStore: createMemoryLocalDraftStore(),
      editor: {
        getPersistableText: () => getPersistableText(useEditorStore.getState()),
        replaceDocumentText: (text) => useEditorStore.getState().replaceDocumentText(text),
      },
      createUntitledId: () => "editor-integration",
    });

    await store.getState().open();
    useEditorStore.getState().setCellInput(
      { kind: "label", sheet: "Sheet", rowPath: "A", colLabel: "2024" },
      "9",
    );
    expect(useEditorStore.getState()).toMatchObject({
      canUndo: true,
      historyCursor: 1,
    });

    await adapter.setDiskText("file-a", DOC_C);
    store.getState().handleExternalSnapshot(await currentSnapshot(adapter));
    await store.getState().reloadFromDisk();

    expect(useEditorStore.getState()).toMatchObject({
      sourceText: DOC_C,
      canUndo: false,
      canRedo: false,
      historyCursor: 0,
      history: [],
    });
    const canonicalReloadText = getPersistableText(useEditorStore.getState()).text;
    expect(store.getState()).toMatchObject({
      backingText: canonicalReloadText,
      documentDirty: "clean",
      backingFileState: "clean",
    });
  });
});
