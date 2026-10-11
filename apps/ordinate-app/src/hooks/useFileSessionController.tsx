import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConfirmationDialogConfig } from "../components/ConfirmationDialog";
import { useEditorStore, type EditorState } from "../store/editorStore";
import { defaultFileSessionStore, formatStorageFailure, getPersistableText, readUploadedDocument, useFileSessionStore } from "../store/fileSessionStore";
import { installFileDrop, type FileDropCue } from "../platform/fileDrop";
import { readImportFile } from "../interchange/browserTransport";
import type { ImportFile } from "../interchange/contracts";
import { documentName } from "../platform/documentName";
import { handleDocumentRequest, waitForFileSession } from "../platform/documentSession";
import { fileSessionStatus } from "../utils/fileSessionStatus";
import { isNativeTextEditingTarget } from "../utils/textEditingTarget";
import { startFileSync } from "../platform/fileSync";
import { createDesktopStorageAdapter } from "../platform/desktopStorage";
import { BLANK_DOCUMENT } from "../platform/blankDocument";

type Options = Pick<EditorState, "mode" | "revision" | "sourceText" | "docState" | "undo" | "redo"> & {
  initialText?: string;
  requestConfirmation: (config: ConfirmationDialogConfig) => Promise<boolean>;
  prepareForPersistence: () => void;
  hasPendingCellEdit: boolean;
  assistantWorking: boolean;
  onImport: (file?: ImportFile) => void;
  onExport: () => void;
  onPrint: () => Promise<void>;
  onSettings: () => void;
  onBrowserOpen: (openDocument: () => void) => void;
};
export function useFileSessionController({ initialText, mode, revision, sourceText, docState, undo, redo, requestConfirmation, prepareForPersistence, hasPendingCellEdit, assistantWorking, onImport, onExport, onPrint, onBrowserOpen, onSettings }: Options) {
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
  const draftName = useFileSessionStore((state) => state.draftName);
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
  const fileName = documentName({ file: fileSessionFile, draftName });

  const fileSessionEditorSignatureRef = useRef<string | null>(null);
  const initializationRef = useRef<Promise<void> | null>(null);
  const [initializationStatus, setInitializationStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [fileDropCue, setFileDropCue] = useState<FileDropCue | null>(null);
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
      if (restored) {
        if (restored.text === null) defaultFileSessionStore.getState().initializeUntitled(BLANK_DOCUMENT, restored.draftName);
        else defaultFileSessionStore.getState().importUntitled(restored.text, restored.draftName ?? "Untitled");
      } else if (initialText !== undefined) {
        defaultFileSessionStore.getState().initializeUntitled(initialText);
      } else {
        defaultFileSessionStore.getState().initializeUntitled(getPersistableText(useEditorStore.getState()).text);
      }
      await loadUntitledFileDraft();
      // A failed restore must never autosave the empty startup document over the draft.
      const restoreError = defaultFileSessionStore.getState().lastError;
      if (initialText !== undefined && restoreError) {
        throw new Error(formatStorageFailure(restoreError));
      }
      if (window.ordinateDesktop || initialText !== undefined) {
        defaultFileSessionStore.getState().recoverDraft();
        await defaultFileSessionStore.getState().autosaveNow();
      }
    })();
    void initializationRef.current.then(() => setInitializationStatus("ready")).catch((error: unknown) => {
      defaultFileSessionStore.setState({ lastError: { kind: "read_failed", message: String(error) } });
      setInitializationStatus("failed");
    });
  }, [loadUntitledFileDraft, initialText]);

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
      const state = defaultFileSessionStore.getState();
      return { needsSave: state.file === null && state.documentDirty === "dirty" };
    });
  }, []);

  useEffect(() => {
    if (initializationStatus !== "ready") return;
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
  }, [initializationStatus, mode, revision, sourceText, syncFileEditorSnapshot, autosaveFileNow]);

  useEffect(() => {
    if (!shouldWarnBeforeUnload && !hasPendingCellEdit) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shouldWarnBeforeUnload, hasPendingCellEdit]);

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

  const prepareDocumentSwitch = useCallback(async () => {
    prepareRef.current();
    await waitForFileSession(defaultFileSessionStore);
    defaultFileSessionStore.getState().syncEditorSnapshot();
  }, []);

  const handleOpenDocument = useCallback(async (file?: File) => {
    await prepareDocumentSwitch();
    if (window.ordinateDesktop) {
      await window.ordinateDesktop.openDocument(file);
      return;
    }
    defaultFileSessionStore.getState().syncEditorSnapshot();
    if (defaultFileSessionStore.getState().documentDirty === "dirty") {
      const confirmed = await requestConfirmation({
        title: "Open another file?",
        body: <p>Unsaved changes in this window will be replaced.</p>,
        confirmLabel: "Open File",
        cancelLabel: "Cancel",
        tone: "warning",
      });
      if (!confirmed) return;
    }
    await openFile(file ? () => readUploadedDocument(file) : undefined);
  }, [openFile, requestConfirmation, prepareDocumentSwitch]);

  const dropActions = useRef({ handleOpenDocument, onImport, requestConfirmation, initializationStatus, assistantWorking });
  useLayoutEffect(() => {
    dropActions.current = { handleOpenDocument, onImport, requestConfirmation, initializationStatus, assistantWorking };
  }, [handleOpenDocument, onImport, requestConfirmation, initializationStatus, assistantWorking]);
  useEffect(() => {
    const canDrop = () => dropActions.current.initializationStatus === "ready"
      && !dropActions.current.assistantWorking
      && !document.querySelector('[role="dialog"][aria-modal="true"]')
      && !defaultFileSessionStore.getState().operation;
    return installFileDrop(window, {
      scope: "open",
      canDrop,
      preview: setFileDropCue,
      receive: async (file, kind) => {
        if (kind === "document") await dropActions.current.handleOpenDocument(file);
        else {
          const imported = await readImportFile(file);
          // A command may have opened a dialog while the file was being read.
          if (canDrop()) dropActions.current.onImport(imported);
        }
      },
      report: async error => {
        if (!canDrop()) return;
        await dropActions.current.requestConfirmation({ title: "Could not open file",
          body: <p>{error instanceof Error ? error.message : String(error)}</p>, confirmLabel: "OK", tone: "warning" });
      },
    });
  }, []);

  const handleOpenFile = useCallback(() => {
    if (window.ordinateDesktop) void handleOpenDocument();
    else onBrowserOpen(handleOpenDocument);
  }, [handleOpenDocument, onBrowserOpen]);

  const handleOpenDocumentText = useCallback(async (text: string, name: string, origin: "new" | "content") => {
    await prepareDocumentSwitch();
    const session = defaultFileSessionStore.getState();
    session.syncEditorSnapshot();
    if (session.operation || session.conflict || session.recoveryDraft || session.externalSnapshot) {
      throw new Error("Resolve the current file notice before opening another document.");
    }
    const current = defaultFileSessionStore.getState();
    if (current.documentDirty === "dirty") {
      const confirmed = await requestConfirmation({
        title: "Replace this document?",
        body: <p>Save a copy first if you want to keep the current document.</p>,
        confirmLabel: "Replace document", cancelLabel: "Keep editing", tone: "warning",
      });
      if (!confirmed) return false;
    }
    if (origin === "new") defaultFileSessionStore.getState().initializeUntitled(text, name);
    else defaultFileSessionStore.getState().importUntitled(text, name);
    await defaultFileSessionStore.getState().autosaveNow();
    return true;
  }, [requestConfirmation, prepareDocumentSwitch]);

  const handleNewFile = useCallback(async () => {
    const bridge = window.ordinateDesktop;
    if (bridge) await bridge.newDocument();
    else await handleOpenDocumentText(BLANK_DOCUMENT, "Untitled.ord", "new");
  }, [handleOpenDocumentText]);

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
    if (assistantWorking && ["open", "undo", "redo", "import"].includes(command)) return;
    if ((command === "undo" || command === "redo")
      && (mode === "source" || isNativeTextEditingTarget(document.activeElement))) {
      void window.ordinateDesktop!.nativeHistory(command);
      return;
    }
    // Native menu accelerators bypass DOM keyboard bubbling. A modal must not
    // let Undo/Open/Save mutate the document behind a conversion review.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const handlers = { open: handleOpenFile, save: handleSaveFile, saveAs: handleSaveFileAs, undo, redo, import: onImport, export: onExport, print: onPrint, settings: onSettings };
    void handlers[command]();
  }), [assistantWorking, handleOpenFile, handleSaveFile, handleSaveFileAs, mode, undo, redo, onImport, onExport, onPrint, onSettings]);


  return { initializationStatus, fileDropCue, fileName, fileStatus, handleNewFile, handleOpenFile, handleOpenDocumentText, handleSaveFile, handleSaveFileAs };
}
