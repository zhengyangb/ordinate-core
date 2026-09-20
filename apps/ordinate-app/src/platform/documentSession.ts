import type { StoreApi } from "zustand/vanilla";
import type { FileSessionState } from "../store/fileSessionStore";
import type { DesktopBridge, DocumentRequest } from "./storage";

export async function waitForFileSession(store: StoreApi<FileSessionState>): Promise<void> {
  if (!store.getState().operation) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (!state.operation) { unsubscribe(); resolve(); }
    });
  });
  // A completed operation may synchronously start a follow-up autosave.
  return waitForFileSession(store);
}

/** One writer, including native autosave requests and closing during debounce. */
export async function flushFileSession(store: StoreApi<FileSessionState>): Promise<void> {
  await waitForFileSession(store);
  await store.getState().autosaveNow();
  await waitForFileSession(store);
  store.getState().syncEditorSnapshot();
  const state = store.getState();
  if (state.recoveryDraft) throw new Error("Resolve the recovery draft before closing this document.");
  if (state.conflict || state.externalSnapshot) throw new Error("Resolve the changes on disk before continuing.");
  if (state.file ? state.documentDirty !== "clean" : state.localDraftState !== "current") {
    throw new Error("The latest changes could not be saved. Keep this window open and check the file status.");
  }
}

export async function handleDocumentRequest(
  store: StoreApi<FileSessionState>, bridge: Pick<DesktopBridge, "readDocumentRequest" | "commitDocumentRequest">, request: DocumentRequest,
): Promise<void> {
  if (request.kind === "flush") return flushFileSession(store);
  if (request.kind === "open") {
    const snapshot = await bridge.readDocumentRequest(request.id);
    if (!snapshot.ok) throw new Error(`The document could not be opened: ${snapshot.error.kind}`);
    // Resume and the last-file bookmark may identify the same session. Do not
    // replace an already-open editor, its recovery draft, or its undo history.
    if (store.getState().file?.id === snapshot.value.file.id) return;
    await flushFileSession(store);
    await store.getState().open(async () => snapshot);
    if (store.getState().lastError) throw new Error("The document could not be opened. Check the file status.");
    return;
  }
  await waitForFileSession(store);
  if (request.kind === "move") await flushFileSession(store);
  await store.getState().persistTo(async (text) => {
    const { file, backingVersion: version } = store.getState();
    return bridge.commitDocumentRequest(request.id, { file, text, version });
  }, { allowInvalidSource: true });
  if (store.getState().lastError) throw new Error("The document could not be saved or moved. Check the file status.");
  await flushFileSession(store);
}
