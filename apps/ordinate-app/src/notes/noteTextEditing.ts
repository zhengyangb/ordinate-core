import { matchNoteListItem } from "@ordinate/core";

export type NoteTextEdit = { from: number; to: number; text: string };

/** Enter edits only the selected range/current empty marker, never other source. */
export function noteEnterEdit(source: string, from: number, to: number): NoteTextEdit {
  const before = source.slice(0, from), after = source.slice(to);
  const lineStart = before.lastIndexOf("\n") + 1;
  const nextBreak = after.indexOf("\n");
  const suffix = nextBreak === -1 ? after : after.slice(0, nextBreak);
  const item = matchNoteListItem(before.slice(lineStart) + suffix);
  if (!item || from < lineStart + item.marker.length + (item.content ? item.spacing.length : 0)) {
    return { from, to, text: "\n\n" };
  }
  if (!item.content) {
    // Remove the empty item. Existing surrounding newlines already separate
    // paragraphs unless this is the final line of an existing list.
    return { from: lineStart, to: to + suffix.length, text: lineStart > 0 && nextBreak === -1 ? "\n" : "" };
  }
  // Like canonical note source, repeat the ordered marker: Markdown computes
  // display numbering from the first item, not subsequent source numbers.
  return { from, to, text: `\n${item.marker}${item.spacing}` };
}

/** Use native text editing so Enter remains undoable inside the textarea.
 * insertText (not insertHTML) preserves inert text and the browser undo buffer.
 * https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
 */
export function insertNoteEnter(input: HTMLTextAreaElement) {
  const edit = noteEnterEdit(input.value, input.selectionStart, input.selectionEnd);
  input.setSelectionRange(edit.from, edit.to);
  if (!input.ownerDocument.execCommand("insertText", false, edit.text)) {
    throw new Error("The browser could not insert a note paragraph.");
  }
}
