import type { GridApi } from "ag-grid-community";

import type { ColumnMetric, GridRow, HeaderOverlayHitResult, RowIndexMetric } from "../types/ui";
import type { GridScrollSnapshot } from "../utils/gridGeometry";

export type LeafHeaderCellMetric = {
  colId: string;
  colIndex: number;
  left: number;
  right: number;
};

export type RowMetricsSnapshot = {
  metrics: RowIndexMetric[];
  trackHeight: number;
};

export type GridViewportAdapter = {
  collectRowMetrics(api: GridApi<GridRow> | null, rowHeightFallback: number): RowMetricsSnapshot;
  collectColumnMetrics(
    root: HTMLElement | null,
    api: GridApi<GridRow> | null,
    colIndexLookup: Map<string, number>,
    expectedColCount: number,
  ): ColumnMetric[];
  readLeafHeaderCells(root: HTMLElement, colIndexLookup: Map<string, number>): LeafHeaderCellMetric[];
  resolveLeafHeaderColIdAtClientX(root: HTMLElement, clientX: number, colIndexLookup: Map<string, number>): string | null;
  resolveHeaderColIdFromTarget(target: HTMLElement | null, colCount: number, colIndexLookup: Map<string, number>): string | null;
  resolveHeaderOverlayHit(
    root: HTMLElement,
    clientX: number,
    rowNumber: number,
    headerRowCount: number,
    colIndexLookup: Map<string, number>,
  ): HeaderOverlayHitResult | null;
  focusLeafHeaderCell(root: HTMLElement, colId: string): void;
  scrollHorizontalViewport(root: HTMLElement, deltaLeft: number): boolean;
  attachViewportSync(
    root: HTMLElement,
    onFrame: (snapshot: GridScrollSnapshot) => void,
    onScroll?: (position: Pick<GridScrollSnapshot, "top" | "left">) => void,
  ): () => void;
};

function toColFieldId(colIndex: number): string {
  return `col_${colIndex}`;
}

function queryVerticalViewport(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".ag-body-viewport.ag-layout-normal") ??
    root.querySelector<HTMLElement>(".ag-body-viewport")
  );
}

function queryHorizontalViewport(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(".ag-body-horizontal-scroll-viewport") ??
    root.querySelector<HTMLElement>(".ag-center-cols-viewport")
  );
}

