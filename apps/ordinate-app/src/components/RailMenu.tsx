import { useEffect, useRef, useState, type RefObject } from "react";

import { FormatOptionGlyph } from "./DisplayMetadataPreview";
import RailMenuDetailPanel from "./RailMenuDetailPanel";
import { MenuDivider, MenuGroup, MenuHead, MenuOption, MenuSurface, MenuTitle } from "./MenuSurface";
import type { FloatingMenuPosition, RailMenuView } from "../types/ui";
import type { CoreRowDeleteMode } from "@ordinate/core";

function StyleRowGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6.2 14.1 9.8 5.8l3.9 8.3M7.3 11.7h5.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M5.6 16.2h8.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" opacity="0.92" />
    </svg>
  );
}

function InsertAboveGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 4.2v5.2M7.4 6.8 10 4.2l2.6 2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M4.8 13.2h10.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function InsertBelowGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 15.8V10.6M7.4 13.2 10 15.8l2.6-2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M4.8 6.8h10.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function InsertLeftGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4.2 10h5.2M6.8 7.4 4.2 10l2.6 2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M13.2 4.8v10.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function InsertRightGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M15.8 10h-5.2M13.2 7.4 15.8 10l-2.6 2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
      <path d="M6.8 4.8v10.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function DeleteGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.3 5.2h9.4M7.6 5.2l.4-1h4l.4 1M7 7.1v6.4M10 7.1v6.4M13 7.1v6.4M6.2 5.2l.4 10h6.8l.4-10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
    </svg>
  );
}

function RowStructurePanel({
  rowNumber,
  hasChildren,
  onInsertAbove,
  onInsertBelow,
  onDelete,
}: {
  rowNumber: number;
  hasChildren: boolean;
  onInsertAbove: (rowNumber: number) => void;
  onInsertBelow: (rowNumber: number) => void;
  onDelete: (rowNumber: number, mode: CoreRowDeleteMode) => void;
}) {
  return (
    <MenuGroup className="rail-structure-panel">
      <MenuOption className="rail-structure-action" icon={<InsertAboveGlyph />} onClick={() => onInsertAbove(rowNumber)}>
        Insert Above
      </MenuOption>
      <MenuOption className="rail-structure-action" icon={<InsertBelowGlyph />} onClick={() => onInsertBelow(rowNumber)}>
        Insert Below
      </MenuOption>
      <MenuOption
        className="rail-structure-action"
        icon={<DeleteGlyph />}
        tone="danger"
        onClick={() => onDelete(rowNumber, hasChildren ? "subtree" : "node")}
      >
        {hasChildren ? "Delete Row and Children" : "Delete Row"}
      </MenuOption>
    </MenuGroup>
  );
}

type RailMenuProps = {
  open: boolean;
  position: FloatingMenuPosition;
  railMenu: RailMenuView | null;
  railMenuRef: RefObject<HTMLDivElement>;
  onInsertRowAbove: (rowNumber: number) => void;
  onInsertRowBelow: (rowNumber: number) => void;
  onDeleteRow: (rowNumber: number, mode: CoreRowDeleteMode) => void;
  onInsertColumnLeft: (colIndex: number) => void;
  onInsertColumnRight: (colIndex: number) => void;
  onDeleteColumn: (colIndex: number) => void;
};

