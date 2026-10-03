import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";

import { AutoIcon, MoonIcon, SunIcon } from "../icons/uiIcons";
import RailMenu from "./RailMenu";
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
  ThemeMenuPosition,
  ThemeMode,
} from "../types/ui";

type OverlayPortalsProps = {
  themeMenuOpen: boolean;
  themeMenuPosition: ThemeMenuPosition;
  themeMenuRef: RefObject<HTMLDivElement>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeMenuOpen: (open: boolean) => void;
  railMenuOpen: boolean;
  railMenuPosition: FloatingMenuPosition;
  railMenu: RailMenuView | null;
  railMenuRef: RefObject<HTMLDivElement>;
  sheetSetupOpen: boolean;
  sheetSetupPosition: FloatingMenuPosition;
  sheetSetupMenuRef: RefObject<HTMLDivElement>;
  headerRowCount: number;
  maxHeaderRowCount: number;
  headerColCount: number;
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
  themeMenuOpen,
  themeMenuPosition,
  themeMenuRef,
  themeMode,
  setThemeMode,
  setThemeMenuOpen,
  railMenuOpen,
  railMenuPosition,
  railMenu,
  railMenuRef,
  sheetSetupOpen,
  sheetSetupPosition,
  sheetSetupMenuRef,
  headerRowCount,
  maxHeaderRowCount,
  headerColCount,
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
        <MenuSurface
          innerRef={themeMenuRef}
          className="theme-menu"
          open={themeMenuOpen}
          style={{ top: `${themeMenuPosition.top}px`, left: `${themeMenuPosition.left}px` }}
        >
          {(
            [
              { mode: "auto", label: "Auto", icon: <AutoIcon /> },
              { mode: "light", label: "Light", icon: <SunIcon /> },
              { mode: "dark", label: "Dark", icon: <MoonIcon /> },
            ] satisfies Array<{ mode: ThemeMode; label: string; icon: ReactNode }>
          ).map((option) => (
            <MenuOption
              key={option.mode}
              role="menuitemradio"
              aria-checked={themeMode === option.mode}
              active={themeMode === option.mode}
              icon={<span className="tool-icon">{option.icon}</span>}
              onClick={() => {
                setThemeMode(option.mode);
                setThemeMenuOpen(false);
              }}
            >
              {option.label}
            </MenuOption>
          ))}
        </MenuSurface>,
        document.body,
      )}

      {createPortal(
        <RailMenu
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
          open={sheetSetupOpen}
          position={sheetSetupPosition}
          menuRef={sheetSetupMenuRef}
          headerRowCount={headerRowCount}
          maxHeaderRowCount={maxHeaderRowCount}
          headerColCount={headerColCount}
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
