import { describe, expect, it } from "vitest";
import { createFileSessionStore, createMemoryLocalDraftStore, createMemoryStorageAdapter, type PersistableText } from "../store/fileSessionStore";
import { flushFileSession, handleDocumentRequest } from "./documentSession";
import type { DesktopBridge } from "./storage";

function requestBridge(methods: Partial<Pick<DesktopBridge, "readDocumentRequest" | "commitDocumentRequest">>) {
  return {
    readDocumentRequest: async () => { throw new Error("Unexpected document read"); },
    commitDocumentRequest: async () => { throw new Error("Unexpected document write"); },
    ...methods,
  };
}

function harness(autosaveInvalidSource = false) {
  let text = "original";
  let validity: PersistableText["validity"] = "valid_document";
  const adapter = createMemoryStorageAdapter({ file: { displayName: "Report.ord", text } });
  const drafts = createMemoryLocalDraftStore();
  const store = createFileSessionStore({ adapter, localDraftStore: drafts, autosaveInvalidSource,
    editor: { getPersistableText: () => ({ text, validity, source: "source" }), replaceDocumentText: (value) => { text = value; } },
  });
  return { store, adapter, drafts, edit: (value: string, valid: PersistableText["validity"] = "valid_document") => { text = value; validity = valid; } };
}

describe("desktop document session", () => {
  it("routes a system open through the shared session and flushes the previous document", async () => {
    const { store, edit, adapter } = harness();
    await store.getState().open();
    const target = await adapter.saveAs("restored document");
    const bridge = requestBridge({ readDocumentRequest: async () => target });
    edit("unsaved before system open");
    await handleDocumentRequest(store, bridge, { id: "restore", kind: "open" });
    expect(adapter.getDiskText("file")).toBe("unsaved before system open");
    expect(store.getState().backingText).toBe("restored document");
  });

  it("does not replace local edits when Resume names the already-open document", async () => {
    const { store, edit, adapter } = harness();
    await store.getState().open();
    const bridge = requestBridge({ readDocumentRequest: () => adapter.readCurrent(store.getState().file!) });
    edit("local edits must survive");
    await handleDocumentRequest(store, bridge, { id: "restore", kind: "open" });
    await flushFileSession(store);
    expect(adapter.getDiskText("file")).toBe("local edits must survive");
  });

  it("rejects a system open if flushing the current document conflicts", async () => {
    const { store, edit, adapter } = harness();
    await store.getState().open();
    const target = await adapter.saveAs("another document");
    const bridge = requestBridge({ readDocumentRequest: async () => target });
    edit("local");
    await adapter.setDiskText("file", "external");
    await expect(handleDocumentRequest(store, bridge, { id: "restore", kind: "open" })).rejects.toThrow("changes on disk");
    expect(store.getState().file?.id).toBe("file");
    expect(adapter.getDiskText("file")).toBe("external");
  });

  it("reports a missing restored file without replacing the current editor", async () => {
    const { store } = harness();
    await store.getState().open();
    const bridge = requestBridge({ readDocumentRequest: async () => ({ ok: false, error: { kind: "not_found" } }) });
    await expect(handleDocumentRequest(store, bridge, { id: "restore", kind: "open" })).rejects.toThrow("not_found");
    expect(store.getState().backingText).toBe("original");
  });
  it("surfaces a rejected native write without leaving the session permanently busy", async () => {
    const { store } = harness();
    await store.getState().persistTo(async () => { throw new Error("Native session unavailable"); });
    expect(store.getState().operation).toBe(null);
    expect(store.getState().lastError).toMatchObject({ kind: "write_failed", message: "Native session unavailable" });
  });

  it("restores a provided native snapshot without opening another picker", async () => {
    const { store, adapter } = harness();
    const snapshot = await adapter.open();
    adapter.open = async () => { throw new Error("Unexpected picker"); };
    await store.getState().open(async () => snapshot);
    expect(store.getState().file?.displayName).toBe("Report.ord");
    expect(store.getState().operation).toBe(null);
  });

  it("flushes an edit even before the autosave debounce runs", async () => {
    const { store, edit, adapter } = harness();
    await store.getState().open();
    edit("latest");
    await flushFileSession(store);
    expect(adapter.getDiskText("file")).toBe("latest");
    expect(store.getState().documentDirty).toBe("clean");
  });

  it("waits for an in-flight write and persists edits made during that write", async () => {
    const { store, adapter, edit } = harness();
    await store.getState().open();
    const original = adapter.save;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    adapter.save = async (...args) => { started(); await gate; return original(...args); };
    edit("first");
    const saving = store.getState().autosaveNow();
    await startedPromise;
    edit("second");
    let finished = false;
    const flushing = flushFileSession(store).then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await Promise.all([saving, flushing]);
    expect(adapter.getDiskText("file")).toBe("second");
  });

  it("keeps untitled contents in a local draft without opening a save dialog", async () => {
    const { store, edit } = harness();
    edit("untitled latest");
    await flushFileSession(store);
    expect(store.getState()).toMatchObject({ file: null, localDraftState: "current", localDraftText: "untitled latest" });
  });

  it("does not overwrite an unresolved recovery draft", async () => {
    const { store } = harness();
    store.setState({ recoveryDraft: { key: "draft", draft: { key: "draft", text: "precious", version: "1", updatedAt: 1 }, fileText: "original" } });
    await expect(flushFileSession(store)).rejects.toThrow("recovery draft");
    expect(store.getState().recoveryDraft?.draft.text).toBe("precious");
  });

  it("refuses to close on a disk conflict even if a recovery draft was written", async () => {
    const { store, edit, adapter } = harness();
    await store.getState().open();
    edit("local");
    const file = store.getState().file!;
    await adapter.save(file, "external", { expectedVersion: store.getState().backingVersion, reason: "manual" });
    await expect(flushFileSession(store)).rejects.toThrow("changes on disk");
    expect(adapter.getDiskText("file")).toBe("external");
  });

  it.each([false, true])("only desktop opts into exact-text autosave of unfinished source (%s)", async (desktop) => {
    const { store, edit, adapter } = harness(desktop);
    await store.getState().open();
    edit("unfinished = sum(", "invalid_source");
    await store.getState().autosaveNow();
    expect(adapter.getDiskText("file")).toBe(desktop ? "unfinished = sum(" : "original");
  });

  it("adopts the new file reference before subsequent autosaves after a native move", async () => {
    const { store, edit, adapter } = harness();
    await store.getState().open();
    const bridge = requestBridge({ commitDocumentRequest: async (_id, write) => adapter.saveAs(write.text) });
    edit("before move");
    await handleDocumentRequest(store, bridge, { id: "native-capability", kind: "move" });
    const movedId = store.getState().file!.id;
    expect(movedId).not.toBe("file");
    edit("after move");
    await flushFileSession(store);
    expect(adapter.getDiskText(movedId)).toBe("after move");
    expect(adapter.getDiskText("file")).toBe("before move");
  });
});
