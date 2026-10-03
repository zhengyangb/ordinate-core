import { DocumentState, serializeDocumentState, validateDocument } from "@ordinate/core";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import { type EditorState, useEditorStore } from "./editorStore";
import { createDesktopStorageAdapter } from "../platform/desktopStorage";
import type {
  FileSessionVersion, FilePermissionState, FileReference, FileSnapshot,
  StorageFailure, StorageResult, StorageCapabilities, StorageAvailability, StorageAdapter,
} from "../platform/storage";

export type PersistableText = {
  text: string;
  validity: "valid_document" | "invalid_source";
  source: "table" | "source";
};

export type DocumentDirtyState = "clean" | "dirty";
export type BackingFileState = "none" | "clean" | "dirty" | "external_changed" | "conflict" | "unavailable" | "error";
export type LocalDraftState = "none" | "stale" | "current" | "newer_than_backing" | "error";

export type FileOperationKind =
  | "open"
  | "save"
  | "save_as"
  | "autosave_backing"
  | "autosave_local_draft"
  | "load_untitled_draft"
  | "reload_from_disk"
  | "overwrite_conflict";

export type FileOperation = {
  id: string;
  kind: FileOperationKind;
  fileId: string | null;
  text: string;
  expectedVersion: FileSessionVersion | null;
};

export type FileConflict = {
  kind: "local_dirty_vs_external_change";
  file: FileReference;
  diskText: string;
  diskVersion: FileSessionVersion;
  baselineText: string;
  baselineVersion: FileSessionVersion;
  editorText: string;
};

export type LocalDraftRecord = {
  key: string;
  text: string;
  version: string;
  updatedAt: number;
};

export type RecoveryDraft = {
  key: string;
  draft: LocalDraftRecord;
  fileText: string;
};

