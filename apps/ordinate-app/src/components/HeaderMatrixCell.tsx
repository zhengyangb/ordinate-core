import type { ButtonHTMLAttributes } from "react";
import type { HeaderOverlayCell } from "../types/ui";
import { SearchText } from "../search/SheetSearch";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  cell: HeaderOverlayCell;
};

/** One visible header cell in both the editor and its read-only preview. */
export function HeaderMatrixCell({ cell, className, ...props }: Props) {
  return <button
    {...props}
    className={["header-matrix-cell", className].filter(Boolean).join(" ")}
    data-row-number={cell.rowNumber}
    data-start-col={cell.startCol}
    data-end-col={cell.endCol}
    type="button"
    title={cell.label}
  >
    <span><SearchText row={cell.rowNumber} col={cell.startCol} text={cell.label} /></span>
  </button>;
}