export function createAgGridAdapter(): GridViewportAdapter {
  return {
    collectRowMetrics(api, rowHeightFallback) {
      if (!api) {
        return { metrics: [], trackHeight: 0 };
      }

      const metrics: RowIndexMetric[] = [];
      let maxBottom = 0;

      for (let index = 0; index < api.getDisplayedRowCount(); index += 1) {
        const rowNode = api.getDisplayedRowAtIndex(index);
        if (!rowNode?.data) continue;

        const top = rowNode.rowTop ?? index * rowHeightFallback;
        const height = rowNode.rowHeight ?? rowHeightFallback;
        maxBottom = Math.max(maxBottom, top + height);

        metrics.push({
          rowKey: rowNode.data.__rowKey,
          number: rowNode.data.__absoluteRowNumber,
          top,
          height,
        });
      }

      return {
        metrics,
        trackHeight: maxBottom,
      };
    },

    collectColumnMetrics(root, api, colIndexLookup, expectedColCount) {
      if (!api) return [];
      const columns = api.getAllDisplayedColumns();
      const metricColumns = columns;
      if (metricColumns.length === 0) return [];
      if (metricColumns.length !== expectedColCount) {
        throw new Error(`displayed column count mismatch: expected ${expectedColCount}, got ${metricColumns.length}`);
      }

      const toPinnedZone = (pinned: ReturnType<(typeof columns)[number]["getPinned"]>) => {
        if (pinned === "left" || pinned === true) return "left" as const;
        if (pinned === "right") return "right" as const;
        return "center" as const;
      };

      const leftPinnedWidth = columns
        .filter((column) => toPinnedZone(column.getPinned()) === "left")
        .reduce((sum, column) => sum + column.getActualWidth(), 0);
      const centerWidth = columns
        .filter((column) => toPinnedZone(column.getPinned()) === "center")
        .reduce((sum, column) => sum + column.getActualWidth(), 0);

      const baseMetrics = metricColumns.map((column) => {
        const colId = column.getColId();
        const colNumber = colIndexLookup.get(colId);
        if (!colNumber) {
          throw new Error(`unknown column id in displayed columns: ${colId}`);
        }
        const left = column.getLeft();
        if (left == null) {
          throw new Error(`missing left position for column ${colId}`);
        }
        const width = column.getActualWidth();
        if (!(width > 0)) {
          throw new Error(`invalid width for column ${colId}: ${width}`);
        }
        const zone = toPinnedZone(column.getPinned());
        const globalLeft =
          zone === "left"
            ? left
            : zone === "center"
              ? leftPinnedWidth + left
              : leftPinnedWidth + centerWidth + left;
        return {
          colIndex: colNumber - 1,
          left: globalLeft,
          width,
        };
      });

      return baseMetrics.sort((a, b) => a.colIndex - b.colIndex);
    },

    readLeafHeaderCells(root, colIndexLookup) {
      const rootRect = root.getBoundingClientRect();
      const allHeaderCells = Array.from(root.querySelectorAll<HTMLElement>(".ag-header-cell[col-id]"));
      let leafRowIndex = Number.NEGATIVE_INFINITY;
      for (const cell of allHeaderCells) {
        const rowIndex = Number(cell.getAttribute("aria-rowindex"));
        if (Number.isFinite(rowIndex)) {
          leafRowIndex = Math.max(leafRowIndex, rowIndex);
        }
      }

      const candidates =
        Number.isFinite(leafRowIndex) && leafRowIndex > 0
          ? allHeaderCells.filter((cell) => Number(cell.getAttribute("aria-rowindex")) === leafRowIndex)
          : allHeaderCells;

      const byCol = new Map<string, { metric: LeafHeaderCellMetric; width: number }>();
      for (const cell of candidates) {
        const colId = cell.getAttribute("col-id");
        if (!colId) continue;
        const colNumber = colIndexLookup.get(colId);
        if (!colNumber) continue;

        const rect = cell.getBoundingClientRect();
        const metric: LeafHeaderCellMetric = {
          colId,
          colIndex: colNumber - 1,
          left: rect.left - rootRect.left,
          right: rect.right - rootRect.left,
        };
        const width = Math.max(0, rect.width);
        const current = byCol.get(colId);
        if (!current || width > current.width + 0.5) {
          byCol.set(colId, { metric, width });
        }
      }

      return Array.from(byCol.values())
        .map((entry) => entry.metric)
        .sort((a, b) => a.colIndex - b.colIndex);
    },

    resolveLeafHeaderColIdAtClientX(root, clientX, colIndexLookup) {
      const rootRect = root.getBoundingClientRect();
      const localX = clientX - rootRect.left;
      const cells = this.readLeafHeaderCells(root, colIndexLookup);
      for (const cell of cells) {
        if (localX >= cell.left && localX <= cell.right) {
          return cell.colId;
        }
      }
      return null;
    },

    resolveHeaderColIdFromTarget(target, colCount, colIndexLookup) {
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
    },

    resolveHeaderOverlayHit(root, clientX, rowNumber, headerRowCount, colIndexLookup) {
      const colId = this.resolveLeafHeaderColIdAtClientX(root, clientX, colIndexLookup);
      if (!colId) return null;

      const colNumber = colIndexLookup.get(colId);
      if (!colNumber) return null;

      const maxHeaderRow = Math.max(1, headerRowCount);
      const clampedRowNumber = Math.max(1, Math.min(rowNumber, maxHeaderRow));
      return {
        logical: {
          rAbs: clampedRowNumber,
          cAbs: colNumber - 1,
        },
        colId,
        headerRowNumber: clampedRowNumber,
      };
    },

    focusLeafHeaderCell(root, colId) {
      let matchingLeafCell: HTMLElement | null = null;
      let bestTop = Number.NEGATIVE_INFINITY;
      const cells = Array.from(root.querySelectorAll<HTMLElement>(".ag-header-cell[col-id]"));
      for (const cell of cells) {
        if (cell.getAttribute("col-id") !== colId) continue;
        const rect = cell.getBoundingClientRect();
        if (rect.top > bestTop) {
          bestTop = rect.top;
          matchingLeafCell = cell;
        }
      }
      if (!matchingLeafCell) return;
      const cellToFocus = matchingLeafCell;
      cellToFocus.tabIndex = 0;
      requestAnimationFrame(() => cellToFocus.focus());
    },

    scrollHorizontalViewport(root, deltaLeft) {
      if (!Number.isFinite(deltaLeft)) {
        throw new Error("horizontal scroll delta must be finite");
      }
      if (Math.abs(deltaLeft) <= 0.5) return false;

      const horizontalViewport = queryHorizontalViewport(root);
      if (!horizontalViewport) {
        throw new Error("horizontal grid viewport is required");
      }

      const maxScrollLeft = Math.max(0, horizontalViewport.scrollWidth - horizontalViewport.clientWidth);
      const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, horizontalViewport.scrollLeft + deltaLeft));
      if (Math.abs(nextScrollLeft - horizontalViewport.scrollLeft) <= 0.5) return false;
      horizontalViewport.scrollLeft = nextScrollLeft;
      return true;
    },

    attachViewportSync(root, onFrame, onScroll) {
      if (typeof ResizeObserver === "undefined") {
        throw new Error("ResizeObserver is required for grid viewport sync");
      }
      if (typeof MutationObserver === "undefined") {
        throw new Error("MutationObserver is required for grid viewport sync");
      }
      let verticalViewport: HTMLElement | null = null;
      let horizontalViewport: HTMLElement | null = null;
      let rafId: number | null = null;

      const apply = () => {
        rafId = null;
        bindViewports();
        const top = verticalViewport?.scrollTop ?? 0;
        const left = horizontalViewport?.scrollLeft ?? 0;
        const centerViewportWidth = horizontalViewport?.clientWidth ?? 0;
        const bodyViewportHeight = verticalViewport?.clientHeight ?? 0;
        onFrame({
          top,
          left,
          centerViewportWidth,
          bodyViewportHeight,
          hasVerticalOverlap: top > 0.5,
          hasHorizontalOverlap: left > 0.5,
        });
      };

      const schedule = () => {
        if (rafId != null) return;
        rafId = window.requestAnimationFrame(apply);
      };

      const handleViewportScroll = () => {
        onScroll?.({
          top: verticalViewport?.scrollTop ?? 0,
          left: horizontalViewport?.scrollLeft ?? 0,
        });
        schedule();
      };

      const resizeObserver = new ResizeObserver(schedule);
      const bindViewports = () => {
        const nextVerticalViewport = queryVerticalViewport(root);
        const nextHorizontalViewport = queryHorizontalViewport(root);
        if (verticalViewport !== nextVerticalViewport) {
          verticalViewport?.removeEventListener("scroll", handleViewportScroll);
          if (verticalViewport) resizeObserver.unobserve(verticalViewport);
          verticalViewport = nextVerticalViewport;
          verticalViewport?.addEventListener("scroll", handleViewportScroll, { passive: true });
          if (verticalViewport) resizeObserver.observe(verticalViewport);
        }
        if (horizontalViewport !== nextHorizontalViewport) {
          horizontalViewport?.removeEventListener("scroll", handleViewportScroll);
          if (horizontalViewport) resizeObserver.unobserve(horizontalViewport);
          horizontalViewport = nextHorizontalViewport;
          horizontalViewport?.addEventListener("scroll", handleViewportScroll, { passive: true });
          if (horizontalViewport) resizeObserver.observe(horizontalViewport);
        }
      };

      schedule();
      window.addEventListener("resize", schedule, { passive: true });
      resizeObserver.observe(root);
      const mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(root, { childList: true, subtree: true });

      return () => {
        if (rafId != null) {
          window.cancelAnimationFrame(rafId);
        }
        verticalViewport?.removeEventListener("scroll", handleViewportScroll);
        horizontalViewport?.removeEventListener("scroll", handleViewportScroll);
        window.removeEventListener("resize", schedule);
        resizeObserver.disconnect();
        mutationObserver.disconnect();
      };
    },
  };
}
