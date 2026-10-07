import type { FileReference } from "./storage.js";

/** A draft name is a label, never a path or permission to write a source file. */
export function validateDocumentName(name: string): void {
  if (typeof name !== "string" || !name.trim() || /[/\\\u0000-\u001f]/.test(name)) {
    throw new Error("Invalid document name.");
  }
}

export function documentName(state: { file: FileReference | null; draftName: string | null }): string {
  return state.file?.displayName ?? state.draftName ?? "Untitled";
}

export function documentSaveName(state: { file: FileReference | null; draftName: string | null }): string {
  const name = documentName(state);
  return /\.ord$/i.test(name) ? name : `${name}.ord`;
}
