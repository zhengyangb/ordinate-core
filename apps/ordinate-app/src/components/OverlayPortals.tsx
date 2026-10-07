import { createPortal } from "react-dom";
import type { RefObject } from "react";

import RailMenu from "./RailMenu";
import { RowsToNoteMenuItem } from "../notes/RowsToNoteMenuItem";
import type { RowsToNoteAction } from "../notes/useRowsToNoteCommand";
import SheetSetupMenu from "./SheetSetupMenu";
import FloatingTooltipView from "./FloatingTooltipView";
import { MenuOption, MenuSurface } from "./MenuSurface";
import type { CoreRowDeleteMode } from "@ordinate/core";
import type {
  FloatingMenuPosition,
  FloatingTooltip,
  FormatLocalKey,
  FormatLocalOptions,
  RailMenuView,
  StyleLocalView,
} from "../types/ui";

type OverlayPortalsProps = {
  rowNoteActions: { rail: RowsToNoteAction | null; selection: RowsToNoteAction | null };
  railMenuOpen: boolean;
  railMenuPosition: FloatingMenuPosition;
  railMenu: RailMenuView | null;
  railMenuRef: RefObject<HTMLDivElement>;
  sheetSetupOpen: boolean;
  onEditNote: (position: import("@ordinate/core").SheetNotePosition) => void;
  notesDisabled: boolean;
  sheetSetupPosition: FloatingMenuPosition;
  sheetSetupMenuRef: RefObject<HTMLDivElement>;
  headerRowCount: number;
  maxHeaderRowCount: number;
  headerColCount: number;
  maxHeaderColCount: number;
  onSetHeaderColCount: (count: number) => void;
  onSetHeaderRowCount: (count: number) => void;
  selectionMenuOpen: boolean;
  selectionMenuPosition: FloatingMenuPosition;
  selectionMenuRef: RefObject<HTMLDivElement>;
  canClearSelection: boolean;
  onClearSelection: () => void;
  onInsertRowAbove: (rowNumber: number, area: "header" | "body") => void;
  onInsertRowBelow: (rowNumber: number, area: "header" | "body") => void;
  onDeleteRow: (rowNumber: number, area: "header" | "body", rowId: number, mode: CoreRowDeleteMode) => void;
  onInsertColumnLeft: (colIndex: number) => void;
  onInsertColumnRight: (colIndex: number) => void;
  onDuplicateColumn: (colIndex: number) => void;
  onDeleteColumn: (colIndex: number) => void;
  onDuplicateRow: (rowNumber: number, area: "header" | "body", rowId: number) => void;
  onConvertRowsToHeader: (rowId: number) => void;
  onConvertRowsToBody: (rowId: number) => void;
  onSetColumnDefaultFormat: (colId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onSetColumnDefaultStyle: <Axis extends keyof StyleLocalView>(colId: number, axis: Axis, value: StyleLocalView[Axis]) => void;
  onSetRowDefaultFormat: (rowId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onSetRowDefaultStyle: <Axis extends keyof StyleLocalView>(rowId: number, axis: Axis, value: StyleLocalView[Axis]) => void;
  tooltip: FloatingTooltip | null;
};

export default function OverlayPortals({
  rowNoteActions,
  railMenuOpen,
  railMenuPosition,
  railMenu,
  railMenuRef,
  sheetSetupOpen,
  onEditNote,
  notesDisabled,
  sheetSetupPosition,
  sheetSetupMenuRef,
  headerRowCount,
  maxHeaderRowCount,
  headerColCount,
  maxHeaderColCount,
  onSetHeaderColCount,
  onSetHeaderRowCount,
  selectionMenuOpen,
  selectionMenuPosition,
  selectionMenuRef,
  canClearSelection,
  onClearSelection,
  onInsertRowAbove,
  onInsertRowBelow,
  onDeleteRow,
  onInsertColumnLeft,
  onInsertColumnRight,
  onDuplicateColumn,
  onDeleteColumn,
  onDuplicateRow,
  onConvertRowsToHeader,
  onConvertRowsToBody,
  onSetColumnDefaultFormat,
  onSetColumnDefaultStyle,
  onSetRowDefaultFormat,
  onSetRowDefaultStyle,
  tooltip,
}: OverlayPortalsProps) {
  return (
    <>
      {createPortal(
        <RailMenu
          rowNoteMenuItem={<RowsToNoteMenuItem action={rowNoteActions.rail} />}
          open={railMenuOpen}
          position={railMenuPosition}
          railMenu={railMenu}
          railMenuRef={railMenuRef}
          onInsertRowAbove={onInsertRowAbove}
          onInsertRowBelow={onInsertRowBelow}
          onDeleteRow={onDeleteRow}
          onInsertColumnLeft={onInsertColumnLeft}
          onInsertColumnRight={onInsertColumnRight}
          onDuplicateColumn={onDuplicateColumn}
          onDeleteColumn={onDeleteColumn}
          onSetHeaderColCount={onSetHeaderColCount}
          onDuplicateRow={onDuplicateRow}
          onConvertRowsToHeader={onConvertRowsToHeader}
          onConvertRowsToBody={onConvertRowsToBody}
          onSetColumnDefaultFormat={onSetColumnDefaultFormat}
          onSetColumnDefaultStyle={onSetColumnDefaultStyle}
          onSetRowDefaultFormat={onSetRowDefaultFormat}
          onSetRowDefaultStyle={onSetRowDefaultStyle}
        />,
        document.body,
      )}

      {createPortal(
        <SheetSetupMenu
          onEditNote={onEditNote}
          notesDisabled={notesDisabled}
          open={sheetSetupOpen}
          position={sheetSetupPosition}
          menuRef={sheetSetupMenuRef}
          headerRowCount={headerRowCount}
          maxHeaderRowCount={maxHeaderRowCount}
          headerColCount={headerColCount}
          maxHeaderColCount={maxHeaderColCount}
          onSetHeaderColCount={onSetHeaderColCount}
          onSetHeaderRowCount={onSetHeaderRowCount}
        />,
        document.body,
      )}

      {createPortal(
        <MenuSurface
          innerRef={selectionMenuRef}
          className="selection-menu"
          open={selectionMenuOpen}
          style={{ top: `${selectionMenuPosition.top}px`, left: `${selectionMenuPosition.left}px` }}
        >
          <MenuOption role="menuitem" tone="danger" disabled={!canClearSelection} onClick={onClearSelection}>
            Clear selection
          </MenuOption>
          <RowsToNoteMenuItem action={rowNoteActions.selection} />
        </MenuSurface>,
        document.body,
      )}

      {createPortal(
        <FloatingTooltipView tooltip={tooltip} />,
        document.body,
      )}
    </>
  );
}
