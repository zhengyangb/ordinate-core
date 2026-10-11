import { parseSheetNote, serializeSheetNote, SheetNoteError, type SheetState, type SheetNotePosition } from "@ordinate/core";
import type { SheetNote, NoteBlock } from "@ordinate/core";

export function noteColumns(note: SheetNote) {
  const columns: NoteBlock[][] = [[]];
  const lastContent = note.blocks.map(block => block.kind !== "rule").lastIndexOf(true);
  for (const [index, block] of note.blocks.entries()) {
    // Only internal separators create layout sections, never empty columns.
    // Retain every rule in the DOM: narrow layouts display it horizontally.
    if (block.kind === "rule" && index < lastContent && columns.at(-1)!.some(item => item.kind !== "rule")) columns.push([]);
    columns.at(-1)!.push(block);
  }
  return columns;
}

/** Read invalid source too, so repairing a note never requires source mode. */
export function readNote(sheet: SheetState, position: SheetNotePosition) {
  const index = sheet.primaryTableBlockIndex;
  if (index === null) throw new Error("Notes require a primary table");
  const blocks = position === "beforeTable" ? sheet.sourceBlocks.slice(0, index) : sheet.sourceBlocks.slice(index + 1);
  const markdown = blocks.map(block => {
    if (block.kind === "note") return serializeSheetNote(block.note);
    if (block.kind === "unparsed") return block.lines.join("\n");
    throw new Error("Sheet notes require exactly one table");
  }).join("\n\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "");
  try {
    return { markdown, note: parseSheetNote(markdown), error: null };
  } catch (error) {
    if (!(error instanceof SheetNoteError)) throw error;
    return { markdown, note: null, error: error.message };
  }
}

export function savesNote(event: {
  key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean;
}): boolean {
  return !event.isComposing && (event.key === "Escape"
    || (event.key === "Enter" && (event.ctrlKey || event.metaKey)));
}

/** The visible scrollbar treats the note and grid as one continuous document. */
export function splitNoteScroll(position: number, introMax: number, gridMax: number) {
  const clamped = Math.min(Math.max(position, 0), introMax + gridMax);
  return { intro: Math.min(clamped, introMax), grid: Math.max(0, clamped - introMax) };
}
