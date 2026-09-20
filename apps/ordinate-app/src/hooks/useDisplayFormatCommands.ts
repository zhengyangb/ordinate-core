import type { StylePatch } from "@ordinate/core";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useEditorStore } from "../store/editorStore";
import type { FormatLocalKey, FormatLocalOptions, FormulaBarData, SelectedCell } from "../types/ui";
import type { FormulaInputMode } from "../utils/appHelpers";
import { formatSpecFromLocalSelection } from "../utils/formatDisplay";

type Options = {
  activeSheet: string | null; selectedCell: SelectedCell | null;
  headerRowCount: number; headerColCount: number;
  setFormulaInputMode: Dispatch<SetStateAction<FormulaInputMode>>;
};
export function useDisplayFormatCommands({
  activeSheet, selectedCell, headerRowCount, headerColCount, setFormulaInputMode,
}: Options) {
  const setCellLocalFormat = useEditorStore(state => state.setCellLocalFormat);
  const setCellLocalStyle = useEditorStore(state => state.setCellLocalStyle);
  const setColumnDefaultFormat = useEditorStore(state => state.setColumnDefaultFormat);
  const setColumnDefaultStyle = useEditorStore(state => state.setColumnDefaultStyle);
  const clearColumnDefaultFormat = useEditorStore(state => state.clearColumnDefaultFormat);
  const setRowDefaultFormat = useEditorStore(state => state.setRowDefaultFormat);
  const setRowDefaultStyle = useEditorStore(state => state.setRowDefaultStyle);
  const clearRowDefaultFormat = useEditorStore(state => state.clearRowDefaultFormat);
  const handleSetCellLocalFormat = useCallback((key: FormatLocalKey, options: FormatLocalOptions | null | undefined) => {
    if (!selectedCell || selectedCell.area !== "body" || selectedCell.logical.rAbs <= headerRowCount || selectedCell.logical.cAbs < headerColCount) {
      throw new Error("format edit requires a selected data cell");
    }
    if (!activeSheet) {
      throw new Error("format edit requires an active sheet");
    }
    setCellLocalFormat(
      {
        kind: "index",
        sheet: activeSheet,
        rowIndex: selectedCell.logical.rAbs - 1,
        colIndex: selectedCell.logical.cAbs,
      },
      formatSpecFromLocalSelection(key, options ?? null),
    );
    setFormulaInputMode("read");
  }, [selectedCell, activeSheet, headerRowCount, headerColCount, setCellLocalFormat]);

  const handleSetCellLocalStyle = useCallback(<Axis extends "align" | "weight" | "color">(
    axis: Axis,
    value: NonNullable<FormulaBarData["styleLocal"]>[Axis],
  ) => {
    if (!selectedCell || selectedCell.area !== "body" || selectedCell.logical.rAbs <= headerRowCount || selectedCell.logical.cAbs < headerColCount) {
      throw new Error("style edit requires a selected data cell");
    }
    if (!activeSheet) {
      throw new Error("style edit requires an active sheet");
    }
    const patch: StylePatch = {
      [axis]: value === "auto" ? null : value,
    };
    setCellLocalStyle(
      {
        kind: "index",
        sheet: activeSheet,
        rowIndex: selectedCell.logical.rAbs - 1,
        colIndex: selectedCell.logical.cAbs,
      },
      patch,
    );
    setFormulaInputMode("read");
  }, [selectedCell, activeSheet, headerRowCount, headerColCount, setCellLocalStyle]);

  const handleSetColumnDefaultFormat = useCallback((colId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => {
    if (!activeSheet) {
      throw new Error("column format edit requires an active sheet");
    }
    if (key === "auto") {
      clearColumnDefaultFormat(activeSheet, colId);
    } else {
      setColumnDefaultFormat(activeSheet, colId, formatSpecFromLocalSelection(key, options));
    }
    setFormulaInputMode("read");
  }, [activeSheet, clearColumnDefaultFormat, setColumnDefaultFormat]);

  const handleSetColumnDefaultStyle = useCallback(<Axis extends "align" | "weight" | "color">(
    colId: number,
    axis: Axis,
    value: NonNullable<FormulaBarData["styleLocal"]>[Axis],
  ) => {
    if (!activeSheet) {
      throw new Error("column style edit requires an active sheet");
    }
    const patch: StylePatch = {
      [axis]: value === "auto" ? null : value,
    };
    setColumnDefaultStyle(activeSheet, colId, patch);
    setFormulaInputMode("read");
  }, [activeSheet, setColumnDefaultStyle]);

  const handleSetRowDefaultFormat = useCallback((rowId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => {
    if (!activeSheet) {
      throw new Error("row format edit requires an active sheet");
    }
    if (key === "auto") {
      clearRowDefaultFormat(activeSheet, rowId);
    } else {
      setRowDefaultFormat(activeSheet, rowId, formatSpecFromLocalSelection(key, options));
    }
    setFormulaInputMode("read");
  }, [activeSheet, clearRowDefaultFormat, setRowDefaultFormat]);

  const handleSetRowDefaultStyle = useCallback(<Axis extends "align" | "weight" | "color">(
    rowId: number,
    axis: Axis,
    value: NonNullable<FormulaBarData["styleLocal"]>[Axis],
  ) => {
    if (!activeSheet) {
      throw new Error("row style edit requires an active sheet");
    }
    const patch: StylePatch = {
      [axis]: value === "auto" ? null : value,
    };
    setRowDefaultStyle(activeSheet, rowId, patch);
    setFormulaInputMode("read");
  }, [activeSheet, setRowDefaultStyle]);

  return {
    handleSetCellLocalFormat, handleSetCellLocalStyle, handleSetColumnDefaultFormat,
    handleSetColumnDefaultStyle, handleSetRowDefaultFormat, handleSetRowDefaultStyle,
  };
}
