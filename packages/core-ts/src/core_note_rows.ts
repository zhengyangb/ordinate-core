import type { DocumentState } from "./incremental";
import { CoreEditFailure } from "./core_edit_common";
import { selectViewDetailed } from "./runtime/eval";
import { getBoundSheetId, walkExpressionReferences } from "./runtime/references";
import { resolveSheetRowStructure } from "./row_structure";
import { serializeSheetNote, type NoteBlock, type NoteInline, type SheetNotePosition } from "./sheet_notes";

export interface RowsToNotePreview {
  position: SheetNotePosition;
  append: boolean;
  markdown: string;
  rowIndices: number[];
}

const reject = (message: string): never => { throw new CoreEditFailure("invalid_operation", message); };

/** One plan owns menu eligibility, content conversion and dependency protection. */
export function previewRowsToNote(document: DocumentState, sheetName: string, rowIds: readonly number[]): RowsToNotePreview {
  const sheet = document.sheets.find(item => item.name === sheetName);
  if (!sheet) return reject(`Unknown sheet '${sheetName}'.`);
  if (!Array.isArray(rowIds) || !rowIds.length || new Set(rowIds).size !== rowIds.length) return reject("Select consecutive rows at the beginning or end of the table.");
  const indices = rowIds.map(id => {
    if (!Number.isInteger(id)) return reject("Row identities must be integers.");
    const index = sheet.rowIdToIndex.get(id);
    if (index === undefined) return reject("A selected row is no longer in the table.");
    return index;
  }).sort((a,b) => a-b);
  if (indices.some((index,i) => index !== indices[0]+i)) return reject("Select consecutive rows at the beginning or end of the table.");
  const end = indices.at(-1)!;
  if (indices[0] !== 0 && end !== sheet.rowCount-1) return reject("Only the first or last rows can become a sheet note.");
  if (indices.filter(index => index >= sheet.bodyStart).length >= sheet.bodyRowCount) {
    return reject("Keep at least one body row in the table.");
  }
  const position = indices[0] === 0 ? "beforeTable" : "afterTable";
  if (position === "beforeTable" && end >= sheet.bodyStart) {
    const next = resolveSheetRowStructure(sheet)[end+1-sheet.bodyStart];
    if (next && next.depth > 0) return reject("Include the complete row group so its children keep their parent.");
  }
  const selected = new Set(indices);
  const blocks: NoteBlock[] = [];
  for (const r of indices) {
    const children: NoteInline[] = [];
    for (let c=0; c<sheet.colCount; c++) {
      const cell = sheet.cells[r][c];
      if (!cell.body.valid || cell.body.kind !== "literal" || !["blank","string"].includes(cell.body.literal.kind)) {
        return reject("Only text and blank cells can become notes. Keep formulas and numeric data in the table.");
      }
      if (cell.body.literal.kind !== "string" || !cell.body.literal.value.trim()) continue;
      if (cell.localDisplay && !cell.localDisplay.valid) return reject("Fix invalid cell formatting before converting these rows.");
      const local = cell.localDisplay?.style;
      const row = sheet.rowDisplayMetadata[r];
      const column = sheet.columnDisplayMetadata[c];
      const weight = local?.weight ?? (row?.valid ? row.style?.weight : null) ?? (column?.valid ? column.style?.weight : null);
      const lines = cell.body.literal.value.split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
      if (children.length) children.push({kind:"text",text:" "});
      const text: NoteInline = {kind:"text",text:lines.join(" ")};
      children.push(weight === "bold" ? {kind:"strong",children:[text]} : text);
    }
    if (children.length) blocks.push({kind:"paragraph",children});
  }
  if (!blocks.length) return reject("The selected rows contain no note text.");

  // Resolve native selectors rather than searching formula source strings.
  // This covers A1, fixed, relative, label, range and cross-sheet references.
  for (const source of document.sheets) source.cells.forEach((row,r) => row.forEach((cell,c) => {
    if (source === sheet && selected.has(r) || !cell.body.valid || cell.body.kind !== "formula") return;
    walkExpressionReferences(cell.body.expression, ref => {
      const bound = getBoundSheetId(ref.sheetSelector);
      const target = ref.sheetSelector
        ? document.sheets.find(item => bound !== null ? item.sheetId === bound : item.name === ref.sheetSelector!.value)
        : source;
      if (target !== sheet) return;
      const view = selectViewDetailed(ref,r,c,sheet.rowMap,sheet.colMap,sheet.rowCount,sheet.colCount,
        sheet.bodyStart,sheet.bodyRowCount,sheet.dataRowIndices,sheet.dataColIndices,sheet.rowIdToIndex,sheet.colIdToIndex);
      if (!view.ok) return reject(`Fix the unresolved reference in '${source.name}', row ${r+1}, column ${c+1} before converting rows.`);
      if (view.view.rowIndices.some(index => selected.has(index))) {
        reject(`Referenced by '${source.name}', row ${r+1}, column ${c+1}. Keep those rows in the table.`);
      }
    });
  }));
  const existing = sheet.getSheetNote(position);
  // Keep document order: intro -> extracted prefix -> table -> extracted suffix -> footer.
  const combined = position === "beforeTable" ? [...existing.blocks,...blocks] : [...blocks,...existing.blocks];
  return {position,append:existing.blocks.length>0,markdown:serializeSheetNote({blocks:combined}),rowIndices:indices};
}

export function convertRowsToNote(document: DocumentState, sheetName: string, rowIds: readonly number[]): void {
  const plan = previewRowsToNote(document,sheetName,rowIds);
  const sheet = document.sheets.find(item => item.name === sheetName)!;
  // Delete from the end so row positions remain valid; existing structural edits
  // retain surviving identities, display metadata and reference targets.
  for (const index of [...plan.rowIndices].reverse()) {
    if (index < sheet.bodyStart) sheet.deleteHeaderRow(index,false);
    else sheet.deleteRow(index,false);
  }
  sheet.setSheetNote(plan.position,plan.markdown);
}
