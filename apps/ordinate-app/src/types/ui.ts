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

export type SelectedCell =
  | {
      kind: "header";
      colId: string;
      headerRowNumber: number;
    }
  | {
      kind: "body";
      rowPath: string;
      colId: string;
      absoluteRowNumber: number;
    };

export type FormulaBarData = {
  primaryAddress: string;
  secondaryAddress: string;
  chip: string;
  displayText: string;
  sourceText: string;
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
  left: number;
  width: number;
  top: number;
  height: number;
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

export type TabTooltip = {
  text: string;
  top: number;
  left: number;
};

export type ToolSpec = {
  label: string;
  icon: ReactNode;
};
