import { DocumentState } from "./incremental";
import { cloneDocumentState } from "./document_clone";
import { resolveDocumentPresentation } from "./presentation";
import type { FormatSpec, StyleSpec } from "./runtime/types";

export interface ImportSheetHeaders {
  sheetName: string;
  headerRows: number;
  headerColumns: number;
}
export class ImportHeaderError extends Error {}

/** Configure an isolated imported document. Coordinates and formula sources stay intact. */
export function configureImportedDocument(source: DocumentState, headers: readonly ImportSheetHeaders[] = []): DocumentState {
  const document = cloneDocumentState(source);
  const seen = new Set<string>();
  for (const choice of headers) {
    if (!choice || typeof choice !== "object"
      || Object.keys(choice).some(key => !["sheetName", "headerRows", "headerColumns"].includes(key))) {
      throw new ImportHeaderError("Expected a sheet name and header row/column counts.");
    }
    const sheet = document.sheets.find(sheet => sheet.name === choice.sheetName);
    if (!sheet) throw new ImportHeaderError("Header settings refer to an unknown sheet.");
    if (seen.has(choice.sheetName)) throw new ImportHeaderError("Duplicate sheet header settings.");
    seen.add(choice.sheetName);
    const { headerRows, headerColumns } = choice;
    if (!Number.isInteger(headerRows) || headerRows < 0 || headerRows > Math.max(0, sheet.rowCount - 1)) {
      throw new ImportHeaderError(`${sheet.name}: Keep at least one data row.`);
    }
    if (!Number.isInteger(headerColumns) || headerColumns < 0 || headerColumns > Math.max(0, sheet.colCount - 1)) {
      throw new ImportHeaderError(`${sheet.name}: Keep at least one data column.`);
    }
    for (let r = 0; r < sheet.rowCount; r++) for (let c = 0; c < sheet.colCount; c++) {
      if (r >= headerRows && c >= headerColumns) continue;
      const body = sheet.cells[r][c].body;
      if (!body.valid || body.kind === "formula") {
        throw new ImportHeaderError(`${sheet.name}: Headers cannot contain formulas or invalid input.`);
      }
    }
    if (headerRows < sheet.headerRowCount) sheet.convertHeaderSuffixToBody(sheet.headerRowCount - headerRows, 0, false);
    if (headerRows > sheet.headerRowCount) sheet.convertBodyPrefixToHeader(headerRows - sheet.headerRowCount, false);
    if (headerColumns !== sheet.headerColCount) sheet.setHeaderColumnCount(headerColumns, false);
  }
  compactImportedPresentation(document);
  document.evaluate();
  return document;
}

const key = (value: unknown) => JSON.stringify(value);
function common<T>(values: Array<T | null>): T | null {
  // Null inherits in ORD; it cannot cancel a column default. Never change a
  // General/automatic exception merely to make the serialized source shorter.
  if (values.length < 3) return null;
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    if (value === null) return null;
    const id = key(value);
    const entry = counts.get(id);
    if (entry) entry.count++;
    else counts.set(id, { value, count: 1 });
  }
  const winner = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return winner.count >= 3 && winner.count / values.length >= 0.8 ? winner.value : null;
}

const STYLE_AXES = ["align", "weight", "color"] as const;

/** Extract column, then row defaults per axis, retaining exact local exceptions. */
function compactImportedPresentation(document: DocumentState): void {
  const presentation = resolveDocumentPresentation(document);
  document.sheets.forEach((sheet, s) => {
    // Existing row defaults have higher precedence. They are not rewritten
    // by this import-only column pass.
    if (sheet.rowDisplayMetadata.some(meta => meta !== null)) return;
    for (let c = sheet.headerColCount; c < sheet.colCount; c++) {
      const cells = presentation.sheets[s].cells.map(row => row[c]);
      const empty = (r: number) => {
        const body = sheet.cells[r][c].body;
        return body.valid && body.kind === "literal" && body.literal.kind === "blank";
      };
      const format = common<FormatSpec>(cells
        .filter(cell => !empty(cell.rowIndex) || cell.formatLayer.effective !== null)
        .map(cell => cell.formatLayer.effective));
      const style: StyleSpec = { align: null, weight: null, color: null };
      for (const axis of STYLE_AXES) {
        const values = cells
          .filter(cell => !empty(cell.rowIndex) || cell.styleLayer.effective?.[axis] != null)
          .map(cell => cell.styleLayer.effective?.[axis] ?? null);
        Object.assign(style, { [axis]: common(values) });
      }
      if (format) {
        sheet.setColumnDefaultFormatByIndex(c, format);
        for (const cell of cells) {
          if (key(cell.formatLayer.effective) === key(format)) sheet.clearCellLocalFormatByIndex(cell.rowIndex, c);
        }
      }
      if (Object.values(style).some(value => value !== null)) {
        sheet.setColumnDefaultStyleByIndex(c, style);
        for (const cell of cells) {
          const local = { ...cell.styleLayer.effective };
          for (const axis of STYLE_AXES) {
            if (style[axis] !== null && local[axis] === style[axis]) local[axis] = null;
          }
          sheet.clearCellLocalStyleByIndex(cell.rowIndex, c);
          sheet.setCellLocalStyleByIndex(cell.rowIndex, c, local);
        }
      }
    }
  });
  compactImportedRows(document);
}

function compactImportedRows(document: DocumentState): void {
  const presentation = resolveDocumentPresentation(document);
  document.sheets.forEach((sheet, s) => {
    for (let r = sheet.bodyStart; r < sheet.rowCount; r++) {
      if (sheet.rowDisplayMetadata[r] !== null) continue;
      const cells = presentation.sheets[s].cells[r - sheet.bodyStart].slice(sheet.headerColCount);
      const empty = (c: number) => {
        const body = sheet.cells[r][c].body;
        return body.valid && body.kind === "literal" && body.literal.kind === "blank";
      };
      const format = common<FormatSpec>(cells
        .filter(cell => !empty(cell.colIndex) || cell.formatLayer.effective !== null)
        .map(cell => cell.formatLayer.effective));
      // Do not copy already-inherited column defaults into each row.
      if (format && cells.filter(cell => cell.formatLayer.local && key(cell.formatLayer.local) === key(format)).length >= 3) {
        sheet.setRowDefaultFormatByIndex(r, format);
        for (const cell of cells) {
          if (key(cell.formatLayer.effective) === key(format)) sheet.clearCellLocalFormatByIndex(r, cell.colIndex);
          else if (cell.formatLayer.effective) sheet.setCellLocalFormatByIndex(r, cell.colIndex, cell.formatLayer.effective);
        }
      }
      const style: StyleSpec = {align:null,weight:null,color:null};
      for (const axis of STYLE_AXES) {
        const value = common(cells
          .filter(cell => !empty(cell.colIndex) || cell.styleLayer.effective?.[axis] != null)
          .map(cell => cell.styleLayer.effective?.[axis] ?? null));
        if (value !== null && cells.filter(cell => cell.styleLayer.local?.[axis] === value).length >= 3) {
          Object.assign(style, {[axis]:value});
        }
      }
      if (Object.values(style).some(value => value !== null)) {
        sheet.setRowDefaultStyleByIndex(r, style);
        for (const cell of cells) {
          const local = {...cell.styleLayer.local};
          for (const axis of STYLE_AXES) {
            if (style[axis] !== null) {
              const target = cell.styleLayer.effective?.[axis] ?? null;
              Object.assign(local, {[axis]: target === style[axis] ? null : target});
            }
          }
          sheet.setCellLocalStyleByIndex(r, cell.colIndex, local);
        }
      }
    }
  });
}
