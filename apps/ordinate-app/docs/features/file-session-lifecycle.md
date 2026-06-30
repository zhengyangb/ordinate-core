# File Session Lifecycle

## Status

Draft implementation spec.

This is an app/editor feature spec. It intentionally stays outside the core RFC set because file handles, autosave, local recovery, permissions, host dialogs, and conflict UI are host/editor concerns. Core remains responsible for parse, serialize, evaluate, and edit semantics.

## Problem

Ordinate currently behaves like an in-memory editor. Users can edit tables and source text, but the app does not yet have a first-class file session model:

- no explicit opened file identity
- no reliable backing-file baseline
- no autosave model
- no local recovery draft
- no conflict model when the backing file changes outside the app
- no clear split between editor dirty state, file dirty state, local draft state, and disk saved state

The next implementation should make file lifecycle behavior explicit while keeping Browser V1 compatible with a future Electron host.

## Goals

- Define a host-independent file session state model.
- Support browser-only V1 without blocking a future Electron implementation.
- Enable autosave by default when a real writable backing file is available.
- Always support local recovery drafts for crash/reload protection.
- Preserve a clear backing-file baseline for dirty/conflict checks.
- Detect save-time external modification when the storage backend can read the current backing file.
- Keep invalid source drafts recoverable without silently autosaving invalid text over the backing file.
- Make save, autosave, conflict, reload, overwrite, permission loss, and stale operation behavior testable with fake adapters.

## Non-goals

- Real-time native file watching in browser-only V1.
- Three-way merge or automatic conflict resolution.
- Multi-user collaboration.
- Server-backed document sync.
- Full version history.
- Moving file lifecycle into core RFCs.
- Changing `.ord` serialization semantics.

## Decisions

- Autosave is enabled by default.
- A writable backing file is autosaved only when the adapter has current write permission.
- If no writable backing file is available, autosave writes only a local recovery draft.
- A local draft is a hidden recovery copy, not a user-visible version history.
- V1 keeps only the latest local draft per file/session identity.
- Invalid Source Mode drafts may autosave to local draft storage.
- Invalid Source Mode drafts must not autosave to the backing file.
- Manual Save may write an invalid Source Mode draft after explicit user intent.
- Recovery UI should be a modal/dialog, not a persistent banner.
- Ordinary Save As switches the active session to the new file.
- Conflict Save as New File also switches the active session to the new file and clears the conflict.
- Export-copy-without-switching is a distinct future command, not V1 Save As behavior.
- Browser V1 uses content hash versions for backing-file freshness.
- Electron may use file metadata for cheap watch signals, but conflict-sensitive saves should still verify content freshness.
- Clean external backing-file changes should be adopted automatically without a blocking conflict dialog.
- Dirty external backing-file changes require an explicit conflict-resolution dialog.

## Terminology

- **Editor snapshot**: text produced from the current editor state by `getPersistableText`.
- **Canonical document snapshot**: text produced by serializing a valid `DocumentState`.
- **Source draft**: text currently shown in Source Mode. It may be invalid and may not correspond to `docState`.
- **Backing file**: the user-visible file opened through browser file handles or a future Electron host.
- **Backing baseline**: the backing file text and version last known to have been saved or loaded.
- **Local draft**: hidden autosaved recovery text stored in app-controlled local storage, such as IndexedDB or OPFS. It is not the backing file and is not user-visible version history.
- **File reference**: stable host-specific file identity plus display metadata.
- **Storage adapter**: the boundary between editor lifecycle and host-specific file I/O.
- **Version**: a freshness token for one observed file representation. Browser V1 should use a content hash. Electron may use metadata plus hash verification.

## Storage Adapter Contract

The editor session should depend on a small storage interface rather than direct browser or Electron APIs.

