import type { DocumentState } from "@ordinate/core";

export type FillSessionSnapshot = { document: DocumentState; sheet: string };

/** File reload, undo and edits replace the document; switching sheets does not. Check both. */
export function isFillSessionCurrent(snapshot: FillSessionSnapshot, current: {
  docState: DocumentState | null; activeSheet: string | null; mode: string;
}): boolean {
  return current.mode === "table" && snapshot.document === current.docState && snapshot.sheet === current.activeSheet;
}
