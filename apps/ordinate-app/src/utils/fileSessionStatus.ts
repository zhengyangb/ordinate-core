import type { FileStatusTone } from "../components/AppChrome";
import type { FileSessionState } from "../store/fileSessionStore";

export function fileSessionStatus(
  state: Pick<
    FileSessionState,
    "operation" | "conflict" | "recoveryDraft" | "backingFileState" | "documentDirty" | "localDraftState" | "lastError" | "file"
  >,
  automatic = false,
): { label: string; tone: FileStatusTone } {
  if (state.operation?.kind === "open") return { label: "Opening...", tone: "saving" };
  if (state.operation) return { label: "Saving...", tone: "saving" };
  if (state.conflict) return { label: "Conflict", tone: "error" };
  if (state.recoveryDraft) return { label: "Draft available", tone: "warning" };
  if (state.backingFileState === "external_changed") return { label: "Changed on disk", tone: "warning" };
  if (state.lastError) return { label: "Save failed", tone: "error" };
  if (automatic && !state.file && state.localDraftState === "current") return { label: "Local draft", tone: "neutral" };
  if (state.localDraftState === "current" && state.documentDirty === "dirty") return { label: "Draft saved", tone: "warning" };
  if (!state.file && state.localDraftState === "none") return { label: "Unsaved", tone: "neutral" };
  if (state.documentDirty === "dirty") return { label: "Edited", tone: "dirty" };
  if (state.file?.adapterKind === "browser-download") return { label: "Downloaded", tone: "neutral" };
  if (state.file) return { label: automatic ? "Autosaved" : "Saved", tone: "neutral" };
  return { label: "Unsaved", tone: "neutral" };
}
