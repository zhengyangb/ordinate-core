import { useId, useRef, type ReactNode } from "react";
import ModalShell from "./ModalShell";

export function InfoDialog({ title, children, onClose, action }: { title: string; children: ReactNode; onClose: () => void; action?: { label: string; onClick: () => void } }) {
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  return <ModalShell open titleId={titleId} initialFocusRef={buttonRef} onClose={onClose}>
    <div className="app-modal-content">
      <header className="app-modal-header"><h2 id={titleId}>{title}</h2></header>
      <div className="app-modal-body">{children}</div>
      <div className="app-modal-actions">
        <button ref={action ? undefined : buttonRef} className={action ? "app-modal-action secondary" : "app-modal-action primary"} onClick={onClose}>{action ? "Close" : "OK"}</button>
        {action && <button ref={buttonRef} className="app-modal-action primary" onClick={action.onClick}>{action.label}</button>}
      </div>
    </div>
  </ModalShell>;
}
