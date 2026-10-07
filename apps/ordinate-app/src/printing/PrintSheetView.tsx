import type { CSSProperties } from "react";
import { groupHeaderSpans, type SheetNote } from "@ordinate/core";
import { NoteContent } from "../notes/NoteContent";
import { toColFieldId } from "../utils/appHelpers";
import type { PrintSheetModel } from "./printSheetModel";
import "./printSheet.css";

function PrintNote({ note }: { note: SheetNote }) {
  if (!note.blocks.length) return null;
  return <section className="print-note"><NoteContent note={note}/></section>;
}

export function PrintSheet({ sheet }: { sheet: PrintSheetModel }) {
  const totalWidth = sheet.widths.reduce((sum, width) => sum + width, 0);
  const columns = sheet.widths.map((_, colIndex) => ({ colIndex }));
  return <article className="print-sheet">
    <h1>{sheet.name}</h1>
    <PrintNote note={sheet.before} />
    <table>
      <colgroup>{sheet.widths.map((width, index) => <col key={index} style={{ width: `${width / totalWidth * 100}%` }} />)}</colgroup>
      {sheet.headers.length > 0 && <thead>{sheet.headers.map((row, index) => <tr key={index}>
        {groupHeaderSpans(columns, row, sheet.headerColCount).map(({ start, end, label }) =>
          <th key={start} scope={end > start ? "colgroup" : "col"} colSpan={end - start + 1}>{label}</th>,
        )}
      </tr>)}</thead>}
      <tbody>{sheet.rows.map(row => <tr key={row.__rowId} className={row.__hasChildren ? "print-group" : undefined}>
        {sheet.widths.map((_, col) => {
          const isHeader = col < sheet.headerColCount;
          const Cell = isHeader ? "th" : "td";
          const color = row[`__color_${col}`];
          const weight = row[`__weight_${col}`];
          const align = row[`__align_${col}`];
          const style: CSSProperties = {
            textAlign: align ? align as CSSProperties["textAlign"] : undefined,
            fontWeight: weight === "bold" ? 700 : weight === "normal" ? 400 : undefined,
            color: color ? `var(--display-color-${color})` : undefined,
            paddingLeft: col === 0 && isHeader ? `${6 + Math.max(0, row.__depth - 1) * 10}px` : undefined,
          };
          return <Cell key={col} scope={isHeader ? "row" : undefined} style={style}>{String(row[toColFieldId(col)])}</Cell>;
        })}
      </tr>)}</tbody>
    </table>
    <PrintNote note={sheet.after} />
  </article>;
}
