import { getCellTextView, type CoreAffectedFormulaCell } from "@ordinate/core";
import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ConfirmationDialogConfig } from "../components/ConfirmationDialog";
import { useEditorStore } from "../store/editorStore";
import type { SelectedCell, SheetSelection } from "../types/ui";
import { queryGridBodyViewport, resolveColumnDeleteTargets, resolveRowDeleteTargets, toColFieldId, toColumnLetters, type FormulaInputMode } from "../utils/appHelpers";
import { resolvePostRowStructureColumnIndex, resolveRowInsert } from "../utils/rowStructureEdits";
import type { useSheetViewModel } from "./useSheetViewModel";
import type { useStructureTransition } from "./useStructureTransition";

type Options = Pick<ReturnType<typeof useSheetViewModel>, "currentSheet" | "currentSheetState" | "currentSheetRowStructure" | "sheetColCount" | "headerRowCount" | "headerColCount" | "headerSemanticLabelPaths" | "expandRowPath"> & Pick<ReturnType<typeof useStructureTransition>, "startRowTransition" | "startColumnTransition"> & {
  activeSheet: string | null;
  selectedCell: SelectedCell | null;
  selection: SheetSelection | null;
  defaultBodyRailColIndex: number | null;
  closeRailMenu: () => void;
  clearActiveSelection: () => void;
  setSelectedColumnIndex: (index: number | null) => void;
  setSelectedCell: (cell: SelectedCell | null) => void;
  setFormulaInputMode: Dispatch<SetStateAction<FormulaInputMode>>;
  focusHeaderOverlayCell: (row: number, column: number) => void;
  focusBodyCellAt: (row: number, column: number) => boolean;
  gridWrapRef: RefObject<HTMLDivElement>;
  queueAppendRowAnchorScroll: (sheet: string, top: number, height: number, focus: { rAbs: number; colId: string } | null) => void;
  scheduleColumnIntoView: (index: number) => void;
  scheduleAppendColumnAnchorScroll: (sheet: string, count: number) => void;
  requestConfirmation: (config: ConfirmationDialogConfig) => Promise<boolean>;
};

function countUniqueAffectedFormulaCells(cells: CoreAffectedFormulaCell[]): number {
  const keys = new Set<string>();
  for (const cell of cells) {
    keys.add(`${cell.sheet}:${cell.rowId}:${cell.colId}`);
  }
  return keys.size;
}


