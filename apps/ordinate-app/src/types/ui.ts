import type { ReactNode } from "react";

export type GridRow = {
  __rowPath: string;
  __absoluteRowNumber: number;
  __depth: number;
  __hasChildren: boolean;
  __isSection: boolean;
  __collapsed: boolean;
  [key: string]: string | number | boolean;
};

export type LogicalCell = {
  rAbs: number;
  cAbs: number;
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
  sourceText: string;
  editableSourceText: string;
  formatLocalKey?: FormatLocalKey;
  formatLocalOptions?: FormatLocalOptions | null;
  styleLocal?: StyleLocalView | null;
  displaySource?: "cell" | "column" | "default";
  displayErrors?: string[];
};

export type DisplayCellView = {
  displayText: string;
  source: "cell" | "column" | "default";
  formatRaw: string | null;
  styleRaw: string | null;
  errors: string[];
};

export type ChromeVisibilityPhase = "visible" | "hiding" | "hidden";

export type RowIndexMetric = {
  rowPath: string;
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

export type FormatLocalKey = "auto" | "integer" | "decimal" | "scientific" | "percent";

export type FormatLocalOptions = {
  sign: "default" | "plus" | "parentheses";
  zeroPad: boolean;
  width: number | null;
  grouping: boolean;
  precision: number | null;
};

export type StyleLocalView = {
  align: "auto" | "left" | "center" | "right";
  weight: "auto" | "bold" | "normal";
  color: "auto" | "red" | "green" | "blue";
};

export type ColumnRailMenuView = {
  colIndex: number;
  colLabel: string;
  hasLocalConfig: boolean;
  formatLocalKey: FormatLocalKey;
  formatLocalOptions: FormatLocalOptions | null;
  styleLocal: StyleLocalView;
};

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
