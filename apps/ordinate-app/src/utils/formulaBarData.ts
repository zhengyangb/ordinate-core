import { resolveCellInputText, splitCellDisplayMetadata, type PresentedCell, type RuntimeValue } from "@ordinate/core";

import type { FormulaBarData, SelectedCell } from "../types/ui";
import { BLANK_RUNTIME_VALUE, formatLocalView, styleLocalView } from "./appHelpers";
import { leafLabel, runtimeKindLabel, runtimeValueToText } from "./sheetView";

type RuntimeSheet = {
  rowPaths: string[];
  values: RuntimeValue[][];
};

type StateCell = {
  sourceText?: string;
  parsed?: {
    kind: string;
  };
};

type StateSheet = {
  headerRowCount?: number;
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
  absoluteRowPathLookup: Map<number, string>;
};

function resolveCellSourceView(rawSource: string, fallbackSource: string, mode: "input" | "body") {
  const sourceText = rawSource.length > 0 ? rawSource : fallbackSource;
  const sourceView = mode === "input"
    ? resolveCellInputText(sourceText)
    : { inputText: splitCellDisplayMetadata(sourceText).contentText };
  const editableSourceText = sourceView.inputText.length > 0 ? sourceView.inputText : sourceText;
  return {
    sourceText,
    editableSourceText,
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
  absoluteRowPathLookup,
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
    const sourceRaw = rawCell?.sourceText ?? "";
    const displayText = currentSheetPresentation?.headerDisplayRows?.[rowNumber - 1]?.[colIndex] ?? sourceRaw;
    const sourceView = resolveCellSourceView(sourceRaw, displayText, "body");
    return {
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${semanticColLabel} / Header Row ${rowNumber}`,
      chip: "Header Row",
      displayText: displayText.length > 0 ? displayText : "(blank)",
      sourceText: sourceView.sourceText,
      editableSourceText: sourceView.editableSourceText,
      ...formatLocalView(null),
      styleLocal: styleLocalView(null),
    };
  }

  const rowPath = selectedCell.rowPath ?? absoluteRowPathLookup.get(rowNumber);
  if (!rowPath) return null;

  const rowRel = currentSheet.rowPaths.indexOf(rowPath);
  if (rowRel < 0) return null;

  const rowLeaf = leafLabel(rowPath);
  const presentedCell = currentSheetPresentation?.cells?.[rowRel]?.[colIndex];

  if (colIndex < headerColCount) {
    const rawCell = currentSheetState.cells[absoluteRowIndex]?.[colIndex];
    const sourceRaw = rawCell?.sourceText ?? "";
    const displayText = colIndex === 0 ? rowLeaf : (presentedCell?.displayText ?? sourceRaw);
    const sourceView = resolveCellSourceView(sourceRaw, displayText, "body");
    return {
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
      chip: colIndex === 0 ? "Label" : "Header Col",
      displayText: displayText.length > 0 ? displayText : "(blank)",
      sourceText: sourceView.sourceText,
      editableSourceText: sourceView.editableSourceText,
      ...formatLocalView(null),
      styleLocal: styleLocalView(null),
    };
  }

  const runtimeValue = currentSheet.values[rowRel]?.[colIndex];
  const rawCell = currentSheetState.cells[absoluteRowIndex]?.[colIndex];
  const sourceText = rawCell?.sourceText ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);
  const fallbackSourceText = presentedCell?.displayText ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);
  const sourceView = resolveCellSourceView(sourceText, fallbackSourceText, "input");
  const chip = rawCell?.parsed?.kind === "formula" ? "Formula" : runtimeKindLabel(runtimeValue);

  return {
    primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
    secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
    chip,
    displayText: presentedCell?.displayText ?? (runtimeValue ? runtimeValueToText(runtimeValue) : ""),
    sourceText: sourceView.sourceText,
    editableSourceText: sourceView.editableSourceText,
    ...formatLocalView(presentedCell?.formatLayer.local),
    styleLocal: styleLocalView(presentedCell?.styleLayer.local),
    displaySource: presentedCell?.source,
    displayErrors: presentedCell?.errors ?? [],
  };
}
