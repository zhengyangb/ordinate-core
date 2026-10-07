import { type RefObject } from "react";
import { MenuGroup, MenuHead, MenuOption, MenuSurface, MenuTitle } from "./MenuSurface";
import { IntegerStepper } from "./IntegerStepper";
import type { FloatingMenuPosition } from "../types/ui";

type SheetSetupMenuProps = {
  onEditNote: (position: import("@ordinate/core").SheetNotePosition) => void;
  notesDisabled: boolean;
  open: boolean;
  position: FloatingMenuPosition;
  menuRef: RefObject<HTMLDivElement>;
  headerRowCount: number;
  maxHeaderRowCount: number;
  headerColCount: number;
  maxHeaderColCount: number;
  onSetHeaderRowCount: (count: number) => void;
  onSetHeaderColCount: (count: number) => void;
};

function HeaderCountControl({ axis, value, maximum, onChange }: {
  axis: "rows" | "columns"; value: number; maximum: number; onChange: (count: number) => void;
}) {
  const id = `sheet-setup-header-${axis}`;
  return <div className="sheet-setup-row">
    <label className="sheet-setup-label" htmlFor={id}>Header {axis}</label>
    <IntegerStepper id={id} label={`Header ${axis}`} value={value} maximum={maximum} onChange={onChange} />
  </div>;
}

export default function SheetSetupMenu(props: SheetSetupMenuProps) {
  return <MenuSurface innerRef={props.menuRef} className="sheet-setup-menu" open={props.open}
    style={{ top: `${props.position.top}px`, left: `${props.position.left}px` }}>
    <MenuHead className="sheet-setup-head"><MenuTitle>Sheet setup</MenuTitle></MenuHead>
    <MenuGroup className="sheet-setup-body">
      <HeaderCountControl axis="rows" value={props.headerRowCount} maximum={props.maxHeaderRowCount} onChange={props.onSetHeaderRowCount} />
      <HeaderCountControl axis="columns" value={props.headerColCount} maximum={props.maxHeaderColCount} onChange={props.onSetHeaderColCount} />
    </MenuGroup>
    <MenuGroup className="sheet-setup-notes">
      <MenuOption disabled={props.notesDisabled} onClick={() => props.onEditNote("beforeTable")}>Note before table</MenuOption>
      <MenuOption disabled={props.notesDisabled} onClick={() => props.onEditNote("afterTable")}>Note after table</MenuOption>
    </MenuGroup>
  </MenuSurface>;
}
