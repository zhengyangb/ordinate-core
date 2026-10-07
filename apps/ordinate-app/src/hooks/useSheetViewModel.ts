import { getCellTextView, resolveSheetRowStructure, type RuntimeValue } from "@ordinate/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorState } from "../store/editorStore";
import type { GridRow, SheetHealth, SheetIssueViewModel } from "../types/ui";
import { GRID_HEADER_HEIGHT, buildHeaderMatrix, buildSheetHealthByName, buildSheetIssueBuckets, toColFieldId, trimSheetColCount } from "../utils/appHelpers";
import { resolveBooleanCellView } from "../utils/booleanCell";
import { resolveColumnLayouts } from "../utils/columnLayout";
import { compactColLabel, isVisiblePath } from "../utils/sheetView";
import type { CellDisplayFormatter } from "../preferences/temporalDisplay";

export function projectSheetRows(
  currentSheet: NonNullable<EditorState["evaluation"]>["sheets"][number] | null,
  currentSheetState: NonNullable<EditorState["docState"]>["sheets"][number] | null,
  currentSheetPresentation: NonNullable<EditorState["presentation"]>["sheets"][number] | null,
  sheetColCount: number, headerColCount: number, collapsedPaths: ReadonlySet<string>, displayCell: CellDisplayFormatter,
): GridRow[] {
  const currentSheetRowStructure = currentSheetState ? resolveSheetRowStructure(currentSheetState) : [];
    if (!currentSheet || !currentSheetState) return [];

    return currentSheetRowStructure
      .map((rowInfo, rowIndex) => {
        const row = currentSheet.values[rowIndex] ?? [];

        const item: GridRow = {
          __rowKey: `r${rowInfo.absoluteRowNumber}`,
          __rowId: rowInfo.rowId,
          __rowPath: rowInfo.rowPath,
          __absoluteRowNumber: rowInfo.absoluteRowNumber,
          __depth: rowInfo.depth,
          __hasChildren: rowInfo.hasChildren,
          __collapsed: collapsedPaths.has(rowInfo.rowPath),
          __displayLabel: rowInfo.label,
        };

        for (let colIndex = 0; colIndex < sheetColCount; colIndex += 1) {
          const field = toColFieldId(colIndex);
          const presentedCell = currentSheetPresentation?.cells[rowIndex]?.[colIndex] ?? null;
          const rawCell = currentSheetState.cells[rowInfo.absoluteRowIndex]?.[colIndex];
          const runtimeValue = row[colIndex] as RuntimeValue | undefined;
          const displayText = displayCell(runtimeValue, presentedCell);

          if (colIndex < headerColCount) {
            if (colIndex === 0) {
              item[field] = rowInfo.label;
              item[`__kind_${colIndex}`] = "label";
            } else {
              const headerValue = displayText.length > 0
                ? displayText
                : rawCell
                  ? getCellTextView(rawCell).inputText
                  : "";
              item[field] = headerValue;
              item[`__kind_${colIndex}`] = headerValue.length > 0 ? "string" : "blank";
            }
          } else {
            item[field] = displayText;
            item[`__kind_${colIndex}`] = runtimeValue?.kind ?? "blank";
            const booleanView = resolveBooleanCellView(runtimeValue, rawCell?.body);
            if (booleanView) {
              item[`__boolean_value_${colIndex}`] = booleanView.value;
              item[`__boolean_interactive_${colIndex}`] = booleanView.interactive;
            }
            item[`__align_${colIndex}`] = presentedCell?.styleLayer.effective?.align ?? "";
            item[`__weight_${colIndex}`] = presentedCell?.styleLayer.effective?.weight ?? "";
            item[`__color_${colIndex}`] = presentedCell?.styleLayer.effective?.color ?? "";
            item[`__display_has_errors_${colIndex}`] = (presentedCell?.errors.length ?? 0) > 0;
            item[`__display_source_${colIndex}`] = presentedCell?.source ?? "default";
            if (runtimeValue?.kind === "error") {
              item[`__error_external_${colIndex}`] = runtimeValue.errorKind;
              item[`__error_internal_${colIndex}`] = runtimeValue.internalKind;
              item[`__error_context_${colIndex}`] = JSON.stringify(runtimeValue.context);
            }
          }
        }

        return item;
      });
}

