import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConfirmationDialogConfig } from "../components/ConfirmationDialog";
import { useEditorStore, type EditorState } from "../store/editorStore";
import { defaultFileSessionStore, getPersistableText, useFileSessionStore } from "../store/fileSessionStore";
import { handleDocumentRequest } from "../platform/documentSession";
import { fileSessionStatus } from "../utils/fileSessionStatus";
import { isNativeTextEditingTarget } from "../utils/textEditingTarget";
import { startFileSync } from "../platform/fileSync";
import { createDesktopStorageAdapter } from "../platform/desktopStorage";
import { BLANK_DOCUMENT } from "../platform/blankDocument";

type Options = Pick<EditorState, "mode" | "revision" | "sourceText" | "docState" | "undo" | "redo"> & {
  requestConfirmation: (config: ConfirmationDialogConfig) => Promise<boolean>;
  prepareForPersistence: () => void;
  hasPendingCellEdit: boolean;
};
export function useFileSessionController({ mode, revision, sourceText, docState, undo, redo, requestConfirmation, prepareForPersistence, hasPendingCellEdit }: Options) {
  const prepareRef = useRef(prepareForPersistence);
  useLayoutEffect(() => { prepareRef.current = prepareForPersistence; }, [prepareForPersistence]);
  const editingRef = useRef(hasPendingCellEdit);
  const fileSyncRef = useRef<ReturnType<typeof startFileSync> | null>(null);
  useLayoutEffect(() => { editingRef.current = hasPendingCellEdit; }, [hasPendingCellEdit]);
  useEffect(() => {
    const bridge = window.ordinateDesktop;
    if (!bridge) return;
    const sync = startFileSync(defaultFileSessionStore, createDesktopStorageAdapter(bridge), () => editingRef.current);
    fileSyncRef.current = sync;
    return () => { sync.dispose(); fileSyncRef.current = null; };
  }, []);
  useEffect(() => {
    if (!hasPendingCellEdit) fileSyncRef.current?.refresh();
  }, [hasPendingCellEdit]);
  const fileSessionFile = useFileSessionStore((state) => state.file);
  const fileSessionOperation = useFileSessionStore((state) => state.operation);
  const fileSessionConflict = useFileSessionStore((state) => state.conflict);
  const fileSessionRecoveryDraft = useFileSessionStore((state) => state.recoveryDraft);
  const fileSessionBackingFileState = useFileSessionStore((state) => state.backingFileState);
  const fileSessionDocumentDirty = useFileSessionStore((state) => state.documentDirty);
  const fileSessionLocalDraftState = useFileSessionStore((state) => state.localDraftState);
  const fileSessionLastError = useFileSessionStore((state) => state.lastError);
  const openFile = useFileSessionStore((state) => state.open);
  const saveFile = useFileSessionStore((state) => state.save);
  const saveFileAs = useFileSessionStore((state) => state.saveAs);
  const autosaveFileNow = useFileSessionStore((state) => state.autosaveNow);
  const syncFileEditorSnapshot = useFileSessionStore((state) => state.syncEditorSnapshot);
  const loadUntitledFileDraft = useFileSessionStore((state) => state.loadUntitledDraft);
  const fileStatus = fileSessionStatus({
    operation: fileSessionOperation,
    conflict: fileSessionConflict,
    recoveryDraft: fileSessionRecoveryDraft,
    backingFileState: fileSessionBackingFileState,
    documentDirty: fileSessionDocumentDirty,
    localDraftState: fileSessionLocalDraftState,
    lastError: fileSessionLastError,
    file: fileSessionFile,
  }, !!window.ordinateDesktop);
  const fileName = fileSessionFile?.displayName ?? "Untitled";

  const fileSessionEditorSignatureRef = useRef<string | null>(null);
  const initializationRef = useRef<Promise<void> | null>(null);
  const [initializationStatus, setInitializationStatus] = useState<"loading" | "ready" | "failed">("loading");
  const shouldWarnBeforeUnload = fileSessionDocumentDirty === "dirty" && fileSessionLocalDraftState !== "current";

  useEffect(() => {
    // React StrictMode must not restore the same file twice or replace new edits.
    if (initializationRef.current) return;
    initializationRef.current = (async () => {
      const restored = await window.ordinateDesktop?.restoreDocument();
      if (restored?.snapshot) {
        await defaultFileSessionStore.getState().open(async () => restored.snapshot!);
        return;
      }
      if (restored) useEditorStore.getState().replaceDocumentText(restored.text ?? BLANK_DOCUMENT);
      await loadUntitledFileDraft();
      if (window.ordinateDesktop) {
        defaultFileSessionStore.getState().recoverDraft();
        await defaultFileSessionStore.getState().autosaveNow();
      }
    })();
    void initializationRef.current.then(() => setInitializationStatus("ready")).catch((error: unknown) => {
      defaultFileSessionStore.setState({ lastError: { kind: "read_failed", message: String(error) } });
      setInitializationStatus("failed");
    });
  }, [loadUntitledFileDraft]);

  useEffect(() => {
    const bridge = window.ordinateDesktop;
    if (!bridge) return;
    return bridge.onDocumentRequest(async (request) => {
      await initializationRef.current;
      // Commit any active cell/text editor before taking the persistence snapshot.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      await Promise.resolve();
      prepareRef.current();
      await handleDocumentRequest(defaultFileSessionStore, bridge, request);
    });
  }, []);

  useEffect(() => {
    const editorSignature = `${mode}:${revision}:${sourceText}`;
    syncFileEditorSnapshot();
    if (fileSessionEditorSignatureRef.current === null) {
      fileSessionEditorSignatureRef.current = editorSignature;
      return;
    }
    if (fileSessionEditorSignatureRef.current === editorSignature) {
      return;
    }
    fileSessionEditorSignatureRef.current = editorSignature;
    const timeout = window.setTimeout(() => {
      void autosaveFileNow();
    }, mode === "source" ? 1500 : 750);
    return () => window.clearTimeout(timeout);
  }, [mode, revision, sourceText, syncFileEditorSnapshot, autosaveFileNow]);

  useEffect(() => {
    if (!shouldWarnBeforeUnload) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shouldWarnBeforeUnload]);

  const resolveManualSaveOptions = useCallback(async (): Promise<{ allowInvalidSource?: boolean } | null> => {
    if (window.ordinateDesktop) return { allowInvalidSource: true };
    const persistableText = getPersistableText({ mode, sourceText, docState });
    if (persistableText.validity === "valid_document") return {};
    const confirmed = await requestConfirmation({
      title: "Save source anyway?",
      body: <p>The source text has issues. Save the file exactly as written?</p>,
      confirmLabel: "Save Anyway",
      cancelLabel: "Cancel",
      tone: "warning",
    });
    if (!confirmed) return null;
    return { allowInvalidSource: true };
  }, [docState, mode, requestConfirmation, sourceText]);

  const handleOpenFile = useCallback(async () => {
    if (window.ordinateDesktop) {
      await window.ordinateDesktop.openDocument();
      return;
    }
    if (fileSessionDocumentDirty === "dirty") {
      const confirmed = await requestConfirmation({
        title: "Open another file?",
        body: <p>Unsaved changes in this window will be replaced.</p>,
        confirmLabel: "Open File",
        cancelLabel: "Cancel",
        tone: "warning",
      });
      if (!confirmed) return;
    }
    void openFile();
  }, [fileSessionDocumentDirty, openFile, requestConfirmation, saveFileAs, mode, sourceText, docState]);

  const handleNewFile = useCallback(async () => {
    const bridge = window.ordinateDesktop;
    if (!bridge) throw new Error("New document tabs require the desktop host");
    await bridge.newDocument();
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (window.ordinateDesktop) prepareRef.current();
    const options = await resolveManualSaveOptions();
    if (!options) return;
    void saveFile(options);
  }, [resolveManualSaveOptions, saveFile]);

  const handleSaveFileAs = useCallback(async () => {
    if (window.ordinateDesktop) prepareRef.current();
    const options = await resolveManualSaveOptions();
    if (!options) return;
    void saveFileAs(options);
  }, [resolveManualSaveOptions, saveFileAs]);

  useEffect(() => window.ordinateDesktop?.onCommand((command) => {
    if ((command === "undo" || command === "redo")
      && (mode === "source" || isNativeTextEditingTarget(document.activeElement))) {
      void window.ordinateDesktop!.nativeHistory(command);
      return;
    }
    const handlers = { open: handleOpenFile, save: handleSaveFile, saveAs: handleSaveFileAs, undo, redo };
    void handlers[command]();
  }), [handleOpenFile, handleSaveFile, handleSaveFileAs, mode, undo, redo]);


  return { initializationStatus, fileName, fileStatus, handleNewFile, handleOpenFile, handleSaveFile, handleSaveFileAs };
}
