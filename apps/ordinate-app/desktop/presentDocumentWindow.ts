import type { BrowserWindow } from "electron";

/** Only the workspace may reveal a loaded document, after its tab placement. */
export function presentDocumentWindow(win: BrowserWindow, tabParent?: BrowserWindow) {
  if (win.isVisible()) throw new Error("Document was shown before its window placement was resolved");
  if (tabParent) {
    if (tabParent.isDestroyed()) {
      win.destroy();
      throw new Error("The destination tab group closed while the document was loading");
    }
    tabParent.addTabbedWindow(win);
  }
  win.show();
}