export type LocalDraftStore = {
  get: (key: string) => Promise<LocalDraftRecord | null>;
  set: (record: LocalDraftRecord) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

type EditorBridge = {
  getPersistableText: () => PersistableText;
  replaceDocumentText: EditorState["replaceDocumentText"];
};

export type FileSessionState = {
  file: FileReference | null;
  backingText: string | null;
  backingVersion: FileSessionVersion | null;
  externalSnapshot: FileSnapshot | null;
  localDraftText: string | null;
  localDraftVersion: string | null;
  documentDirty: DocumentDirtyState;
  backingFileState: BackingFileState;
  localDraftState: LocalDraftState;
  availability: StorageAvailability;
  conflict: FileConflict | null;
  recoveryDraft: RecoveryDraft | null;
  operation: FileOperation | null;
  pendingAutosave: boolean;
  autosaveEnabled: boolean;
  lastError: StorageFailure | null;
  open: (read?: () => Promise<StorageResult<FileSnapshot>>) => Promise<void>;
  save: (options?: { allowInvalidSource?: boolean }) => Promise<void>;
  saveAs: (options?: { allowInvalidSource?: boolean }) => Promise<void>;
  persistTo: (write: (text: string) => Promise<StorageResult<FileSnapshot>>, options?: { allowInvalidSource?: boolean }) => Promise<void>;
  autosaveNow: () => Promise<void>;
  syncEditorSnapshot: () => void;
  loadUntitledDraft: () => Promise<void>;
  handleExternalSnapshot: (snapshot: FileSnapshot) => void;
  refreshFromDisk: (canApply: () => boolean) => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  overwriteConflict: () => Promise<void>;
  saveConflictAsNewFile: () => Promise<void>;
  cancelConflict: () => void;
  recoverDraft: () => void;
  openSavedFile: () => Promise<void>;
  discardDraft: () => Promise<void>;
};

type FileSessionDeps = {
  autosaveInvalidSource?: boolean;
  adapter: StorageAdapter;
  localDraftStore: LocalDraftStore;
  editor: EditorBridge;
  now?: () => number;
  createOperationId?: () => string;
  createUntitledId?: () => string;
};

const UNAVAILABLE: StorageAvailability = {
  readPermission: "unavailable",
  writePermission: "unavailable",
};

const DEFAULT_CAPABILITIES: StorageCapabilities = {
  canAutosaveToBackingFile: false,
  canReadCurrentBackingFile: false,
  canWatchBackingFile: false,
  canAtomicCompareAndWrite: false,
};

let nextOperationNumber = 1;
let nextUntitledNumber = 1;

function defaultOperationId(): string {
  const id = `file-op-${nextOperationNumber}`;
  nextOperationNumber += 1;
  return id;
}

function defaultUntitledId(): string {
  const id = `untitled-${nextUntitledNumber}`;
  nextUntitledNumber += 1;
  return id;
}

function ok<T>(value: T): StorageResult<T> {
  return { ok: true, value };
}

function err<T>(error: StorageFailure): StorageResult<T> {
  return { ok: false, error };
}

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sameFile(a: FileReference | null, b: FileReference | null): boolean {
  return Boolean(a && b && a.id === b.id && a.adapterKind === b.adapterKind);
}

function draftKeyFor(file: FileReference | null, untitledId: string): string {
  if (file?.draftKey) return file.draftKey;
  if (file) return `${file.adapterKind}:${file.id}`;
  return `untitled:${untitledId}`;
}

function recomputeDirtyState(
  state: Pick<FileSessionState, "file" | "backingText" | "localDraftText" | "conflict" | "externalSnapshot" | "backingFileState">,
  editorText: string,
): Pick<FileSessionState, "documentDirty" | "backingFileState" | "localDraftState"> {
  const documentDirty: DocumentDirtyState = state.backingText === editorText ? "clean" : "dirty";
  const localDraftState: LocalDraftState =
    state.localDraftText == null ? "none" : state.localDraftText === editorText ? "current" : "stale";

  let backingFileState: BackingFileState;
  if (!state.file) {
    backingFileState = "none";
  } else if (state.conflict) {
    backingFileState = "conflict";
  } else if (state.externalSnapshot) {
    backingFileState = "external_changed";
  } else {
    backingFileState = documentDirty === "clean" ? "clean" : "dirty";
  }

  return { documentDirty, backingFileState, localDraftState };
}

function operationMatches(operation: FileOperation | null, expected: FileOperation): boolean {
  return Boolean(
    operation
    && operation.id === expected.id
    && operation.kind === expected.kind
    && operation.fileId === expected.fileId
    && operation.text === expected.text
    && operation.expectedVersion === expected.expectedVersion
  );
}

function formatStorageFailure(error: StorageFailure): string {
  if (error.kind === "permission_denied") return "File permission was denied.";
  if (error.kind === "not_found") return "The backing file could not be found.";
  if (error.kind === "read_failed") return error.message;
  if (error.kind === "write_failed") return error.message;
  if (error.kind === "version_mismatch") return "The backing file changed before save.";
  return "The file operation was cancelled.";
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getPersistableText(editor: Pick<EditorState, "mode" | "sourceText" | "docState">): PersistableText {
  if (editor.mode === "table") {
    if (!editor.docState) {
      throw new Error("cannot persist table mode without an active document");
    }
    return {
      text: serializeDocumentState(editor.docState),
      validity: "valid_document",
      source: "table",
    };
  }

  const sourceText = editor.sourceText;
  try {
    DocumentState.fromText(sourceText);
    const validation = validateDocument(sourceText);
    return {
      text: sourceText,
      validity: validation.errors.length === 0 ? "valid_document" : "invalid_source",
      source: "source",
    };
  } catch {
    return {
      text: sourceText,
      validity: "invalid_source",
      source: "source",
    };
  }
}

function createInitialFileSessionState(): Omit<
  FileSessionState,
  | "open"
  | "save"
  | "saveAs"
  | "persistTo"
  | "autosaveNow"
  | "syncEditorSnapshot"
  | "loadUntitledDraft"
  | "handleExternalSnapshot"
  | "refreshFromDisk"
  | "reloadFromDisk"
  | "overwriteConflict"
  | "saveConflictAsNewFile"
  | "cancelConflict"
  | "recoverDraft"
  | "openSavedFile"
  | "discardDraft"
> {
  return {
    file: null,
    backingText: null,
    backingVersion: null,
    externalSnapshot: null,
    localDraftText: null,
    localDraftVersion: null,
    documentDirty: "clean",
    backingFileState: "none",
    localDraftState: "none",
    availability: UNAVAILABLE,
    conflict: null,
    recoveryDraft: null,
    operation: null,
    pendingAutosave: false,
    autosaveEnabled: true,
    lastError: null,
  };
}

export function createFileSessionStore(deps: FileSessionDeps): StoreApi<FileSessionState> {
  const now = deps.now ?? (() => Date.now());
  const createOperationId = deps.createOperationId ?? defaultOperationId;
  const untitledId = (deps.createUntitledId ?? defaultUntitledId)();
  const supersededBackingWrites: FileOperation[] = [];

  const rememberSupersededBackingWrite = (operation: FileOperation | null, fileId: string) => {
    if (!operation) return;
    if ((operation.kind === "autosave_backing" || operation.kind === "save") && operation.fileId === fileId) {
      supersededBackingWrites.push(operation);
    }
  };

  const consumeSupersededBackingWrite = (snapshot: FileSnapshot): boolean => {
    const index = supersededBackingWrites.findIndex(
      (operation) =>
        operation.fileId === snapshot.file.id
        && operation.text === snapshot.text
        && operation.expectedVersion !== snapshot.version,
    );
    if (index === -1) return false;
    supersededBackingWrites.splice(index, 1);
    return true;
  };

  const readLocalDraft = async (key: string): Promise<StorageResult<LocalDraftRecord | null>> => {
    try {
      return ok(await deps.localDraftStore.get(key));
    } catch (error) {
      return err({ kind: "read_failed", message: `Local draft could not be read: ${formatUnknownError(error)}` });
    }
  };

  const setLocalDraft = async (record: LocalDraftRecord): Promise<StorageResult<LocalDraftRecord>> => {
    try {
      await deps.localDraftStore.set(record);
      return ok(record);
    } catch (error) {
      return err({ kind: "write_failed", message: `Local draft could not be written: ${formatUnknownError(error)}` });
    }
  };

  const removeLocalDraft = async (key: string): Promise<StorageResult<void>> => {
    try {
      await deps.localDraftStore.remove(key);
      return ok(undefined);
    } catch (error) {
      return err({ kind: "write_failed", message: `Local draft could not be removed: ${formatUnknownError(error)}` });
    }
  };

  const writeLocalDraft = async (
    get: () => FileSessionState,
    set: (state: Partial<FileSessionState>) => void,
    text: string,
    operationKind: FileOperationKind,
  ): Promise<{ applied: boolean; needsFollowup: boolean }> => {
    const state = get();
    const key = draftKeyFor(state.file, untitledId);
    const operation: FileOperation = {
      id: createOperationId(),
      kind: operationKind,
      fileId: state.file?.id ?? null,
      text,
      expectedVersion: state.backingVersion,
    };
    set({ operation, pendingAutosave: false, lastError: null });
    const record: LocalDraftRecord = {
      key,
      text,
      version: `${operation.id}:${now()}`,
      updatedAt: now(),
    };
    const write = await setLocalDraft(record);
    if (!operationMatches(get().operation, operation)) return { applied: false, needsFollowup: false };
    if (!write.ok) {
      set({
        operation: null,
        pendingAutosave: false,
        localDraftState: "error",
        lastError: write.error,
      });
      return { applied: true, needsFollowup: false };
    }
    const current = get();
    const editorText = deps.editor.getPersistableText().text;
    const needsFollowup = current.pendingAutosave || editorText !== text;
    set({
      localDraftText: record.text,
      localDraftVersion: record.version,
      operation: null,
      pendingAutosave: false,
      lastError: null,
      ...recomputeDirtyState({ ...current, localDraftText: record.text }, editorText),
    });
    return { applied: true, needsFollowup };
  };

  const setBackingSnapshot = async (
    get: () => FileSessionState,
    set: (state: Partial<FileSessionState>) => void,
    snapshot: FileSnapshot,
    options?: { normalizeToEditorText?: boolean; operation?: FileOperation },
  ): Promise<{ applied: boolean; needsFollowup: boolean }> => {
    const current = get();
    if (options?.operation && !operationMatches(current.operation, options.operation)) return { applied: false, needsFollowup: false };
    const initialEditorText = deps.editor.getPersistableText().text;
    const backingText = options?.normalizeToEditorText ? initialEditorText : snapshot.text;
    const previousDraftKey = draftKeyFor(current.file, untitledId);
    const localDraftKey = draftKeyFor(snapshot.file, untitledId);
    const shouldClearDraft = current.localDraftText === snapshot.text || current.localDraftText === backingText;
    let cleanupError: StorageFailure | null = null;
    if (shouldClearDraft) {
      if (previousDraftKey !== localDraftKey) {
        const removedPrevious = await removeLocalDraft(previousDraftKey);
        if (!removedPrevious.ok) cleanupError = removedPrevious.error;
      }
      const removedCurrent = await removeLocalDraft(localDraftKey);
      if (!removedCurrent.ok) cleanupError = removedCurrent.error;
    }
    if (options?.operation && !operationMatches(get().operation, options.operation)) return { applied: false, needsFollowup: false };
    const latest = get();
    const editorText = deps.editor.getPersistableText().text;
    // Draft cleanup can await I/O. Edits made during it aren't part of this disk snapshot.
    const finalBackingText = backingText;
    const clearedDraft = shouldClearDraft && !cleanupError;
    const needsFollowup = latest.pendingAutosave || editorText !== finalBackingText;
    set({
      file: snapshot.file,
      backingText: finalBackingText,
      backingVersion: snapshot.version,
      externalSnapshot: null,
      localDraftText: clearedDraft ? null : latest.localDraftText,
      localDraftVersion: clearedDraft ? null : latest.localDraftVersion,
      conflict: null,
      recoveryDraft: null,
      operation: null,
      pendingAutosave: false,
      lastError: cleanupError,
      ...recomputeDirtyState(
        {
          ...latest,
          file: snapshot.file,
          backingText: finalBackingText,
          localDraftText: clearedDraft ? null : latest.localDraftText,
          conflict: null,
          externalSnapshot: null,
        },
        editorText,
      ),
      localDraftState: cleanupError ? "error" : recomputeDirtyState(
        {
          ...latest,
          file: snapshot.file,
          backingText: finalBackingText,
          localDraftText: clearedDraft ? null : latest.localDraftText,
          conflict: null,
          externalSnapshot: null,
        },
        editorText,
      ).localDraftState,
    });
    return { applied: true, needsFollowup };
  };

  return createStore<FileSessionState>((set, get) => ({
    ...createInitialFileSessionState(),

    syncEditorSnapshot: () => {
      const snapshot = deps.editor.getPersistableText();
      set(recomputeDirtyState(get(), snapshot.text));
    },

    loadUntitledDraft: async () => {
      const state = get();
      if (state.file || state.operation) return;
      const editorSnapshot = deps.editor.getPersistableText();
      const key = draftKeyFor(null, untitledId);
      const operation: FileOperation = {
        id: createOperationId(),
        kind: "load_untitled_draft",
        fileId: null,
        text: editorSnapshot.text,
        expectedVersion: null,
      };
      set({ operation, lastError: null });
      const draftResult = await readLocalDraft(key);
      if (!operationMatches(get().operation, operation)) return;
      if (!draftResult.ok) {
        set({
          operation: null,
          localDraftState: "error",
          lastError: draftResult.error,
        });
        return;
      }
      const draft = draftResult.value;
      if (!draft) {
        set({ operation: null, recoveryDraft: null, localDraftText: null, localDraftVersion: null, localDraftState: "none" });
        return;
      }
      const currentText = deps.editor.getPersistableText().text;
      const next = { ...get(), localDraftText: draft.text, conflict: null, externalSnapshot: null };
      set({
        localDraftText: draft.text,
        localDraftVersion: draft.version,
        recoveryDraft: draft.text !== currentText ? { key, draft, fileText: currentText } : null,
        operation: null,
        lastError: null,
        ...recomputeDirtyState(next, currentText),
        localDraftState: draft.text === currentText ? "current" : "newer_than_backing",
      });
    },

    open: async (read = deps.adapter.open) => {
      const operation: FileOperation = {
        id: createOperationId(),
        kind: "open",
        fileId: null,
        text: "",
        expectedVersion: null,
      };
      set({ operation, lastError: null });
      let result: StorageResult<FileSnapshot>;
      try { result = await read(); }
      catch (error) { result = err({ kind: "read_failed", message: formatUnknownError(error) }); }
      if (!operationMatches(get().operation, operation)) return;
      if (!result.ok) {
        set({ operation: null, lastError: result.error, backingFileState: result.error.kind === "not_found" ? "unavailable" : "error" });
        return;
      }

      deps.editor.replaceDocumentText(result.value.text);
      const editorText = deps.editor.getPersistableText().text;
      const availability = await deps.adapter.availability(result.value.file);
      if (!operationMatches(get().operation, operation)) return;
      const key = draftKeyFor(result.value.file, untitledId);
      const draftResult = await readLocalDraft(key);
      if (!operationMatches(get().operation, operation)) return;
      const draft = draftResult.ok ? draftResult.value : null;
      set({
        file: result.value.file,
        backingText: editorText,
        backingVersion: result.value.version,
        externalSnapshot: null,
        localDraftText: draft?.text ?? null,
        localDraftVersion: draft?.version ?? null,
        availability,
        conflict: null,
        recoveryDraft: draft && draft.text !== editorText ? { key, draft, fileText: result.value.text } : null,
        operation: null,
        pendingAutosave: false,
        lastError: draftResult.ok ? null : draftResult.error,
        documentDirty: "clean",
        backingFileState: "clean",
        localDraftState: draftResult.ok ? (draft ? (draft.text === editorText ? "current" : "newer_than_backing") : "none") : "error",
      });
    },

    save: async (options) => {
      const editorSnapshot = deps.editor.getPersistableText();
      if (editorSnapshot.validity === "invalid_source" && !options?.allowInvalidSource) {
        set({ lastError: { kind: "write_failed", message: "Invalid source must be saved explicitly." }, backingFileState: get().file ? "error" : "none" });
        return;
      }

      if (!get().file) {
        await get().saveAs(options);
        return;
      }

      const state = get();
      if (!state.file) throw new Error("file session expected active file before save");
      if (state.conflict) {
        set({ lastError: { kind: "version_mismatch", current: {
          file: state.conflict.file,
          text: state.conflict.diskText,
          version: state.conflict.diskVersion,
        } } });
        return;
      }

      const operation: FileOperation = {
        id: createOperationId(),
        kind: "save",
        fileId: state.file.id,
        text: editorSnapshot.text,
        expectedVersion: state.backingVersion,
      };
      rememberSupersededBackingWrite(get().operation, state.file.id);
      set({ operation, lastError: null });

      const availability = await deps.adapter.availability(state.file);
      if (!operationMatches(get().operation, operation)) return;
      if (availability.writePermission === "denied" || availability.writePermission === "unavailable") {
        set({ availability });
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (!draftWrite.applied) return;
        set({ availability, lastError: { kind: "permission_denied", permission: availability.writePermission } });
        if (draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }

      const capabilities = deps.adapter.capabilities();
      if (capabilities.canReadCurrentBackingFile && state.backingVersion) {
        const current = await deps.adapter.readCurrent(state.file);
        if (!operationMatches(get().operation, operation)) return;
        if (!current.ok) {
          set({ operation: null, availability, lastError: current.error, backingFileState: current.error.kind === "not_found" ? "unavailable" : "error" });
          return;
        }
        if (current.value.version !== state.backingVersion) {
          set({ operation: null, availability });
          get().handleExternalSnapshot(current.value);
          return;
        }
      }

      set({ operation, availability, lastError: null });
      const result = await deps.adapter.save(state.file, editorSnapshot.text, {
        expectedVersion: state.backingVersion,
        reason: "manual",
      });
      if (!operationMatches(get().operation, operation)) return;
      if (!result.ok) {
        if (result.error.kind === "version_mismatch") {
          if (consumeSupersededBackingWrite(result.error.current)) {
            const retryOperation: FileOperation = {
              ...operation,
              id: createOperationId(),
              expectedVersion: result.error.current.version,
            };
            set({ operation: retryOperation });
            const retry = await deps.adapter.save(state.file, editorSnapshot.text, {
              expectedVersion: result.error.current.version,
              reason: "manual",
            });
            if (!operationMatches(get().operation, retryOperation)) return;
            if (!retry.ok) {
              if (retry.error.kind === "version_mismatch") {
                set({ operation: null });
                get().handleExternalSnapshot(retry.error.current);
                return;
              }
              if (retry.error.kind === "permission_denied" || retry.error.kind === "write_failed") {
                const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
                if (!draftWrite.applied) return;
                set({ lastError: retry.error, backingFileState: retry.error.kind === "write_failed" ? "error" : get().backingFileState });
                if (draftWrite.needsFollowup) await get().autosaveNow();
                return;
              }
              set({ operation: null, lastError: retry.error, backingFileState: retry.error.kind === "not_found" ? "unavailable" : "error" });
              return;
            }
            const appliedRetry = await setBackingSnapshot(get, set, retry.value, { operation: retryOperation });
            if (!appliedRetry.applied) return;
            if (appliedRetry.needsFollowup) await get().autosaveNow();
            return;
          }
          set({ operation: null });
          get().handleExternalSnapshot(result.error.current);
          return;
        }
        if (result.error.kind === "permission_denied" || result.error.kind === "write_failed") {
          const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
          if (!draftWrite.applied) return;
          set({ lastError: result.error, backingFileState: result.error.kind === "write_failed" ? "error" : get().backingFileState });
          if (draftWrite.needsFollowup) await get().autosaveNow();
          return;
        }
        set({ operation: null, lastError: result.error, backingFileState: result.error.kind === "not_found" ? "unavailable" : "error" });
        return;
      }

      const appliedSave = await setBackingSnapshot(get, set, result.value, { operation });
      if (!appliedSave.applied) return;
      if (appliedSave.needsFollowup) await get().autosaveNow();
    },

    saveAs: (options) => get().persistTo(deps.adapter.saveAs, options),

    persistTo: async (write, options) => {
      const editorSnapshot = deps.editor.getPersistableText();
      if (editorSnapshot.validity === "invalid_source" && !options?.allowInvalidSource) {
        set({ lastError: { kind: "write_failed", message: "Invalid source must be saved explicitly." } });
        return;
      }
      const operation: FileOperation = {
        id: createOperationId(),
        kind: "save_as",
        fileId: null,
        text: editorSnapshot.text,
        expectedVersion: null,
      };
      set({ operation, lastError: null });
      let result: StorageResult<FileSnapshot>;
      try { result = await write(editorSnapshot.text); }
      catch (error) { result = err({ kind: "write_failed", message: formatUnknownError(error) }); }
      if (!operationMatches(get().operation, operation)) return;
      if (!result.ok) {
        if (result.error.kind === "permission_denied" || result.error.kind === "write_failed") {
          const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
          if (!draftWrite.applied) return;
          set({ lastError: result.error });
          if (draftWrite.needsFollowup) await get().autosaveNow();
          return;
        }
        set({ operation: null, lastError: result.error });
        return;
      }
      const availability = await deps.adapter.availability(result.value.file);
      if (!operationMatches(get().operation, operation)) return;
      const appliedSaveAs = await setBackingSnapshot(get, set, result.value, { operation });
      if (!appliedSaveAs.applied) return;
      if (appliedSaveAs.needsFollowup) await get().autosaveNow();
      set({ availability });
    },

    autosaveNow: async () => {
      if (!get().autosaveEnabled) return;
      // Never overwrite a recovery draft before the user has chosen its contents.
      if (get().recoveryDraft) return;
      const editorSnapshot = deps.editor.getPersistableText();
      const dirtyState = recomputeDirtyState(get(), editorSnapshot.text);
      set(dirtyState);
      const state = { ...get(), ...dirtyState };
      if (state.documentDirty === "clean" && state.localDraftState !== "current") return;
      if (state.operation) {
        set({ pendingAutosave: true });
        return;
      }
      if (editorSnapshot.validity === "invalid_source" && !deps.autosaveInvalidSource) {
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }
      if (!state.file) {
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }
      if (state.conflict || state.externalSnapshot) {
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }

      const capabilities = deps.adapter.capabilities();
      const operation: FileOperation = {
        id: createOperationId(),
        kind: "autosave_backing",
        fileId: state.file.id,
        text: editorSnapshot.text,
        expectedVersion: state.backingVersion,
      };
      set({ operation, lastError: null });
      const availability = await deps.adapter.availability(state.file);
      if (!operationMatches(get().operation, operation)) return;
      if (!capabilities.canAutosaveToBackingFile || availability.writePermission !== "granted") {
        set({ availability });
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }

      const current = capabilities.canReadCurrentBackingFile ? await deps.adapter.readCurrent(state.file) : null;
      if (!operationMatches(get().operation, operation)) return;
      if (current && !current.ok) {
        set({ operation: null, availability, lastError: current.error, backingFileState: current.error.kind === "not_found" ? "unavailable" : "error" });
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }
      if (current?.ok && state.backingVersion && current.value.version !== state.backingVersion) {
        set({ operation: null, availability });
        get().handleExternalSnapshot(current.value);
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }

      set({ operation, availability, lastError: null });
      const result = await deps.adapter.save(state.file, editorSnapshot.text, {
        expectedVersion: state.backingVersion,
        reason: "autosave",
      });
      if (!operationMatches(get().operation, operation)) return;
      if (!result.ok) {
        if (result.error.kind === "version_mismatch") {
          set({ operation: null });
          get().handleExternalSnapshot(result.error.current);
          const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
          if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
          return;
        }
        set({ operation: null, lastError: result.error, backingFileState: result.error.kind === "not_found" ? "unavailable" : "error" });
        const draftWrite = await writeLocalDraft(get, set, editorSnapshot.text, "autosave_local_draft");
        if (draftWrite.applied && draftWrite.needsFollowup) await get().autosaveNow();
        return;
      }

      const appliedAutosave = await setBackingSnapshot(get, set, result.value, { operation });
      if (!appliedAutosave.applied) return;
      if (appliedAutosave.needsFollowup) await get().autosaveNow();
    },

    refreshFromDisk: async (canApply) => {
      const state = get();
      if (!state.file || state.operation || state.recoveryDraft || !canApply()) return;
      const operation: FileOperation = {
        id: createOperationId(), kind: "reload_from_disk", fileId: state.file.id,
        text: state.backingText ?? "", expectedVersion: state.backingVersion,
      };
      set({ operation });
      let result: StorageResult<FileSnapshot>;
      try { result = await deps.adapter.readCurrent(state.file); }
      catch (error) { result = err({ kind: "read_failed", message: String(error) }); }
      if (!operationMatches(get().operation, operation)) return;
      if (!result.ok) {
        set({ operation: null, lastError: result.error,
          backingFileState: result.error.kind === "not_found" ? "unavailable" : "error" });
      } else if (!canApply() || get().recoveryDraft) {
        set({ operation: null });
      } else {
        const snapshot = result.value;
        const current = get();
        const editorText = deps.editor.getPersistableText().text;
        if (snapshot.version === current.backingVersion) {
          // Also recovers from a deleted/recreated file or an external edit that was reverted.
          set({ operation: null, conflict: null, externalSnapshot: null, lastError: null,
            ...recomputeDirtyState({ ...current, conflict: null, externalSnapshot: null }, editorText) });
        } else if (snapshot.text === editorText || editorText === current.backingText) {
          const replace = snapshot.text !== editorText;
          if (replace) deps.editor.replaceDocumentText(snapshot.text, { preserveView: true });
          const applied = await setBackingSnapshot(get, set, snapshot, { normalizeToEditorText: replace, operation });
          if (applied.applied && applied.needsFollowup) await get().autosaveNow();
        } else {
          set({ operation: null });
          get().handleExternalSnapshot(snapshot);
        }
      }
      if (get().pendingAutosave) {
        set({ pendingAutosave: false });
        await get().autosaveNow();
      }
    },

    handleExternalSnapshot: (snapshot) => {
      const state = get();
      if (!sameFile(state.file, snapshot.file) || state.backingText == null || state.backingVersion == null) return;
      if (snapshot.version === state.backingVersion) return;
      const editorSnapshot = deps.editor.getPersistableText();
      if (snapshot.text === editorSnapshot.text) {
        set({ backingText: snapshot.text, backingVersion: snapshot.version,
          conflict: null, externalSnapshot: null, lastError: null,
          ...recomputeDirtyState({ ...state, backingText: snapshot.text, conflict: null, externalSnapshot: null }, editorSnapshot.text) });
        return;
      }
      if (editorSnapshot.text === state.backingText) {
        set({
          externalSnapshot: snapshot,
          backingFileState: "external_changed",
          conflict: null,
          lastError: null,
        });
        return;
      }
      set({
        externalSnapshot: null,
        backingFileState: "conflict",
        conflict: {
          kind: "local_dirty_vs_external_change",
          file: snapshot.file,
          diskText: snapshot.text,
          diskVersion: snapshot.version,
          baselineText: state.backingText,
          baselineVersion: state.backingVersion,
          editorText: editorSnapshot.text,
        },
        lastError: { kind: "version_mismatch", current: snapshot },
      });
    },

    reloadFromDisk: async () => {
      const state = get();
      const snapshot =
        state.conflict
          ? { file: state.conflict.file, text: state.conflict.diskText, version: state.conflict.diskVersion }
          : state.externalSnapshot;
      if (!snapshot) return;
      const operation: FileOperation = {
        id: createOperationId(),
        kind: "reload_from_disk",
        fileId: snapshot.file.id,
        text: snapshot.text,
        expectedVersion: snapshot.version,
      };
      set({ operation });
      deps.editor.replaceDocumentText(snapshot.text);
      const appliedReload = await setBackingSnapshot(get, set, snapshot, { normalizeToEditorText: true, operation });
      if (!appliedReload.applied) return;
      if (appliedReload.needsFollowup) await get().autosaveNow();
    },

    overwriteConflict: async () => {
      const state = get();
      if (!state.conflict) return;
      const operation: FileOperation = {
        id: createOperationId(),
        kind: "overwrite_conflict",
        fileId: state.conflict.file.id,
        text: state.conflict.editorText,
        expectedVersion: state.conflict.diskVersion,
      };
      set({ operation, lastError: null });
      if (deps.adapter.capabilities().canReadCurrentBackingFile) {
        const current = await deps.adapter.readCurrent(state.conflict.file);
        if (!operationMatches(get().operation, operation)) return;
        if (!current.ok) {
          set({ operation: null, lastError: current.error, backingFileState: current.error.kind === "not_found" ? "unavailable" : "error" });
          return;
        }
        if (current.value.version !== state.conflict.diskVersion) {
          set({ operation: null });
          get().handleExternalSnapshot(current.value);
          return;
        }
      }
      const result = await deps.adapter.save(state.conflict.file, state.conflict.editorText, {
        expectedVersion: state.conflict.diskVersion,
        reason: "overwrite_conflict",
      });
      if (!operationMatches(get().operation, operation)) return;
      if (!result.ok) {
        set({ operation: null, lastError: result.error, backingFileState: result.error.kind === "not_found" ? "unavailable" : "error" });
        return;
      }
      const appliedOverwrite = await setBackingSnapshot(get, set, result.value, { operation });
      if (!appliedOverwrite.applied) return;
      if (appliedOverwrite.needsFollowup) await get().autosaveNow();
    },

    saveConflictAsNewFile: async () => {
      const state = get();
      if (!state.conflict) return;
      const operation: FileOperation = {
        id: createOperationId(),
        kind: "save_as",
        fileId: null,
        text: state.conflict.editorText,
        expectedVersion: null,
      };
      set({ operation, lastError: null });
      const result = await deps.adapter.saveAs(state.conflict.editorText);
      if (!operationMatches(get().operation, operation)) return;
      if (!result.ok) {
        if (result.error.kind === "permission_denied" || result.error.kind === "write_failed") {
          const draftWrite = await writeLocalDraft(get, set, state.conflict.editorText, "autosave_local_draft");
          if (!draftWrite.applied) return;
          set({ lastError: result.error });
          if (draftWrite.needsFollowup) await get().autosaveNow();
          return;
        }
        set({ operation: null, lastError: result.error });
        return;
      }
      const availability = await deps.adapter.availability(result.value.file);
      if (!operationMatches(get().operation, operation)) return;
      const appliedCopy = await setBackingSnapshot(get, set, result.value, { operation });
      if (!appliedCopy.applied) return;
      if (appliedCopy.needsFollowup) await get().autosaveNow();
      set({ availability });
    },

    cancelConflict: () => {
      const editorSnapshot = deps.editor.getPersistableText();
      const state = get();
      if (state.externalSnapshot && !state.conflict) {
        const next = {
          ...state,
          backingText: state.externalSnapshot.text,
          backingVersion: state.externalSnapshot.version,
          conflict: null,
          externalSnapshot: null,
        };
        set({
          backingText: state.externalSnapshot.text,
          backingVersion: state.externalSnapshot.version,
          conflict: null,
          externalSnapshot: null,
          lastError: null,
          ...recomputeDirtyState(next, editorSnapshot.text),
        });
        return;
      }
      const next = { ...state, conflict: null, externalSnapshot: null };
      set({
        conflict: null,
        externalSnapshot: null,
        lastError: null,
        ...recomputeDirtyState(next, editorSnapshot.text),
      });
    },

    recoverDraft: () => {
      const recovery = get().recoveryDraft;
      if (!recovery) return;
      deps.editor.replaceDocumentText(recovery.draft.text);
      const editorText = deps.editor.getPersistableText().text;
      set({
        recoveryDraft: null,
        localDraftText: editorText,
        localDraftVersion: recovery.draft.version,
        ...recomputeDirtyState({ ...get(), localDraftText: editorText }, editorText),
      });
    },

    openSavedFile: async () => {
      const recovery = get().recoveryDraft;
      if (!recovery) return;
      deps.editor.replaceDocumentText(recovery.fileText);
      const editorText = deps.editor.getPersistableText().text;
      set({
        recoveryDraft: null,
        ...recomputeDirtyState(get(), editorText),
      });
    },

    discardDraft: async () => {
      const recovery = get().recoveryDraft;
      if (!recovery) return;
      const removed = await removeLocalDraft(recovery.key);
      if (!removed.ok) {
        set({ localDraftState: "error", lastError: removed.error });
        return;
      }
      const editorSnapshot = deps.editor.getPersistableText();
      set({
        recoveryDraft: null,
        localDraftText: null,
        localDraftVersion: null,
        ...recomputeDirtyState({ ...get(), localDraftText: null }, editorSnapshot.text),
      });
    },
  }));
}

export function createMemoryLocalDraftStore(initial?: Record<string, LocalDraftRecord>): LocalDraftStore {
  const records = new Map<string, LocalDraftRecord>(Object.entries(initial ?? {}));
  return {
    get: async (key) => records.get(key) ?? null,
    set: async (record) => {
      records.set(record.key, record);
    },
    remove: async (key) => {
      records.delete(key);
    },
  };
}

export function createLocalStorageDraftStore(storage?: Storage): LocalDraftStore {
  const targetStorage = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!targetStorage) return createMemoryLocalDraftStore();

  const prefix = "ordinate:file-draft:";
  return {
    get: async (key) => {
      const raw = targetStorage.getItem(`${prefix}${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LocalDraftRecord;
      if (parsed.key !== key) throw new Error("local draft key mismatch");
      return parsed;
    },
    set: async (record) => {
      targetStorage.setItem(`${prefix}${record.key}`, JSON.stringify(record));
    },
    remove: async (key) => {
      targetStorage.removeItem(`${prefix}${key}`);
    },
  };
}

export type MemoryStorageAdapter = StorageAdapter & {
  setDiskText: (fileId: string, text: string) => Promise<void>;
  getDiskText: (fileId: string) => string | null;
  setAvailability: (availability: StorageAvailability) => void;
  setNextSaveFailure: (failure: StorageFailure | null) => void;
  setNextOpenFailure: (failure: StorageFailure | null) => void;
};

export function createMemoryStorageAdapter(initialFiles: Record<string, { displayName: string; text: string }> = {}): MemoryStorageAdapter {
  const files = new Map<string, { file: FileReference; text: string; version: string }>();
  let nextFileNumber = 1;
  let availability: StorageAvailability = { readPermission: "granted", writePermission: "granted" };
  let nextSaveFailure: StorageFailure | null = null;
  let nextOpenFailure: StorageFailure | null = null;

  const snapshotFor = async (file: FileReference, text: string): Promise<FileSnapshot> => ({
    file,
    text,
    version: await hashText(text),
  });

  for (const [id, entry] of Object.entries(initialFiles)) {
    const file: FileReference = { id, displayName: entry.displayName, adapterKind: "memory" };
    files.set(id, { file, text: entry.text, version: "" });
  }

  const refreshFileVersion = async (id: string) => {
    const entry = files.get(id);
    if (!entry) return;
    entry.version = await hashText(entry.text);
  };

  const firstFile = () => files.values().next().value as { file: FileReference; text: string; version: string } | undefined;

  return {
    kind: "memory",
    capabilities: () => ({
      canAutosaveToBackingFile: true,
      canReadCurrentBackingFile: true,
      canWatchBackingFile: false,
      canAtomicCompareAndWrite: true,
    }),
    availability: async () => availability,
    open: async () => {
      if (nextOpenFailure) {
        const failure = nextOpenFailure;
        nextOpenFailure = null;
        return err(failure);
      }
      const entry = firstFile();
      if (!entry) return err({ kind: "not_found" });
      if (!entry.version) await refreshFileVersion(entry.file.id);
      return ok({ file: entry.file, text: entry.text, version: entry.version || await hashText(entry.text) });
    },
    save: async (file, text, options) => {
      if (nextSaveFailure) {
        const failure = nextSaveFailure;
        nextSaveFailure = null;
        return err(failure);
      }
      if (availability.writePermission !== "granted") {
        return err({ kind: "permission_denied", permission: availability.writePermission });
      }
      const entry = files.get(file.id);
      if (!entry) return err({ kind: "not_found" });
      if (!entry.version) await refreshFileVersion(file.id);
      if (options.expectedVersion && entry.version !== options.expectedVersion) {
        return err({ kind: "version_mismatch", current: { file: entry.file, text: entry.text, version: entry.version } });
      }
      entry.text = text;
      entry.version = await hashText(text);
      return ok({ file: entry.file, text, version: entry.version });
    },
    saveAs: async (text) => {
      if (nextSaveFailure) {
        const failure = nextSaveFailure;
        nextSaveFailure = null;
        return err(failure);
      }
      const id = `memory-file-${nextFileNumber}`;
      nextFileNumber += 1;
      const file: FileReference = { id, displayName: `${id}.ord`, adapterKind: "memory" };
      const snapshot = await snapshotFor(file, text);
      files.set(id, { file, text, version: snapshot.version });
      return ok(snapshot);
    },
    readCurrent: async (file) => {
      if (availability.readPermission !== "granted") {
        return err({ kind: "permission_denied", permission: availability.readPermission });
      }
      const entry = files.get(file.id);
      if (!entry) return err({ kind: "not_found" });
      if (!entry.version) await refreshFileVersion(file.id);
      return ok({ file: entry.file, text: entry.text, version: entry.version });
    },
    setDiskText: async (fileId, text) => {
      const entry = files.get(fileId);
      if (!entry) throw new Error(`unknown memory file '${fileId}'`);
      entry.text = text;
      entry.version = await hashText(text);
    },
    getDiskText: (fileId) => files.get(fileId)?.text ?? null,
    setAvailability: (nextAvailability) => {
      availability = nextAvailability;
    },
    setNextSaveFailure: (failure) => {
      nextSaveFailure = failure;
    },
    setNextOpenFailure: (failure) => {
      nextOpenFailure = failure;
    },
  };
}

type FileSystemFileHandleLike = {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  queryPermission?: (descriptor: { mode: "read" | "readwrite" }) => Promise<FilePermissionState>;
  requestPermission?: (descriptor: { mode: "read" | "readwrite" }) => Promise<FilePermissionState>;
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandleLike[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandleLike>;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function fileTextSnapshot(file: FileReference, text: string): Promise<FileSnapshot> {
  return { file, text, version: await hashText(text) };
}

function createUnavailableStorageAdapter(): StorageAdapter {
  const unavailable = err<FileSnapshot>({ kind: "permission_denied", permission: "unavailable" });
  return {
    kind: "browser-download",
    capabilities: () => DEFAULT_CAPABILITIES,
    availability: async () => UNAVAILABLE,
    open: async () => unavailable,
    save: async () => unavailable,
    saveAs: async () => unavailable,
    readCurrent: async () => unavailable,
  };
}

export function createBrowserStorageAdapter(win?: FilePickerWindow): StorageAdapter {
  const targetWindow: FilePickerWindow | null = win ?? (typeof window === "undefined" ? null : window as FilePickerWindow);
  if (!targetWindow) return createUnavailableStorageAdapter();

  const handles = new Map<string, FileSystemFileHandleLike>();
  let nextBrowserFileNumber = 1;

  const capabilities = (): StorageCapabilities => ({
    canAutosaveToBackingFile: Boolean(targetWindow.showOpenFilePicker && targetWindow.showSaveFilePicker),
    canReadCurrentBackingFile: Boolean(targetWindow.showOpenFilePicker),
    canWatchBackingFile: false,
    canAtomicCompareAndWrite: false,
  });

  const fileForHandle = (handle: FileSystemFileHandleLike, observedFile?: File): FileReference => {
    const draftKey = observedFile
      ? `browser-file-system:${observedFile.name}:${observedFile.size}:${observedFile.lastModified}`
      : `browser-file-system:${handle.name}`;
    for (const [id, existing] of handles) {
      if (existing === handle) return { id, displayName: handle.name, adapterKind: "browser-file-system", draftKey };
    }
    const id = `browser-file-${nextBrowserFileNumber}:${handle.name}`;
    nextBrowserFileNumber += 1;
    handles.set(id, handle);
    return { id, displayName: handle.name, adapterKind: "browser-file-system", draftKey };
  };

  const handleFor = (file: FileReference): FileSystemFileHandleLike | null => handles.get(file.id) ?? null;

  const promptUpload = async (): Promise<StorageResult<FileSnapshot>> => {
    return new Promise((resolve) => {
      const input = targetWindow.document.createElement("input");
      let settled = false;
      const cleanup = () => {
        targetWindow.removeEventListener("focus", handleFocus);
        input.remove();
      };
      const finish = (result: StorageResult<FileSnapshot>) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const handleFocus = () => {
        targetWindow.setTimeout(() => {
          if (!settled && !input.files?.length) finish(err({ kind: "cancelled" }));
        }, 250);
      };
      input.type = "file";
      input.accept = ".ord,text/plain";
      input.style.display = "none";
      input.addEventListener("change", async () => {
        const selected = input.files?.[0];
        if (!selected) {
          finish(err({ kind: "cancelled" }));
          return;
        }
        const text = await selected.text();
        const file: FileReference = {
          id: `upload:${selected.name}:${selected.size}:${selected.lastModified}`,
          displayName: selected.name,
          adapterKind: "browser-download",
          draftKey: `browser-upload:${selected.name}:${selected.size}:${selected.lastModified}`,
        };
        finish(ok(await fileTextSnapshot(file, text)));
      }, { once: true });
      targetWindow.addEventListener("focus", handleFocus);
      targetWindow.document.body.append(input);
      input.click();
    });
  };

  const downloadText = async (text: string): Promise<StorageResult<FileSnapshot>> => {
    const file: FileReference = {
      id: `download:${Date.now()}`,
      displayName: "Untitled.ord",
      adapterKind: "browser-download",
    };
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = targetWindow.document.createElement("a");
    anchor.href = url;
    anchor.download = file.displayName;
    anchor.click();
    URL.revokeObjectURL(url);
    return err({
      kind: "write_failed",
      message: "Browser download was started, but this browser does not provide a writable backing file.",
    });
  };

  return {
    kind: "browser-file-system",
    capabilities,
    availability: async (file) => {
      if (!file || file.adapterKind !== "browser-file-system") return UNAVAILABLE;
      const handle = handleFor(file);
      if (!handle) return UNAVAILABLE;
      const readPermission = handle.queryPermission ? await handle.queryPermission({ mode: "read" }) : "granted";
      const writePermission = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "prompt";
      return { readPermission, writePermission };
    },
    open: async () => {
      if (!targetWindow.showOpenFilePicker) return promptUpload();
      try {
        const [handle] = await targetWindow.showOpenFilePicker({
          multiple: false,
          types: [{ description: "Ordinate documents", accept: { "text/plain": [".ord", ".txt"] } }],
        });
        if (!handle) return err({ kind: "cancelled" });
        const file = await handle.getFile();
        const fileRef = fileForHandle(handle, file);
        return ok(await fileTextSnapshot(fileRef, await file.text()));
      } catch (error) {
        if (isAbortError(error)) return err({ kind: "cancelled" });
        return err({ kind: "read_failed", message: formatStorageFailure({ kind: "read_failed", message: String(error) }) });
      }
    },
    save: async (file, text) => {
      if (file.adapterKind !== "browser-file-system") return downloadText(text);
      const handle = handleFor(file);
      if (!handle) return err({ kind: "not_found" });
      const permission = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "prompt";
      if (permission !== "granted") {
        const requested = handle.requestPermission ? await handle.requestPermission({ mode: "readwrite" }) : "denied";
        if (requested !== "granted") return err({ kind: "permission_denied", permission: requested });
      }
      try {
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return ok(await fileTextSnapshot(file, text));
      } catch (error) {
        return err({ kind: "write_failed", message: String(error) });
      }
    },
    saveAs: async (text) => {
      if (!targetWindow.showSaveFilePicker) return downloadText(text);
      try {
        const handle = await targetWindow.showSaveFilePicker({
          suggestedName: "Untitled.ord",
          types: [{ description: "Ordinate documents", accept: { "text/plain": [".ord"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        const savedFile = handle.getFile ? await handle.getFile() : undefined;
        const file = fileForHandle(handle, savedFile);
        return ok(await fileTextSnapshot(file, text));
      } catch (error) {
        if (isAbortError(error)) return err({ kind: "cancelled" });
        return err({ kind: "write_failed", message: String(error) });
      }
    },
    readCurrent: async (file) => {
      const handle = handleFor(file);
      if (!handle) return err({ kind: "not_found" });
      try {
        const current = await handle.getFile();
        return ok(await fileTextSnapshot(file, await current.text()));
      } catch (error) {
        return err({ kind: "read_failed", message: String(error) });
      }
    },
  };
}

const defaultFileSessionStore = createFileSessionStore({
  autosaveInvalidSource: typeof window !== "undefined" && !!window.ordinateDesktop,
  adapter: typeof window !== "undefined" && window.ordinateDesktop
    ? createDesktopStorageAdapter(window.ordinateDesktop)
    : createBrowserStorageAdapter(),
  localDraftStore: createLocalStorageDraftStore(),
  editor: {
    getPersistableText: () => getPersistableText(useEditorStore.getState()),
    replaceDocumentText: (text, options) => useEditorStore.getState().replaceDocumentText(text, options),
  },
  createUntitledId: () => typeof window !== "undefined" && window.ordinateDesktop
    ? window.ordinateDesktop.sessionId : "browser-untitled",
});

export function useFileSessionStore<T>(selector: (state: FileSessionState) => T): T {
  return useStore(defaultFileSessionStore, selector);
}

export { defaultFileSessionStore };