```ts
type FileSessionVersion = string;

type FilePermissionState = "granted" | "prompt" | "denied" | "unavailable";

type FileReference = {
  id: string;
  displayName: string;
  adapterKind: "browser-file-system" | "browser-download" | "electron" | "memory";
};

type FileSnapshot = {
  file: FileReference;
  text: string;
  version: FileSessionVersion;
};

type StorageFailure =
  | { kind: "cancelled" }
  | { kind: "permission_denied"; permission: FilePermissionState }
  | { kind: "not_found" }
  | { kind: "read_failed"; message: string }
  | { kind: "write_failed"; message: string }
  | { kind: "version_mismatch"; current: FileSnapshot };

type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageFailure };

type StorageCapabilities = {
  canAutosaveToBackingFile: boolean;
  canReadCurrentBackingFile: boolean;
  canWatchBackingFile: boolean;
  canAtomicCompareAndWrite: boolean;
};

type StorageAvailability = {
  readPermission: FilePermissionState;
  writePermission: FilePermissionState;
};

type SaveOptions = {
  expectedVersion: FileSessionVersion | null;
  reason: "manual" | "autosave" | "overwrite_conflict";
};

type StorageAdapter = {
  kind: FileReference["adapterKind"];
  capabilities(): StorageCapabilities;
  availability(file: FileReference | null): Promise<StorageAvailability>;

  open(): Promise<StorageResult<FileSnapshot>>;
  save(file: FileReference, text: string, options: SaveOptions): Promise<StorageResult<FileSnapshot>>;
  saveAs(text: string): Promise<StorageResult<FileSnapshot>>;
  readCurrent(file: FileReference): Promise<StorageResult<FileSnapshot>>;
  watch?(file: FileReference, callback: (snapshot: FileSnapshot) => void): () => void;
};
```

Capabilities are static adapter facts. Availability is session-specific and may change as browser permissions expire, files move, or files become unreadable.

`save(expectedVersion)` should enforce freshness when the adapter can do so atomically. Browser V1 cannot guarantee atomic compare-and-write, so it provides best-effort behavior: read current file, compare version, then write. Electron should eventually provide a stronger adapter-level compare-and-write if the host can support it.

## State Model

The file lifecycle must not be modeled as one flat enum. A single `status` cannot represent valid combinations such as dirty-while-saving, conflict-with-local-draft-current, save-failed-but-still-dirty, or clean-editor-with-external-disk-change.

Use independent state axes:

```ts
type DocumentDirtyState = "clean" | "dirty";

type BackingFileState =
  | "none"
  | "clean"
  | "dirty"
  | "external_changed"
  | "conflict"
  | "unavailable"
  | "error";

type LocalDraftState =
  | "none"
  | "stale"
  | "current"
  | "newer_than_backing"
  | "error";

type FileOperationKind =
  | "open"
  | "save"
  | "save_as"
  | "autosave_backing"
  | "autosave_local_draft"
  | "reload_from_disk"
  | "overwrite_conflict";

type FileOperation = {
  id: string;
  kind: FileOperationKind;
  fileId: string | null;
  text: string;
  expectedVersion: FileSessionVersion | null;
};

type FileConflict = {
  kind: "local_dirty_vs_external_change";
  file: FileReference;
  diskText: string;
  diskVersion: FileSessionVersion;
  baselineText: string;
  baselineVersion: FileSessionVersion;
  editorText: string;
};

type FileSessionState = {
  file: FileReference | null;
  backingText: string | null;
  backingVersion: FileSessionVersion | null;
  localDraftText: string | null;
  localDraftVersion: string | null;

  documentDirty: DocumentDirtyState;
  backingFileState: BackingFileState;
  localDraftState: LocalDraftState;
  availability: StorageAvailability;
  conflict: FileConflict | null;
  operation: FileOperation | null;
  pendingAutosave: boolean;
  lastError: StorageFailure | null;
};
```

The UI may derive a compact user-facing label such as `Saved`, `Saving...`, `Edited`, `Draft saved`, `Conflict`, or `Save failed`, but those labels are derived from the axes above.

## Editor Dirty vs File Dirty

The app already has editor history dirty state. File lifecycle dirty state is separate.

- **Editor dirty** answers: "does the editor history cursor differ from the editor's saved-history cursor?"
- **File dirty** answers: "does `getPersistableText(editor)` differ from the backing baseline?"
- **Local draft current** answers: "does recovery storage contain the latest editor text?"

