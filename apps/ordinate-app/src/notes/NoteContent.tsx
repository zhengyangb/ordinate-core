import type { SheetNote } from "@ordinate/core";
import { NoteBlocks } from "./NoteBlocks";
import { noteColumns } from "./noteModel";
import "./noteContent.css";

/** The same separators render as rules or column boundaries without changing source. */
export function NoteContent({ note }: { note: SheetNote }) {
  return <div className="note-content-layout"><div className="sheet-note-columns">
    {noteColumns(note).map((blocks, index) => <div key={index} className="sheet-note-column">
      <NoteBlocks blocks={blocks}/>
    </div>)}
  </div></div>;
}
