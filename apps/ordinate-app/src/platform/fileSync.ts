import type { StoreApi } from "zustand/vanilla";
import type { FileSessionState } from "../store/fileSessionStore";
import type { StorageAdapter } from "./storage";

/** Event-driven, one reader at a time; never interrupt a save or an uncommitted cell edit. */
export function startFileSync(
  store: StoreApi<FileSessionState>, adapter: StorageAdapter, isEditing: () => boolean,
) {
  if (!adapter.capabilities().canWatchBackingFile || !adapter.watch) {
    throw new Error("File synchronization requires a watching storage adapter");
  }
  let disposed = false;
  let running = false;
  let pending = false;
  let fileId: string | null = null;
  let stopWatch: (() => void) | undefined;

  async function pump() {
    if (disposed || running || !pending || isEditing() || store.getState().operation || store.getState().recoveryDraft) return;
    running = true;
    pending = false;
    const expectedFile = fileId;
    try {
      await store.getState().refreshFromDisk(() => !disposed && expectedFile === fileId && !isEditing());
    } finally {
      running = false;
      void pump();
    }
  }
  const refresh = () => { pending = true; void pump(); };
  const syncSubscription = () => {
    if (disposed) return;
    const file = store.getState().file;
    if (file?.id !== (fileId ?? undefined)) {
      stopWatch?.();
      fileId = file?.id ?? null;
      pending = false;
      stopWatch = file ? adapter.watch!(file, (error) => {
        if (disposed || file.id !== fileId) return;
        if (error) store.setState({ lastError: error, backingFileState: "error" });
        else refresh();
      }) : undefined;
    }
    void pump();
  };
  const unsubscribe = store.subscribe(syncSubscription);
  syncSubscription();
  return {
    refresh,
    dispose: () => { disposed = true; stopWatch?.(); unsubscribe(); },
  };
}
