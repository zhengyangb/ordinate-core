import { useId, useState } from "react";
import ModalShell from "../components/ModalShell";
import { SegmentedChoice } from "../components/SegmentedChoice";
import { SelectionRow } from "../components/SelectionRow";
import { DEFAULT_PRINT_OPTIONS, type PreparedPrintDocument, type PrintOptions } from "./printDocumentModel";
import "./printDialog.css";

type PrintDialogProps = {
  document: Pick<PreparedPrintDocument, "currentSheet" | "sheets">;
  onClose: () => void;
  onPrint: (options: PrintOptions) => void;
};

export function PrintOptionsContent({ document, options, onChange, onClose, onPrint, titleId }: PrintDialogProps & {
  options: PrintOptions; onChange: (options: PrintOptions) => void; titleId?: string;
}) {
  const selectedSheets = document.sheets.filter(sheet => options.scope === "all" || sheet.name === document.currentSheet);
  return <div className="app-modal-content print-options-content">
    <header className="app-modal-header"><h2 id={titleId}>Print</h2></header>
    <section className="print-range" aria-label="Print range">
      <SegmentedChoice label="Sheets to print" value={options.scope}
        options={[{ value: "current", label: "Current sheet" }, { value: "all", label: "All sheets" }]}
        onChange={scope => onChange({ ...options, scope })} />
      <p className="print-range-summary" title={options.scope === "current" ? document.currentSheet : undefined}>
        {options.scope === "current" ? document.currentSheet : `${document.sheets.length} sheets · Each starts on a new page`}
      </p>
    </section>
    {/* Reserve the same choices across scopes. Disabling an unavailable choice
        keeps the dialog still; do not mount/unmount rows when scope changes. */}
    {(document.sheets.some(sheet => sheet.hasBeforeNotes || sheet.hasAfterNotes)) &&
      <section className="print-note-options" aria-label="Notes to include">
        {document.sheets.some(sheet => sheet.hasBeforeNotes) && <SelectionRow label="Notes above table" description="Include introductory notes."
          selected={options.includeBeforeNotes} disabled={!selectedSheets.some(sheet => sheet.hasBeforeNotes)}
          onToggle={() => onChange({ ...options, includeBeforeNotes: !options.includeBeforeNotes })} />}
        {document.sheets.some(sheet => sheet.hasAfterNotes) && <SelectionRow label="Notes below table" description="Include closing notes."
          selected={options.includeAfterNotes} disabled={!selectedSheets.some(sheet => sheet.hasAfterNotes)}
          onToggle={() => onChange({ ...options, includeAfterNotes: !options.includeAfterNotes })} />}
      </section>}
    <footer className="app-modal-actions">
      <button type="button" className="app-modal-action secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="app-modal-action primary" onClick={() => onPrint(options)}>Print…</button>
    </footer>
  </div>;
}

export function PrintDialog(props: PrintDialogProps) {
  const titleId = useId();
  const [options, setOptions] = useState(DEFAULT_PRINT_OPTIONS);
  return <ModalShell open titleId={titleId} onClose={props.onClose} className="print-options-dialog">
    <PrintOptionsContent {...props} titleId={titleId} options={options} onChange={setOptions} />
  </ModalShell>;
}