The file session must not rely on `editorStore.isDirty` as the source of truth for file save status. It may observe editor revisions/history as a trigger to recompute persistable text.

## Persistable Text

The app needs one function that determines the text to persist:

```ts
function getPersistableText(editor: EditorState): {
  text: string;
  validity: "valid_document" | "invalid_source";
  source: "table" | "source";
};
```

Rules:

- In table mode, persist canonical serialized document state.
- In source mode with a valid parsed document, persist the source draft after successful parse.
- In source mode with parse or validation errors, persist the source draft and mark it `invalid_source`.
- If there is no active document and no source draft, fail early.

This prevents data loss when the user intentionally edits source text that is temporarily invalid.

## Backing Save Policy

Backing file saves use these rules:

- Valid table or valid source text may be saved manually or by autosave.
- Invalid source text may be saved to local draft by autosave.
- Invalid source text must not be autosaved to the backing file.
- Invalid source text may be manually saved to the backing file after explicit user intent.
- A conflict may be overwritten only by an explicit overwrite action, never by normal autosave.

Manual Save of invalid source text should make the UI explicit: the saved file contains source text that currently cannot be shown as a valid table.

## Local Draft Lifecycle

Local drafts are crash/reload recovery, not version history.

V1 should keep only the latest draft for each draft key. The draft key should be derived from:

- adapter kind
- file reference id when available
- file display name when no stable file id exists
- app-generated untitled session id for untitled documents

Local draft invariants:

- Local draft writes are allowed even when backing-file writes are unavailable.
- Local draft writes never mark the backing file clean.
- A backing-file save that writes the same text as the current local draft may clear that local draft.
- Opening a file with a newer local draft should show a recovery dialog.
- Untitled sessions should recover by app-generated session id.
- V1 does not keep a local draft history; it keeps only latest.
- Multi-tab collisions should be detected by draft timestamp/version and resolved by recovery dialog. V1 does not need live multi-tab coordination.

Recovery dialog actions:

- **Recover Draft**: replace editor contents with local draft text.
- **Open Saved File**: keep backing file text and leave draft untouched or mark it discarded after confirmation.
- **Discard Draft**: remove local draft and keep current backing file text.

This should be a modal/dialog because it is an explicit recovery choice, not a background status notification.

## Autosave Model

Autosave is enabled by default but routed by capability and validity.

Recommended V1 behavior:

- User edits mark file state dirty.
- A debounce timer schedules autosave after a quiet interval.
- A save operation owns one immutable text snapshot.
- Each operation has an id, target file id, target text, expected version, and operation kind.
- If more edits occur while saving, mark `pendingAutosave`.
- When an operation resolves, apply the result only if operation id, file id, and text still match the current expected operation.
- If `pendingAutosave` is true, schedule the next autosave.
- Never overwrite a detected conflict through autosave.

Initial debounce recommendation:

- Source typing: 1500 ms after last input.
- Table commands: 750 ms after command boundary.
- Manual save bypasses debounce.

Autosave target selection:

- If text is valid and the adapter has current write permission, autosave to the backing file.
- If text is invalid source, autosave to local draft only.
- If no writable backing file is available, autosave to local draft only.
- If backing autosave fails due to permission loss, keep or write a local draft and surface permission state.

## Operation Ordering

The following rules avoid stale async writes:

- Starting Open while any save is in flight invalidates the save result unless it resolves against the same new file identity.
- Manual Save during autosave should supersede the autosave if both target the same file and same text.
- Save As during any save creates a new file identity and invalidates older operations for the previous identity.
- Reload from disk during save invalidates the save result unless the user explicitly waits for save completion.
- Conflict actions are disabled while a conflicting write operation is still resolving, or they create a new operation id that supersedes it.
- Stale operation results must not mutate backing baselines, local draft state, document state, or conflict state.

## Browser V1

Browser V1 should support two storage modes.

### File System Access Mode

When `showOpenFilePicker` and writable file handles are available:

- Open reads the selected `.ord` file and records a file reference derived from the handle.
- Save writes back to the same handle after conflict checks.
- Save As writes to a new handle and switches active file identity.
- Autosave may write to the same handle after write permission is available.
- If permission is missing or expired, autosave writes local draft and the UI asks for save permission on the next explicit Save.

