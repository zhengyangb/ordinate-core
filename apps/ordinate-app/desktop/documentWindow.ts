import { app, BrowserWindow, dialog, Menu, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeStorage } from "./fileStorage.js";
import { createNativeInterchange } from "./interchangeStorage.js";
import { FORMATS, IMPORT_FORMATS, MAX_EXPORT_BYTES } from "../src/interchange/contracts.js";
import { createDocumentHost } from "./documentHost.js";
import { createWindowIpc } from "./windowIpc.js";
import { createVersionHistory } from "./versionHistory.js";
import { watchDocument } from "./fileWatcher.js";
import { appKit, setNativeChrome } from "./nativeChrome.js";
import { windowPresentation } from "./windowPresentation.js";
import { createSheetPrinter } from "./printing.js";
import type { DocumentSession } from "./workspaceSession.js";
import type { FileSnapshot, StorageResult } from "../src/platform/storage.js";
import { documentSaveName, validateDocumentName } from "../src/platform/documentName.js";
import type { QuitPhase } from "./quitCoordinator.js";

type Options = {
  record: DocumentSession;
  rendererUrl: string;
  persist: () => Promise<void>;
  open: (parent: BrowserWindow, filename?: string) => Promise<void>;
  newDocument: (parent: BrowserWindow) => Promise<void>;
  createUntitled: (text: string, parent: BrowserWindow, draftName?: string) => Promise<void>;
  checkDestination: (filename: string) => Promise<void>;
  quitPhase: () => QuitPhase;
  closed: () => void;
};

