import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import App from "../App";
import { BLANK_DOCUMENT } from "../platform/blankDocument";
import type { OnlineChrome, OnlineEditorCommands } from "../platform/experience";
import { formatStorageFailure, useFileSessionStore } from "../store/fileSessionStore";
import { InfoDialog } from "../components/InfoDialog";
import { ExampleDialog } from "./ExampleDialog";
import { afterVisiblePause } from "./visibleEntrance";
import { remoteUrlFromFragment } from "./remoteWorkbook";
import { useRemoteWorkbook } from "./useRemoteWorkbook";
import { exampleAssetUrl, exampleById, isMacPlatform, macDownloadUrl, shouldOfferExamples, type Example } from "./onlineModel";
import "./online.css";

const releaseUrl = macDownloadUrl(import.meta.env.VITE_MAC_DOWNLOAD_URL);
const mac = isMacPlatform(navigator.platform, navigator.maxTouchPoints);

async function readAsset(file: string, signal?: AbortSignal) {
  const response = await fetch(exampleAssetUrl(file, import.meta.env.BASE_URL, location.href), { signal });
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
  return response.text();
}

export default function OnlineApp() {
  const [gallery, setGallery] = useState(false);
  const [examples, setExamples] = useState<Example[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState(false);
  const [selected, setSelected] = useState<{ example: Example; text: string } | null>(null);
  const commands = useRef<OnlineEditorCommands | null>(null);
  const operation = useRef(false);
  const launchHandled = useRef(false);
  const interacted = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const draftName = useFileSessionStore(state => state.draftName);
  const file = useFileSessionStore(state => state.file);
  const pristine = useFileSessionStore(shouldOfferExamples);
  const sessionError = useFileSessionStore(state => state.lastError);
  const startupError = !ready && sessionError ? formatStorageFailure(sessionError) : null;
  const receiveCommands = useCallback((next: OnlineEditorCommands) => { commands.current = next; setReady(true); }, []);
  const closeGallery = useCallback(() => { setGallery(false); }, []);
  const remoteOpened = useCallback(() => setSelected(null), []);
  const remote = useRemoteWorkbook({ commands, operation, onOpened: remoteOpened, onError: setError });
  const openRemoteFragment = useCallback(() => {
    const url = new URL(location.href);
    if (!url.hash.startsWith("#url=")) return false;
    launchHandled.current = true; setGallery(false); setError(null);
    // Consume even a rejected launch link. Refresh recovers the local document,
    // not an unsolicited retry or a fresh download over the user's changes.
    const hash = url.hash; url.hash = "";
    history.replaceState(null, "", url);
    try {
      if (url.searchParams.has("example")) throw new Error("Use either an example link or a file link, not both.");
      remote.openUrl(remoteUrlFromFragment(hash, location.origin)!);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    return true;
  }, [remote.openUrl]);

  useEffect(() => {
    const abort = new AbortController();
    void readAsset("catalog.json", abort.signal).then(text => setExamples(JSON.parse(text) as Example[]))
      .catch((cause: unknown) => { if (!abort.signal.aborted) setError(String(cause)); });
    return () => abort.abort();
  }, []);
  useLayoutEffect(() => { host.current!.inert = gallery || remote.isOpen; }, [gallery, remote.isOpen]);

  useEffect(() => {
    if (!ready) return;
    const changed = () => { if (!operation.current) openRemoteFragment(); };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [ready, openRemoteFragment]);

  const openDocument = useCallback(async (example?: Example, resetText?: string) => {
    if (!commands.current || operation.current) return;
    operation.current = true;
    setBusy(example?.id ?? "blank"); setError(null);
    try {
      const text = example ? resetText ?? await readAsset(example.file) : BLANK_DOCUMENT;
      // Only one modal owns focus: any replacement confirmation belongs to App.
      setGallery(false);
      const accepted = await commands.current.replaceDocument(text, example?.title ?? "Untitled", example ? "content" : "new");
      if (accepted) setSelected(example ? { example, text } : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { operation.current = false; setBusy(null); }
  }, []);

  useEffect(() => {
    if (!ready || launchHandled.current) return;
    if (openRemoteFragment()) return;
    if (!examples.length) return;
    const url = new URL(location.href);
    const id = url.searchParams.get("example");
    if (id) {
      launchHandled.current = true;
      // Reload recovers edits instead of reopening the original template.
      url.searchParams.delete("example"); history.replaceState(null, "", url);
      try { void openDocument(exampleById(examples, id)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      return;
    }
    if (!pristine || interacted.current) { launchHandled.current = true; return; }
    // A background tab must not spend the entrance before the user sees it.
    // Cancel if content changes or the user starts working during the pause.
    return afterVisiblePause(() => {
      // A hash-only navigation does not remount the editor. It can claim the
      // launch while this invitation's visible pause is still pending.
      if (launchHandled.current || interacted.current) return;
      launchHandled.current = true;
      setGallery(true);
    });
  }, [examples, ready, pristine, openDocument, openRemoteFragment]);

  const downloadMac = () => {
    if (releaseUrl) window.open(releaseUrl, "_blank", "noopener,noreferrer");
    else setDownloadNotice(true);
  };
  const online: OnlineChrome = {
    isMac: mac, downloadMac,
    showExamples: () => { launchHandled.current = true; setGallery(true); },
    openFromLink: () => { launchHandled.current = true; setGallery(false); setError(null); remote.openFromLink(); },
    resetExample: selected && file === null && draftName === selected.example.title
      ? () => { void openDocument(selected.example, selected.text); } : undefined,
  };
  const beginWorking = () => { interacted.current = true; };

  return <>
    <div ref={host} className="online-editor-host" onPointerDownCapture={beginWorking} onKeyDownCapture={beginWorking}>
      <App initialText={BLANK_DOCUMENT} online={online} onSessionReady={receiveCommands} />
    </div>
    {gallery && <ExampleDialog examples={examples} busy={busy} error={error} onClose={closeGallery}
      onOpen={example => { void openDocument(example); }} onBlank={() => { void openDocument(); }}
      onOpenFile={() => { setGallery(false); commands.current!.openFile(); }} />}
    {remote.dialog}
    {!gallery && !remote.isOpen && (error || startupError || remote.detachedError) && <InfoDialog title="Could not open document" onClose={() => {
      if (startupError) location.reload();
      else { setError(null); remote.clearError(); }
    }}><p>{error ?? startupError ?? remote.detachedError}</p></InfoDialog>}
    {downloadNotice && <InfoDialog title="Mac download isn’t available yet" onClose={() => setDownloadNotice(false)}><p>The Mac app hasn’t been published. You can keep working in Ordinate.</p></InfoDialog>}
  </>;
}
