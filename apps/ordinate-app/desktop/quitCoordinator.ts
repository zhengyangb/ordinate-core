import type { DocumentSession } from "./workspaceSession.js";

export type QuitPhase = "idle" | "checking" | "approved";
type QuitDocument = {
  record: DocumentSession;
  prepareToClose: (reason: "close" | "quit") => Promise<boolean>;
};

/** Confirm the whole workspace before allowing Electron to close any window. */
export function createQuitCoordinator(options: {
  documents: () => QuitDocument[];
  persist: (records: DocumentSession[]) => Promise<void>;
  flushStorage: () => void;
  quit: () => void;
  reportError: (error: unknown) => void;
}) {
  let phase: QuitPhase = "idle";
  let pending: Promise<boolean> | null = null;
  const request = (): Promise<boolean> => {
    if (phase === "approved") return Promise.resolve(true);
    if (pending) return pending;
    phase = "checking";
    pending = (async () => {
      const documents = options.documents();
      // Serial sheets avoid competing save dialogs. Cancellation leaves every
      // window open, including documents already approved with Don't Save.
      for (const document of documents) {
        if (!await document.prepareToClose("quit")) return false;
      }
      // An unnamed document is now either untouched or explicitly discarded.
      // Only saved files should resume after this confirmed quit.
      await options.persist(documents.filter(document => document.record.filename !== null).map(document => document.record));
      options.flushStorage();
      phase = "approved";
      options.quit();
      return true;
    })().finally(() => {
      pending = null;
      if (phase !== "approved") phase = "idle";
    });
    return pending;
  };
  return {
    get phase() { return phase; },
    request,
    beforeQuit(event: { preventDefault: () => void }) {
      if (phase === "approved") return;
      event.preventDefault();
      if (phase === "checking") return;
      void request().catch(options.reportError);
    },
  };
}
