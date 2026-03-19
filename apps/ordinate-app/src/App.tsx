import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type FirstDataRenderedEvent,
  type GridApi,
  type GridReadyEvent,
  type ModelUpdatedEvent,
  themeQuartz,
} from "ag-grid-community";

import { type RuntimeValue, type SheetEvaluation } from "@ordinate/core";
import { useEditorStore } from "./store/editorStore";

import "ag-grid-community/styles/ag-grid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const LABEL_COLUMN_WIDTH = 280;
const DATA_COLUMN_MIN_WIDTH = 132;
const INDEX_RAIL_WIDTH = 56;
const GRID_HEADER_HEIGHT = 40;
const GRID_ROW_HEIGHT = 38;
const FORMULA_BAR_SAFE_SPACE = 136;
const THEME_STORAGE_KEY = "ordinate-theme-mode";

type GridRow = {
  __rowPath: string;
  __rowNumber: number;
  __label: string;
  __depth: number;
  __hasChildren: boolean;
  __isSection: boolean;
  __collapsed: boolean;
  [key: string]: string | number | boolean;
};

type SelectedCell = {
  rowPath: string;
  colId: string;
};

type FormulaBarData = {
  primaryAddress: string;
  secondaryAddress: string;
  chip: string;
  displayText: string;
  sourceText: string;
};

type RowIndexMetric = {
  rowPath: string;
  number: number;
  top: number;
  height: number;
};

type ThemeMode = "auto" | "light" | "dark";
type ThemeMenuPosition = { top: number; left: number };
type FloatingMenuPosition = { top: number; left: number };
type TabTooltip = {
  text: string;
  top: number;
  left: number;
};

type ToolSpec = {
  label: string;
  icon: ReactNode;
};

function runtimeValueToText(value: RuntimeValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value ?? "");
    case "string":
      return String(value.value ?? "");
    case "boolean":
      return value.value ? "true" : "false";
    case "blank":
      return "";
    case "null":
      return "null";
    case "error":
      return "#ERROR";
    default:
      return String(value.value ?? "");
  }
}

function runtimeKindLabel(value: RuntimeValue | null | undefined): string {
  switch (value?.kind) {
    case "number":
      return "Number";
    case "string":
      return "Text";
    case "boolean":
      return "Boolean";
    case "blank":
      return "Blank";
    case "null":
      return "Null";
    case "error":
      return "Error";
    default:
      return "Value";
  }
}

function splitPath(path: string): string[] {
  return path.split(".").filter((part) => part.length > 0);
}

function leafLabel(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? path;
}

function compactColLabel(label: string): string {
  const parts = splitPath(label);
  if (parts.length <= 1) return label;
  return parts.slice(-2).join(" / ");
}

function isVisiblePath(path: string, collapsed: Set<string>): boolean {
  const parts = splitPath(path);
  let current = "";
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = current ? `${current}.${parts[i]}` : parts[i];
    if (collapsed.has(current)) {
      return false;
    }
  }
  return true;
}

function normalizeLabel(text: string): string {
  return text.replace(/^\[|\]$/g, "").trim().toLowerCase();
}

function shouldHideFirstDataColumn(sheet: SheetEvaluation): boolean {
  if (sheet.colLabels.length === 0 || sheet.values.length === 0) {
    return false;
  }

  let comparableRows = 0;
  let matchedRows = 0;

  for (let i = 0; i < sheet.values.length; i += 1) {
    const rowPath = sheet.rowPaths[i] ?? "";
    const rawValue = runtimeValueToText(sheet.values[i]?.[0] as RuntimeValue);
    if (!rowPath || rawValue.length === 0) continue;
    comparableRows += 1;
    if (normalizeLabel(rawValue) === normalizeLabel(leafLabel(rowPath))) {
      matchedRows += 1;
    }
  }

  return comparableRows > 0 && matchedRows / comparableRows >= 0.7;
}

function rowHeaderLabel(sheet: SheetEvaluation): string {
  if (sheet.colLabels.length === 0) {
    return "Line Item";
  }
  return shouldHideFirstDataColumn(sheet) ? sheet.colLabels[0] ?? "Line Item" : "Line Item";
}

function ToolbarIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