Browser V1 conflict detection is best effort:

1. Read the current backing file text if possible.
2. Hash it and compare with `backingVersion`.
3. If different and local editor text is dirty, enter conflict and do not write.
4. If different and local editor text is clean, enter `external_changed`.
5. If unchanged, write the editor text.
6. Hash the saved text as the new `backingVersion`.

This is not atomic. The spec should not pretend it prevents every time-of-check-to-time-of-use race in browser-only mode.

### Download/Upload Mode

When File System Access is unavailable:

- Open uses file upload or pasted source text.
- Save As downloads a `.ord` file.
- Autosave writes local draft only.
- The app must label this state as local draft saved, not saved to file.

This mode is still valuable because it prevents reload data loss.

## Electron Adapter Plan

Electron should implement the same `StorageAdapter` contract:

- `open` uses native file dialogs.
- `save` writes to the selected file.
- `readCurrent` reads from disk before save.
- `watch` reports backing file changes.
- `version` should be host-generated and stable enough for expected-version checks.

Recommended Electron version strategy:

- Use file path or host file identity as `FileReference.id`.
- Use `{mtimeMs, size}` as a cheap watch/change signal.
- Use SHA-256 content hash for conflict-sensitive save validation.
- If an atomic compare-and-write strategy is available, expose `canAtomicCompareAndWrite: true`.

The file session state machine should not change when Electron arrives. Electron only upgrades capabilities:

- browser save-time conflict detection becomes real-time external-change detection
- best-effort write freshness can become adapter-enforced compare-and-write
- backing-file autosave becomes reliable after open/save-as

## External Changes and Conflicts

External changes have two states:

- `external_changed`: backing file changed, but local editor text still equals the old backing baseline.
- `conflict`: backing file changed and local editor text also changed.

The decision is based on a three-snapshot model:

- **base**: backing baseline text/version last loaded or saved by Ordinate.
- **local**: current editor persistable text.
- **remote**: current backing file text/version observed from disk or host storage.

Recommended behavior:

- `remote == base`: no external change.
- `remote != base && local == base`: automatically reload `remote`, update the backing baseline, and do not show a modal. The UI may briefly show a lightweight status such as `Reloaded from disk`.
- `remote != base && local != base`: enter `conflict` and show explicit conflict resolution.

This mirrors common single-file editor behavior: when the editor has no local unsaved changes, outside file edits can be picked up immediately. The rule should not be generalized into unconditional overwrite. Silent reload is safe only when the app can prove `local == base`.

`external_changed` is therefore an internal transitional state, not normally a blocking user-facing state. It may still be observable briefly while a reload operation is queued, or in hosts that cannot safely reload immediately.

`conflict` actions:

- **Reload from Disk**: replace editor contents with disk text, clear app history, update baselines.
- **Overwrite Disk**: write current editor text to backing file, update baselines.
- **Save as New File**: write current editor text to a new file, switch active file identity, update baselines, and clear the conflict.
- **Cancel**: keep editing without writing.

V1 does not attempt merge. The conflict surface may show concise metadata and a source-text preview, but merge UI is deferred.

Browser V1 caveat: browser-only builds may not have a real file watcher, and File System Access writes are not atomic. Clean external auto-reload can be implemented when an external snapshot is observed through a host watcher or save-time freshness check. If no watcher exists, this behavior remains future work for Electron or a stronger browser host integration.

## Source Mode Behavior

Source Mode needs explicit rules because source text can be invalid.

- Valid source reparse replaces table state and clears app history according to existing editor lifecycle behavior.
- Invalid source draft remains the active persistable text while Source Mode is open.
- Invalid source draft autosaves only to local draft storage.
- Invalid source draft may be manually saved to backing file after explicit user intent.
- Returning to table mode is blocked while the source draft is invalid.
- Reloading from disk during invalid source editing replaces the invalid draft only after confirmation.

The UI should distinguish:

- table document saved
- source draft saved
- source draft saved locally
- source draft has parse errors

## UI Requirements

