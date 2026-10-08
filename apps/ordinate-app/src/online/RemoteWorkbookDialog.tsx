import { useId, useRef, useState, type RefObject } from "react";
import ModalShell from "../components/ModalShell";
import { hasOrdFileExtension, type RemoteWorkbook } from "./remoteWorkbook";

export function RemoteWorkbookContent({ remote, value, busy, error, onChange, onClose, onOpen, titleId, inputRef, cancelRef }: {
  remote: RemoteWorkbook | null; value: string; busy: boolean; error: string | null;
  onChange: (value: string) => void; onClose: () => void; onOpen: (value: string) => void; titleId?: string;
  inputRef?: RefObject<HTMLInputElement>;
  cancelRef?: RefObject<HTMLButtonElement>;
}) {
  const unknownFormat = URL.canParse(value) && !hasOrdFileExtension(new URL(value));
  return <form className="app-modal-content remote-workbook-content" aria-busy={busy} onSubmit={event => { event.preventDefault(); if (!busy) onOpen(value); }}>
    <header className="app-modal-header"><h2 id={titleId}>Open from URL</h2></header>
    {remote ? <p className="remote-workbook-address selectable-text" dir="ltr" tabIndex={0} aria-label="File URL">{remote.url}</p> : <div className="remote-workbook-field">
      <label htmlFor={`${titleId}-url`}>File URL</label>
      <input ref={inputRef} id={`${titleId}-url`} type="url" value={value} readOnly={busy} required
        placeholder="https://example.com/workbook.ord" autoComplete="off" spellCheck={false}
        onChange={event => onChange(event.target.value)} />
    </div>}
    {unknownFormat && <p className="remote-workbook-format-warning" role="status">This may not be an Ordinate workbook.</p>}
    <div className="remote-workbook-feedback" data-error={!!error}>
      <p className="remote-workbook-trust" aria-hidden={!!error}>
        <svg width="20" height="22" viewBox="0 0 20 22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><path d="M10 2 17 5v5c0 4.4-2.6 7.6-7 10-4.4-2.6-7-5.6-7-10V5z"/></svg>
        <span>Only open files from sources you trust. This opens a local copy.</span>
      </p>
      <div className="remote-workbook-error" role="alert" tabIndex={error ? 0 : undefined}>{error}</div>
    </div>
    <footer className="app-modal-actions">
      <button ref={cancelRef} type="button" className="app-modal-action secondary" onClick={onClose}>Cancel</button>
      <button type="submit" className="app-modal-action primary" disabled={busy || !value.trim()}>Open</button>
    </footer>
  </form>;
}

export function RemoteWorkbookDialog(props: {
  remote: RemoteWorkbook | null; busy: boolean; error: string | null;
  onClose: () => void; onOpen: (value: string) => void;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(props.remote?.url ?? "");
  return <ModalShell open titleId={titleId} onClose={props.onClose} initialFocusRef={props.remote ? cancelRef : inputRef} className="remote-workbook-dialog">
    <RemoteWorkbookContent {...props} titleId={titleId} inputRef={inputRef} cancelRef={cancelRef} value={value} onChange={setValue} />
  </ModalShell>;
}
