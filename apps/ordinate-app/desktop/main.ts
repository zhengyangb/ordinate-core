import { app, BrowserWindow, dialog, Menu, net, protocol, session, type MenuItemConstructorOptions } from "electron";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appKit } from "./nativeChrome.js";
import { createDocumentWindow, type DocumentWindow } from "./documentWindow.js";
import { presentDocumentWindow } from "./presentDocumentWindow.js";
import { createWorkspaceSession, type DocumentSession } from "./workspaceSession.js";
import type { DesktopCommand } from "../src/platform/storage.js";

const isDev = !app.isPackaged && process.argv.includes("--dev");
const rendererUrl = isDev ? "http://127.0.0.1:5174/" : "ordinate://app/";
app.setName("Ordinate");
if (isDev) app.setPath("userData", path.join(app.getPath("appData"), "Ordinate Development"));
protocol.registerSchemesAsPrivileged([{ scheme: "ordinate", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const windows = new Map<number, DocumentWindow>();
const workspace = createWorkspaceSession(app.getPath("userData"));
let initialized = false;
let allowQuit = false;
let flushingQuit = false;
let openQueue: Promise<unknown> = Promise.resolve();
let startup: Promise<void>;
const focused = () => {
  const win = BrowserWindow.getFocusedWindow();
  return win ? windows.get(win.id) : undefined;
};
const persist = () => {
  refreshMenu();
  return workspace.write([...windows.values()].map(entry => entry.record));
};
const reportError = (error: unknown) => dialog.showErrorBox("Ordinate", String(error));
const run = (action: () => Promise<unknown>) => { void action().catch(reportError); };

async function createWindow(record: DocumentSession = { id: randomUUID(), filename: null, text: null }, parent?: BrowserWindow) {
  if (flushingQuit) throw new Error("Wait for Ordinate to finish saving before opening another document.");
  const entry = createDocumentWindow({
    record, rendererUrl, persist,
    open: chooseDocuments,
    newDocument: async parent => { await createWindow(undefined, parent); },
    duplicate: async (text, parent) => { await createWindow({ id: randomUUID(), filename: null, text }, parent); },
    checkDestination: async filename => {
      let canonical: string;
      try { canonical = await realpath(filename); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        canonical = path.join(await realpath(path.dirname(filename)), path.basename(filename));
      }
      if ([...windows.values()].some(other => other !== entry && other.record.filename === canonical)) {
        throw new Error("This file is already open in another window. Choose a different name or close that document first.");
      }
    },
    isQuitting: () => allowQuit,
    closed: () => {
      windows.delete(entry.win.id);
      if (!allowQuit) run(persist);
    },
  });
  windows.set(entry.win.id, entry);
  entry.win.on("new-window-for-tab", () => run(() => createWindow(undefined, entry.win)));
  entry.win.on("focus", refreshMenu);
  entry.win.on("blur", refreshMenu);
  if (initialized) await persist();
  await entry.load();
  presentDocumentWindow(entry.win, process.platform === "darwin" ? parent : undefined);
  return entry;
}

async function openDocument(filename: string) {
  const canonical = await realpath(filename);
  const existing = [...windows.values()].find(entry => entry.record.filename === canonical);
  if (existing) { existing.win.show(); existing.win.focus(); return existing; }
  return createWindow({ id: randomUUID(), filename: canonical, text: null }, focused()?.win);
}

function openSystemDocument(filename: string): Promise<DocumentWindow> {
  const opening = openQueue.then(async () => { await startup; return openDocument(filename); });
  openQueue = opening.catch(() => undefined);
  return opening;
}

async function chooseDocuments(parent?: BrowserWindow) {
  const options: Electron.OpenDialogOptions = {
    title: "Open Ordinate document", properties: ["openFile", "multiSelections"],
    filters: [{ name: "Ordinate documents", extensions: ["ord", "txt"] }],
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (!result.canceled) for (const filename of result.filePaths) await openSystemDocument(filename);
}

appKit?.setDocumentOpenHandler((id, _kind, filename) => {
  void openSystemDocument(filename).then(
    entry => appKit!.completeDocumentOpen(id, entry.host.nativeId!, ""),
    error => appKit!.completeDocumentOpen(id, 0, String(error)),
  );
});
app.on("open-file", (event, filename) => { event.preventDefault(); run(() => openSystemDocument(filename)); });

// Flush every document before closing any window. Failed saves leave the whole
// workspace open, and the persisted identities restore independent drafts.
app.on("before-quit", event => {
  if (allowQuit) return;
  event.preventDefault();
  if (flushingQuit) return;
  flushingQuit = true;
  void (async () => {
    await Promise.all([...windows.values()].map(entry => entry.host.flush()));
    await persist();
    session.defaultSession.flushStorageData();
    allowQuit = true;
    app.quit();
  })().catch(error => { flushingQuit = false; reportError(error); });
});

function installMenu() {
  const command = (value: DesktopCommand) => focused()?.win.webContents.send("editor:command", value);
  const nativeAction = (action: "rename" | "move") => {
    const entry = focused();
    if (entry?.host.nativeId !== undefined) appKit!.documentAction(entry.host.nativeId, action);
  };
  const fileMenu: MenuItemConstructorOptions[] = [
    { label: "New", accelerator: "CmdOrCtrl+N", click: () => run(() => createWindow(undefined, focused()?.win)) },
    ...(process.platform === "darwin" ? [{
      label: "New Tab", accelerator: "CmdOrCtrl+Alt+N", click: () => run(() => createWindow(undefined, focused()?.win)),
    }] : []),
    { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => run(() => createWindow()) },
    { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => run(() => chooseDocuments(focused()?.win)) },
    ...(process.platform === "darwin" ? [{ role: "recentDocuments" as const, submenu: [{ role: "clearRecentDocuments" as const }] }] : []),
    { type: "separator" },
    { id: "save", label: "Save", accelerator: "CmdOrCtrl+S", click: () => command("save") },
    { id: "saveAs", label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => command("saveAs") },
    { id: "duplicate", label: "Duplicate", click: () => { const entry = focused(); if (entry) run(() => entry.host.request("duplicate")); } },
    ...(process.platform === "darwin" ? [
      { id: "rename", label: "Rename…", click: () => nativeAction("rename") },
      { id: "move", label: "Move To…", click: () => nativeAction("move") },
      { id: "revert", label: "Revert To…", click: () => { const entry = focused(); if (entry) run(entry.showVersions); } },
    ] : []),
    { type: "separator" }, { role: "close" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { label: "File", submenu: fileMenu },
    { label: "Edit", submenu: [
      { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => command("undo") },
      { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", click: () => command("redo") },
      { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { label: "Window", submenu: [
      { role: "minimize" }, { role: "zoom" },
      ...(process.platform === "darwin" ? [
        { type: "separator" as const },
        { label: "Show Tab Bar", click: () => focused()?.win.toggleTabBar() },
        { label: "Show Next Tab", accelerator: "Ctrl+Tab", click: () => focused()?.win.selectNextTab() },
        { label: "Show Previous Tab", accelerator: "Ctrl+Shift+Tab", click: () => focused()?.win.selectPreviousTab() },
        { label: "Move Tab to New Window", click: () => focused()?.win.moveTabToNewWindow() },
        { label: "Merge All Windows", click: () => focused()?.win.mergeAllWindows() },
        { type: "separator" as const }, { role: "front" as const }, { role: "window" as const },
      ] : []),
    ] },
  ]));
  refreshMenu();
}

function refreshMenu() {
  const entry = focused();
  const menu = Menu.getApplicationMenu();
  for (const id of ["save", "saveAs", "duplicate", "rename", "move", "revert"]) {
    const item = menu?.getMenuItemById(id);
    if (item) item.enabled = !!entry && (id !== "revert" || !!entry.record.filename);
  }
}

async function start() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (!isDev) {
    const assets = path.join(app.getAppPath(), "dist");
    protocol.handle("ordinate", async request => {
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
  installMenu();
  const records = await workspace.read();
  if (records.length) for (const record of records) await createWindow(record);
  else await createWindow();
  initialized = true;
  await persist();
  app.on("activate", () => { if (!windows.size) run(() => createWindow()); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

// Electron emits ready only after ESM evaluation has completed.
startup = start();
void startup.catch(error => { console.error(error); app.exit(1); });
