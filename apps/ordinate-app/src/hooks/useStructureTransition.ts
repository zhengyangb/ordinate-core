import { useCallback, useEffect, useRef, useState } from "react";
import { shouldAnimateTableStructure } from "../config/motion";

const ROW_TRANSITION_MS = 260;
const COLUMN_TRANSITION_MS = 220;

export type StructureTransitionRowKind = "insert" | "delete";
export type StructureTransitionColumnKind = "insert" | "delete";

type ColumnTransitionState = {
  kind: StructureTransitionColumnKind;
};

type RowTransitionState = {
  kind: StructureTransitionRowKind;
};

export function useStructureTransition() {
  const rowTimeoutRef = useRef<number | null>(null);
  const columnTimeoutRef = useRef<number | null>(null);
  const [rowTransition, setRowTransition] = useState<RowTransitionState | null>(null);
  const [columnTransition, setColumnTransition] = useState<ColumnTransitionState | null>(null);

  const clearRowTransition = useCallback(() => {
    if (rowTimeoutRef.current != null) {
      window.clearTimeout(rowTimeoutRef.current);
      rowTimeoutRef.current = null;
    }
    setRowTransition(null);
  }, []);

  const clearColumnTransition = useCallback(() => {
    if (columnTimeoutRef.current != null) {
      window.clearTimeout(columnTimeoutRef.current);
      columnTimeoutRef.current = null;
    }
    setColumnTransition(null);
  }, []);

  const startRowTransition = useCallback((kind: StructureTransitionRowKind, targetRowNumber: number) => {
    if (targetRowNumber <= 0) {
      throw new Error("row transition requires a positive row number");
    }
    if (!shouldAnimateTableStructure()) {
      clearRowTransition();
      return;
    }
    if (rowTimeoutRef.current != null) {
      window.clearTimeout(rowTimeoutRef.current);
    }
    setRowTransition({ kind });
    rowTimeoutRef.current = window.setTimeout(() => {
      rowTimeoutRef.current = null;
      setRowTransition(null);
    }, ROW_TRANSITION_MS);
  }, [clearRowTransition]);

  const startColumnTransition = useCallback((kind: StructureTransitionColumnKind) => {
    if (!shouldAnimateTableStructure()) {
      clearColumnTransition();
      return;
    }
    if (columnTimeoutRef.current != null) {
      window.clearTimeout(columnTimeoutRef.current);
    }
    setColumnTransition({ kind });
    columnTimeoutRef.current = window.setTimeout(() => {
      columnTimeoutRef.current = null;
      setColumnTransition(null);
    }, COLUMN_TRANSITION_MS);
  }, [clearColumnTransition]);

  useEffect(() => {
    return () => {
      if (rowTimeoutRef.current != null) {
        window.clearTimeout(rowTimeoutRef.current);
      }
      if (columnTimeoutRef.current != null) {
        window.clearTimeout(columnTimeoutRef.current);
      }
    };
  }, []);

  return {
    rowTransitionKind: rowTransition?.kind ?? null,
    structureTransitionScope: (rowTransition != null ? "row" : columnTransition != null ? "column" : null) as "row" | "column" | null,
    isSelectionRingTransitioning: rowTransition != null || columnTransition != null,
    isStructureVeilVisible: rowTransition != null || columnTransition != null,
    startRowTransition,
    startColumnTransition,
    clearRowTransition,
    clearColumnTransition,
  };
}
