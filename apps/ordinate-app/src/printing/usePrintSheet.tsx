import { useCallback, useRef } from "react";
import type { ConfirmationDialogConfig } from "../components/ConfirmationDialog";
import { useEditorStore } from "../store/editorStore";
import { buildPrintSheet } from "./printSheetModel";
import { printSheet } from "./runPrint";
import type { CellDisplayFormatter } from "../preferences/temporalDisplay";

export function usePrintSheet(prepare: () => void, requestConfirmation: (config: ConfirmationDialogConfig) => Promise<boolean>, displayCell: CellDisplayFormatter) {
  const printing = useRef(false);
  return useCallback(async () => {
    if (printing.current) return;
    printing.current = true;
    try {
      const bridge = window.ordinateDesktop;
      if (!bridge) throw new Error("Printing is available in the Mac app.");
      prepare();
      await printSheet(buildPrintSheet(useEditorStore.getState(), displayCell), bridge);
    } catch (error) {
      await requestConfirmation({ title: "Unable to print", body: <p>{error instanceof Error ? error.message : String(error)}</p>, confirmLabel: "OK", tone: "warning" });
    } finally {
      printing.current = false;
    }
  }, [prepare, requestConfirmation, displayCell]);
}
