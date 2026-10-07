import { DocumentState, resolveDocumentPresentation, serializeDocumentState, validateDocument } from "@ordinate/core";
import type { EditorState } from "../store/editorStore";
import { projectSheetRows } from "../hooks/useSheetViewModel";
import { buildHeaderMatrix, isBlockingSheetIssue } from "../utils/appHelpers";
import { resolveColumnLayouts } from "../utils/columnLayout";
import type { CellDisplayFormatter } from "../preferences/temporalDisplay";

/** A complete, detached snapshot: never print the virtualized viewport or stale source. */
export function buildPrintSheet(editor: Pick<EditorState, "mode" | "sourceText" | "docState" | "activeSheet">, displayCell: CellDisplayFormatter) {
  const state = editor.mode === "source" ? DocumentState.fromText(editor.sourceText) : editor.docState;
  if (!state) throw new Error("There is no document to print.");
  const sheet = state.sheets.find(sheet => sheet.name === editor.activeSheet);
  if (!sheet) throw new Error("Choose a sheet in table view before printing.");
  const validation = validateDocument(editor.mode === "source" ? editor.sourceText : serializeDocumentState(state));
  const blocking = validation.errors.find(issue => !issue.sheet || (issue.sheet === sheet.name && isBlockingSheetIssue(issue)));
  if (blocking) throw new Error(blocking.message);
  const evaluation = state.evaluate().sheets.find(value => value.name === sheet.name);
  const presentation = resolveDocumentPresentation(state).sheets.find(value => value.name === sheet.name);
  if (!evaluation || !presentation) throw new Error("The current sheet could not be evaluated for printing.");
  const rows = projectSheetRows(evaluation, sheet, presentation, sheet.colCount, sheet.headerColCount, new Set(), displayCell);
  const headers = buildHeaderMatrix(sheet, evaluation, presentation, sheet.colCount, sheet.headerRowCount);
  const layouts = resolveColumnLayouts(rows, Array.from({ length: sheet.colCount }, (_, col) => headers.at(-1)?.[col] ?? ""), sheet.headerColCount);
  return {
    name: sheet.name,
    headers,
    headerColCount: sheet.headerColCount,
    rows,
    widths: layouts.map(layout => layout.width),
    before: sheet.getSheetNote("beforeTable"),
    after: sheet.getSheetNote("afterTable"),
  };
}

export type PrintSheetModel = ReturnType<typeof buildPrintSheet>;
