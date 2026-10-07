import type { DocumentState } from "./incremental";
import type { FormulaRenderContext, FormulaSheetRenderContext } from "./runtime/renderFormula";

/** One document-wide view of current IDs and labels for every formula renderer. */
export function buildFormulaRenderContext(document: DocumentState): FormulaRenderContext {
  const sheetsById = new Map<number, FormulaSheetRenderContext>();
  for (const sheet of document.sheets) {
    sheetsById.set(sheet.sheetId, {
      sheetName: sheet.name,
      rowIdToIndex: sheet.rowIdToIndex,
      colIdToIndex: sheet.colIdToIndex,
      rowLabelPathsByIndex: Array.from({ length: sheet.rowCount }, (_, r) =>
        r >= sheet.bodyStart ? (sheet.rowPaths[r - sheet.bodyStart] ?? "").split(".") : []),
      colLabelsByIndex: sheet.colLabels,
    });
  }
  return { sheetsById };
}