The app chrome should expose file status without dominating the spreadsheet surface:

- file name or `Untitled`
- save status text: `Saved`, `Saving...`, `Edited`, `Draft saved`, `Conflict`, `Save failed`
- manual Save and Save As commands
- Open command
- recovery dialog when a newer local draft is found
- conflict dialog or popover when conflict resolution is needed
- beforeunload warning when there are unsaved changes not safely persisted anywhere

Autosave status should be truthful:

- `Saved` means the backing file baseline equals current text.
- `Draft saved` means recovery text exists but the backing file may be stale.
- `Edited` means no current backing save or local draft save covers the current text.

## Failure Behavior

The lifecycle must fail early on invalid assumptions:

- saving without a document or source draft
- autosaving invalid source text to a backing file
- autosaving to a backing file through an adapter that does not currently support it
- overwriting a conflict without explicit overwrite intent
- applying a stale save result to a newer editor snapshot
- clearing a local draft before a successful backing save or explicit discard

Save errors must not mutate document state or backing baselines.

## Testing Strategy

The implementation should be mostly testable without browser file pickers.

Use fake adapters:

- **memory adapter**: supports open, save, saveAs, readCurrent
- **download-only adapter**: supports saveAs and local draft only
- **stale adapter**: changes disk text before save
- **slow adapter**: resolves saves manually to test in-flight edits
- **permission adapter**: changes read/write availability across operations
- **failing adapter**: rejects save or read
- **watch adapter**: emits external modification events for future Electron behavior

Unit test scenarios:

- open file initializes backing baseline and clean state
- edit marks file dirty
- undo back to backing text marks file clean
- redo after clean marks file dirty
- manual save updates backing baseline
- autosave success marks backing clean when backing save is supported
- autosave local draft does not mark backing file clean
- edit during in-flight autosave schedules a second save
- stale save result does not overwrite newer state
- permission loss routes autosave to local draft
- user-cancelled Save As preserves existing baselines
- read-before-save failure preserves existing baselines
- external disk change with clean editor reloads disk text and updates the backing baseline
- external disk change with dirty editor enters conflict and does not write
- overwrite conflict updates backing baseline
- reload conflict replaces editor text and clears history
- Save as New File switches file identity and clears conflict
- local draft recovery dialog can recover, discard, or open saved file
- local draft is cleared after successful backing save of the same text
- invalid source draft autosaves locally
- invalid source draft does not autosave to backing file
- manual save can write invalid source after explicit intent
- save failure preserves old baselines and reports error
- manual-save/autosave races resolve by operation id
- file deleted or moved enters unavailable/error state
- Electron watch self-write events do not create false conflicts

Browser validation:

- open `.ord` file through File System Access where available
- edit table cell and observe autosave status
- revoke or deny write permission and confirm local draft fallback
- reload page and recover local draft through modal dialog
- simulate save conflict by modifying the file outside the app before Save
- verify Save As writes a new file and switches active file identity
- verify download/upload mode shows Draft saved rather than Saved

## V1 Acceptance

Browser V1 is complete when:

- The app tracks file identity, save status, file dirty state, local draft state, and backing baseline.
- Users can open, save, and save as `.ord` documents.
- Autosave is enabled by default.
- Autosave writes to local draft storage in all browsers.
- Autosave writes to the backing file when the adapter supports it, permission is available, and text is valid.
- Invalid source drafts autosave locally but not to the backing file.
- Save-time conflict detection prevents known silent overwrites.
- Browser-only conflict detection is documented as best effort.
- Conflict actions support reload, overwrite, save as new file, and cancel.
- Newer local drafts are recovered through a modal/dialog.
- Unit tests cover normal save, autosave, clean external auto-reload, dirty external conflict, stale save, local draft, invalid source, permission loss, and failure paths.

## Open Questions

- What exact copy should appear in the invalid-source manual-save confirmation?
- Should local drafts expire after a fixed age?
- Should untitled documents get a visible temporary name before first Save As?
- Should V1 expose an autosave toggle, or keep autosave always on?
- Should Electron V1 implement atomic compare-and-write immediately, or start with read-hash-write plus watcher?