function ViewIcon() {
  return (
    <ToolbarIcon>
      <rect x="2.5" y="4" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 4v12" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 8h1.7M4.5 10.7h1.7M4.5 13.4h1.7" fill="none" stroke="currentColor" strokeLinecap="round" />
    </ToolbarIcon>
  );
}

function InsertIcon() {
  return (
    <ToolbarIcon>
      <rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 6.8v6.4M6.8 10h6.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.2 15.2h2.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </ToolbarIcon>
  );
}

function TableGlyph() {
  return (
    <ToolbarIcon>
      <rect x="3" y="4" width="14" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 8h14M3 12h14M8 4v12M12 4v12" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </ToolbarIcon>
  );
}

function ChartIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M10 3.2a6.8 6.8 0 1 1-4.8 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <path d="M10 3.2V10l4.7 2.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </ToolbarIcon>
  );
}

function TextIcon() {
  return (
    <ToolbarIcon>
      <rect x="2.8" y="4.2" width="14.4" height="11.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.1 13.2 9.8 6.8l2.7 6.4M8.1 11h3.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M15.4 8.2h1.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </ToolbarIcon>
  );
}

function ShapeIcon() {
  return (
    <ToolbarIcon>
      <rect x="3" y="3.8" width="8.7" height="8.7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.4" y="7.2" width="8.6" height="8.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </ToolbarIcon>
  );
}

function CommentIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M4.2 4.5h11.6a1.8 1.8 0 0 1 1.8 1.8v6.1a1.8 1.8 0 0 1-1.8 1.8H9l-3.6 2.4v-2.4H4.2a1.8 1.8 0 0 1-1.8-1.8V6.3a1.8 1.8 0 0 1 1.8-1.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path d="M6.7 8.4h6.6M6.7 11h4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </ToolbarIcon>
  );
}

function OrganizeIcon() {
  return (
    <ToolbarIcon>
      <path d="M4 5.2h12M6.2 9.1h7.6M8 13h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <circle cx="15.4" cy="15.3" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </ToolbarIcon>
  );
}

function PlusIcon() {
  return (
    <ToolbarIcon>
      <path d="M10 4.4v11.2M4.4 10h11.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </ToolbarIcon>
  );
}

function MoreIcon() {
  return (
    <ToolbarIcon>
      <circle cx="5" cy="10" r="1.2" fill="currentColor" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" />
    </ToolbarIcon>
  );
}

function CodeIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M7.25 5.75 3.5 9.5l3.75 3.75M12.75 5.75 16.5 9.5l-3.75 3.75M11.1 4.5 8.9 14.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </ToolbarIcon>
  );
}

function SunIcon() {
  return (
    <ToolbarIcon>
      <circle cx="10" cy="10" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2.5v2.1M10 15.4v2.1M2.5 10h2.1M15.4 10h2.1M4.6 4.6l1.5 1.5M13.9 13.9l1.5 1.5M15.4 4.6l-1.5 1.5M6.1 13.9l-1.5 1.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </ToolbarIcon>
  );
}

function MoonIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M12.9 3.1a6.7 6.7 0 1 0 4 11.8A7.4 7.4 0 1 1 12.9 3.1Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </ToolbarIcon>
  );
}

function AutoIcon() {
  return (
    <ToolbarIcon>
      <path
        d="M10 3.1a6.9 6.9 0 1 0 0 13.8V3.1Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M10 3.1a6.9 6.9 0 0 1 0 13.8"
        fill="currentColor"
        opacity="0.2"
      />
      <path d="M10 2.3v1.3M10 16.4v1.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </ToolbarIcon>
  );
}

const TOOLBAR_ITEMS: ToolSpec[] = [
  { label: "View", icon: <ViewIcon /> },
  { label: "Insert", icon: <InsertIcon /> },
  { label: "Table", icon: <TableGlyph /> },
  { label: "Chart", icon: <ChartIcon /> },
  { label: "Text", icon: <TextIcon /> },
  { label: "Shape", icon: <ShapeIcon /> },
  { label: "Comment", icon: <CommentIcon /> },
  { label: "Organize", icon: <OrganizeIcon /> },
];

