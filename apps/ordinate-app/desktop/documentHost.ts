import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { DocumentRequest, DocumentWrite } from "../src/platform/storage.js";
import type { createNativeStorage } from "./fileStorage.js";
import { appKit } from "./nativeChrome.js";

type Request = DocumentRequest & {
  destination?: string;
  committed: boolean;
  finish: (error: string | null) => void;
};

/** Destinations stay in the main process; the renderer only sees single-use IDs. */
export function createDocumentHost(win: BrowserWindow, storage: ReturnType<typeof createNativeStorage>) {
  const pending = new Map<string, Request>();
  let ready = false;
  const send = (request: Request) => {
    pending.set(request.id, request);
    if (ready) win.webContents.send("document:request", { id: request.id, kind: request.kind });
  };
  const nativeId = appKit?.attachDocument(win.getNativeWindowHandle(), (id, kind, destination) => {
    send({ id: randomUUID(), kind, destination, committed: false,
      finish: (error) => appKit!.completeDocumentRequest(nativeId!, id, error ?? "") });
  });
  const unavailable = (message: string) => {
    ready = false;
    for (const request of pending.values()) request.finish(message);
    pending.clear();
  };
  return {
    unavailable,
    nativeId,
    openDocument(filename: string): Promise<void> {
      return new Promise((resolve, reject) => send({ id: randomUUID(), kind: "open", destination: filename, committed: false,
        finish: (error) => error ? reject(new Error(error)) : resolve() }));
    },
    async read(id: string) {
      const request = pending.get(id);
      if (!request || request.kind !== "open" || !request.destination || request.committed) throw new Error("Invalid document read capability");
      request.committed = true;
      return storage.readPath(request.destination);
    },
    ready() {
      if (ready) return;
      ready = true;
      for (const { id, kind } of pending.values()) win.webContents.send("document:request", { id, kind });
    },
    update(filename: string, edited: boolean) {
      if (nativeId !== undefined) appKit!.updateDocument(nativeId, filename, edited);
    },
    flush(): Promise<void> {
      if (!ready) return Promise.reject(new Error("The editor is not ready to save. Please wait for it to finish loading."));
      return new Promise((resolve, reject) => send({ id: randomUUID(), kind: "flush", committed: false,
        finish: (error) => error ? reject(new Error(error)) : resolve() }));
    },
    async commit(id: string, write: DocumentWrite) {
      const request = pending.get(id);
      if (!request || (request.kind !== "save" && request.kind !== "move") || !request.destination || request.committed) throw new Error("Invalid document write capability");
      request.committed = true;
      if (request.kind === "save") return storage.saveTo(request.destination, write.text, write.file, write.version);
      if (!write.file || !write.version || !appKit) throw new Error("Moving requires a saved macOS document");
      return storage.moveTo(request.destination, write.file, write.version, (from, to) => appKit!.moveDocumentFile(nativeId!, from, to));
    },
    complete(id: string, error: unknown) {
      const request = pending.get(id);
      if (!request || (error !== null && typeof error !== "string")) throw new Error("Invalid document completion");
      if (request.kind !== "flush" && !request.committed && error === null) throw new Error("Document write has not been committed");
      pending.delete(id);
      request.finish(error);
    },
    dispose() {
      // Complete AppKit requests before releasing their callback channel.
      unavailable("The document window closed before saving completed.");
      if (nativeId !== undefined) appKit!.detachDocument(nativeId);
    },
  };
}
