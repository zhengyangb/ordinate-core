import { useId } from "react";
import ModalShell from "../components/ModalShell";

export function BrowserOpenDialog({ onOpenDocument, onOpenLink, onImport, onClose }: {
  onOpenDocument: () => void; onOpenLink?: () => void; onImport: () => void; onClose: () => void;
}) {
  const titleId = useId();
  return <ModalShell open titleId={titleId} onClose={onClose}>
    <div className="app-modal-content">
      <header className="app-modal-header"><h2 id={titleId}>Open file</h2></header>
      <div className="app-modal-body interchange-open-options">
        <button type="button" className="app-modal-action secondary" onClick={onOpenDocument}>Open Ordinate document…<small>.ord · from this device</small></button>
        {onOpenLink && <button type="button" className="app-modal-action secondary" onClick={onOpenLink}>Open from link…<small>.ord · from a URL</small></button>}
        <button type="button" className="app-modal-action secondary" onClick={onImport}>Import spreadsheet…<small>.csv, .tsv, .xlsx · convert to a new document</small></button>
      </div>
      <footer className="app-modal-actions"><button type="button" className="app-modal-action secondary" onClick={onClose}>Cancel</button></footer>
    </div>
  </ModalShell>;
}
