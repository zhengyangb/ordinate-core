import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { DesktopBridge } from "../platform/storage";
import { PrintSheet } from "./PrintSheetView";
import type { PrintSheetModel } from "./printSheetModel";

/** Keep the complete print tree alive until the system dialog finishes, including cancellation. */
export async function printSheet(sheet: PrintSheetModel, bridge: Pick<DesktopBridge, "print">) {
  if (document.getElementById("ordinate-print-root")) throw new Error("A print operation is already in progress.");
  const container = document.createElement("div");
  container.id = "ordinate-print-root";
  document.body.append(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<PrintSheet sheet={sheet} />));
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await bridge.print();
  } finally {
    root.unmount();
    container.remove();
  }
}
