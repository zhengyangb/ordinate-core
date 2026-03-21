import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type FirstDataRenderedEvent,
  type GridApi,
  type GridReadyEvent,
  type ModelUpdatedEvent,
} from "ag-grid-community";

import { type RuntimeValue } from "@ordinate/core";
import AppChrome from "./components/AppChrome";
import FormulaBarOverlay from "./components/FormulaBarOverlay";
import OverlayPortals from "./components/OverlayPortals";
import TableStage from "./components/TableStage";
import { AutoIcon, MoonIcon, SunIcon, TOOLBAR_ITEMS } from "./icons/uiIcons";
import { useEditorStore } from "./store/editorStore";
import type {
  ChromeVisibilityPhase,
  FloatingMenuPosition,
  FormulaBarData,
  GridRow,
  HeaderIndexMetric,
  HeaderOverlayCell,
  RowIndexMetric,
  SelectedCell,
  TabTooltip,
  ThemeMenuPosition,
  ThemeMode,
} from "./types/ui";
import {
  compactColLabel,
  isVisiblePath,
  leafLabel,
  runtimeKindLabel,
  runtimeValueToText,
  splitPath,
} from "./utils/sheetView";

import "ag-grid-community/styles/ag-grid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const LABEL_COLUMN_WIDTH = 280;
const HEADER_COLUMN_WIDTH = 168;
const DATA_COLUMN_MIN_WIDTH = 132;
const GRID_HEADER_HEIGHT = 40;
const GRID_ROW_HEIGHT = 38;
const FORMULA_BAR_SAFE_SPACE = 136;
const CHROME_TRANSITION_MS = 260;
const THEME_STORAGE_KEY = "ordinate-theme-mode";
const BLANK_RUNTIME_VALUE: RuntimeValue = { kind: "blank", value: null };

function resolveInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

function toColFieldId(colIndex: number): string {
  return `col_${colIndex}`;
}

function parseColIndexFromField(colId: string): number {
  if (!colId.startsWith("col_")) return -1;
  const parsed = Number(colId.slice(4));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : -1;
}

function resolveHeaderColId(target: HTMLElement | null, colCount: number, colIndexLookup: Map<string, number>): string | null {
  if (!target) return null;

  const headerCell = target.closest<HTMLElement>(".ag-header-cell[col-id], .ag-header-group-cell[col-id]");
  const rawColId = headerCell?.getAttribute("col-id");
  if (rawColId && colIndexLookup.has(rawColId)) {
    return rawColId;
  }

  const ariaColIndex = Number(headerCell?.getAttribute("aria-colindex"));
  if (Number.isFinite(ariaColIndex)) {
    const zeroBased = ariaColIndex - 1;
    if (zeroBased >= 0 && zeroBased < colCount) {
      return toColFieldId(zeroBased);
    }
  }

  return null;
}

function resolveLeafHeaderColIdByClientX(
  root: HTMLElement,
  clientX: number,
  colIndexLookup: Map<string, number>,
): string | null {
  const headerCells = Array.from(root.querySelectorAll<HTMLElement>(".ag-header-cell[col-id]"));
  for (const cell of headerCells) {
    const colId = cell.getAttribute("col-id");
    if (!colId || !colIndexLookup.has(colId)) continue;
    const rect = cell.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) {
      return colId;
    }
  }
  return null;
}

