import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopCommand, DocumentRequest, StorageFailure } from "../src/platform/storage.js";

const bridge: DesktopBridge = {
  windowChrome: "native",
  restoreDocument: () => ipcRenderer.invoke("document:restore"),
  updateWindow: (state) => ipcRenderer.invoke("window:update", state),
  open: () => ipcRenderer.invoke("file:open"),
  save: (file, text, options) => ipcRenderer.invoke("file:save", file, text, options),
  saveAs: (text) => ipcRenderer.invoke("file:saveAs", text),
  readCurrent: (file) => ipcRenderer.invoke("file:readCurrent", file),
  watch: (file, callback) => {
    const id = crypto.randomUUID();
    let active = true;
    const listener = (_event: Electron.IpcRendererEvent, subscription: string, error: StorageFailure | null) => {
      if (active && subscription === id) callback(error);
    };
    ipcRenderer.on("file:changed", listener);
    void ipcRenderer.invoke("file:watch", id, file).catch((error: unknown) => {
      if (active) callback({ kind: "read_failed", message: String(error) });
    });
    return () => {
      active = false;
      ipcRenderer.removeListener("file:changed", listener);
      ipcRenderer.send("file:unwatch", id);
    };
  },
  availability: (file) => ipcRenderer.invoke("file:availability", file),
  nativeHistory: (command) => ipcRenderer.invoke("editor:nativeHistory", command),
  commitDocumentRequest: (id, write) => ipcRenderer.invoke("document:commit", id, write),
  readDocumentRequest: (id) => ipcRenderer.invoke("document:read", id),
  onDocumentRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: DocumentRequest) => {
      void callback(request).then(
        () => ipcRenderer.invoke("document:complete", request.id, null),
        (error: unknown) => ipcRenderer.invoke("document:complete", request.id, String(error)),
      );
    };
    ipcRenderer.on("document:request", listener);
    ipcRenderer.send("document:ready");
    return () => ipcRenderer.removeListener("document:request", listener);
  },
  onCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: DesktopCommand) => callback(command);
    ipcRenderer.on("editor:command", listener);
    return () => ipcRenderer.removeListener("editor:command", listener);
  },
};
contextBridge.exposeInMainWorld("ordinateDesktop", bridge);
