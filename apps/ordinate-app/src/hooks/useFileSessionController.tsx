import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { ConfirmationDialogConfig } from "../components/ConfirmationDialog";
import type { EditorState } from "../store/editorStore";
import { defaultFileSessionStore, getPersistableText, useFileSessionStore } from "../store/fileSessionStore";
import { flushFileSession, handleDocumentRequest } from "../platform/documentSession";
import { fileSessionStatus } from "../utils/fileSessionStatus";
import { isNativeTextEditingTarget } from "../utils/textEditingTarget";
import { startFileSync } from "../platform/fileSync";
import { createDesktopStorageAdapter } from "../platform/desktopStorage";

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
  const initialTextRef = useRef(getPersistableText({ mode, sourceText, docState }).text);
  const restoredUntitledRef = useRef(false);
  const shouldWarnBeforeUnload = fileSessionDocumentDirty === "dirty" && fileSessionLocalDraftState !== "current";

  useEffect(() => {
    // React StrictMode must not restore the same file twice or replace new edits.
    if (initializationRef.current) return;
    initializationRef.current = (async () => {
      const restored = await window.ordinateDesktop?.restoreDocument();
      if (restored) {
        await defaultFileSessionStore.getState().open(async () => restored);
        return;
      }
      await loadUntitledFileDraft();
      restoredUntitledRef.current = defaultFileSessionStore.getState().localDraftText !== null;
      if (window.ordinateDesktop) defaultFileSessionStore.getState().recoverDraft();
    })();
    void initializationRef.current.catch((error: unknown) => {
      defaultFileSessionStore.setState({ lastError: { kind: "read_failed", message: String(error) } });
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
      try { prepareRef.current(); await flushFileSession(defaultFileSessionStore); }
      catch (error) {
        await requestConfirmation({ title: "Couldn't finish saving", body: <p>{String(error)}</p>, confirmLabel: "Keep Editing", cancelLabel: "Cancel", tone: "warning" });
        return;
      }
      // Preserve the existing single untitled draft before replacing this window.
      // Naming it once avoids an inaccessible orphan behind a named session.
      const hasUntitledWork = restoredUntitledRef.current || getPersistableText({ mode, sourceText, docState }).text !== initialTextRef.current;
      if (!defaultFileSessionStore.getState().file && hasUntitledWork) {
        await saveFileAs({ allowInvalidSource: true });
        if (!defaultFileSessionStore.getState().file) return;
      }
      await openFile();
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


  return { fileName, fileStatus, handleOpenFile, handleSaveFile, handleSaveFileAs };
}
