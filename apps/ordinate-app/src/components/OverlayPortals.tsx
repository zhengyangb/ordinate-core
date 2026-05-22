import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";

import { AutoIcon, MoonIcon, SunIcon } from "../icons/uiIcons";
import RailMenu from "./RailMenu";
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
  ToolSpec,
} from "../types/ui";

type OverlayPortalsProps = {
  themeMenuOpen: boolean;
  themeMenuPosition: ThemeMenuPosition;
  themeMenuRef: RefObject<HTMLDivElement>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeMenuOpen: (open: boolean) => void;
  toolMenuOpen: boolean;
  toolMenuPosition: FloatingMenuPosition;
  toolMenuRef: RefObject<HTMLDivElement>;
  overflowTools: ToolSpec[];
  railMenuOpen: boolean;
  railMenuPosition: FloatingMenuPosition;
  railMenu: RailMenuView | null;
  railMenuRef: RefObject<HTMLDivElement>;
  onInsertRowAbove: (rowNumber: number) => void;
  onInsertRowBelow: (rowNumber: number) => void;
  onDeleteRow: (rowNumber: number, area: "header" | "body", rowId: number, mode: CoreRowDeleteMode) => void;
  onInsertColumnLeft: (colIndex: number) => void;
  onInsertColumnRight: (colIndex: number) => void;
  onDeleteColumn: (colIndex: number) => void;
  onConvertRowsToHeader: (rowId: number) => void;
  onConvertRowsToBody: (rowId: number) => void;
  onSetColumnDefaultFormat: (colId: number, key: FormatLocalKey, options: FormatLocalOptions | null) => void;
  onSetColumnDefaultStyle: <Axis extends keyof StyleLocalView>(colId: number, axis: Axis, value: StyleLocalView[Axis]) => void;
  tooltip: FloatingTooltip | null;
};

export default function OverlayPortals({
  themeMenuOpen,
  themeMenuPosition,
  themeMenuRef,
  themeMode,
  setThemeMode,
  setThemeMenuOpen,
  toolMenuOpen,
  toolMenuPosition,
  toolMenuRef,
  overflowTools,
  railMenuOpen,
  railMenuPosition,
  railMenu,
  railMenuRef,
  onInsertRowAbove,
  onInsertRowBelow,
  onDeleteRow,
  onInsertColumnLeft,
  onInsertColumnRight,
  onDeleteColumn,
  onConvertRowsToHeader,
  onConvertRowsToBody,
  onSetColumnDefaultFormat,
  onSetColumnDefaultStyle,
  tooltip,
}: OverlayPortalsProps) {
  return (
    <>
      {createPortal(
        <MenuSurface
          innerRef={themeMenuRef}
          className="theme-menu"
          open={themeMenuOpen}
          ariaHidden={!themeMenuOpen}
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
        <MenuSurface
          innerRef={toolMenuRef}
          className="tool-menu"
          open={toolMenuOpen}
          ariaHidden={!toolMenuOpen}
          style={{ top: `${toolMenuPosition.top}px`, left: `${toolMenuPosition.left}px` }}
        >
          {overflowTools.map((item) => (
            <MenuOption key={item.label} role="menuitem" tabIndex={toolMenuOpen ? 0 : -1} icon={<span className="tool-icon">{item.icon}</span>}>
              {item.label}
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
          onDeleteColumn={onDeleteColumn}
          onConvertRowsToHeader={onConvertRowsToHeader}
          onConvertRowsToBody={onConvertRowsToBody}
          onSetColumnDefaultFormat={onSetColumnDefaultFormat}
          onSetColumnDefaultStyle={onSetColumnDefaultStyle}
        />,
        document.body,
      )}

      {createPortal(
        <div
          className={tooltip ? "floating-tooltip visible" : "floating-tooltip"}
          data-placement={tooltip?.placement ?? "below"}
          data-alignment={tooltip?.alignment ?? "center"}
          role="tooltip"
          aria-hidden={!tooltip}
          style={{
            top: `${tooltip?.top ?? 0}px`,
            left: `${tooltip?.left ?? 0}px`,
          }}
        >
          {tooltip?.text ?? ""}
        </div>,
        document.body,
      )}
    </>
  );
}
