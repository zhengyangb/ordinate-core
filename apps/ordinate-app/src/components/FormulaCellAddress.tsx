import { useEffect, useId, useRef, useState } from "react";
import type { FormulaBarData, Rect } from "../types/ui";
import { toColumnLetters } from "../utils/appHelpers";
import { EditorPopover } from "./EditorPopover";

export function FormulaCellAddress({ cell, selection }: { cell: FormulaBarData; selection: Rect | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);
  const id = useId();
  const count = selection ? (selection.rowEnd - selection.rowStart + 1) * (selection.colEnd - selection.colStart + 1) : 1;
  const range = selection ? `${toColumnLetters(selection.colStart + 1)}${selection.rowStart}:${toColumnLetters(selection.colEnd + 1)}${selection.rowEnd}` : null;
  return <div ref={rootRef} className="formula-bar-meta formula-location" data-escape-owner
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <button type="button" className="formula-address" aria-label={`${cell.primaryAddress}, cell location`}
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true" className="formula-column-address">{toColumnLetters(cell.columnNumber)}<sub>{cell.columnNumber}</sub></span>
      <span aria-hidden="true" className="formula-row-address">{cell.rowNumber}</span>
    </button>
    {count > 1 ? <span className="formula-selection-count">{count} cells</span> : null}
    {open ? <div className="formula-location-popover-wrap">
      <EditorPopover className="formula-location-popover" grow="up" role="region" aria-label="Cell location" id={id}>
        <div><span className="formula-location-label">Column</span><span>{cell.columnPath.length ? cell.columnPath.join(" › ") : `Column ${cell.columnNumber}`}</span></div>
        <div><span className="formula-location-label">Row</span><span>{cell.rowPath.length ? cell.rowPath.join(" › ") : `Row ${cell.rowNumber}`}</span></div>
        {range ? <div><span className="formula-location-label">Selection</span><span>{range} · {count} cells</span></div> : null}
      </EditorPopover>
    </div> : null}
  </div>;
}