function overlayCellsEqual(previous: HeaderOverlayCell[], next: HeaderOverlayCell[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const a = previous[index];
    const b = next[index];
    if (a.key !== b.key) return false;
    if (a.rowNumber !== b.rowNumber || a.label !== b.label) return false;
    if (Math.abs(a.left - b.left) > 0.5) return false;
    if (Math.abs(a.width - b.width) > 0.5) return false;
  }
  return true;
}

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
  const [headerOverlayCells, setHeaderOverlayCells] = useState<HeaderOverlayCell[]>([]);

  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const columnTrackRef = useRef<HTMLDivElement | null>(null);
  const rowTrackRef = useRef<HTMLDivElement | null>(null);
  const gridApiRef = useRef<GridApi<GridRow> | null>(null);
  const themeControlRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolButtonRef = useRef<HTMLButtonElement | null>(null);

  const currentSheet = useMemo(() => {
    if (!evaluation || !activeSheet) return null;
    return evaluation.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [evaluation, activeSheet]);

  const currentSheetState = useMemo(() => {
    if (!docState || !activeSheet) return null;
    return docState.sheets.find((sheet) => sheet.name === activeSheet) ?? null;
  }, [docState, activeSheet]);

  const sheetColCount = currentSheetState?.colCount ?? 0;
  const headerRowCount = currentSheetState?.headerRowCount ?? 0;
  const headerColCount = Math.min(currentSheetState?.headerColCount ?? 0, sheetColCount);
  const headerOverlayRows = Math.max(0, headerRowCount - 1);
  const headerOverlayHeight = headerOverlayRows * GRID_HEADER_HEIGHT;

  const headerMatrix = useMemo(() => {
    if (!currentSheetState || sheetColCount === 0) return [] as string[][];

    const matrixDepth = Math.max(1, headerRowCount);
    return Array.from({ length: matrixDepth }, (_, rowIndex) => {
      const sourceRow = rowIndex < headerRowCount ? currentSheetState.cells[rowIndex] : null;
      return Array.from({ length: sheetColCount }, (_, colIndex) => {
        const raw = sourceRow?.[colIndex]?.text?.trim() ?? "";
        if (raw.length > 0) return raw;
        if (rowIndex === matrixDepth - 1) {
          return currentSheetState.colLabels[colIndex] ?? currentSheet?.colLabels[colIndex] ?? `C${colIndex + 1}`;
        }
        return "";
      });
    });
  }, [currentSheetState, currentSheet, sheetColCount, headerRowCount]);

  const headerLeafLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    const leafRow = headerMatrix[headerMatrix.length - 1] ?? [];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const label = leafRow[colIndex] ?? currentSheetState?.colLabels[colIndex] ?? `C${colIndex + 1}`;
      return compactColLabel(label);
    });
  }, [headerMatrix, currentSheetState, sheetColCount]);

  const headerSemanticLabels = useMemo(() => {
    if (sheetColCount === 0) return [] as string[];
    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const fromLabels = currentSheetState?.colLabels[colIndex];
      if (fromLabels && fromLabels.length > 0) return fromLabels;
      return headerLeafLabels[colIndex] ?? `C${colIndex + 1}`;
    });
  }, [currentSheetState, headerLeafLabels, sheetColCount]);

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
    if (mode === "source") {
      setFormulaBarSnapshot(null);
    }
  }, [mode]);

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

  const handleTabMouseEnter = useCallback((sheetName: string, target: HTMLButtonElement) => {
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
  }, []);

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
        number: rowNode.data.__absoluteRowNumber,
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

  const rowData: GridRow[] = useMemo(() => {
    if (!currentSheet || !currentSheetState) return [];

    return currentSheet.values
      .map((row, rowIndex) => {
        const rowPath = currentSheet.rowPaths[rowIndex] ?? `R${rowIndex + 1}`;
        const depth = Math.max(0, splitPath(rowPath).length - 1);
        const hasChildren = currentSheet.rowPaths.some(
          (candidate) => candidate !== rowPath && candidate.startsWith(`${rowPath}.`),
        );
        const absoluteRowNumber = currentSheetState.bodyStart + rowIndex + 1;
        const rowLeaf = leafLabel(rowPath);

        const item: GridRow = {
          __rowPath: rowPath,
          __absoluteRowNumber: absoluteRowNumber,
          __depth: depth,
          __hasChildren: hasChildren,
          __isSection: hasChildren,
          __collapsed: collapsedPaths.has(rowPath),
          __displayLabel: rowLeaf,
        };

        for (let colIndex = 0; colIndex < sheetColCount; colIndex += 1) {
          const field = toColFieldId(colIndex);
          const rawCell = currentSheetState.cells[currentSheetState.bodyStart + rowIndex]?.[colIndex];
          const runtimeValue = row[colIndex] as RuntimeValue | undefined;

          if (colIndex < headerColCount) {
            if (colIndex === 0) {
              item[field] = rowLeaf;
              item[`__kind_${colIndex}`] = "label";
            } else {
              const headerValue = rawCell?.text ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);
              item[field] = headerValue;
              item[`__kind_${colIndex}`] = headerValue.length > 0 ? "string" : "blank";
            }
          } else {
            item[field] = runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);
            item[`__kind_${colIndex}`] = runtimeValue?.kind ?? "blank";
          }
        }

        return item;
      })
      .filter((row) => isVisiblePath(row.__rowPath, collapsedPaths));
  }, [currentSheet, currentSheetState, collapsedPaths, sheetColCount, headerColCount]);

  const rowIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    rowData.forEach((row) => map.set(row.__rowPath, row.__absoluteRowNumber));
    return map;
  }, [rowData]);

  useEffect(() => {
    if (mode === "source") return;
    syncRowIndexMetrics(gridApiRef.current);
  }, [mode, rowData, syncRowIndexMetrics]);

  const colIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (let colIndex = 0; colIndex < sheetColCount; colIndex += 1) {
      map.set(toColFieldId(colIndex), colIndex + 1);
    }
    return map;
  }, [sheetColCount]);

  const syncHeaderOverlayCells = useCallback(
    (root: HTMLElement | null) => {
      if (!root || mode === "source" || headerOverlayRows === 0 || sheetColCount === 0) {
        setHeaderOverlayCells((current) => (current.length === 0 ? current : []));
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const leafCells = Array.from(root.querySelectorAll<HTMLElement>(".ag-header-cell[col-id]"))
        .map((cell) => {
          const colId = cell.getAttribute("col-id");
          if (!colId) return null;
          const colNumber = colIndexLookup.get(colId);
          if (!colNumber) return null;
          const rect = cell.getBoundingClientRect();
          return {
            colId,
            colIndex: colNumber - 1,
            left: rect.left - rootRect.left,
            right: rect.right - rootRect.left,
          };
        })
        .filter((cell): cell is { colId: string; colIndex: number; left: number; right: number } => cell !== null)
        .sort((a, b) => a.left - b.left);

      if (leafCells.length === 0) {
        setHeaderOverlayCells((current) => (current.length === 0 ? current : []));
        return;
      }

      const nextCells: HeaderOverlayCell[] = [];

      for (let rowOffset = 0; rowOffset < headerOverlayRows; rowOffset += 1) {
        let cursor = 0;
        while (cursor < leafCells.length) {
          const start = leafCells[cursor];
          const label = headerMatrix[rowOffset]?.[start.colIndex] ?? "";
          let end = cursor;
          while (end + 1 < leafCells.length) {
            const current = leafCells[end];
            const candidate = leafCells[end + 1];
            if (candidate.colIndex !== current.colIndex + 1) break;
            const candidateLabel = headerMatrix[rowOffset]?.[candidate.colIndex] ?? "";
            if (candidateLabel !== label) break;
            end += 1;
          }

          const left = start.left;
          const width = Math.max(0, leafCells[end].right - left);
          if (width > 0.5) {
            const startCol = start.colIndex + 1;
            const endCol = leafCells[end].colIndex + 1;
            const rowNumber = rowOffset + 1;
            nextCells.push({
              key: `r${rowNumber}-c${startCol}-${endCol}`,
              rowNumber,
              label,
              left,
              width,
              top: rowOffset * GRID_HEADER_HEIGHT,
              height: GRID_HEADER_HEIGHT,
            });
          }

          cursor = end + 1;
        }
      }

      setHeaderOverlayCells((current) => (overlayCellsEqual(current, nextCells) ? current : nextCells));
    },
    [mode, headerOverlayRows, sheetColCount, colIndexLookup, headerMatrix],
  );

  const renderedColumnCount = sheetColCount;

  const gridTemplateColumns = useMemo(() => {
    if (sheetColCount === 0) return "";
    const tracks = Array.from({ length: sheetColCount }, (_, colIndex) => {
      if (colIndex < headerColCount) {
        return colIndex === 0 ? `${LABEL_COLUMN_WIDTH}px` : `${HEADER_COLUMN_WIDTH}px`;
      }
      return `minmax(${DATA_COLUMN_MIN_WIDTH}px, 1fr)`;
    });
    return tracks.join(" ");
  }, [sheetColCount, headerColCount]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(() => {
    if (!currentSheet || !currentSheetState || sheetColCount === 0) return [];

    return Array.from({ length: sheetColCount }, (_, colIndex) => {
      const field = toColFieldId(colIndex);
      const isHeaderColumn = colIndex < headerColCount;
      const leafHeader = headerLeafLabels[colIndex] ?? `C${colIndex + 1}`;
      const semanticLabel = headerSemanticLabels[colIndex] ?? leafHeader;

      const baseDef: ColDef<GridRow> = {
        colId: field,
        field,
        headerName: leafHeader,
        headerTooltip: semanticLabel,
        suppressMovable: true,
      };

      if (isHeaderColumn) {
        const withHeader: ColDef<GridRow> = {
          ...baseDef,
          pinned: "left",
          width: colIndex === 0 ? LABEL_COLUMN_WIDTH : HEADER_COLUMN_WIDTH,
          minWidth: colIndex === 0 ? LABEL_COLUMN_WIDTH : HEADER_COLUMN_WIDTH,
          headerClass: "line-item-header",
          cellClass: colIndex === 0 ? "line-item-cell" : "header-column-cell",
        };

        if (colIndex === 0) {
          withHeader.cellRenderer = (params: { data?: GridRow }) => {
            const data = params.data;
            if (!data) return null;

            const showToggle = data.__hasChildren;
            const showSpacer = !showToggle && data.__depth > 0;
            const paddingLeft = Math.max(0, data.__depth - 1) * 12;
            const isCollapsed = data.__collapsed;
            const leadingSlot = showToggle ? (
              <button
                className={isCollapsed ? "tree-toggle is-collapsed" : "tree-toggle"}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
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
                <span className={data.__hasChildren ? "tree-label section" : "tree-label"}>
                  {String(data.__displayLabel ?? data.__rowPath)}
                </span>
              </div>
            );
          };
        }

        return withHeader;
      }

      return {
        ...baseDef,
        minWidth: DATA_COLUMN_MIN_WIDTH,
        flex: 1,
        headerClass: "data-column-header",
        cellClass: (params: { data?: GridRow }) => {
          const kind = params.data?.[`__kind_${colIndex}`];
          const classes = ["data-cell"];
          if (kind === "number") classes.push("is-numeric");
          if (kind === "error") classes.push("is-error");
          if (kind === "blank") classes.push("is-blank");
          return classes.join(" ");
        },
      } satisfies ColDef<GridRow>;
    });
  }, [
    currentSheet,
    currentSheetState,
    sheetColCount,
    headerColCount,
    headerLeafLabels,
    headerSemanticLabels,
    toggleCollapse,
  ]);

  const headerIndexMetrics = useMemo<HeaderIndexMetric[]>(() => {
    return Array.from({ length: headerRowCount }, (_, index) => ({
      number: index + 1,
      top: index * GRID_HEADER_HEIGHT,
      height: GRID_HEADER_HEIGHT,
    }));
  }, [headerRowCount]);

  const headerIndexTrackHeight = headerRowCount * GRID_HEADER_HEIGHT;

  const handleHeaderOverlaySelect = useCallback(
    (clientX: number, rowNumber: number) => {
      const root = gridWrapRef.current;
      if (!root) return;

      const colId = resolveLeafHeaderColIdByClientX(root, clientX, colIndexLookup);
      if (!colId) return;

      const maxHeaderRow = Math.max(1, headerRowCount);
      const clampedRowNumber = Math.max(1, Math.min(rowNumber, maxHeaderRow));
      setSelectedCell({
        kind: "header",
        colId,
        headerRowNumber: clampedRowNumber,
      });

      const matchingLeafCell = Array.from(root.querySelectorAll<HTMLElement>(".ag-header-cell[col-id]")).find(
        (cell) => cell.getAttribute("col-id") === colId,
      );
      if (matchingLeafCell) {
        matchingLeafCell.tabIndex = 0;
        requestAnimationFrame(() => matchingLeafCell.focus());
      }
    },
    [colIndexLookup, headerRowCount],
  );

  useEffect(() => {
    const root = gridWrapRef.current;
    if (!root || mode === "source") return;

    const leafHeaderRowNumber = Math.max(1, headerRowCount);

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const headerCell = target?.closest<HTMLElement>(".ag-header-cell, .ag-header-group-cell");
      if (!headerCell) return;

      const colId =
        resolveLeafHeaderColIdByClientX(root, event.clientX, colIndexLookup) ??
        resolveHeaderColId(target, sheetColCount, colIndexLookup);
      if (!colId) return;

      setSelectedCell({
        kind: "header",
        colId,
        headerRowNumber: leafHeaderRowNumber,
      });

      headerCell.tabIndex = 0;
      requestAnimationFrame(() => headerCell.focus());
    };

    root.addEventListener("mousedown", handlePointerDown);
    return () => root.removeEventListener("mousedown", handlePointerDown);
  }, [mode, headerRowCount, sheetColCount, colIndexLookup]);

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

    let rafId: number | null = null;
    const applyScrollSync = () => {
      rafId = null;
      const top = verticalViewport?.scrollTop ?? 0;
      const left = horizontalViewport?.scrollLeft ?? 0;
      rowTrack.style.transform = `translateY(${-top}px)`;
      columnTrack.style.transform = `translateX(${-left}px)`;
      syncHeaderOverlayCells(root);
      const nextVertical = top > 0.5;
      const nextHorizontal = left > 0.5;
      setHasVerticalOverlap((current) => (current === nextVertical ? current : nextVertical));
      setHasHorizontalOverlap((current) => (current === nextHorizontal ? current : nextHorizontal));
    };

    const scheduleScrollSync = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(applyScrollSync);
    };

    scheduleScrollSync();
    verticalViewport?.addEventListener("scroll", scheduleScrollSync, { passive: true });
    horizontalViewport?.addEventListener("scroll", scheduleScrollSync, { passive: true });
    window.addEventListener("resize", scheduleScrollSync, { passive: true });

    return () => {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
      verticalViewport?.removeEventListener("scroll", scheduleScrollSync);
      horizontalViewport?.removeEventListener("scroll", scheduleScrollSync);
      window.removeEventListener("resize", scheduleScrollSync);
    };
  }, [mode, activeSheet, rowData.length, renderedColumnCount, syncHeaderOverlayCells]);

  const handleCellFocused = useCallback(
    (event: { rowIndex: number | null; column?: string | { getColId(): string } | null }) => {
      if (!event.column) {
        setSelectedCell(null);
        return;
      }

      const rawColId = typeof event.column === "string" ? event.column : event.column.getColId();
      if (!colIndexLookup.has(rawColId)) {
        return;
      }

      if (event.rowIndex == null) {
        setSelectedCell({
          kind: "header",
          colId: rawColId,
          headerRowNumber: Math.max(1, headerRowCount),
        });
        return;
      }

      const row = rowData[event.rowIndex];
      if (!row) {
        setSelectedCell(null);
        return;
      }

      setSelectedCell({
        kind: "body",
        rowPath: row.__rowPath,
        colId: rawColId,
        absoluteRowNumber: row.__absoluteRowNumber,
      });
    },
    [rowData, colIndexLookup, headerRowCount],
  );

  const formulaBarData = useMemo<FormulaBarData | null>(() => {
    if (!currentSheet || !currentSheetState || !selectedCell) return null;

    const colNumber = colIndexLookup.get(selectedCell.colId);
    if (!colNumber) return null;

    const colIndex = parseColIndexFromField(selectedCell.colId);
    if (colIndex < 0 || colIndex >= sheetColCount) return null;

    const semanticColLabel = headerSemanticLabels[colIndex] ?? `C${colIndex + 1}`;

    if (selectedCell.kind === "header") {
      const maxHeaderRow = Math.max(1, headerRowCount);
      const headerRowNumber = Math.max(1, Math.min(selectedCell.headerRowNumber, maxHeaderRow));
      const headerAbsIndex = headerRowNumber - 1;
      const sourceFromSheet = headerRowCount > 0 ? currentSheetState.cells[headerAbsIndex]?.[colIndex]?.text ?? "" : "";
      const displayText =
        headerMatrix[headerRowNumber - 1]?.[colIndex] ??
        sourceFromSheet ??
        semanticColLabel;
      const sourceText = sourceFromSheet.length > 0 ? sourceFromSheet : displayText;

      return {
        primaryAddress: `Col ${colNumber} · Row ${headerRowNumber}`,
        secondaryAddress: `${semanticColLabel} / Header`,
        chip: "Header",
        displayText: displayText.length > 0 ? displayText : "(blank)",
        sourceText: sourceText.length > 0 ? sourceText : "(blank)",
      };
    }

    const rowRel = currentSheet.rowPaths.indexOf(selectedCell.rowPath);
    if (rowRel < 0) return null;

    const rowLeaf = leafLabel(selectedCell.rowPath);
    const rowNumber = rowIndexLookup.get(selectedCell.rowPath) ?? selectedCell.absoluteRowNumber;
    const absoluteRowIndex = currentSheetState.bodyStart + rowRel;

    if (colIndex < headerColCount) {
      const sourceText = currentSheetState.cells[absoluteRowIndex]?.[colIndex]?.text ?? "";
      const displayText = colIndex === 0 ? rowLeaf : sourceText;
      return {
        primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
        secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
        chip: colIndex === 0 ? "Label" : "Header Col",
        displayText: displayText.length > 0 ? displayText : "(blank)",
        sourceText: sourceText.length > 0 ? sourceText : displayText.length > 0 ? displayText : "(blank)",
      };
    }

    const runtimeValue = currentSheet.values[rowRel]?.[colIndex] as RuntimeValue | undefined;
    const rawCell = currentSheetState.cells[absoluteRowIndex]?.[colIndex];
    const sourceText = rawCell?.text ?? runtimeValueToText(runtimeValue ?? BLANK_RUNTIME_VALUE);
    const chip = rawCell?.parsed.kind === "formula" ? "Formula" : runtimeKindLabel(runtimeValue);

    return {
      primaryAddress: `Col ${colNumber} · Row ${rowNumber}`,
      secondaryAddress: `${semanticColLabel} / ${rowLeaf}`,
      chip,
      displayText: runtimeValue ? runtimeValueToText(runtimeValue) : "",
      sourceText: sourceText.length > 0 ? sourceText : "(blank)",
    };
  }, [
    currentSheet,
    currentSheetState,
    selectedCell,
    colIndexLookup,
    sheetColCount,
    headerSemanticLabels,
    headerMatrix,
    headerRowCount,
    rowIndexLookup,
    headerColCount,
  ]);

  useEffect(() => {
    if (formulaBarData) {
      setFormulaBarSnapshot(formulaBarData);
      return;
    }

    const timeout = window.setTimeout(() => setFormulaBarSnapshot(null), CHROME_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [formulaBarData]);

  const chromeVisibilityPhase: ChromeVisibilityPhase =
    mode === "table" ? (formulaBarData ? "visible" : formulaBarSnapshot ? "hiding" : "hidden") : "hidden";

  const themeButtonLabel = themeMode === "auto" ? "Automatic appearance" : themeMode === "light" ? "Light mode" : "Dark mode";
  const themeButtonIcon = themeMode === "auto" ? <AutoIcon /> : themeMode === "light" ? <SunIcon /> : <MoonIcon />;

  const visibleToolCount = viewportWidth < 720 ? 3 : viewportWidth < 860 ? 4 : viewportWidth < 1040 ? 5 : TOOLBAR_ITEMS.length;
  const visibleTools = TOOLBAR_ITEMS.slice(0, visibleToolCount);
  const overflowTools = TOOLBAR_ITEMS.slice(visibleToolCount);

  const tableStageClassName = [
    "table-stage",
    `index-rails-${chromeVisibilityPhase}`,
    hasVerticalOverlap ? "has-scroll-y" : "",
    hasHorizontalOverlap ? "has-scroll-x" : "",
  ]
    .join(" ")
    .trim();

  const tableStageStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--formula-bar-safe-space": `${FORMULA_BAR_SAFE_SPACE}px`,
        "--header-overlay-height": `${headerOverlayHeight}px`,
      }) as CSSProperties,
    [headerOverlayHeight],
  );

  return (
    <div className="page">
      <div className={mode === "source" ? "app-window source-mode" : "app-window"}>
        <AppChrome
          mode={mode}
          activeSheet={activeSheet}
          sheetNames={evaluation?.sheets.map((sheet) => sheet.name) ?? []}
          setActiveSheet={setActiveSheet}
          visibleTools={visibleTools}
          overflowTools={overflowTools}
          toolMenuOpen={toolMenuOpen}
          setToolMenuOpen={setToolMenuOpen}
          themeMenuOpen={themeMenuOpen}
          setThemeMenuOpen={setThemeMenuOpen}
          themeButtonLabel={themeButtonLabel}
          themeButtonIcon={themeButtonIcon}
          themeControlRef={themeControlRef}
          themeButtonRef={themeButtonRef}
          toolButtonRef={toolButtonRef}
          onEnterSourceMode={enterSourceMode}
          onExitSourceMode={exitSourceMode}
          onTabMouseEnter={handleTabMouseEnter}
          onTabMouseLeave={() => setTabTooltip(null)}
        />

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
              <TableStage
                tableStageClassName={tableStageClassName}
                tableStageStyle={tableStageStyle}
                gridTemplateColumns={gridTemplateColumns}
                renderedColumnCount={renderedColumnCount}
                headerIndexMetrics={headerIndexMetrics}
                headerIndexTrackHeight={headerIndexTrackHeight}
                headerOverlayHeight={headerOverlayHeight}
                headerOverlayCells={headerOverlayCells}
                rowIndexTrackHeight={rowIndexTrackHeight}
                indexRailsPhase={chromeVisibilityPhase}
                rowIndexMetrics={rowIndexMetrics}
                columnTrackRef={columnTrackRef}
                rowTrackRef={rowTrackRef}
                gridWrapRef={gridWrapRef}
                rowData={rowData}
                columnDefs={columnDefs}
                handleHeaderOverlaySelect={handleHeaderOverlaySelect}
                handleGridReady={handleGridReady}
                handleFirstDataRendered={handleFirstDataRendered}
                handleModelUpdated={handleModelUpdated}
                handleCellFocused={handleCellFocused}
              />
            ) : (
              <div className="empty-state">
                <h3>No sheet selected</h3>
                <p>Pick a sheet from the tab strip or return to source mode to inspect the document.</p>
              </div>
            )}
          </section>
        )}
      </div>

      <FormulaBarOverlay
        mode={mode}
        phase={chromeVisibilityPhase}
        formulaBarData={formulaBarData}
        formulaBarSnapshot={formulaBarSnapshot}
      />

      <OverlayPortals
        themeMenuOpen={themeMenuOpen}
        themeMenuPosition={themeMenuPosition}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        setThemeMenuOpen={setThemeMenuOpen}
        toolMenuOpen={toolMenuOpen}
        toolMenuPosition={toolMenuPosition}
        overflowTools={overflowTools}
        tabTooltip={tabTooltip}
      />
    </div>
  );
}