export function createDocumentWindow(options: Options) {
  const { record, rendererUrl } = options;
  const win = new BrowserWindow({
    title: record.filename ? path.basename(record.filename) : record.draftName ?? "Untitled",
    width: 1280, height: 860, minWidth: 640, minHeight: 480,
    backgroundColor: "#f5f5f4", show: false, titleBarStyle: "default",
    ...(process.platform === "darwin" ? { tabbingIdentifier: "dev.ordinate.documents" } : {}),
    webPreferences: {
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cjs"),
      additionalArguments: [`--ordinate-session=${record.id}`, `--ordinate-locale=${app.getSystemLocale()}`],
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  const ipc = createWindowIpc(win, rendererUrl);
  ipc.handle("document:print", createSheetPrinter(win, appKit));
  const interchange = createNativeInterchange({
    open: async () => {
      const result = await dialog.showOpenDialog(win, { title: "Import spreadsheet", properties: ["openFile"],
        filters: [{ name: "Spreadsheets", extensions: [...IMPORT_FORMATS] }] });
      if (result.canceled) return null;
      if (!result.filePaths[0]) throw new Error("Import dialog returned no file");
      return result.filePaths[0];
    },
    save: async file => {
      const result = await dialog.showSaveDialog(win, { title: "Export a copy", defaultPath: file.name,
        filters: [{ name: FORMATS[file.format].label, extensions: [file.format] }] });
      if (result.canceled) return null;
      if (!result.filePath) throw new Error("Export dialog returned no destination");
      return result.filePath;
    },
    checkDestination: async filename => {
      if (filename === record.filename) throw new Error("Export cannot overwrite the open document. Choose another filename; use Save to update this document.");
      await options.checkDestination(filename);
    },
  });
  ipc.handle("interchange:pick", () => interchange.pickImport());
  ipc.handle("interchange:save", (_event, file) => interchange.saveExport(file));
  ipc.handle("document:import", async (_event, text, name) => {
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_EXPORT_BYTES) throw new Error("Invalid imported document.");
    validateDocumentName(name);
    await options.createUntitled(text, win, name);
  });
  const history = createVersionHistory();
  const storage = createNativeStorage({
    open: async () => {
      const result = await dialog.showOpenDialog(win, { properties: ["openFile"],
        filters: [{ name: "Ordinate documents", extensions: ["ord", "txt"] }] });
      return result.canceled ? null : result.filePaths[0];
    },
    save: async () => {
      const result = await dialog.showSaveDialog(win, { title: "Save Ordinate document",
        defaultPath: record.filename ?? documentSaveName({file: null, draftName: record.draftName ?? null}), filters: [{ name: "Ordinate document", extensions: ["ord"] }] });
      if (result.canceled) return null;
      if (!result.filePath) throw new Error("Save dialog returned no destination");
      await options.checkDestination(result.filePath);
      return result.filePath;
    },
  }, appKit?.copyDocumentMetadata, filename => history.checkpoint(filename));
  let currentSnapshot: FileSnapshot | null = null;
  async function adopt(result: StorageResult<FileSnapshot>) {
      if (result.ok) {
      currentSnapshot = result.value;
      const filename = storage.documentPath(result.value.file);
      const changed = record.filename !== filename;
      record.filename = filename;
      delete record.draftName;
      record.text = null;
      if (process.platform === "darwin") {
        // Registers the URL for AppKit's Open Recent menu.
        app.addRecentDocument(record.filename);
      }
      if (changed) await options.persist();
    }
    return result;
  }
  const host = createDocumentHost(win, storage, kind => kind === "duplicate" ? host.request("duplicate") : showVersions(), options.checkDestination);
  let fileWatch: { id: string; stop: () => void } | null = null;
  const stopWatch = () => { fileWatch?.stop(); fileWatch = null; };
  ipc.handle("file:watch", (_event, id: unknown, file) => {
    if (typeof id !== "string" || id.length > 100) throw new TypeError("Invalid watch subscription");
    const filename = storage.documentPath(file);
    stopWatch();
    fileWatch = { id, stop: watchDocument(filename, error => win.webContents.send("file:changed", id, error)) };
  });
  ipc.on("file:unwatch", (_event, id) => { if (fileWatch?.id === id) stopWatch(); });
  ipc.on("document:ready", () => host.ready());
  ipc.handle("document:commit", async (_event, id, write) => adopt(await host.commit(id, write)));
  ipc.handle("document:read", async (_event, id) => adopt(await host.read(id)));
  ipc.handle("document:restore", async () => {
    return {
      snapshot: record.filename ? await adopt(await storage.readPath(record.filename)) : null,
      text: record.text, draftName: record.draftName,
    };
  });
  ipc.handle("document:complete", (_event, id, error, result) => host.complete(id, error, result));
  ipc.handle("document:open", (_event, filename?: unknown) => {
    if (filename === undefined) return options.open(win);
    if (typeof filename !== "string" || !path.isAbsolute(filename) || path.extname(filename).toLowerCase() !== ".ord") {
      throw new Error("Drop an .ord document to open it.");
    }
    return options.open(win, filename);
  });
  ipc.handle("document:new", () => options.newDocument(win));
  ipc.handle("document:duplicate", async (_event, id, text) => {
    if (typeof text !== "string") throw new TypeError("Document content must be text");
    host.claimDuplicate(id);
    await options.createUntitled(text, win);
  });
  for (const method of ["open", "save", "saveAs", "readCurrent", "availability"] as const) {
    ipc.handle(`file:${method}`, async (_event, ...args) => {
      const result = await (storage[method] as (...values: unknown[]) => Promise<unknown>)(...args);
      if (method !== "availability") await adopt(result as StorageResult<FileSnapshot>);
      return result;
    });
  }
  ipc.handle("window:update", async (_event, state) => {
    const presentation = windowPresentation(state, storage.documentPath, record.draftName);
    nativeTheme.themeSource = presentation.themeSource;
    setNativeChrome(win, presentation.chromeColor);
    // Initial renderer effects run before the file has been restored.
    if (record.filename && !presentation.filename) return;
    win.setTitle(presentation.title);
    host.update(presentation.filename, presentation.edited, presentation.title);
  });
  ipc.handle("editor:nativeHistory", (_event, command: unknown) => {
    if (command !== "undo" && command !== "redo") throw new TypeError("Invalid history command");
    win.webContents[command]();
  });

  async function showVersions() {
    if (!appKit || !record.filename) return;
    await host.flush();
    const versions = appKit.listVersions(record.filename);
    if (!versions.length) {
      await dialog.showMessageBox(win, { message: "No earlier versions yet", detail: "Versions are kept as you edit this document.", buttons: ["OK"] });
      return;
    }
    Menu.buildFromTemplate(versions.map(version => ({
      label: new Date(version.date).toLocaleString(),
      click: () => { void restoreVersion(version.id).catch(reportError); },
    }))).popup({ window: win });
  }
  async function restoreVersion(id: string) {
    if (!appKit || !record.filename) throw new Error("Version history requires a saved macOS document");
    const text = appKit.readVersion(record.filename, id);
    const choice = await dialog.showMessageBox(win, { type: "question", message: "Restore this version?",
      detail: "Your current document will be kept in version history.", buttons: ["Cancel", "Restore"], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return;
    await host.flush();
    if (!currentSnapshot) throw new Error("Missing document baseline");
    history.checkpoint(record.filename, true);
    await host.revert(currentSnapshot, text);
  }
  function reportError(error: unknown) {
    void dialog.showMessageBox(win, { type: "warning", message: "The document operation could not be completed", detail: String(error) });
  }
  win.on("page-title-updated", event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  win.webContents.on("did-start-navigation", (_event, _url, _inPlace, main) => { if (main) stopWatch(); });
  win.webContents.on("did-navigate", () => host.unavailable("The editor reloaded before saving completed."));
  win.webContents.on("render-process-gone", () => { stopWatch(); host.unavailable("The editor stopped before saving completed."); });
  let closing = false;
  let flushed = false;
  let closePreparation: Promise<boolean> | null = null;
  function prepareToClose(reason: "close" | "quit"): Promise<boolean> {
    if (closePreparation) return closePreparation;
    closePreparation = (async () => {
      const result = await host.flush();
      if (!result.needsSave) return true;
      const choice = await dialog.showMessageBox(win, {
        message: reason === "quit" ? "Save this document before quitting?" : "Save this document before closing?",
        detail: "Your changes have not been saved to a file.",
        buttons: ["Save…", "Cancel", "Don't Save"], defaultId: 0, cancelId: 1,
      });
      switch (choice.response) {
        case 0: await host.request("saveAs"); return true;
        case 1: return false;
        case 2: return true;
        default: throw new Error("Invalid document close choice");
      }
    })().finally(() => { closePreparation = null; });
    return closePreparation;
  }
  win.on("close", event => {
    if (options.quitPhase() === "checking") { event.preventDefault(); return; }
    if (flushed || options.quitPhase() === "approved") return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void (async () => {
      if (!await prepareToClose("close") || options.quitPhase() !== "idle") return;
      flushed = true;
      win.webContents.session.flushStorageData();
      win.close();
    })().catch(reportError).finally(() => { closing = false; });
  });
  win.webContents.on("will-prevent-unload", event => {
    if (flushed || options.quitPhase() === "approved") event.preventDefault();
  });
  // Creation/loading never presents a window. The workspace decides whether
  // this document becomes a standalone window or joins an existing tab group.
  win.on("closed", () => { stopWatch(); host.dispose(); ipc.dispose(); options.closed(); });
  return { win, host, record, prepareToClose, showVersions, reportError, load: () => win.loadURL(rendererUrl) };
}

export type DocumentWindow = ReturnType<typeof createDocumentWindow>;