export default function App() {
  const {
    mode,
    sourceText,
    docState,
    evaluation,
    activeSheet,
    error,
    setSourceText,
    setActiveSheet,
    enterSourceMode,
    exitSourceMode,
  } = useEditorStore();

  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [formulaBarSnapshot, setFormulaBarSnapshot] = useState<FormulaBarData | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState<ThemeMenuPosition>({ top: 0, left: 0 });
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuPosition, setToolMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0 });
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [tabTooltip, setTabTooltip] = useState<TabTooltip | null>(null);
  const [hasVerticalOverlap, setHasVerticalOverlap] = useState(false);
  const [hasHorizontalOverlap, setHasHorizontalOverlap] = useState(false);
  const [rowIndexMetrics, setRowIndexMetrics] = useState<RowIndexMetric[]>([]);
  const [rowIndexTrackHeight, setRowIndexTrackHeight] = useState(0);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const columnTrackRef = useRef<HTMLDivElement | null>(null);
  const rowTrackRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<GridRow> | null>(null);
  const themeControlRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolButtonRef = useRef<HTMLButtonElement | null>(null);

  const clearActiveSelection = useCallback(() => {
    setSelectedCell(null);
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }, []);

  useEffect(() => {
    setCollapsedPaths(new Set());
  }, [activeSheet]);

  useEffect(() => {
    setSelectedCell(null);
  }, [activeSheet, mode]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!themeMenuOpen) return;

    const updatePosition = () => {
      const button = themeButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 148;
      setThemeMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - menuWidth),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [themeMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;

    const updatePosition = () => {
      const button = toolButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 168;
      setToolMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - menuWidth),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [toolMenuOpen]);

  useEffect(() => {
    const dismissTooltip = () => setTabTooltip(null);
    window.addEventListener("resize", dismissTooltip);
    window.addEventListener("scroll", dismissTooltip, true);
    return () => {
      window.removeEventListener("resize", dismissTooltip);
      window.removeEventListener("scroll", dismissTooltip, true);
    };
  }, []);

  const handleTabMouseEnter = useCallback(
    (sheetName: string, target: HTMLButtonElement) => {
      if (target.scrollWidth <= target.clientWidth + 1) {
        setTabTooltip(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setTabTooltip({
        text: sheetName,
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
      });
    },
    [],
  );

  const syncRowIndexMetrics = useCallback((api: GridApi<GridRow> | null) => {
    if (!api) {
      setRowIndexMetrics([]);
      setRowIndexTrackHeight(0);
      return;
    }

    const nextMetrics: RowIndexMetric[] = [];
    let maxBottom = 0;

    for (let index = 0; index < api.getDisplayedRowCount(); index += 1) {
      const rowNode = api.getDisplayedRowAtIndex(index);
      if (!rowNode?.data) continue;

      const top = rowNode.rowTop ?? index * GRID_ROW_HEIGHT;
      const height = rowNode.rowHeight ?? GRID_ROW_HEIGHT;
      maxBottom = Math.max(maxBottom, top + height);

      nextMetrics.push({
        rowPath: rowNode.data.__rowPath,
        number: rowNode.data.__rowNumber,
        top,
        height,
      });
    }

    setRowIndexMetrics(nextMetrics);
    setRowIndexTrackHeight(maxBottom);
  }, []);

  const handleGridReady = useCallback(
    (event: GridReadyEvent<GridRow>) => {
      gridApiRef.current = event.api;
      syncRowIndexMetrics(event.api);
    },
    [syncRowIndexMetrics],
  );

  const handleFirstDataRendered = useCallback(
    (event: FirstDataRenderedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
    },
    [syncRowIndexMetrics],
  );

  const handleModelUpdated = useCallback(
    (event: ModelUpdatedEvent<GridRow>) => {
      syncRowIndexMetrics(event.api);
    },
    [syncRowIndexMetrics],
  );

  useEffect(() => {
    const root = gridWrapRef.current;
    if (!root || mode === "source") return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const headerCell = target?.closest<HTMLElement>(".ag-header-cell, .ag-header-group-cell");
      if (!headerCell) return;
      setSelectedCell(null);
      headerCell.tabIndex = 0;
      requestAnimationFrame(() => headerCell.focus());
    };

    root.addEventListener("mousedown", handlePointerDown);
    return () => root.removeEventListener("mousedown", handlePointerDown);
  }, [mode, activeSheet]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      setTabTooltip(null);
      if (!target?.closest(".theme-control") && !target?.closest(".theme-menu")) {
        setThemeMenuOpen(false);
      }
      if (!target?.closest(".tool-overflow-control") && !target?.closest(".tool-menu")) {
        setToolMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (themeMenuOpen) {
        setThemeMenuOpen(false);
        return;
      }
      if (toolMenuOpen) {
        setToolMenuOpen(false);
        return;
      }
      if (mode === "source") return;
      if (!selectedCell) return;
      clearActiveSelection();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, selectedCell, clearActiveSelection, themeMenuOpen, toolMenuOpen]);

  useEffect(() => {
    if (mode === "source") return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selectedCell) return;
      const interactiveRoot = target?.closest(
        ".ag-cell, .ag-header-cell, .ag-header-group-cell, .formula-bar, .source-button, .theme-control, .theme-menu, .tool-overflow-control, .tool-menu, .sheet-tab, textarea",
      );
      if (interactiveRoot) return;
      clearActiveSelection();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [mode, selectedCell, clearActiveSelection]);

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

  const currentSheet = useMemo(() => {
    if (!evaluation || !activeSheet) return null;
    return evaluation.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [evaluation, activeSheet]);

  const currentSheetState = useMemo(() => {
    if (!docState || !activeSheet) return null;
    return docState.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [docState, activeSheet]);

  const hiddenFirstDataColumn = useMemo(
    () => (currentSheet ? shouldHideFirstDataColumn(currentSheet) : false),
    [currentSheet],
  );

  const visibleDataColumns = useMemo(() => {
    if (!currentSheet) return [];
    return currentSheet.colLabels
      .map((colLabel, colIndex) => ({ colLabel, colIndex }))
      .filter(({ colIndex }) => !(hiddenFirstDataColumn && colIndex === 0));
  }, [currentSheet, hiddenFirstDataColumn]);

  const renderedColumnCount = 1 + visibleDataColumns.length;
  const gridTemplateColumns = useMemo(
    () => `${LABEL_COLUMN_WIDTH}px repeat(${visibleDataColumns.length}, minmax(${DATA_COLUMN_MIN_WIDTH}px, 1fr))`,
    [visibleDataColumns.length],
  );

  const columnDefs: ColDef<GridRow>[] = useMemo(() => {
    if (!currentSheet) return [];

    return [
      {
        field: "__label",
        headerName: rowHeaderLabel(currentSheet),
        pinned: "left",
        width: LABEL_COLUMN_WIDTH,
        suppressMovable: true,
        headerClass: "line-item-header",
        cellClass: "line-item-cell",
        cellRenderer: (params: { data?: GridRow }) => {
          const data = params.data;
          if (!data) return null;

          const showToggle = data.__hasChildren;
          const showSpacer = !showToggle && data.__depth > 0;
          const paddingLeft = Math.max(0, data.__depth - 1) * 12;
          const isCollapsed = data.__collapsed;
          const leadingSlot = showToggle ? (
            <button
              className={isCollapsed ? "tree-toggle is-collapsed" : "tree-toggle"}
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapse(data.__rowPath);
              }}
              aria-label={isCollapsed ? "Expand section" : "Collapse section"}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              <svg className="tree-toggle-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="M4 2.5 8.5 6 4 9.5Z" fill="currentColor" />
              </svg>
            </button>
          ) : showSpacer ? (
            <span className="tree-spacer" />
          ) : (
            <span className="tree-inline-pad" aria-hidden="true" />
          );

          return (
            <div className="tree-cell" style={{ paddingLeft }}>
              {leadingSlot}
              <span className={data.__hasChildren ? "tree-label section" : "tree-label"}>{data.__label}</span>
            </div>
          );
        },
      },
      ...visibleDataColumns.map(({ colLabel, colIndex }) => ({
        field: `c_${colIndex}`,
        headerName: compactColLabel(colLabel),
        headerTooltip: colLabel,
        minWidth: DATA_COLUMN_MIN_WIDTH,
        flex: 1,
        suppressMovable: true,
        cellClass: (params: { data?: GridRow }) => {
          const kind = params.data?.[`__kind_${colIndex}`];
          const classes = ["data-cell"];
          if (kind === "number") classes.push("is-numeric");
          if (kind === "error") classes.push("is-error");
          if (kind === "blank") classes.push("is-blank");
          return classes.join(" ");
        },
      })),
    ];
  }, [currentSheet, toggleCollapse, visibleDataColumns]);

  const rowData: GridRow[] = useMemo(() => {
    if (!currentSheet) return [];

    return currentSheet.values
      .map((row, rowIndex) => {
        const rowPath = currentSheet.rowPaths[rowIndex] ?? `R${rowIndex + 1}`;
        const depth = Math.max(0, splitPath(rowPath).length - 1);
        const hasChildren = currentSheet.rowPaths.some(
          (candidate) => candidate !== rowPath && candidate.startsWith(`${rowPath}.`),
        );

        const item: GridRow = {
          __rowPath: rowPath,
          __rowNumber: rowIndex + 1,
          __label: leafLabel(rowPath),
          __depth: depth,
          __hasChildren: hasChildren,
          __isSection: hasChildren,
          __collapsed: collapsedPaths.has(rowPath),
        };

        visibleDataColumns.forEach(({ colIndex }) => {
          const value = row[colIndex] as RuntimeValue;
          item[`c_${colIndex}`] = runtimeValueToText(value);
          item[`__kind_${colIndex}`] = value.kind;
        });

        return item;
      })
      .filter((row) => isVisiblePath(row.__rowPath, collapsedPaths));
  }, [currentSheet, collapsedPaths, visibleDataColumns]);

  const rowIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    rowData.forEach((row) => map.set(row.__rowPath, row.__rowNumber));
    return map;
  }, [rowData]);

  useEffect(() => {
    if (mode === "source") return;
    syncRowIndexMetrics(gridApiRef.current);
  }, [mode, rowData, syncRowIndexMetrics]);

  const colIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    map.set("__label", 1);
    visibleDataColumns.forEach(({ colIndex }, index) => {
      map.set(`c_${colIndex}`, index + 2);
    });
    return map;
  }, [visibleDataColumns]);

  useEffect(() => {
    if (mode === "source") return;
    const root = gridWrapRef.current;
    const columnTrack = columnTrackRef.current;
    const rowTrack = rowTrackRef.current;
    if (!root || !columnTrack || !rowTrack) return;

    const verticalViewport =
      root.querySelector<HTMLElement>(".ag-body-viewport.ag-layout-normal") ??
      root.querySelector<HTMLElement>(".ag-body-viewport");
    const horizontalViewport =
      root.querySelector<HTMLElement>(".ag-body-horizontal-scroll-viewport") ??
      root.querySelector<HTMLElement>(".ag-center-cols-viewport");

    const syncScroll = () => {
      const top = verticalViewport?.scrollTop ?? 0;
      const left = horizontalViewport?.scrollLeft ?? 0;
      rowTrack.style.transform = `translateY(${-top}px)`;
      columnTrack.style.transform = `translateX(${-left}px)`;
      const nextVertical = top > 0.5;
      const nextHorizontal = left > 0.5;
      setHasVerticalOverlap((current) => (current === nextVertical ? current : nextVertical));
      setHasHorizontalOverlap((current) => (current === nextHorizontal ? current : nextHorizontal));
    };

    syncScroll();
    verticalViewport?.addEventListener("scroll", syncScroll);
    horizontalViewport?.addEventListener("scroll", syncScroll);
    window.addEventListener("resize", syncScroll);

    return () => {
      verticalViewport?.removeEventListener("scroll", syncScroll);
      horizontalViewport?.removeEventListener("scroll", syncScroll);
      window.removeEventListener("resize", syncScroll);
    };
  }, [mode, activeSheet, rowData.length, renderedColumnCount]);

  const handleCellFocused = useCallback(
    (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => {
      if (event.rowIndex == null || !event.column) {
        setSelectedCell(null);
        return;
      }

      const row = rowData[event.rowIndex];
      if (!row) {
        setSelectedCell(null);
        return;
      }

      const colId = typeof event.column === "string" ? event.column : event.column.getColId();
      setSelectedCell({
        rowPath: row.__rowPath,
        colId,
      });
    },
    [rowData],
  );

  const formulaBarData = useMemo<FormulaBarData | null>(() => {
    if (!currentSheet || !currentSheetState || !selectedCell) return null;

    const rowRel = currentSheet.rowPaths.indexOf(selectedCell.rowPath);
    if (rowRel < 0) return null;

    const rowNumber = rowIndexLookup.get(selectedCell.rowPath);
    const colNumber = colIndexLookup.get(selectedCell.colId);
    if (!rowNumber || !colNumber) return null;

    const rAbs = currentSheetState.bodyStart + rowRel;
    const rowLeaf = leafLabel(selectedCell.rowPath);

    if (selectedCell.colId === "__label") {
      const rawCell = hiddenFirstDataColumn ? currentSheetState.cells[rAbs]?.[0] : null;
      const rawText = rawCell?.text?.trim() ? rawCell.text : rowLeaf;
      return {
        primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
        secondaryAddress: `${rowHeaderLabel(currentSheet)} / ${rowLeaf}`,
        chip: "Label",
        displayText: rowLeaf,
        sourceText: rawText,
      };
    }

    if (!selectedCell.colId.startsWith("c_")) return null;

    const colIndex = Number(selectedCell.colId.slice(2));
    if (!Number.isFinite(colIndex) || colIndex < 0 || colIndex >= currentSheet.colLabels.length) {
      return null;
    }

    const runtimeValue = currentSheet.values[rowRel]?.[colIndex] as RuntimeValue | undefined;
    const rawCell = currentSheetState.cells[rAbs]?.[colIndex];
    const sourceText = rawCell?.text ?? runtimeValueToText(runtimeValue ?? { kind: "blank", value: null });
    const chip = rawCell?.parsed.kind === "formula" ? "Formula" : runtimeKindLabel(runtimeValue);

    return {
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${currentSheet.colLabels[colIndex]} / ${rowLeaf}`,
      chip,
      displayText: runtimeValue ? runtimeValueToText(runtimeValue) : "",
      sourceText: sourceText.length > 0 ? sourceText : "(blank)",
    };
  }, [currentSheet, currentSheetState, hiddenFirstDataColumn, selectedCell, rowIndexLookup, colIndexLookup]);

  useEffect(() => {
    if (formulaBarData) {
      setFormulaBarSnapshot(formulaBarData);
      return;
    }

    const timeout = window.setTimeout(() => setFormulaBarSnapshot(null), 180);
    return () => window.clearTimeout(timeout);
  }, [formulaBarData]);

  const rowIndexStripHeight = rowIndexTrackHeight + GRID_HEADER_HEIGHT;
  const themeButtonLabel = themeMode === "auto" ? "Automatic appearance" : themeMode === "light" ? "Light mode" : "Dark mode";
  const themeButtonIcon =
    themeMode === "auto" ? <AutoIcon /> : themeMode === "light" ? <SunIcon /> : <MoonIcon />;
  const visibleToolCount = viewportWidth < 720 ? 3 : viewportWidth < 860 ? 4 : viewportWidth < 1040 ? 5 : TOOLBAR_ITEMS.length;
  const visibleTools = TOOLBAR_ITEMS.slice(0, visibleToolCount);
  const overflowTools = TOOLBAR_ITEMS.slice(visibleToolCount);
  const tableStageClassName = [
    "table-stage",
    hasVerticalOverlap ? "has-scroll-y" : "",
    hasHorizontalOverlap ? "has-scroll-x" : "",
  ]
    .join(" ")
    .trim();
  const tableStageStyle = useMemo<CSSProperties>(
    () => ({
      "--formula-bar-safe-space": `${FORMULA_BAR_SAFE_SPACE}px`,
    }) as CSSProperties,
    [],
  );

  return (
    <div className="page">
      <div className={mode === "source" ? "app-window source-mode" : "app-window"}>
        <header className={mode === "source" ? "app-chrome source-mode" : "app-chrome"}>
          <div className="topbar">
            <div className="brand-lockup">
              <span className="brand-name">Ordinate</span>
            </div>

            <nav className="toolbar-tools" aria-label="Placeholder toolbar">
              {visibleTools.map((item) => (
                <button
                  key={item.label}
                  className="tool-button"
                  type="button"
                  tabIndex={-1}
                  aria-label={item.label}
                  title={item.label}
                >
                  <span className="tool-icon">{item.icon}</span>
                </button>
              ))}
              {overflowTools.length > 0 ? (
                <div className="tool-overflow-control">
                  <button
                    ref={toolButtonRef}
                    className={toolMenuOpen ? "tool-button tool-more-button active" : "tool-button tool-more-button"}
                    type="button"
                    onClick={() => setToolMenuOpen((open) => !open)}
                    aria-label="More tools"
                    title="More tools"
                    aria-haspopup="menu"
                    aria-expanded={toolMenuOpen}
                  >
                    <span className="tool-icon">
                      <MoreIcon />
                    </span>
                  </button>
                </div>
              ) : null}
            </nav>

            <div className="toolbar-actions">
              <div className="theme-control" ref={themeControlRef}>
                <button
                  className={themeMenuOpen ? "tool-button theme-button active" : "tool-button theme-button"}
                  type="button"
                  onClick={() => setThemeMenuOpen((open) => !open)}
                  ref={themeButtonRef}
                  title={themeButtonLabel}
                  aria-label={themeButtonLabel}
                  aria-haspopup="menu"
                  aria-expanded={themeMenuOpen}
                >
                  <span className="tool-icon">{themeButtonIcon}</span>
                </button>
              </div>

              <button
                className={mode === "source" ? "tool-button source-button active" : "tool-button source-button"}
                onClick={mode === "source" ? exitSourceMode : enterSourceMode}
                title={mode === "source" ? "Return to table view" : "Open source mode"}
                aria-label={mode === "source" ? "Return to table view" : "Open source mode"}
              >
                <span className="tool-icon">
                  <CodeIcon />
                </span>
              </button>
            </div>
          </div>

          <div className="sheetbar-shell" aria-hidden={mode === "source"}>
            <div className="sheetbar">
              <button className="sheet-add" type="button" aria-label="Add sheet placeholder" tabIndex={-1}>
                <PlusIcon />
              </button>
              <div className="sheet-tabs" role="tablist" aria-label="Sheets">
                {evaluation?.sheets.map((sheet) => (
                  <button
                    key={sheet.name}
                    className={sheet.name === activeSheet ? "sheet-tab active" : "sheet-tab"}
                    onClick={() => setActiveSheet(sheet.name)}
                    type="button"
                    tabIndex={mode === "source" ? -1 : 0}
                    onMouseEnter={(event) => handleTabMouseEnter(sheet.name, event.currentTarget)}
                    onMouseLeave={() => setTabTooltip(null)}
                    onFocus={(event) => handleTabMouseEnter(sheet.name, event.currentTarget)}
                    onBlur={() => setTabTooltip(null)}
                  >
                    {sheet.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <div className="error" role="alert">
            <strong>Source has parse or evaluation issues.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {mode === "source" ? (
          <section className="source-shell">
            <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} spellCheck={false} />
          </section>
        ) : (
          <section className="workspace-shell">
            {currentSheet ? (
              <div className={tableStageClassName} style={tableStageStyle}>
                <div className="table-corner">
                  <button className="corner-button" type="button" tabIndex={-1} aria-label="Corner placeholder">
                    <span className="corner-dot" />
                  </button>
                </div>

                <div className="column-index-strip">
                  <div
                    ref={columnTrackRef}
                    className="column-index-track"
                    style={{ gridTemplateColumns }}
                    aria-hidden="true"
                  >
                    {Array.from({ length: renderedColumnCount }, (_, index) => (
                      <div key={`column-index-${index + 1}`} className="column-index-cell">
                        {index + 1}
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="row-index-strip"
                  aria-hidden="true"
                  style={rowIndexStripHeight > 0 ? { height: `${rowIndexStripHeight}px` } : undefined}
                >
                  <div className="row-index-spacer" />
                  <div className="row-index-viewport">
                    <div
                      ref={rowTrackRef}
                      className="row-index-track"
                      style={rowIndexTrackHeight > 0 ? { height: `${rowIndexTrackHeight}px` } : undefined}
                    >
                      {rowIndexMetrics.map((row) => (
                        <div
                          key={`row-index-${row.rowPath}`}
                          className="row-index-cell"
                          style={{
                            top: `${row.top}px`,
                            height: `${row.height}px`,
                          }}
                        >
                          {row.number}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid-shell">
                  <div className="grid-wrap" ref={gridWrapRef}>
                    <AgGridReact<GridRow>
                      rowData={rowData}
                      columnDefs={columnDefs}
                      animateRows
                      defaultColDef={{
                        editable: false,
                        sortable: false,
                        filter: false,
                        resizable: false,
                        suppressMovable: true,
                      }}
                      getRowId={(params) => params.data.__rowPath}
                      suppressMovableColumns
                      suppressDragLeaveHidesColumns
                      suppressContextMenu
                      theme={themeQuartz}
                      onGridReady={handleGridReady}
                      onFirstDataRendered={handleFirstDataRendered}
                      onModelUpdated={handleModelUpdated}
                      onCellFocused={handleCellFocused}
                      rowClassRules={{
                        "section-row": (params) => Boolean(params.data?.__isSection),
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <h3>No sheet selected</h3>
                <p>Pick a sheet from the tab strip or return to source mode to inspect the document.</p>
              </div>
            )}
          </section>
        )}
      </div>

      {mode === "table" && formulaBarSnapshot ? (
        <aside
          className={formulaBarData ? "formula-bar-shell is-visible" : "formula-bar-shell is-hiding"}
          aria-live="polite"
          aria-hidden={formulaBarData ? undefined : true}
        >
          <div className="formula-bar">
            <div className="formula-bar-meta">
              <span className="formula-chip fx">=</span>
              <span className="formula-address">{formulaBarSnapshot.primaryAddress}</span>
              <span className="formula-subaddress">{formulaBarSnapshot.secondaryAddress}</span>
              <span className="formula-chip">{formulaBarSnapshot.chip}</span>
              <span className="formula-value-preview">{formulaBarSnapshot.displayText || " "}</span>
            </div>
            <div className="formula-source" title={formulaBarSnapshot.sourceText}>
              {formulaBarSnapshot.sourceText}
            </div>
          </div>
        </aside>
      ) : null}

      {createPortal(
        <div
          className={themeMenuOpen ? "theme-menu open" : "theme-menu"}
          role="menu"
          aria-hidden={!themeMenuOpen}
          style={{ top: `${themeMenuPosition.top}px`, left: `${themeMenuPosition.left}px` }}
        >
          {(
            [
              { mode: "auto", label: "Auto", icon: <AutoIcon /> },
              { mode: "light", label: "Light", icon: <SunIcon /> },
              { mode: "dark", label: "Dark", icon: <MoonIcon /> },
            ] satisfies Array<{ mode: ThemeMode; label: string; icon: ReactNode }>
          ).map((option) => (
            <button
              key={option.mode}
              className={themeMode === option.mode ? "theme-option active" : "theme-option"}
              type="button"
              role="menuitemradio"
              aria-checked={themeMode === option.mode}
              onClick={() => {
                setThemeMode(option.mode);
                setThemeMenuOpen(false);
              }}
            >
              <span className="tool-icon">{option.icon}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {createPortal(
        <div
          className={toolMenuOpen ? "tool-menu open" : "tool-menu"}
          role="menu"
          aria-hidden={!toolMenuOpen}
          style={{ top: `${toolMenuPosition.top}px`, left: `${toolMenuPosition.left}px` }}
        >
          {overflowTools.map((item) => (
            <button key={item.label} className="tool-menu-option" type="button" role="menuitem" tabIndex={toolMenuOpen ? 0 : -1}>
              <span className="tool-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {createPortal(
        <div
          className={tabTooltip ? "tab-tooltip visible" : "tab-tooltip"}
          role="tooltip"
          aria-hidden={!tabTooltip}
          style={{
            top: `${tabTooltip?.top ?? 0}px`,
            left: `${tabTooltip?.left ?? 0}px`,
          }}
        >
          {tabTooltip?.text ?? ""}
        </div>,
        document.body,
      )}
    </div>
  );
}
