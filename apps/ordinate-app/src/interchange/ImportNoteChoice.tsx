import type { ExcelNoteCandidate, NoteInline, SheetNote } from "@ordinate/core";
import { useId } from "react";
import { SelectionRow } from "../components/SelectionRow";

function inlineText(nodes: NoteInline[]): string {
  return nodes.map(node => node.kind === "text" ? node.text : inlineText(node.children)).join("");
}

/** One readable line, without leaking Markdown punctuation into the picker. */
export function importNoteSummary(note: SheetNote): string {
  const block = note.blocks.find(block => block.kind !== "rule");
  if (!block) return "";
  return inlineText(block.kind === "paragraph" ? block.children : block.items[0]);
}

export function importNoteLabel(candidate: ExcelNoteCandidate) {
  return `Note ${candidate.position === "beforeTable" ? "before" : "after"} table`;
}

export function importNoteSource(candidate: ExcelNoteCandidate) {
  return `Source ${candidate.firstRow === candidate.lastRow ? `row ${candidate.firstRow}` : `rows ${candidate.firstRow}–${candidate.lastRow}`}`;
}

export function ImportNoteChoice({ candidate, note, selected, disabled, previewing, onToggle, onPreview }: {
  candidate: ExcelNoteCandidate;
  note: SheetNote;
  selected: boolean;
  disabled: boolean;
  previewing: boolean;
  onToggle: () => void;
  onPreview: (button: HTMLButtonElement) => void;
}) {
  const label = importNoteLabel(candidate);
  const reasonId = useId();
  return <div className="import-note-choice">
    <SelectionRow className="import-note-select" label={label} selected={selected}
      disabled={disabled || !!candidate.unavailableReason} onToggle={onToggle} description={<>
        <span className="import-note-summary">{importNoteSource(candidate)} · {importNoteSummary(note)}</span>
        {candidate.unavailableReason && <span id={reasonId} className="import-note-reason">{candidate.unavailableReason}</span>}
      </>} />
    <button type="button" className="import-note-preview-button" aria-label={`Preview ${label.toLowerCase()}`}
      aria-describedby={candidate.unavailableReason ? reasonId : undefined}
      aria-pressed={previewing} onClick={event => onPreview(event.currentTarget)}>Preview</button>
  </div>;
}