export default function RailMenu({
  open,
  position,
  railMenu,
  railMenuRef,
  onInsertRowAbove,
  onInsertRowBelow,
  onDeleteRow,
  onInsertColumnLeft,
  onInsertColumnRight,
  onDeleteColumn,
}: RailMenuProps) {
  const [panel, setPanel] = useState<"format" | "style" | null>(null);
  const [columnFormatInspectKey, setColumnFormatInspectKey] = useState<"auto" | "integer" | "decimal" | "scientific" | "percent">("auto");
  const formatTriggerRef = useRef<HTMLButtonElement>(null);
  const styleTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !railMenu) return;
    setPanel(null);
    if (railMenu.kind === "column") {
      setColumnFormatInspectKey(railMenu.formatLocalKey);
    }
  }, [open, railMenu]);

  const detailAnchorRef = panel === "format" ? formatTriggerRef : styleTriggerRef;

  return (
    <>
      <MenuSurface
        innerRef={railMenuRef}
        className={[
          "rail-menu",
          railMenu?.kind === "column" ? "rail-menu--column" : "rail-menu--row",
        ].join(" ")}
        open={open}
        ariaHidden={!open}
        style={{ top: `${position.top}px`, left: `${position.left}px` }}
      >
        {railMenu ? (
          <>
            <MenuHead className="column-rail-menu-head">
              <MenuTitle className="column-rail-menu-title" index={railMenu.kind === "column" ? railMenu.colIndex + 1 : undefined}>
                {railMenu.kind === "column" ? `Column ${railMenu.colLabel}` : `Row ${railMenu.rowNumber}`}
              </MenuTitle>
            </MenuHead>
            {railMenu.kind === "column" ? (
              <div className="column-rail-menu-body">
                <div className="column-rail-menu-nav" aria-label="Column tools">
                  <MenuGroup className="column-rail-menu-nav-group" role="group" ariaLabel="Column metadata tools">
                    <MenuOption
                      buttonRef={formatTriggerRef}
                      active={panel === "format"}
                      className="column-rail-menu-nav-item"
                      icon={<FormatOptionGlyph option="decimal" />}
                      trailing={railMenu.formatLocalKey !== "auto" ? <span className="column-rail-menu-nav-mark" aria-hidden="true" /> : null}
                      onClick={() => {
                        const nextOpen = panel !== "format";
                        setPanel(nextOpen ? "format" : null);
                        if (nextOpen) {
                          setColumnFormatInspectKey(railMenu.formatLocalKey);
                        }
                      }}
                    >
                      Format
                    </MenuOption>
                    <MenuOption
                      buttonRef={styleTriggerRef}
                      active={panel === "style"}
                      className="column-rail-menu-nav-item"
                      icon={<StyleRowGlyph />}
                      trailing={railMenu.styleLocal.align !== "auto" || railMenu.styleLocal.weight !== "auto" || railMenu.styleLocal.color !== "auto" ? (
                        <span className="column-rail-menu-nav-mark" aria-hidden="true" />
                      ) : null}
                      onClick={() => setPanel((current) => (current === "style" ? null : "style"))}
                    >
                      Style
                    </MenuOption>
                  </MenuGroup>
                  {railMenu.canStructureEdit ? <MenuDivider className="column-rail-menu-nav-divider" /> : null}
                  {railMenu.canStructureEdit ? (
                    <MenuGroup className="column-rail-menu-action-group" ariaLabel="Column structure actions">
                      <MenuOption className="column-rail-menu-action" icon={<InsertLeftGlyph />} onClick={() => onInsertColumnLeft(railMenu.colIndex)}>
                        Insert Left
                      </MenuOption>
                      <MenuOption className="column-rail-menu-action" icon={<InsertRightGlyph />} onClick={() => onInsertColumnRight(railMenu.colIndex)}>
                        Insert Right
                      </MenuOption>
                      <MenuOption className="column-rail-menu-action" icon={<DeleteGlyph />} tone="danger" onClick={() => onDeleteColumn(railMenu.colIndex)}>
                        Delete Column
                      </MenuOption>
                    </MenuGroup>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="column-rail-menu-body">
                <RowStructurePanel
                  rowNumber={railMenu.rowNumber}
                  hasChildren={railMenu.hasChildren}
                  onInsertAbove={onInsertRowAbove}
                  onInsertBelow={onInsertRowBelow}
                  onDelete={onDeleteRow}
                />
              </div>
            )}
          </>
        ) : null}
      </MenuSurface>
      {railMenu?.kind === "column" ? (
        <RailMenuDetailPanel
          open={open && panel !== null}
          panel={panel}
          railMenu={railMenu}
          anchorRef={detailAnchorRef}
          containerRef={railMenuRef}
          inspectedKey={columnFormatInspectKey}
          onInspectKey={setColumnFormatInspectKey}
        />
      ) : null}
    </>
  );
}