type Options = Pick<EditorState, "docState" | "evaluation" | "presentation" | "activeSheet" | "sheetIssuesByName"> & { displayCell: CellDisplayFormatter };
export function useSheetViewModel({ docState, evaluation, presentation, activeSheet, sheetIssuesByName, displayCell }: Options) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const expandRowPath = useCallback((rowPath: string) => {
    setCollapsedPaths(current => {
      if (!current.has(rowPath)) return current;
      const next = new Set(current);
      next.delete(rowPath);
      return next;
    });
  }, []);
  useEffect(() => {
    setCollapsedPaths(new Set());
  }, [activeSheet]);

  const currentSheet = useMemo(() => {
    if (!evaluation || !activeSheet) return null;
    return evaluation.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [evaluation, activeSheet]);

  const currentSheetState = useMemo(() => {
    if (!docState || !activeSheet) return null;
    return docState.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [docState, activeSheet]);

  const currentSheetPresentation = useMemo(() => {
    if (!presentation || !activeSheet) return null;
    return presentation.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [presentation, activeSheet]);

  const currentSheetRowStructure = useMemo(() => {
    if (!currentSheetState) return [];
    return resolveSheetRowStructure(currentSheetState);
  }, [currentSheetState]);

  const sheetNames = useMemo(() => {
    if (docState?.sheets?.length) {
      return docState.sheets.map((sheet) => sheet.name);
    }
    return evaluation?.sheets.map((sheet) => sheet.name) ?? [];
  }, [docState, evaluation]);

  const sheetIssueBuckets = useMemo(() => {
    return buildSheetIssueBuckets(sheetNames, sheetIssuesByName);
  }, [sheetNames, sheetIssuesByName]);

  const sheetHealthByName = useMemo<Record<string, SheetHealth>>(() => {
    return buildSheetHealthByName(sheetNames, sheetIssueBuckets);
  }, [sheetNames, sheetIssueBuckets]);

  const activeSheetBlockingIssues = useMemo<SheetIssueViewModel[]>(() => {
    if (!activeSheet) return [];
    return sheetIssueBuckets[activeSheet]?.blocking ?? [];
  }, [activeSheet, sheetIssueBuckets]);

  const isActiveSheetBlocked = activeSheetBlockingIssues.length > 0;

  const sheetColCount = useMemo(() => {
    return trimSheetColCount(currentSheetState, currentSheet);
  }, [currentSheetState, currentSheet]);
  const headerRowCount = currentSheetState?.headerRowCount ?? 0;
  const sheetRowCount = currentSheetState?.cells.length ?? 0;
  const headerColCount = Math.min(currentSheetState?.headerColCount ?? 0, sheetColCount);
  const headerOverlayRows = headerRowCount;
  const headerOverlayHeight = headerOverlayRows * GRID_HEADER_HEIGHT;
  const headerMatrix = useMemo(() => {
    return buildHeaderMatrix(
      currentSheetState,
      currentSheet,
      currentSheetPresentation,
      sheetColCount,
      headerRowCount,
    );
  }, [currentSheetState, currentSheetPresentation, currentSheet, sheetColCount, headerRowCount]);

  const headerLeafLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    const leafRow = headerMatrix[headerMatrix.length - 1] ?? [];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const label = leafRow[colIndex] ?? "";
      return compactColLabel(label);
    });
  }, [headerMatrix, sheetColCount]);

  const headerSemanticLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const fromLabels = currentSheetState?.colLabels[colIndex];
      if (fromLabels && fromLabels.length > 0) return fromLabels;
      return headerLeafLabels[colIndex] ?? `C${colIndex + 1}`;
    });
  }, [currentSheetState, headerLeafLabels, sheetColCount]);

  const headerSemanticLabelPaths = useMemo(() => {
    if (sheetColCount === 0) return [] as string[][];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const path = headerMatrix
        .map((row) => compactColLabel(row[colIndex] ?? ""))
        .filter((label) => label.length > 0);
      if (path.length > 0) return path;
      const fromLabels = currentSheetState?.colLabels[colIndex];
      if (fromLabels && fromLabels.length > 0) return [fromLabels];
      return [headerLeafLabels[colIndex] ?? `C${colIndex + 1}`];
    });
  }, [currentSheetState, headerLeafLabels, headerMatrix, sheetColCount]);

  const toggleCollapse = useCallback((rowPath: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(rowPath)) {
        next.delete(rowPath);
      } else {
        next.add(rowPath);
      }
      return next;
    });
  }, []);

  const allRowData = useMemo(() => projectSheetRows(
    currentSheet, currentSheetState, currentSheetPresentation, sheetColCount, headerColCount, collapsedPaths, displayCell,
  ), [currentSheet, currentSheetState, currentSheetPresentation, sheetColCount, headerColCount, collapsedPaths, displayCell]);

  const rowData = useMemo(
    () => allRowData.filter((row) => isVisiblePath(row.__rowPath, collapsedPaths)),
    [allRowData, collapsedPaths],
  );
  const columnLayouts = useMemo(
    () => resolveColumnLayouts(allRowData, headerLeafLabels, headerColCount),
    [allRowData, headerLeafLabels, headerColCount],
  );

  return {
    currentSheet, currentSheetState, currentSheetPresentation, currentSheetRowStructure, sheetNames,
    sheetHealthByName, activeSheetBlockingIssues, isActiveSheetBlocked, sheetColCount, sheetRowCount,
    headerRowCount, headerColCount, headerOverlayRows, headerOverlayHeight, headerMatrix,
    headerLeafLabels, headerSemanticLabels, headerSemanticLabelPaths, allRowData, rowData,
    columnLayouts, toggleCollapse, expandRowPath,
  };
}
