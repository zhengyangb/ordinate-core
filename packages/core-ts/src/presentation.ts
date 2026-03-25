import { DocumentState } from "./incremental";
import { stripCellDisplayMetadata } from "./runtime/parse";
import { type FormatSpec, type RuntimeValue, type StyleSpec } from "./runtime/types";

export interface ColumnDisplayDefault {
  format: FormatSpec | null;
  style: StyleSpec | null;
  valid: boolean;
  errors: string[];
}

export interface PresentedCell {
  rowIndex: number;
  colIndex: number;
  value: RuntimeValue | null;
  format: FormatSpec | null;
  style: StyleSpec | null;
  source: "cell" | "column" | "default";
  errors: string[];
}

export interface SheetPresentation {
  name: string;
  bodyStart: number;
  columnDefaults: ColumnDisplayDefault[];
  cells: PresentedCell[][];
}

export interface PresentationResult {
  sheets: SheetPresentation[];
}

export function resolvePresentationFromText(text: string): PresentationResult {
  const state = DocumentState.fromText(text);
  return resolveDocumentPresentation(state);
}

export function resolveDocumentPresentation(state: DocumentState): PresentationResult {
  const evaluation = state.evaluate();
  const sheets: SheetPresentation[] = [];

  state.sheets.forEach((sheet, sIdx) => {
    const defaults = computeColumnDefaults(sheet);
    const evalSheet = sIdx < evaluation.sheets.length ? evaluation.sheets[sIdx] : null;
    const cells: PresentedCell[][] = [];

    for (let rAbs = sheet.bodyStart; rAbs < sheet.rowCount; rAbs += 1) {
      const evalRow = evalSheet && rAbs - sheet.bodyStart < evalSheet.values.length
        ? evalSheet.values[rAbs - sheet.bodyStart]
        : [];
      const rowCells: PresentedCell[] = [];
      for (let c = 0; c < sheet.colCount; c += 1) {
        const parsedDisplay = sheet.cells[rAbs][c].parsed.display ?? null;
        const cellFormat = parsedDisplay && parsedDisplay.valid ? parsedDisplay.formatSpec : null;
        const cellStyle = parsedDisplay && parsedDisplay.valid ? parsedDisplay.styleSpec : null;
        const colDefault = c < defaults.length ? defaults[c] : { format: null, style: null, valid: true, errors: [] };
        const format = cellFormat ?? colDefault.format;
        const style = cellStyle ?? colDefault.style;
        const hasCellOverride = cellFormat !== null || cellStyle !== null;
        const hasColumnDefault = colDefault.format !== null || colDefault.style !== null;
        const source: "cell" | "column" | "default" = hasCellOverride
          ? "cell"
          : hasColumnDefault
            ? "column"
            : "default";
        const errors = parsedDisplay && !parsedDisplay.valid ? [...parsedDisplay.errors] : [];

        rowCells.push({
          rowIndex: rAbs,
          colIndex: c,
          value: c < evalRow.length ? evalRow[c] : null,
          format,
          style,
          source,
          errors,
        });
      }
      cells.push(rowCells);
    }

    sheets.push({
      name: sheet.name,
      bodyStart: sheet.bodyStart,
      columnDefaults: defaults,
      cells,
    });
  });

  return { sheets };
}

function computeColumnDefaults(sheet: DocumentState["sheets"][number]): ColumnDisplayDefault[] {
  const defaults: ColumnDisplayDefault[] = Array.from({ length: sheet.colCount }, () => ({
    format: null,
    style: null,
    valid: true,
    errors: [],
  }));
  if (sheet.headerRowCount <= 0 || sheet.headerRowCount > sheet.cells.length) {
    return defaults;
  }

  const headerMetaRow = sheet.headerRowCount - 1;
  for (let c = 0; c < sheet.colCount; c += 1) {
    const parsedDisplay = sheet.cells[headerMetaRow][c].parsed.display ?? null;
    if (!parsedDisplay) continue;
    const rawHeader = c < sheet.logicalRows[headerMetaRow].rawCells.length
      ? sheet.logicalRows[headerMetaRow].rawCells[c]
      : "";
    const label = stripCellDisplayMetadata(rawHeader).trim();
    if (label === "") {
      continue;
    }
    defaults[c] = {
      format: parsedDisplay.valid ? parsedDisplay.formatSpec : null,
      style: parsedDisplay.valid ? parsedDisplay.styleSpec : null,
      valid: parsedDisplay.valid,
      errors: [...parsedDisplay.errors],
    };
  }
  return defaults;
}
