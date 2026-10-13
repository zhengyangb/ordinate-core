import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import App from "../App";
import { BLANK_DOCUMENT } from "../platform/blankDocument";
import type { OnlineChrome, OnlineEditorCommands } from "../platform/experience";
import { formatStorageFailure, useFileSessionStore } from "../store/fileSessionStore";
import { InfoDialog } from "../components/InfoDialog";
import { revealStartupWhenVisible } from "../platform/startupScreen";
import { ExampleDialog } from "./ExampleDialog";
import { remoteUrlFromFragment } from "./remoteWorkbook";
import { useRemoteWorkbook } from "./useRemoteWorkbook";
import { desktopPlatform, exampleById, macDownloadUrl, readExampleAsset, shouldOfferExamples, type Example } from "./onlineModel";
import "./online.css";

const releaseUrl = macDownloadUrl(import.meta.env.VITE_MAC_DOWNLOAD_URL);
const platform = desktopPlatform(navigator.platform, navigator.maxTouchPoints);

export default function OnlineApp() {
  const [gallery, setGallery] = useState(false);
  const [examples, setExamples] = useState<Example[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [launchReady, setLaunchReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availabilityNotice, setAvailabilityNotice] = useState<"assistant" | "desktop" | null>(null);
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
    void readExampleAsset("catalog.json", abort.signal).then(text => {
      setExamples(JSON.parse(text) as Example[]);
      setCatalogReady(true);
    }).catch((cause: unknown) => { if (!abort.signal.aborted) { setError(String(cause)); setCatalogReady(true); } });
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
      const text = example ? resetText ?? await readExampleAsset(example.file) : BLANK_DOCUMENT;
      // Only one modal owns focus: any replacement confirmation belongs to App.
      setGallery(false);
      // Built-in examples start new documents from pristine templates; imported
      // content remains a dirty working copy that must be saved explicitly.
      const accepted = await commands.current.replaceDocument(text, example?.title ?? "Untitled", "new");
      if (accepted) setSelected(example ? { example, text } : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { operation.current = false; setBusy(null); }
  }, []);

  useLayoutEffect(() => {
    if (!ready || !catalogReady || launchHandled.current) return;
    if (openRemoteFragment()) { setLaunchReady(true); return; }
    const url = new URL(location.href);
    const id = url.searchParams.get("example");
    if (id) {
      launchHandled.current = true;
      // Reload recovers edits instead of reopening the original template.
      url.searchParams.delete("example"); history.replaceState(null, "", url);
      try {
        const opening = openDocument(exampleById(examples, id));
        if (pristine) void opening.finally(() => setLaunchReady(true));
        else setLaunchReady(true);
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setLaunchReady(true); }
      return;
    }
    launchHandled.current = true;
    if (pristine && !interacted.current) setGallery(true);
    setLaunchReady(true);
  }, [examples, ready, catalogReady, pristine, openDocument, openRemoteFragment]);
  useLayoutEffect(() => { if (launchReady) return revealStartupWhenVisible(); }, [launchReady]);

  const online: OnlineChrome = {
    desktopPlatform: platform,
    showDesktopAvailability: () => {
      if (platform === "mac" && releaseUrl) window.open(releaseUrl, "_blank", "noopener,noreferrer");
      else setAvailabilityNotice("desktop");
    },
    showAssistantAvailability: () => setAvailabilityNotice("assistant"),
    openFromLink: () => { launchHandled.current = true; setGallery(false); setError(null); remote.openFromLink(); },
    resetExample: selected && file === null && draftName === selected.example.title
      ? () => { void openDocument(selected.example, selected.text); } : undefined,
  };
  const beginWorking = () => { interacted.current = true; };

  return <>
    <div ref={host} className="app-editor-host" onPointerDownCapture={beginWorking} onKeyDownCapture={beginWorking}>
      <App initialText={BLANK_DOCUMENT} online={online} onSessionReady={receiveCommands}
        onShowExamples={() => { launchHandled.current = true; setGallery(true); }} />
    </div>
    {gallery && <ExampleDialog examples={examples} busy={busy} error={error} onClose={closeGallery}
      onOpen={example => { void openDocument(example); }} onBlank={() => { void openDocument(); }}
      onOpenFile={() => { setGallery(false); commands.current!.openFile(); }} />}
    {remote.dialog}
    {!gallery && !remote.isOpen && (error || startupError || remote.detachedError) && <InfoDialog title="Could not open document" onClose={() => {
      if (startupError) location.reload();
      else { setError(null); remote.clearError(); }
    }}><p>{error ?? startupError ?? remote.detachedError}</p></InfoDialog>}
    {availabilityNotice && <InfoDialog
      title={availabilityNotice === "assistant" ? "AI Assistant is in the desktop app" : platform === "mac" ? "Mac app isn’t available yet" : `${platform === "windows" ? "Windows" : platform === "linux" ? "Linux" : "Desktop"} app · Coming soon`}
      onClose={() => setAvailabilityNotice(null)}
      action={platform === "mac" && releaseUrl && availabilityNotice === "assistant" ? { label: "Get Mac app", onClick: () => { window.open(releaseUrl, "_blank", "noopener,noreferrer"); setAvailabilityNotice(null); } } : undefined}
    ><p>{availabilityNotice === "assistant"
      ? platform === "mac" ? releaseUrl ? "To work with your workbook using AI, open it in Ordinate for Mac." : "AI Assistant comes with Ordinate for Mac. The Mac app hasn’t been published yet." : `AI Assistant is available in the desktop app. The ${platform === "windows" ? "Windows" : platform === "linux" ? "Linux" : "desktop"} version is coming soon.`
      : platform === "mac" ? "The Mac app hasn’t been published yet. You can keep working in Ordinate Online." : `Ordinate for ${platform === "windows" ? "Windows" : platform === "linux" ? "Linux" : "your platform"} is coming soon. You can keep working in Ordinate Online.`}</p></InfoDialog>}
  </>;
}
