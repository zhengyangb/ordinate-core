import type { BrowserWindow } from "electron";

export type NativePDFPrinter = {
  printPDF: (handle: Buffer, pdf: Buffer, title: string,
    completion: (error: string, printed: boolean) => void) => void;
};

/** HTML owns pagination; PDFKit owns the native preview and printer settings. */
export function createSheetPrinter(win: BrowserWindow, native: NativePDFPrinter | null) {
  let pending = false;
  return async () => {
    if (!native) throw new Error("Printing is available only on Mac.");
    if (pending) throw new Error("A print operation is already in progress.");
    if (win.isDestroyed()) throw new Error("The document window has closed.");
    pending = true;
    try {
      const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      if (win.isDestroyed()) throw new Error("The document window has closed.");
      await new Promise<void>((resolve, reject) => {
        native.printPDF(win.getNativeWindowHandle(), pdf, win.getTitle(), error => {
          if (error) reject(new Error(error));
          else resolve(); // A cancelled system panel is not an application error.
        });
      });
    } finally {
      pending = false;
    }
  };
}
