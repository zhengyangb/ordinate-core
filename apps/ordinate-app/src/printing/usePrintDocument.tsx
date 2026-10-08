import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationDialogConfig } from "../components/ConfirmationDialog";
import { useEditorStore } from "../store/editorStore";
import { preparePrintDocument, type PreparedPrintDocument, type PrintOptions } from "./printDocumentModel";
import { printDocument } from "./runPrint";
import { browserPrint } from "./browserPrint";
import { PrintDialog } from "./PrintDialog";
import type { CellDisplayFormatter } from "../preferences/temporalDisplay";

export function usePrintDocument(prepare: () => void, requestConfirmation: (config: ConfirmationDialogConfig) => Promise<boolean>, displayCell: CellDisplayFormatter) {
  const phase = useRef<"idle" | "options" | "printing">("idle");
  const [request, setRequest] = useState<PreparedPrintDocument | null>(null);
  const reportError = useCallback(async (error: unknown) => {
    await requestConfirmation({ title: "Unable to print", body: <p>{error instanceof Error ? error.message : String(error)}</p>, confirmLabel: "OK", tone: "warning" });
  }, [requestConfirmation]);
  const openPrint = useCallback(async () => {
    if (phase.current !== "idle" || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    phase.current = "options";
    try {
      prepare();
      setRequest(preparePrintDocument(useEditorStore.getState(), displayCell));
    } catch (error) {
      await reportError(error);
      phase.current = "idle";
    }
  }, [prepare, reportError, displayCell]);
  const closePrint = useCallback(() => {
    if (phase.current !== "options") return;
    setRequest(null);
    phase.current = "idle";
  }, []);
  const confirmPrint = useCallback(async (options: PrintOptions) => {
    if (phase.current !== "options") return;
    if (!request) throw new Error("There is no print request to confirm.");
    phase.current = "printing";
    setRequest(null);
    try {
      const bridge = window.ordinateDesktop;
      await printDocument(request.build(options), bridge ? () => bridge.print() : browserPrint);
    } catch (error) {
      await reportError(error);
    } finally {
      phase.current = "idle";
    }
  }, [request, reportError]);
  useEffect(() => {
    // Native accelerators already use the same command. In browsers, prevent
    // Ctrl/Cmd+P from printing the virtualized editor instead of the full sheet.
    if (window.ordinateDesktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      void openPrint();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [openPrint]);
  return {
    openPrint,
    dialog: request && <PrintDialog document={request} onClose={closePrint} onPrint={confirmPrint} />,
  };
}
