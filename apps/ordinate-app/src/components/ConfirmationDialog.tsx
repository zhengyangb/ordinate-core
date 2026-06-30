import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import ModalShell from "./ModalShell";

export type ConfirmationTone = "default" | "danger" | "warning";

export type ConfirmationDialogConfig = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmationTone;
};

type PendingConfirmation = ConfirmationDialogConfig & {
  resolve: (confirmed: boolean) => void;
};

type ConfirmationDialogProps = {
  request: PendingConfirmation | null;
  onResolve: (confirmed: boolean) => void;
};

function ConfirmationDialog({ request, onResolve }: ConfirmationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  if (!request) return null;

  const tone = request.tone ?? "default";
  const cancelLabel = request.cancelLabel ?? "Cancel";

  return (
    <ModalShell
      open
      className="confirmation-dialog"
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocusRef={cancelButtonRef}
      onClose={() => onResolve(false)}
    >
      <div className="app-modal-content" data-tone={tone}>
        <header className="app-modal-header">
          <h2 id={titleId}>{request.title}</h2>
        </header>
        <div id={descriptionId} className="app-modal-body">
          {request.body}
        </div>
        <div className="app-modal-actions">
          <button
            ref={cancelButtonRef}
            className="app-modal-action secondary"
            type="button"
            onClick={() => onResolve(false)}
          >
            {cancelLabel}
          </button>
          <button
            className="app-modal-action primary"
            data-tone={tone}
            type="button"
            onClick={() => onResolve(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export function useConfirmationDialog() {
  const [request, setRequest] = useState<PendingConfirmation | null>(null);
  const pendingResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const resolveRequest = useCallback((confirmed: boolean) => {
    const resolve = pendingResolveRef.current;
    if (!resolve) return;
    pendingResolveRef.current = null;
    setRequest(null);
    resolve(confirmed);
  }, []);

  const requestConfirmation = useCallback((config: ConfirmationDialogConfig) => {
    if (pendingResolveRef.current) {
      throw new Error("confirmation dialog already pending");
    }

    return new Promise<boolean>((resolve) => {
      pendingResolveRef.current = resolve;
      setRequest({ ...config, resolve });
    });
  }, []);

  useEffect(() => {
    return () => {
      const resolve = pendingResolveRef.current;
      if (!resolve) return;
      pendingResolveRef.current = null;
      resolve(false);
    };
  }, []);

  return {
    requestConfirmation,
    confirmationDialog: <ConfirmationDialog request={request} onResolve={resolveRequest} />,
  };
}
