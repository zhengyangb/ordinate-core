import { createRequire } from "node:module";
import type { BrowserWindow } from "electron";

type AppKit = {
  setDocumentOpenHandler: (callback: (id: number, kind: "open", filename: string) => void) => void;
  completeDocumentOpen: (request: number, host: number, error: string) => void;
  setChrome: (handle: Buffer, red: number, green: number, blue: number) => void;
  attachDocument: (handle: Buffer, callback: (id: number, kind: "flush" | "save" | "move" | "duplicate" | "revert", destination: string) => void) => number;
  documentAction: (host: number, action: "rename" | "move") => void;
  checkpoint: (filename: string) => void;
  listVersions: (filename: string) => Array<{ id: string; date: string }>;
  readVersion: (filename: string, id: string) => string;
  updateDocument: (host: number, path: string, edited: boolean) => void;
  completeDocumentRequest: (host: number, id: number, error: string) => void;
  detachDocument: (host: number) => void;
  moveDocumentFile: (host: number, from: string, to: string) => void;
  copyDocumentMetadata: (source: string, replacement: string) => void;
};
export const appKit: AppKit | null = process.platform === "darwin"
  ? createRequire(import.meta.url)("../native/titlebar.node") : null;

export function setNativeChrome(win: BrowserWindow, color: string) {
  if (!appKit) return; // This AppKit capability only exists on macOS.
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
  appKit.setChrome(win.getNativeWindowHandle(), rgb[0], rgb[1], rgb[2]);
}
