import { useEffect, useState, type RefObject } from "react";

import { MenuGroup, MenuHead, MenuSurface, MenuTitle } from "./MenuSurface";
import type { FloatingMenuPosition } from "../types/ui";

type SheetSetupMenuProps = {
  open: boolean;
  position: FloatingMenuPosition;
  menuRef: RefObject<HTMLDivElement>;
  headerRowCount: number;
  maxHeaderRowCount: number;
  headerColCount: number;
  onSetHeaderRowCount: (count: number) => void;
};

function clampHeaderRowCount(value: number, maxHeaderRowCount: number): number {
  return Math.max(0, Math.min(maxHeaderRowCount, value));
}

export default function SheetSetupMenu({
  open,
  position,
  menuRef,
  headerRowCount,
  maxHeaderRowCount,
  headerColCount,
  onSetHeaderRowCount,
}: SheetSetupMenuProps) {
  const [draftHeaderRows, setDraftHeaderRows] = useState(String(headerRowCount));

  useEffect(() => {
    if (!open) return;
    setDraftHeaderRows(String(headerRowCount));
  }, [open, headerRowCount]);

  const commitHeaderRows = (rawValue: string) => {
    const parsed = Number.parseInt(rawValue, 10);
    const next = clampHeaderRowCount(Number.isFinite(parsed) ? parsed : headerRowCount, maxHeaderRowCount);
    setDraftHeaderRows(String(next));
    if (next !== headerRowCount) {
      onSetHeaderRowCount(next);
    }
  };

  const adjustHeaderRows = (delta: number) => {
    const next = clampHeaderRowCount(headerRowCount + delta, maxHeaderRowCount);
    setDraftHeaderRows(String(next));
    if (next !== headerRowCount) {
      onSetHeaderRowCount(next);
    }
  };

  return (
    <MenuSurface
      innerRef={menuRef}
      className="sheet-setup-menu"
      open={open}
      ariaHidden={!open}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <MenuHead className="sheet-setup-head">
        <MenuTitle>Sheet setup</MenuTitle>
      </MenuHead>
      <MenuGroup className="sheet-setup-body">
        <div className="sheet-setup-row">
          <label className="sheet-setup-label" htmlFor="sheet-setup-header-rows">
            Header rows
          </label>
          <div className="sheet-setup-stepper">
            <button
              className="sheet-setup-stepper-button"
              type="button"
              aria-label="Decrease header rows"
              disabled={headerRowCount <= 0}
              onClick={() => adjustHeaderRows(-1)}
            >
              -
            </button>
            <input
              id="sheet-setup-header-rows"
              className="sheet-setup-number"
              type="number"
              min={0}
              max={maxHeaderRowCount}
              value={draftHeaderRows}
              onChange={(event) => setDraftHeaderRows(event.currentTarget.value)}
              onBlur={(event) => commitHeaderRows(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitHeaderRows(event.currentTarget.value);
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setDraftHeaderRows(String(headerRowCount));
                  event.currentTarget.blur();
                }
              }}
            />
            <button
              className="sheet-setup-stepper-button"
              type="button"
              aria-label="Increase header rows"
              disabled={headerRowCount >= maxHeaderRowCount}
              onClick={() => adjustHeaderRows(1)}
            >
              +
            </button>
          </div>
        </div>
        <div className="sheet-setup-row">
          <label className="sheet-setup-label" htmlFor="sheet-setup-header-columns">
            Header columns
          </label>
          <input
            id="sheet-setup-header-columns"
            className="sheet-setup-number sheet-setup-number--readonly"
            type="number"
            value={headerColCount}
            readOnly
            disabled
          />
        </div>
      </MenuGroup>
    </MenuSurface>
  );
}
