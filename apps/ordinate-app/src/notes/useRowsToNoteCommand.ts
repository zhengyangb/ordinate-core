import { previewRowsToNote, type DocumentState } from "@ordinate/core";
import type { RailMenuView, SheetSelection } from "../types/ui";
import { useEditorStore } from "../store/editorStore";
import { rowSelectionRegion } from "../utils/selectionModel";

export type RowsToNoteAction = { label: string; disabledReason?: string; run: () => void };

export function getRowsToNoteRange(selection: SheetSelection | null, columnCount: number): { first: number; last: number } | null {
  if (selection?.kind === "row") return {first:selection.rowStart-1,last:selection.rowEnd-1};
  if (selection?.kind === "range" && selection.range.colStart === 0 && selection.range.colEnd === columnCount-1) {
    return {first:selection.range.rowStart-1,last:selection.range.rowEnd-1};
  }
  return null;
}

export function rowsToNoteAction(document: DocumentState, sheetName: string, first: number, last: number, run: (rowIds: number[]) => void): RowsToNoteAction | null {
  const sheet = document.sheets.find(item => item.name === sheetName);
  if (!sheet) throw new Error("Row note conversion requires its sheet.");
  if (first !== 0 && last !== sheet.rowCount-1) return null;
  if (first === 0 && last === sheet.rowCount-1) return null;
  const position = first === 0 ? "beforeTable" : "afterTable";
  const existing = sheet.getSheetNote(position).blocks.length > 0;
  const label = `${existing ? "Add to" : "Convert to"} note ${position === "beforeTable" ? "before" : "after"} table`;
  const rowIds = sheet.rowIds.slice(first,last+1);
  try {
    previewRowsToNote(document,sheetName,rowIds);
  } catch (error) {
    if (!(error instanceof Error) || !("category" in error) || error.category !== "invalid_operation") throw error;
    if (rowSelectionRegion({rowStart:first+1,rowEnd:last+1}, sheet.headerRowCount) === "mixed") return null;
    return {label,disabledReason:error.message,run:() => {throw error;}};
  }
  return {label,run:() => run(rowIds)};
}

export function useRowsToNoteCommand(document: DocumentState | null, sheetName: string | null, selection: SheetSelection | null, rail: RailMenuView | null, finish: () => void) {
  const applyCoreEdits = useEditorStore(state => state.applyCoreEdits);
  if (!document || !sheetName) return {rail:null,selection:null};
  const sheet = document.sheets.find(item => item.name === sheetName);
  if (!sheet) throw new Error("Row note conversion requires an active sheet.");
  const run = (rowIds: number[]) => {
    applyCoreEdits("Convert rows to sheet note",[{op:"convert_rows_to_note",sheet:sheetName,rowIds}]);
    finish();
  };
  const range = getRowsToNoteRange(selection,sheet.colCount);
  const selectedAction = range ? rowsToNoteAction(document,sheetName,range.first,range.last,run) : null;
  const railRange = rail?.kind === "row"
    ? range && rail.rowNumber-1 >= range.first && rail.rowNumber-1 <= range.last ? range : {first:rail.rowNumber-1,last:rail.rowNumber-1}
    : null;
  return {
    selection:selectedAction,
    rail:railRange === range ? selectedAction : railRange ? rowsToNoteAction(document,sheetName,railRange.first,railRange.last,run) : null,
  };
}
