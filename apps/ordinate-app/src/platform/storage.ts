// Host-independent contract. Desktop code imports types only, never the editor store.
export type FileSessionVersion = string;
export type FilePermissionState = "granted" | "prompt" | "denied" | "unavailable";
export type FileReference = {
  id: string;
  displayName: string;
  adapterKind: "browser-file-system" | "browser-download" | "electron" | "memory";
  draftKey?: string;
};
export type FileSnapshot = { file: FileReference; text: string; version: FileSessionVersion };
export type StorageFailure =
  | { kind: "cancelled" }
  | { kind: "permission_denied"; permission: FilePermissionState }
  | { kind: "not_found" }
  | { kind: "read_failed"; message: string }
  | { kind: "write_failed"; message: string }
  | { kind: "version_mismatch"; current: FileSnapshot };
export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: StorageFailure };
export type StorageCapabilities = {
  canAutosaveToBackingFile: boolean;
  canReadCurrentBackingFile: boolean;
  canWatchBackingFile: boolean;
  canAtomicCompareAndWrite: boolean;
};
export type StorageAvailability = { readPermission: FilePermissionState; writePermission: FilePermissionState };
export type SaveOptions = {
  expectedVersion: FileSessionVersion | null;
  reason: "manual" | "autosave" | "overwrite_conflict";
};
export type StorageAdapter = {
  kind: FileReference["adapterKind"];
  capabilities: () => StorageCapabilities;
  availability: (file: FileReference | null) => Promise<StorageAvailability>;
  open: () => Promise<StorageResult<FileSnapshot>>;
  save: (file: FileReference, text: string, options: SaveOptions) => Promise<StorageResult<FileSnapshot>>;
  saveAs: (text: string, suggestedName?: string) => Promise<StorageResult<FileSnapshot>>;
  readCurrent: (file: FileReference) => Promise<StorageResult<FileSnapshot>>;
  // Invalidation, not a cached snapshot: read after any in-flight save completes.
  watch?: (file: FileReference, callback: (error: StorageFailure | null) => void) => () => void;
};

export type DesktopCommand = "open" | "save" | "saveAs" | "undo" | "redo" | "import" | "export" | "print" | "settings";
export type DocumentRequest = { id: string; kind: "flush" | "save" | "move" | "open" | "duplicate" | "saveAs" | "revert" };
export type DocumentWrite = { file: FileReference | null; text: string; version: string | null };
export type DesktopWindowState = {
  file: FileReference | null;
  edited: boolean;
  appearance: "auto" | "light" | "dark";
  chromeColor: string;
};
export type DesktopBridge = Pick<StorageAdapter, "availability" | "open" | "save" | "saveAs" | "readCurrent"> & {
  watch: NonNullable<StorageAdapter["watch"]>;
  readonly windowChrome: "native";
  readonly sessionId: string;
  readonly systemLocale: string;
  restoreDocument: () => Promise<{ snapshot: StorageResult<FileSnapshot> | null; text: string | null; draftName?: string }>;
  openDocument: (file?: File) => Promise<void>;
  newDocument: () => Promise<void>;
  interchange: import("../interchange/contracts.js").InterchangeTransport;
  openImportedDocument: (text: string, name: string) => Promise<void>;
  duplicateDocument: (id: string, text: string) => Promise<void>;
  updateWindow: (state: DesktopWindowState) => Promise<void>;
  onCommand: (callback: (command: DesktopCommand) => void) => () => void;
  nativeHistory: (command: "undo" | "redo") => Promise<void>;
  print: () => Promise<void>;
  onDocumentRequest: (callback: (request: DocumentRequest) => Promise<void>) => () => void;
  commitDocumentRequest: (id: string, write: DocumentWrite) => Promise<StorageResult<FileSnapshot>>;
  readDocumentRequest: (id: string) => Promise<StorageResult<FileSnapshot>>;
};

declare global {
  interface Window { ordinateDesktop?: DesktopBridge }
}
