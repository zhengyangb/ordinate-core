import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopBridge, DesktopCommand, DocumentRequest, StorageFailure } from "../src/platform/storage.js";
import type { AgentEvent } from "../src/agent/contracts.js";

const sessionId = process.argv.find(argument => argument.startsWith("--ordinate-session="))?.split("=")[1];
if (!sessionId) throw new Error("Missing document session identity");
const systemLocale = process.argv.find(argument => argument.startsWith("--ordinate-locale="))?.slice("--ordinate-locale=".length);
if (!systemLocale) throw new Error("Missing system locale");
const bridge: DesktopBridge = {
  agent: {
    connection: () => ipcRenderer.invoke("agent:connection"),
    login: () => ipcRenderer.invoke("agent:login"),
    models: () => ipcRenderer.invoke("agent:models"),
    startSystemDictation: () => ipcRenderer.invoke("agent:startSystemDictation"),
    stopSystemDictation: () => ipcRenderer.invoke("agent:stopSystemDictation"),
    send: (input) => ipcRenderer.invoke("agent:send", input),
    stop: () => ipcRenderer.invoke("agent:stop"),
    openDiagnosticsFolder: () => ipcRenderer.invoke("agent:openDiagnosticsFolder"),
    openLink: (url) => ipcRenderer.invoke("agent:openLink", url),
    resolveProposal: () => ipcRenderer.invoke("agent:resolveProposal"),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, update: AgentEvent) => callback(update);
      ipcRenderer.on("agent:event", listener);
      return () => ipcRenderer.removeListener("agent:event", listener);
    },
  },
  windowChrome: "native",
  sessionId,
  systemLocale,
  restoreDocument: () => ipcRenderer.invoke("document:restore"),
  openDocument: (file) => {
    if (!file) return ipcRenderer.invoke("document:open");
    const filename = webUtils.getPathForFile(file);
    if (!filename) return Promise.reject(new Error("The dropped file has no filesystem location."));
    return ipcRenderer.invoke("document:open", filename);
  },
  newDocument: () => ipcRenderer.invoke("document:new"),
  interchange: {
    pickImport: () => ipcRenderer.invoke("interchange:pick"),
    saveExport: (file) => ipcRenderer.invoke("interchange:save", file),
  },
  openImportedDocument: (text, name) => ipcRenderer.invoke("document:import", text, name),
  duplicateDocument: (id, text) => ipcRenderer.invoke("document:duplicate", id, text),
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
  print: () => ipcRenderer.invoke("document:print"),
  commitDocumentRequest: (id, write) => ipcRenderer.invoke("document:commit", id, write),
  readDocumentRequest: (id) => ipcRenderer.invoke("document:read", id),
  onDocumentRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: DocumentRequest) => {
      void callback(request).then(
        result => ipcRenderer.invoke("document:complete", request.id, null, result),
        (error: unknown) => ipcRenderer.invoke("document:complete", request.id, String(error), null),
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
