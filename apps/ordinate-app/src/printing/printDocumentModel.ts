import { DocumentState, resolveDocumentPresentation, serializeDocumentState, validateDocument } from "@ordinate/core";
import type { EditorState } from "../store/editorStore";
import { projectSheetRows } from "../hooks/useSheetViewModel";
import { buildHeaderMatrix, isBlockingSheetIssue } from "../utils/appHelpers";
import { resolveColumnLayouts } from "../utils/columnLayout";
import type { CellDisplayFormatter } from "../preferences/temporalDisplay";

export type PrintOptions = {
  scope: "current" | "all";
  includeBeforeNotes: boolean;
  includeAfterNotes: boolean;
};
export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  scope: "current", includeBeforeNotes: true, includeAfterNotes: true,
};

/** Capture authored source once, before the options dialog. The dialog and both
 * hosts share this snapshot; all-sheet printing evaluates the workbook once,
 * not once per sheet. Never print the virtualized viewport or stale source. */
export function preparePrintDocument(editor: Pick<EditorState, "mode" | "sourceText" | "docState" | "activeSheet">, displayCell: CellDisplayFormatter) {
  if (editor.mode === "table" && !editor.docState) throw new Error("There is no document to print.");
  const source = editor.mode === "source" ? editor.sourceText : serializeDocumentState(editor.docState!);
  const state = DocumentState.fromText(source);
  const currentSheet = state.sheets.find(sheet => sheet.name === editor.activeSheet);
  if (!currentSheet) throw new Error("Choose a sheet in table view before printing.");
  const validation = validateDocument(source);
  const checkSheets = (names: Set<string>) => {
    const blocking = validation.errors.find(issue => !issue.sheet || (names.has(issue.sheet) && isBlockingSheetIssue(issue)));
    if (blocking) throw new Error(blocking.sheet ? `${blocking.sheet}: ${blocking.message}` : blocking.message);
  };
  checkSheets(new Set([currentSheet.name]));
  currentSheet.getSheetNote("beforeTable");
  currentSheet.getSheetNote("afterTable");
  return {
    currentSheet: currentSheet.name,
    // Presence metadata is not a request to render every sheet. Inspect parsed
    // blocks here so an invalid, unselected sheet does not prevent Current sheet.
    // Selected sheets still use the core note accessor's validation when built.
    sheets: state.sheets.map(sheet => {
      let afterTable = false, hasBeforeNotes = false, hasAfterNotes = false;
      for (const block of sheet.sourceBlocks) {
        if (block.kind === "table") afterTable = true;
        if (block.kind === "note" && block.note.blocks.length > 0) {
          if (afterTable) hasAfterNotes = true;
          else hasBeforeNotes = true;
        }
      }
      return { name: sheet.name, hasBeforeNotes, hasAfterNotes };
    }),
    build(options: PrintOptions) {
      const sheets = options.scope === "all" ? state.sheets : [currentSheet];
      checkSheets(new Set(sheets.map(sheet => sheet.name)));
      const evaluationResult = state.evaluate();
      const evaluations = evaluationResult.sheets;
      const presentations = resolveDocumentPresentation(state, evaluationResult).sheets;
      return sheets.map(sheet => {
        const evaluation = evaluations.find(value => value.name === sheet.name);
        const presentation = presentations.find(value => value.name === sheet.name);
        if (!evaluation || !presentation) throw new Error(`${sheet.name} could not be evaluated for printing.`);
        const rows = projectSheetRows(evaluation, sheet, presentation, sheet.colCount, sheet.headerColCount, new Set(), displayCell);
        const headers = buildHeaderMatrix(sheet, evaluation, presentation, sheet.colCount, sheet.headerRowCount);
        const layouts = resolveColumnLayouts(rows, Array.from({ length: sheet.colCount }, (_, col) => headers.at(-1)?.[col] ?? ""), sheet.headerColCount, "standard");
        return {
          name: sheet.name, headers, headerColCount: sheet.headerColCount, rows,
          widths: layouts.map(layout => layout.width),
          before: options.includeBeforeNotes ? sheet.getSheetNote("beforeTable") : null,
          after: options.includeAfterNotes ? sheet.getSheetNote("afterTable") : null,
        };
      });
    },
  };
}

export type PreparedPrintDocument = ReturnType<typeof preparePrintDocument>;
export type PrintSheetModel = ReturnType<PreparedPrintDocument["build"]>[number];
