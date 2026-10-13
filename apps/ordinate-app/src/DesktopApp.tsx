import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import App from "./App";
import { ExampleDialog } from "./online/ExampleDialog";
import { readExampleAsset, shouldOfferExamples, type Example } from "./online/onlineModel";
import { finishStartup } from "./platform/startupScreen";
import type { OnlineEditorCommands } from "./platform/experience";
import { defaultFileSessionStore, useFileSessionStore } from "./store/fileSessionStore";
import "./online/online.css";

export default function DesktopApp() {
  const desktop = window.ordinateDesktop!;
  const [gallery, setGallery] = useState(false);
  const [examples, setExamples] = useState<Example[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [launchReady, setLaunchReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commands = useRef<OnlineEditorCommands | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const launchHandled = useRef(false);
  const interacted = useRef(false);
  const operation = useRef(false);
  const pristine = useFileSessionStore(shouldOfferExamples);

  useLayoutEffect(() => { host.current!.inert = gallery; }, [gallery]);

  const receiveCommands = useCallback((next: OnlineEditorCommands) => {
    commands.current = next;
    setReady(true);
  }, []);
  const showExamples = useCallback(() => {
    launchHandled.current = true;
    setGallery(true);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void readExampleAsset("catalog.json", abort.signal).then(text => {
      setExamples(JSON.parse(text) as Example[]);
      setCatalogReady(true);
    }).catch((cause: unknown) => {
      if (abort.signal.aborted) return;
      setError(String(cause));
      setCatalogReady(true);
    });
    return () => abort.abort();
  }, []);

  useLayoutEffect(() => {
    if (!ready || (desktop.offerExamplesOnLaunch && !catalogReady) || launchHandled.current) return;
    launchHandled.current = true;
    if (desktop.offerExamplesOnLaunch && pristine && !interacted.current && shouldOfferExamples(defaultFileSessionStore.getState())) setGallery(true);
    setLaunchReady(true);
  }, [desktop.offerExamplesOnLaunch, ready, catalogReady, pristine]);
  useLayoutEffect(() => { if (launchReady) finishStartup(); }, [launchReady]);

  const openExample = async (example: Example) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(example.id);
    setError(null);
    try {
      const text = await readExampleAsset(example.file);
      if (shouldOfferExamples(defaultFileSessionStore.getState())) {
        if (!commands.current) throw new Error("The editor is not ready to open an example.");
        if (!await commands.current.replaceDocument(text, example.title, "content")) return;
      } else {
        await desktop.openImportedDocument(text, example.title);
      }
      setGallery(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      operation.current = false;
      setBusy(null);
    }
  };
  const openBlank = async () => {
    if (operation.current) return;
    if (shouldOfferExamples(defaultFileSessionStore.getState())) { setGallery(false); return; }
    operation.current = true;
    setBusy("blank");
    setError(null);
    try { await desktop.newDocument(); setGallery(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { operation.current = false; setBusy(null); }
  };

  return <>
    <div ref={host} className="app-editor-host" onPointerDownCapture={() => { interacted.current = true; }} onKeyDownCapture={() => { interacted.current = true; }}>
      <App onSessionReady={receiveCommands} onShowExamples={showExamples} />
    </div>
    {gallery && <ExampleDialog examples={examples} loading={!catalogReady} busy={busy} error={error}
      onClose={() => setGallery(false)} onOpen={example => { void openExample(example); }}
      onBlank={() => { void openBlank(); }} onOpenFile={() => { setGallery(false); commands.current!.openFile(); }} />}
  </>;
}
