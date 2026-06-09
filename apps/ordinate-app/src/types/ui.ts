import type { Diagnostic, RuntimeValue } from "@ordinate/core";
import type { ReactNode } from "react";

export type GridRow = {
  __rowKey: string;
  __rowId: number;
  __rowPath: string;
  __absoluteRowNumber: number;
  __depth: number;
  __hasChildren: boolean;
  __collapsed: boolean;
  [key: string]: string | number | boolean;
};

export type LogicalCell = {
  rAbs: number;
  cAbs: number;
};

export type Rect = {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
};

export type SheetSelection =
  | {
      kind: "cell";
      focus: LogicalCell;
      anchor: LogicalCell;
      range: Rect;
    }
  | {
      kind: "range";
      focus: LogicalCell;
      anchor: LogicalCell;
      range: Rect;
    }
  | {
      kind: "column";
      colIndex: number;
    }
  | {
      kind: "row";
      rowNumber: number;
      area: "header" | "body";
    };

export type SelectedCell = {
  area: "header" | "body";
  logical: LogicalCell;
  colId: string;
  rowPath: string | null;
};

export type HeaderOverlayHitResult = {
  logical: LogicalCell;
  colId: string;
  headerRowNumber: number;
};

export type FormulaBarData = {
  primaryAddress: string;
  secondaryAddress: string;
  chip: string;
  displayText: string;
  cellText: string;
  inputText: string;
  formatLocalKey?: FormatLocalKey;
  formatLocalOptions?: FormatLocalOptions | null;
  formatEffectiveKey?: FormatLocalKey;
  formatEffectiveOptions?: FormatLocalOptions | null;
  formatInheritedKey?: FormatLocalKey;
  formatInheritedOptions?: FormatLocalOptions | null;
  formatPreviewContext?: FormatPreviewContext;
  styleLocal?: StyleLocalView | null;
  displaySource?: "cell" | "row" | "column" | "default";
  formatSource?: "cell" | "row" | "column" | "default";
  displayErrors?: Diagnostic[];
};

export type DisplayCellView = {
  displayText: string;
  source: "cell" | "row" | "column" | "default";
  formatRaw: string | null;
  styleRaw: string | null;
  errors: Diagnostic[];
};

export type ChromeVisibilityPhase = "visible" | "hiding" | "hidden";

export type RowIndexMetric = {
  rowKey: string;
  number: number;
  top: number;
  height: number;
};

export type HeaderIndexMetric = {
  number: number;
  top: number;
  height: number;
};

export type HeaderOverlayCell = {
  key: string;
  rowNumber: number;
  label: string;
  startCol: number;
  endCol: number;
  left: number;
  width: number;
  top: number;
  height: number;
};

export type ColumnMetric = {
  colIndex: number;
  left: number;
  width: number;
};

export type ThemeMode = "auto" | "light" | "dark";

export type ThemeMenuPosition = {
  top: number;
  left: number;
};

export type FloatingMenuPosition = {
  top: number;
  left: number;
};

export type NumericFormatLocalKey = "integer" | "decimal" | "scientific" | "percent";
export type TemporalFormatLocalKey = "temporal";
export type FormatLocalKey = "auto" | NumericFormatLocalKey | TemporalFormatLocalKey;

export type NumericFormatLocalOptions = {
  kind: "numeric";
  sign: "default" | "plus" | "parentheses";
  padWidth: number | null;
  grouping: boolean;
  precision: number | null;
};

export type TemporalFormatLocalOptions = {
  kind: "temporal";
  pattern: string;
  preset: string | null;
};

export type FormatLocalOptions = NumericFormatLocalOptions | TemporalFormatLocalOptions;

export type FormatPreviewContext = {
  value: RuntimeValue | null;
  scope: "cell" | "row" | "column" | "sample";
};

export type StyleLocalView = {
  align: "auto" | "left" | "center" | "right";
  weight: "auto" | "bold" | "normal";
  color: "auto" | "red" | "green" | "blue";
};

export type ColumnRailMenuView = {
  kind: "column";
  colIndex: number;
  colId: number;
  colLabel: string;
  hasLocalConfig: boolean;
  canStructureEdit: boolean;
  formatLocalKey: FormatLocalKey;
  formatLocalOptions: FormatLocalOptions | null;
  formatPreviewContext: FormatPreviewContext;
  styleLocal: StyleLocalView;
};

export type RowRailMenuView = {
  kind: "row";
  area: "header" | "body";
  rowNumber: number;
  rowId: number;
  rowPath: string | null;
  hasChildren: boolean;
  canDisplayEdit: boolean;
  hasLocalConfig: boolean;
  formatLocalKey: FormatLocalKey;
  formatLocalOptions: FormatLocalOptions | null;
  formatPreviewContext: FormatPreviewContext;
  styleLocal: StyleLocalView;
  canConvertToHeader: boolean;
  canConvertToBody: boolean;
};

export type RailMenuView = ColumnRailMenuView | RowRailMenuView;

export type FloatingTooltip = {
  text: string;
  top: number;
  left: number;
  placement: "above" | "below";
  alignment: "center" | "left" | "right";
};

export type ToolSpec = {
  label: string;
  icon: ReactNode;
};

export type SheetHealth = "ok" | "invalid";

export type SheetIssueViewModel = {
  message: string;
  row?: number;
  col?: number;
};
