import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { PrintDocument } from "./PrintSheetView";
import type { PrintSheetModel } from "./printDocumentModel";

/** Keep the complete print tree alive until the system dialog finishes, including cancellation. */
export async function printDocument(sheets: PrintSheetModel[], openPrintDialog: () => Promise<void>) {
  if (document.getElementById("ordinate-print-root")) throw new Error("A print operation is already in progress.");
  const container = document.createElement("div");
  container.id = "ordinate-print-root";
  document.body.append(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<PrintDocument sheets={sheets} />));
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await openPrintDialog();
  } finally {
    root.unmount();
    container.remove();
  }
}
