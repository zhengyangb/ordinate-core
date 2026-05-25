import { getCellTextView, type CellTextViewSource, type PresentedCell, type RuntimeValue } from "@ordinate/core";

import type { FormulaBarData, SelectedCell } from "../types/ui";
import { BLANK_RUNTIME_VALUE, formatLocalView, styleLocalView } from "./appHelpers";
import { leafLabel, runtimeKindLabel, runtimeValueToText } from "./sheetView";

type RuntimeSheet = {
  rowPaths: string[];
  values: RuntimeValue[][];
};

type StateCell = CellTextViewSource;

type StateSheet = {
  headerRowCount?: number;
  bodyStart?: number;
  cells: StateCell[][];
};

type PresentationSheet = {
  headerDisplayRows?: string[][];
  cells?: PresentedCell[][];
};

type BuildFormulaBarDataParams = {
  currentSheet: RuntimeSheet | null;
  currentSheetState: StateSheet | null;
  currentSheetPresentation: PresentationSheet | null;
  selectedCell: SelectedCell | null;
  isActiveSheetBlocked: boolean;
  sheetColCount: number;
  headerColCount: number;
  headerSemanticLabels: string[];
};

function resolveCellTextView(cell: StateCell | undefined, fallbackCellText: string, mode: "input" | "body") {
  if (!cell) {
    return { cellText: fallbackCellText, inputText: fallbackCellText };
  }
  const view = getCellTextView(cell);
  const inputText = mode === "input" ? view.inputText : view.bodyText;
  return {
    cellText: view.cellText,
    inputText,
  };
}

export function buildFormulaBarData({
  currentSheet,
  currentSheetState,
  currentSheetPresentation,
  selectedCell,
  isActiveSheetBlocked,
  sheetColCount,
  headerColCount,
  headerSemanticLabels,
}: BuildFormulaBarDataParams): FormulaBarData | null {
  if (!currentSheet || !currentSheetState || !selectedCell || isActiveSheetBlocked) return null;

  const colIndex = selectedCell.logical.cAbs;
  if (colIndex < 0 || colIndex >= sheetColCount) return null;
  const colNumber = colIndex + 1;

  const semanticColLabel = headerSemanticLabels[colIndex] ?? `C${colNumber}`;
  const rowNumber = selectedCell.logical.rAbs;
  const absoluteRowIndex = rowNumber - 1;

  if (selectedCell.area === "header") {
    const maxHeaderRow = currentSheetState.headerRowCount ?? 0;
    if (rowNumber < 1 || rowNumber > maxHeaderRow) return null;

    const rawCell = currentSheetState.cells[absoluteRowIndex]?.[colIndex];
    const displayText = currentSheetPresentation?.headerDisplayRows?.[rowNumber - 1]?.[colIndex] ?? "";
    const textView = resolveCellTextView(rawCell, displayText, "body");
    return {
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${semanticColLabel} / Header Row ${rowNumber}`,
      chip: "Header Row",
      displayText,
      cellText: textView.cellText,
      inputText: textView.inputText,
      ...formatLocalView(null),
      styleLocal: styleLocalView(null),
    };
  }

  const headerRowCount = currentSheetState.headerRowCount ?? 0;
  const rowRel = rowNumber - headerRowCount - 1;
  if (rowRel < 0 || rowRel >= currentSheet.rowPaths.length) return null;
  const rowPath = currentSheet.rowPaths[rowRel] ?? "";

  const rowLeaf = leafLabel(rowPath);
  const presentedCell = currentSheetPresentation?.cells?.[rowRel]?.[colIndex];

  if (colIndex < headerColCount) {
    const rawCell = currentSheetState.cells[absoluteRowIndex]?.[colIndex];
    const displayText = colIndex === 0 ? rowLeaf : (presentedCell?.displayText ?? "");
    const textView = resolveCellTextView(rawCell, displayText, "body");
    return {
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
      chip: colIndex === 0 ? "Label" : "Header Col",
      displayText,
      cellText: textView.cellText,
      inputText: textView.inputText,
      ...formatLocalView(null),
      styleLocal: styleLocalView(null),
    };
  }

  const runtimeValue = currentSheet.values[rowRel]?.[colIndex];
  const rawCell = currentSheetState.cells[absoluteRowIndex]?.[colIndex];
  const fallbackCellText = presentedCell?.displayText ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);
  const textView = resolveCellTextView(rawCell, fallbackCellText, "input");
  const chip = rawCell?.body.valid && rawCell.body.kind === "formula" ? "Formula" : runtimeKindLabel(runtimeValue);

  return {
    primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
    secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
    chip,
    displayText: presentedCell?.displayText ?? (runtimeValue ? runtimeValueToText(runtimeValue) : ""),
    cellText: textView.cellText,
    inputText: textView.inputText,
    ...formatLocalView(presentedCell?.formatLayer.local),
    styleLocal: styleLocalView(presentedCell?.styleLayer.local),
    displaySource: presentedCell?.source,
    displayErrors: presentedCell?.errors ?? [],
  };
}
