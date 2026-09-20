import type { ColDef } from "ag-grid-community";
import { useMemo } from "react";
import BooleanCellCapsule from "../components/BooleanCellCapsule";
import ErrorCellChip from "../components/ErrorCellChip";
import { SearchText } from "../search/SheetSearch";
import type { UiLocale } from "../i18n/messages";
import type { AxisDragPreview, GridRow } from "../types/ui";
import { toColFieldId } from "../utils/appHelpers";
import { gridCellText } from "../utils/gridCellText";
import type { ColumnAxisSelection } from "../utils/axisRailDrag";
import type { useSheetViewModel } from "./useSheetViewModel";
import type { useTooltips } from "./useTooltips";

type Options = Pick<ReturnType<typeof useSheetViewModel>, "currentSheet" | "currentSheetState" | "sheetColCount" | "headerColCount" | "headerRowCount" | "columnLayouts" | "headerLeafLabels" | "headerSemanticLabels" | "toggleCollapse"> & Pick<ReturnType<typeof useTooltips>, "showTooltip" | "clearTooltip"> & {
  frozenColumnCount: number; uiLocale: UiLocale; revision: number;
  selectedColumnAxisSelection: ColumnAxisSelection | null;
  axisColumnDragPreview: Extract<AxisDragPreview, { axis: "column" }> | null;
  activateBooleanLiteralAt: (row: GridRow, colIndex: number, value: boolean) => void;
  canStartFormulaPointPick: () => boolean;
};
export function useGridColumnDefs({
  currentSheet, currentSheetState, sheetColCount, headerColCount, headerRowCount, frozenColumnCount,
  columnLayouts, headerLeafLabels, headerSemanticLabels, toggleCollapse, uiLocale, showTooltip,
  clearTooltip, selectedColumnAxisSelection, axisColumnDragPreview, activateBooleanLiteralAt,
  canStartFormulaPointPick, revision,
}: Options) {
  const columnDefs = useMemo<ColDef<GridRow>[]>(() => {
    if (!currentSheet || !currentSheetState || sheetColCount === 0) return [];

    const realColumnDefs = Array.from({ length: sheetColCount }, (_, colIndex) => {
      const field = toColFieldId(colIndex);
      const isHeaderColumn = colIndex < headerColCount;
      const leafHeader = headerLeafLabels[colIndex] ?? `C${colIndex + 1}`;
      const semanticLabel = headerSemanticLabels[colIndex] ?? leafHeader;

      const baseDef: ColDef<GridRow> = {
        ...columnLayouts[colIndex],
        colId: field,
        field,
        headerName: leafHeader,
        headerTooltip: semanticLabel,
        suppressMovable: true,
      };

      if (isHeaderColumn) {
        const withHeader: ColDef<GridRow> = {
          ...baseDef,
          pinned: colIndex < frozenColumnCount ? "left" : null,
          headerClass: "line-item-header",
          cellClass: colIndex === 0 ? "line-item-cell" : "header-column-cell",
          cellRenderer: (params: { data?: GridRow; value?: unknown }) => params.data
            ? <SearchText row={params.data.__absoluteRowNumber} col={colIndex} text={String(params.value ?? "")} /> : null,
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
                  <SearchText row={data.__absoluteRowNumber} col={colIndex} text={String(data.__displayLabel ?? data.__rowPath)} />
                </span>
              </div>
            );
          };
        }

        return withHeader;
      }

      return {
        ...baseDef,
        headerClass: "data-column-header",
        cellRenderer: (params: { data?: GridRow; value?: unknown }) => {
          if (!params.data) return null;
          const row = params.data.__absoluteRowNumber;
          const text = gridCellText(params.data, colIndex, uiLocale);
          const kind = params.data?.[`__kind_${colIndex}`];
          if (kind === "boolean") {
            if (!params.data) {
              throw new Error(`missing row data for boolean column ${colIndex}`);
            }
            const value = params.data[`__boolean_value_${colIndex}`];
            const interactive = params.data[`__boolean_interactive_${colIndex}`];
            if (typeof value !== "boolean" || typeof interactive !== "boolean") {
              throw new Error(`missing boolean metadata for column ${colIndex}`);
            }
            if (!interactive) return <SearchText row={row} col={colIndex} text={text} />;
            const pointPickOwnsPointer = canStartFormulaPointPick();
            return <SearchText row={row} col={colIndex} text={text}>{pointPickOwnsPointer ? (
              <BooleanCellCapsule value={value} interactive={false} />
            ) : (
              <BooleanCellCapsule
                value={value}
                interactive
                onToggle={() => activateBooleanLiteralAt(params.data!, colIndex, value)}
              />
            )}</SearchText>;
          }
          if (kind !== "error") {
            const content = <SearchText row={row} col={colIndex} text={text} />;
            if (kind === "string") return <span className="cell-text">{content}</span>;
            if (kind === "number") return <span title={text}>{content}</span>;
            return content;
          }

          const externalKind = params.data?.[`__error_external_${colIndex}`];
          const internalKind = params.data?.[`__error_internal_${colIndex}`];
          const context = params.data?.[`__error_context_${colIndex}`];
          if (typeof externalKind !== "string" || typeof internalKind !== "string" || typeof context !== "string") {
            throw new Error(`missing error metadata for column ${colIndex}`);
          }

          return (
            <SearchText row={row} col={colIndex} text={text}>
            <ErrorCellChip
              locale={uiLocale}
              externalKind={externalKind}
              internalKind={internalKind}
              context={context}
              onTooltipEnter={showTooltip}
              onTooltipLeave={clearTooltip}
            />
            </SearchText>
          );
        },
        cellClass: (params: { data?: GridRow }) => {
          const kind = params.data?.[`__kind_${colIndex}`];
          const classes = ["data-cell"];
          if (kind === "number") classes.push("is-numeric");
          if (kind === "boolean" && params.data?.[`__boolean_interactive_${colIndex}`] === true) {
            classes.push("is-boolean-capsule");
          }
          if (kind === "error") classes.push("is-error");
          if (kind === "blank") classes.push("is-blank");
          const align = params.data?.[`__align_${colIndex}`];
          if (align === "left" || align === "right" || align === "center") {
            classes.push(`align-${align}`);
          }
          if (params.data?.[`__weight_${colIndex}`] === "bold") {
            classes.push("is-bold");
          }
          const color = params.data?.[`__color_${colIndex}`];
          if (color === "red" || color === "green" || color === "blue") {
            classes.push(`is-color-${color}`);
          }
          if (params.data?.[`__display_has_errors_${colIndex}`] === true) {
            classes.push("has-display-errors");
          }
          return classes.join(" ");
        },
        cellClassRules: {
          "is-axis-selected": () =>
            selectedColumnAxisSelection != null &&
            colIndex >= selectedColumnAxisSelection.colStart &&
            colIndex <= selectedColumnAxisSelection.colEnd,
          "is-axis-drag-source": () =>
            axisColumnDragPreview != null &&
            colIndex >= axisColumnDragPreview.colStart &&
            colIndex <= axisColumnDragPreview.colEnd,
        },
      } satisfies ColDef<GridRow>;
    });

    return realColumnDefs;
  }, [
    currentSheet,
    currentSheetState,
    sheetColCount,
    headerColCount,
    headerRowCount,
    frozenColumnCount,
    columnLayouts,
    headerLeafLabels,
    headerSemanticLabels,
    toggleCollapse,
    uiLocale,
    showTooltip,
    clearTooltip,
    selectedColumnAxisSelection,
    axisColumnDragPreview,
    activateBooleanLiteralAt,
    canStartFormulaPointPick,
    revision,
  ]);

  return columnDefs;
}
