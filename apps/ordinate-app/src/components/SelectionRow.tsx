import { useId, type ReactNode } from "react";
import "./selectionRow.css";

/** A whole-row, keyboard-accessible binary choice shared by import and export. */
export function SelectionRow({ label, description, selected, disabled, onToggle, className = "" }: {
  label: string; description: ReactNode; selected: boolean; disabled?: boolean;
  onToggle: () => void; className?: string;
}) {
  const descriptionId = useId();
  return <button type="button" className={`selection-row ${className}`.trim()} aria-label={label}
    aria-pressed={selected} aria-describedby={descriptionId} disabled={disabled} onClick={onToggle}>
    <span className="selection-row-copy">
      <span className="selection-row-label">{label}</span>
      <span id={descriptionId} className="selection-row-description">{description}</span>
    </span>
    <span className="selection-row-mark" aria-hidden="true">{selected ? "✓" : "+"}</span>
  </button>;
}
