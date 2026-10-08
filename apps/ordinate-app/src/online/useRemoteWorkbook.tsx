import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { OnlineEditorCommands } from "../platform/experience";
import { RemoteWorkbookDialog } from "./RemoteWorkbookDialog";
import { createRemoteApprovalStore, readRemoteWorkbook, remoteWorkbook, type RemoteWorkbook } from "./remoteWorkbook";

export function useRemoteWorkbook({ commands, operation, onOpened, onError }: {
  commands: MutableRefObject<OnlineEditorCommands | null>; operation: MutableRefObject<boolean>;
  onOpened: () => void; onError: (message: string) => void;
}) {
  const [request, setRequest] = useState<{ remote: RemoteWorkbook | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const close = useCallback(() => { active.current?.abort(); setRequest(null); setError(null); }, []);
  useEffect(() => () => active.current?.abort(), []);

  const open = useCallback(async (input: string) => {
    if (!commands.current || operation.current) return;
    operation.current = true;
    const abort = new AbortController(); active.current = abort;
    setBusy(true); setError(null);
    try {
      const remote = remoteWorkbook(input, location.origin);
      // An explicit Open click is consent. The launch path only
      // invokes this automatically after finding a separately stored approval.
      createRemoteApprovalStore(localStorage).approve(remote.url);
      // A link imports fresh input, never identifies an existing working copy.
      // Tab recovery and URL permission are independent of this network read.
      const text = await readRemoteWorkbook(remote, abort.signal);
      if (abort.signal.aborted) return;
      // App owns the replacement confirmation; never stack two focus traps.
      setRequest(null);
      const accepted = await commands.current.replaceDocument(text, remote.name, "content");
      if (accepted) onOpened();
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { operation.current = false; active.current = null; setBusy(false); }
  }, [commands, operation, onOpened]);

  const openUrl = useCallback((remote: RemoteWorkbook) => {
    if (operation.current) return;
    setError(null);
    try {
      const approved = createRemoteApprovalStore(localStorage).has(remote.url);
      // Consent is a decision, not a loading state. Mounting its dialog for an
      // approved URL would briefly blur the editor while the file is read.
      if (approved) void open(remote.url);
      else setRequest({ remote });
    } catch (cause) { onError(cause instanceof Error ? cause.message : String(cause)); }
  }, [open, onError, operation]);

  return {
    openUrl,
    openFromLink: () => { if (!operation.current) { setError(null); setRequest({ remote: null }); } },
    isOpen: !!request,
    dialog: request ? <RemoteWorkbookDialog remote={request.remote} busy={busy} error={error}
      onClose={close} onOpen={value => { void open(value); }} /> : null,
    // Replacement/session errors occur after the link dialog has relinquished focus.
    detachedError: !request ? error : null,
    clearError: () => setError(null),
  };
}