/** Structural edits keep their selection/focus transition and confirmation together. */
export function useSheetStructureCommands({
  currentSheet, currentSheetState, currentSheetRowStructure, sheetColCount, headerRowCount,
  headerColCount, headerSemanticLabelPaths, expandRowPath, activeSheet, selectedCell, selection,
  defaultBodyRailColIndex, startRowTransition, startColumnTransition, closeRailMenu,
  setSelectedColumnIndex, setSelectedCell, setFormulaInputMode, focusHeaderOverlayCell,
  focusBodyCellAt, gridWrapRef, queueAppendRowAnchorScroll, requestConfirmation,
  clearActiveSelection, scheduleColumnIntoView, scheduleAppendColumnAnchorScroll,
}: Options) {
  const insertRow = useEditorStore(state => state.insertRow);
  const insertRows = useEditorStore(state => state.insertRows);
  const duplicateRows = useEditorStore(state => state.duplicateRows);
  const previewDeleteRow = useEditorStore(state => state.previewDeleteRow);
  const deleteRows = useEditorStore(state => state.deleteRows);
  const convertRowsToHeader = useEditorStore(state => state.convertRowsToHeader);
  const convertRowsToBody = useEditorStore(state => state.convertRowsToBody);
  const insertColumn = useEditorStore(state => state.insertColumn);
  const insertColumns = useEditorStore(state => state.insertColumns);
  const duplicateColumns = useEditorStore(state => state.duplicateColumns);
  const previewDeleteColumn = useEditorStore(state => state.previewDeleteColumn);
  const deleteColumns = useEditorStore(state => state.deleteColumns);
  const describeRowDeleteTarget = useCallback((rowNumber: number, area: "header" | "body", rowId: number, deletedRowCount: number) => {
    const rowRange = deletedRowCount > 1 ? `Rows ${rowNumber}-${rowNumber + deletedRowCount - 1}` : `Row ${rowNumber}`;
    const headerCell = currentSheetState?.cells[rowNumber - 1]?.[0] ?? null;
    const label = area === "body"
      ? currentSheetRowStructure.find((row) => row.rowId === rowId)?.label.trim() ?? ""
      : headerCell
        ? getCellTextView(headerCell).inputText.trim()
        : "";
    return label.length > 0 ? `${rowRange} · ${label}` : rowRange;
  }, [currentSheetRowStructure, currentSheetState]);

  const describeColumnDeleteTarget = useCallback((colIndex: number) => {
    const columnLabel = toColumnLetters(colIndex + 1);
    const semanticPath = headerSemanticLabelPaths[colIndex]?.filter((label) => label.trim().length > 0) ?? [];
    return semanticPath.length > 0 ? `${columnLabel} · ${semanticPath.join(" / ")}` : columnLabel;
  }, [headerSemanticLabelPaths]);

  const handleInsertRow = useCallback((rowNumber: number, side: "above" | "below", area: "header" | "body") => {
    if (!activeSheet) {
      throw new Error("row insertion requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("row insertion requires current sheet state");
    }
    if (area === "header") {
      const rowGapIndex = side === "above" ? rowNumber - 1 : rowNumber;
      const nextRowNumber = side === "above" ? rowNumber : rowNumber + 1;
      if (rowGapIndex < 0 || rowGapIndex > headerRowCount) {
        throw new Error("header row insertion gap must be inside the header region");
      }
      const nextColIndex = selectedCell?.logical.cAbs ?? defaultBodyRailColIndex ?? 0;
      startRowTransition("insert", nextRowNumber);
      insertRow(activeSheet, "header", rowGapIndex, 0);
      closeRailMenu();
      setSelectedColumnIndex(null);
      setSelectedCell({
        area: "header",
        logical: {
          rAbs: nextRowNumber,
          cAbs: nextColIndex,
        },
        colId: toColFieldId(nextColIndex),
        rowPath: null,
      });
      setFormulaInputMode("read");
      window.requestAnimationFrame(() => {
        focusHeaderOverlayCell(nextRowNumber, nextColIndex);
      });
      return;
    }
    if (!currentSheet) {
      throw new Error("row insertion requires current sheet evaluation");
    }
    if (defaultBodyRailColIndex == null) {
      throw new Error("row insertion requires at least one selectable column");
    }
    const { rowGapIndex, depth, nextRowNumber, expandParentRowPath } = resolveRowInsert(
      currentSheetRowStructure,
      rowNumber,
      side,
    );
    if (expandParentRowPath) {
      expandRowPath(expandParentRowPath);
    }
    const nextColIndex = resolvePostRowStructureColumnIndex(selectedCell, defaultBodyRailColIndex);
    startRowTransition("insert", nextRowNumber);
    insertRow(activeSheet, "body", rowGapIndex, depth);
    closeRailMenu();
    setSelectedColumnIndex(null);
    setSelectedCell({
      area: "body",
      logical: {
        rAbs: nextRowNumber,
        cAbs: nextColIndex,
      },
      colId: toColFieldId(nextColIndex),
      rowPath: null,
    });
    setFormulaInputMode("read");
    window.requestAnimationFrame(() => {
      focusBodyCellAt(nextRowNumber, nextColIndex);
    });
  }, [activeSheet, currentSheet, currentSheetState, currentSheetRowStructure, defaultBodyRailColIndex, selectedCell, headerRowCount, startRowTransition, insertRow, closeRailMenu, focusHeaderOverlayCell, focusBodyCellAt, expandRowPath, setSelectedCell, setSelectedColumnIndex, setFormulaInputMode]);

  const handleAppendBodyRows = useCallback((count: number) => {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("append body rows requires a positive integer count");
    }
    if (!activeSheet) {
      throw new Error("append body rows requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("append body rows requires current sheet state");
    }
    if (defaultBodyRailColIndex == null) {
      throw new Error("append body rows requires at least one selectable column");
    }
    const root = gridWrapRef.current;
    const bodyViewport = root ? queryGridBodyViewport(root) : null;
    if (!bodyViewport) {
      throw new Error("append body rows requires a body viewport");
    }
    const previousBodyScrollTop = bodyViewport.scrollTop;
    const previousBodyScrollHeight = bodyViewport.scrollHeight;
    const rowGapIndex = currentSheetState.rowIds.length;
    const nextRowNumber = rowGapIndex + count;
    const nextColId = toColFieldId(defaultBodyRailColIndex);
    queueAppendRowAnchorScroll(activeSheet, previousBodyScrollTop, previousBodyScrollHeight, {
      rAbs: nextRowNumber,
      colId: nextColId,
    });
    insertRows(activeSheet, "body", rowGapIndex, count, 0);
    closeRailMenu();
    setSelectedColumnIndex(null);
    setSelectedCell({
      area: "body",
      logical: {
        rAbs: nextRowNumber,
        cAbs: defaultBodyRailColIndex,
      },
      colId: nextColId,
      rowPath: null,
    });
    setFormulaInputMode("read");
  }, [
    activeSheet,
    currentSheetState,
    defaultBodyRailColIndex,
    insertRows,
    queueAppendRowAnchorScroll,
    closeRailMenu,
    setSelectedColumnIndex,
    setSelectedCell,
  ]);

  const handleDuplicateRow = useCallback((rowNumber: number, area: "header" | "body", rowId: number) => {
    if (!activeSheet) {
      throw new Error("row duplication requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("row duplication requires current sheet state");
    }
    if (area === "body" && defaultBodyRailColIndex == null) {
      throw new Error("row duplication requires at least one selectable column");
    }

    const rowIndex = rowNumber - 1;
    let rowIds: number[];
    let targetGapIndex: number;
    if (area === "header") {
      if (rowIndex < 0 || rowIndex >= headerRowCount) {
        throw new Error("header row duplication target must be inside the header region");
      }
      rowIds = [rowId];
      targetGapIndex = rowNumber;
    } else {
      const row = currentSheetRowStructure.find((candidate) => candidate.rowId === rowId);
      if (!row) {
        throw new Error("body row duplication requires a visible body row structure");
      }
      const sourceCount = row.hasChildren ? row.subtreeRowCount : 1;
      rowIds = currentSheetState.rowIds.slice(row.absoluteRowIndex, row.absoluteRowIndex + sourceCount);
      if (rowIds.length !== sourceCount) {
        throw new Error("body row duplication source segment is incomplete");
      }
      targetGapIndex = row.absoluteRowIndex + sourceCount;
    }

    const nextRowNumber = targetGapIndex + 1;
    if (area === "body") {
      startRowTransition("insert", nextRowNumber);
    }
    duplicateRows(activeSheet, rowIds, targetGapIndex);
    closeRailMenu();
    setSelectedColumnIndex(null);
    setFormulaInputMode("read");
    const nextColIndex =
      area === "header"
        ? selectedCell?.logical.cAbs ?? defaultBodyRailColIndex ?? 0
        : resolvePostRowStructureColumnIndex(selectedCell, defaultBodyRailColIndex ?? 0);
    setSelectedCell({
      area,
      logical: {
        rAbs: nextRowNumber,
        cAbs: nextColIndex,
      },
      colId: toColFieldId(nextColIndex),
      rowPath: null,
    });
    window.requestAnimationFrame(() => {
      if (area === "header") {
        focusHeaderOverlayCell(nextRowNumber, nextColIndex);
      } else {
        focusBodyCellAt(nextRowNumber, nextColIndex);
      }
    });
  }, [activeSheet, currentSheetState, defaultBodyRailColIndex, headerRowCount, currentSheetRowStructure, startRowTransition, duplicateRows, closeRailMenu, selectedCell, focusHeaderOverlayCell, focusBodyCellAt]);

  const handleDeleteRow = useCallback(async (rowNumber: number, area: "header" | "body", rowId: number, _mode: "node" | "subtree" = "node") => {
    if (!activeSheet) {
      throw new Error("row deletion requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("row deletion requires current sheet state");
    }
    if (area === "body" && defaultBodyRailColIndex == null) {
      throw new Error("row deletion requires at least one selectable column");
    }
    const targets = resolveRowDeleteTargets(rowNumber, area, rowId, selection, currentSheetState, currentSheetRowStructure);
    const previews = targets.map((target) => previewDeleteRow(activeSheet, target.rowId, target.mode));
    const deletedRowCount = previews.reduce((sum, preview) => sum + preview.deletedRowCount, 0);
    const affectedFormulaCellCount = countUniqueAffectedFormulaCells(previews.flatMap((preview) => preview.affectedFormulaCells));
    if (affectedFormulaCellCount > 0) {
      const firstTarget = targets[0];
      if (!firstTarget) {
        throw new Error("row deletion expected at least one delete target");
      }
      closeRailMenu();
      const confirmed = await requestConfirmation({
        title: "Delete row?",
        body: (
          <>
            <p className="app-modal-target">{describeRowDeleteTarget(firstTarget.rowNumber, area, firstTarget.rowId, deletedRowCount)}</p>
            <p>{affectedFormulaCellCount} formula cell(s) reference the row(s) being deleted.</p>
          </>
        ),
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        tone: "danger",
      });
      if (!confirmed) return;
    }
    if (area === "header") {
      const firstTarget = targets[0];
      if (!firstTarget) {
        throw new Error("header row deletion expected at least one delete target");
      }
      const nextHeaderRowNumber = headerRowCount <= deletedRowCount ? null : Math.min(firstTarget.rowNumber, headerRowCount - deletedRowCount);
      deleteRows(activeSheet, targets.map((target) => ({ rowId: target.rowId, mode: target.mode })));
      closeRailMenu();
      setFormulaInputMode("read");
      setSelectedColumnIndex(null);
      if (nextHeaderRowNumber == null) {
        clearActiveSelection();
        return;
      }
      const nextColIndex = selectedCell?.logical.cAbs ?? defaultBodyRailColIndex ?? 0;
      setSelectedCell({
        area: "header",
        logical: {
          rAbs: nextHeaderRowNumber,
          cAbs: nextColIndex,
        },
        colId: toColFieldId(nextColIndex),
        rowPath: null,
      });
      window.requestAnimationFrame(() => {
        focusHeaderOverlayCell(nextHeaderRowNumber, nextColIndex);
      });
      return;
    }
    if (defaultBodyRailColIndex == null) {
      throw new Error("row deletion requires at least one selectable column");
    }
    const bodyRowCount = currentSheet?.values.length ?? 0;
    const firstTarget = targets[0];
    if (!firstTarget) {
      throw new Error("body row deletion expected at least one delete target");
    }
    const nextBodyRowCount = bodyRowCount - deletedRowCount;
    const nextRowNumber =
      nextBodyRowCount <= 0
        ? null
        : firstTarget.rowNumber <= headerRowCount + nextBodyRowCount
          ? firstTarget.rowNumber
          : headerRowCount + nextBodyRowCount;
    if (nextRowNumber != null) {
      startRowTransition("delete", nextRowNumber);
    }
    deleteRows(activeSheet, targets.map((target) => ({ rowId: target.rowId, mode: target.mode })));
    closeRailMenu();
    setFormulaInputMode("read");
    if (nextBodyRowCount <= 0) {
      clearActiveSelection();
      return;
    }
    if (nextRowNumber == null) {
      throw new Error("row deletion expected a next row number");
    }
    const nextColIndex = resolvePostRowStructureColumnIndex(selectedCell, defaultBodyRailColIndex);
    setSelectedColumnIndex(null);
    setSelectedCell({
      area: "body",
      logical: {
        rAbs: nextRowNumber,
        cAbs: nextColIndex,
      },
      colId: toColFieldId(nextColIndex),
      rowPath: null,
    });
    window.requestAnimationFrame(() => {
      focusBodyCellAt(nextRowNumber, nextColIndex);
    });
  }, [activeSheet, currentSheetState, defaultBodyRailColIndex, currentSheet, selectedCell, selection, currentSheetRowStructure, previewDeleteRow, deleteRows, closeRailMenu, requestConfirmation, describeRowDeleteTarget, headerRowCount, clearActiveSelection, focusHeaderOverlayCell, startRowTransition, focusBodyCellAt]);

  const handleConvertRowsToHeader = useCallback((rowId: number) => {
    if (!activeSheet) {
      throw new Error("row conversion requires an active sheet");
    }
    convertRowsToHeader(activeSheet, [rowId]);
    closeRailMenu();
    clearActiveSelection();
    setFormulaInputMode("read");
  }, [activeSheet, convertRowsToHeader, closeRailMenu, clearActiveSelection]);

  const handleConvertRowsToBody = useCallback((rowId: number) => {
    if (!activeSheet) {
      throw new Error("row conversion requires an active sheet");
    }
    convertRowsToBody(activeSheet, [rowId], 0);
    closeRailMenu();
    clearActiveSelection();
    setFormulaInputMode("read");
  }, [activeSheet, convertRowsToBody, closeRailMenu, clearActiveSelection]);

  const maxHeaderRowCount = useMemo(() => {
    const rowCount = currentSheetState?.rowIds.length ?? 0;
    return Math.max(0, rowCount - 1);
  }, [currentSheetState]);

  const handleSetHeaderRowCount = useCallback((nextCount: number) => {
    if (!activeSheet) {
      throw new Error("header row conversion requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("header row conversion requires current sheet state");
    }
    const targetCount = Math.max(0, Math.min(maxHeaderRowCount, nextCount));
    if (targetCount === headerRowCount) return;
    const rowIds = currentSheetState.rowIds;
    if (targetCount > headerRowCount) {
      const rowIdsToPromote = rowIds.slice(headerRowCount, targetCount);
      if (rowIdsToPromote.length !== targetCount - headerRowCount) {
        throw new Error("header row conversion target exceeds available body rows");
      }
      convertRowsToHeader(activeSheet, rowIdsToPromote);
    } else {
      const rowIdsToDemote = rowIds.slice(targetCount, headerRowCount);
      if (rowIdsToDemote.length !== headerRowCount - targetCount) {
        throw new Error("header row conversion target exceeds available header rows");
      }
      convertRowsToBody(activeSheet, rowIdsToDemote, 0);
    }
    clearActiveSelection();
    setFormulaInputMode("read");
  }, [
    activeSheet,
    currentSheetState,
    maxHeaderRowCount,
    headerRowCount,
    convertRowsToHeader,
    convertRowsToBody,
    clearActiveSelection,
  ]);

  const handleInsertColumn = useCallback((colIndex: number, side: "left" | "right") => {
    if (!activeSheet) {
      throw new Error("column insertion requires an active sheet");
    }
    const nextColIndex = side === "left" ? colIndex : colIndex + 1;
    startColumnTransition("insert");
    insertColumn(activeSheet, nextColIndex);
    closeRailMenu();
    setSelectedCell(null);
    setSelectedColumnIndex(nextColIndex);
    setFormulaInputMode("read");
    scheduleColumnIntoView(nextColIndex);
  }, [activeSheet, startColumnTransition, insertColumn, closeRailMenu, scheduleColumnIntoView]);

  const handleAppendDataColumns = useCallback((count: number) => {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("append data columns requires a positive integer count");
    }
    if (!activeSheet) {
      throw new Error("append data columns requires an active sheet");
    }
    const firstColIndex = sheetColCount;
    const lastColIndex = firstColIndex + count - 1;
    startColumnTransition("insert");
    insertColumns(activeSheet, firstColIndex, count);
    closeRailMenu();
    setSelectedCell(null);
    setSelectedColumnIndex(lastColIndex);
    setFormulaInputMode("read");
    scheduleAppendColumnAnchorScroll(activeSheet, sheetColCount + count);
  }, [
    activeSheet,
    sheetColCount,
    startColumnTransition,
    insertColumns,
    closeRailMenu,
    setSelectedCell,
    setSelectedColumnIndex,
    scheduleAppendColumnAnchorScroll,
  ]);

  const handleDuplicateColumn = useCallback((colIndex: number) => {
    if (!activeSheet) {
      throw new Error("column duplication requires an active sheet");
    }
    if (!currentSheetState) {
      throw new Error("column duplication requires current sheet state");
    }
    if (colIndex < headerColCount || colIndex >= sheetColCount) {
      throw new Error("column duplication target must be inside data columns");
    }
    const colId = currentSheetState.colIds[colIndex];
    if (colId == null) {
      throw new Error("column duplication requires a valid source column id");
    }
    const nextColIndex = colIndex + 1;
    startColumnTransition("insert");
    duplicateColumns(activeSheet, [colId], nextColIndex);
    closeRailMenu();
    setSelectedCell(null);
    setSelectedColumnIndex(nextColIndex);
    setFormulaInputMode("read");
  }, [activeSheet, currentSheetState, headerColCount, sheetColCount, startColumnTransition, duplicateColumns, closeRailMenu]);

  const handleDeleteColumn = useCallback(async (colIndex: number) => {
    if (!activeSheet) {
      throw new Error("column deletion requires an active sheet");
    }
    const colIndices = resolveColumnDeleteTargets(colIndex, selection, headerColCount, sheetColCount);
    const previews = colIndices.map((targetColIndex) => previewDeleteColumn(activeSheet, targetColIndex));
    const affectedFormulaCellCount = countUniqueAffectedFormulaCells(previews.flatMap((preview) => preview.affectedFormulaCells));
    if (affectedFormulaCellCount > 0) {
      const firstColIndex = colIndices[0];
      const lastColIndex = colIndices[colIndices.length - 1];
      if (firstColIndex == null || lastColIndex == null) {
        throw new Error("column deletion expected at least one delete target");
      }
      const targetLabel =
        firstColIndex === lastColIndex
          ? describeColumnDeleteTarget(firstColIndex)
          : `${toColumnLetters(firstColIndex + 1)}:${toColumnLetters(lastColIndex + 1)}`;
      closeRailMenu();
      const confirmed = await requestConfirmation({
        title: "Delete column?",
        body: (
          <>
            <p className="app-modal-target">{targetLabel}</p>
            <p>{affectedFormulaCellCount} formula cell(s) reference the column(s) being deleted.</p>
          </>
        ),
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        tone: "danger",
      });
      if (!confirmed) return;
    }
    startColumnTransition("delete");
    deleteColumns(activeSheet, colIndices);
    closeRailMenu();
    setSelectedCell(null);
    const firstColIndex = colIndices[0];
    if (firstColIndex == null) {
      throw new Error("column deletion expected at least one delete target");
    }
    const nextSheetColCount = sheetColCount - colIndices.length;
    const nextColIndex = firstColIndex < nextSheetColCount ? firstColIndex : firstColIndex - 1;
    if (nextColIndex >= headerColCount) {
      setSelectedColumnIndex(nextColIndex);
    } else {
      setSelectedColumnIndex(null);
    }
    setFormulaInputMode("read");
  }, [activeSheet, selection, headerColCount, sheetColCount, previewDeleteColumn, closeRailMenu, requestConfirmation, describeColumnDeleteTarget, startColumnTransition, deleteColumns]);


  return {
    handleInsertRow, handleAppendBodyRows, handleDuplicateRow, handleDeleteRow,
    handleConvertRowsToHeader, handleConvertRowsToBody, maxHeaderRowCount, handleSetHeaderRowCount,
    handleInsertColumn, handleAppendDataColumns, handleDuplicateColumn, handleDeleteColumn,
  };
}
