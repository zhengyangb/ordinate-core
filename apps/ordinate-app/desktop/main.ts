import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, session } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createNativeStorage } from "./fileStorage.js";
import { windowPresentation } from "./windowPresentation.js";
import { appKit, setNativeChrome } from "./nativeChrome.js";
import { createDocumentHost } from "./documentHost.js";
import { createRecentDocument } from "./recentDocument.js";
import { watchDocument } from "./fileWatcher.js";
import type { DesktopCommand } from "../src/platform/storage.js";

const isDev = !app.isPackaged && process.argv.includes("--dev");
const rendererUrl = isDev ? "http://127.0.0.1:5174/" : "ordinate://app/";
const desktopDir = path.dirname(fileURLToPath(import.meta.url));
app.setName("Ordinate");
// Keep development experiments and browser drafts separate from the packaged app.
if (isDev) app.setPath("userData", path.join(app.getPath("appData"), "Ordinate Development"));
protocol.registerSchemesAsPrivileged([{
  scheme: "ordinate", privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

let mainWindow: BrowserWindow | null = null;
let currentDocumentHost: ReturnType<typeof createDocumentHost> | null = null;
let windowCreation: Promise<void> | null = null;
let documentOpenQueue: Promise<unknown> = Promise.resolve();
const recent = createRecentDocument(app.getPath("userData"));
let quitting = false;
app.on("before-quit", () => { quitting = true; });

function ensureWindow(): Promise<void> {
  if (windowCreation) return windowCreation;
  if (mainWindow) return Promise.resolve();
  windowCreation = createWindow().finally(() => { windowCreation = null; });
  return windowCreation;
}

function openSystemDocument(filename: string): Promise<number | undefined> {
  const opening = documentOpenQueue.then(async () => {
    await app.whenReady();
    await ensureWindow();
    const host = currentDocumentHost;
    if (!host) throw new Error("The document window is unavailable");
    await host.openDocument(filename);
    await recent.remember(filename);
    mainWindow?.show();
    return host.nativeId;
  });
  // Serialize system opens; each caller still receives its own failure.
  documentOpenQueue = opening.catch(() => undefined);
  return opening;
}

appKit?.setDocumentOpenHandler((id, _kind, filename) => {
  void openSystemDocument(filename).then(
    host => appKit!.completeDocumentOpen(id, host!, ""),
    error => appKit!.completeDocumentOpen(id, 0, String(error)),
  );
});
// Finder opens can arrive before ready, just like AppKit's Resume requests.
app.on("open-file", (event, filename) => {
  event.preventDefault();
  void openSystemDocument(filename).catch(error => dialog.showErrorBox("Could not open document", String(error)));
});

async function createWindow() {
  const win = new BrowserWindow({
    title: "Untitled", width: 1280, height: 860, minWidth: 640, minHeight: 480,
    backgroundColor: "#f5f5f4", show: false,
    // The system title bar owns document title, proxy icon and traffic lights.
    titleBarStyle: "default",
    webPreferences: {
      preload: path.join(desktopDir, "preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  mainWindow = win;
  const storage = createNativeStorage({
    open: async () => {
      const result = await dialog.showOpenDialog(win, {
        title: "Open Ordinate document", properties: ["openFile"],
        filters: [{ name: "Ordinate documents", extensions: ["ord", "txt"] }],
      });
      if (result.canceled) return null;
      if (!result.filePaths[0]) throw new Error("Open dialog returned no file");
      return result.filePaths[0];
    },
    save: async () => {
      const result = await dialog.showSaveDialog(win, {
        title: "Save Ordinate document", defaultPath: "Untitled.ord",
        filters: [{ name: "Ordinate document", extensions: ["ord"] }],
      });
      if (result.canceled) return null;
      if (!result.filePath) throw new Error("Save dialog returned no destination");
      return result.filePath;
    },
  }, appKit?.copyDocumentMetadata);
  const documentHost = createDocumentHost(win, storage);
  currentDocumentHost = documentHost;
  const validateSender = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame
      || event.senderFrame.url !== rendererUrl) throw new Error("Untrusted desktop request");
  };
  const documentReady = (event: Electron.IpcMainEvent) => { validateSender(event); documentHost.ready(); };
  let fileWatch: { id: string; stop: () => void } | null = null;
  const stopFileWatch = () => { fileWatch?.stop(); fileWatch = null; };
  ipcMain.handle("file:watch", (event, id: unknown, file) => {
    validateSender(event);
    if (typeof id !== "string" || id.length > 100) throw new TypeError("Invalid watch subscription");
    const filename = storage.documentPath(file);
    stopFileWatch();
    fileWatch = { id, stop: watchDocument(filename, (error) => {
      win.webContents.send("file:changed", id, error);
    }) };
  });
  const unwatch = (event: Electron.IpcMainEvent, id: unknown) => {
    validateSender(event);
    if (fileWatch?.id === id) stopFileWatch();
  };
  ipcMain.on("file:unwatch", unwatch);
  win.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) stopFileWatch();
  });
  win.webContents.on("render-process-gone", stopFileWatch);
  ipcMain.on("document:ready", documentReady);
  ipcMain.handle("document:commit", async (event, id, write) => {
    validateSender(event);
    const result = await documentHost.commit(id, write);
    if (result.ok) await recent.remember(storage.documentPath(result.value.file));
    return result;
  });
  ipcMain.handle("document:read", (event, id) => { validateSender(event); return documentHost.read(id); });
  ipcMain.handle("document:restore", async (event) => {
    validateSender(event);
    const filename = await recent.read();
    return filename ? storage.readPath(filename) : null;
  });
  ipcMain.handle("document:complete", (event, id, error) => { validateSender(event); documentHost.complete(id, error); });
  const fileMethods = ["open", "save", "saveAs", "readCurrent", "availability"] as const;
  for (const method of fileMethods) {
    ipcMain.handle(`file:${method}`, async (event, ...args: unknown[]) => {
      validateSender(event);
      // Each operation validates its capability and arguments at the storage boundary.
      const invoke = storage[method] as (...values: unknown[]) => unknown;
      const result = await invoke(...args);
      if (method === "open" || method === "saveAs") {
        const snapshot = result as Awaited<ReturnType<typeof storage.open>>;
        if (snapshot.ok) await recent.remember(storage.documentPath(snapshot.value.file));
      }
      return result;
    });
  }
  ipcMain.handle("window:update", (event, state) => {
    validateSender(event);
    const presentation = windowPresentation(state, storage.documentPath);
    nativeTheme.themeSource = presentation.themeSource;
    setNativeChrome(win, presentation.chromeColor);
    win.setTitle(presentation.title);
    if (process.platform === "darwin") {
      documentHost.update(presentation.filename, presentation.edited);
    }
  });
  // HTML page titles must not overwrite the native document title.
  win.on("page-title-updated", (event) => event.preventDefault());
  ipcMain.handle("editor:nativeHistory", (event, command: unknown) => {
    validateSender(event);
    if (command !== "undo" && command !== "redo") throw new TypeError("Invalid history command");
    win.webContents[command]();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.on("did-navigate", () => documentHost.unavailable("The editor reloaded before saving completed."));
  win.webContents.on("render-process-gone", () => documentHost.unavailable("The editor stopped unexpectedly. The latest save could not be confirmed."));
  let closing = false;
  let flushed = false;
  win.on("close", (event) => {
    if (flushed) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void documentHost.flush().then(() => {
      flushed = true;
      win.webContents.session.flushStorageData();
      if (quitting) app.quit();
      else win.close();
    }).catch(async (error: unknown) => {
      closing = false;
      quitting = false;
      await dialog.showMessageBox(win, { type: "warning", buttons: ["Keep Editing"],
        message: "Your changes haven't finished saving", detail: String(error) });
    });
  });
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning", buttons: ["Keep Editing", "Discard and Close"], defaultId: 0, cancelId: 0,
      title: "Unsaved changes", message: "Close without saving your latest changes?",
      detail: "The latest changes have not yet been saved to a file or recovery draft.",
    });
    if (choice === 1) event.preventDefault();
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    stopFileWatch();
    ipcMain.removeHandler("file:watch");
    ipcMain.removeListener("file:unwatch", unwatch);
    documentHost.dispose();
    ipcMain.removeListener("document:ready", documentReady);
    ipcMain.removeHandler("document:commit");
    ipcMain.removeHandler("document:read");
    ipcMain.removeHandler("document:complete");
    ipcMain.removeHandler("document:restore");
    for (const method of fileMethods) ipcMain.removeHandler(`file:${method}`);
    ipcMain.removeHandler("window:update");
    ipcMain.removeHandler("editor:nativeHistory");
    mainWindow = null;
    currentDocumentHost = null;
  });
  await win.loadURL(rendererUrl);
}

async function start() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  if (!isDev) {
    const assets = path.join(app.getAppPath(), "dist");
    protocol.handle("ordinate", async (request) => {
      const url = new URL(request.url);
      if (url.host !== "app" || request.method !== "GET") return new Response("Forbidden", { status: 403 });
      const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const target = path.resolve(assets, `.${relative}`);
      if (!target.startsWith(`${assets}${path.sep}`)) return new Response("Forbidden", { status: 403 });
      const response = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'");
      return new Response(response.body, { status: response.status, headers });
    });
  }

  function command(value: DesktopCommand) { mainWindow?.webContents.send("editor:command", value); }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { label: "File", submenu: [
      { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => command("open") },
      { label: "Save", accelerator: "CmdOrCtrl+S", click: () => command("save") },
      { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => command("saveAs") },
      { type: "separator" }, { role: "close" },
    ] },
    { label: "Edit", submenu: [
      { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => command("undo") },
      { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: () => command("redo") },
      { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
  ]));
  app.on("activate", () => { if (!mainWindow) void ensureWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  await ensureWindow();
}

// Do not await app readiness at module scope: Electron waits for ESM evaluation
// before emitting ready, which would otherwise deadlock startup.
void start().catch((error) => { console.error(error); app.exit(1); });
