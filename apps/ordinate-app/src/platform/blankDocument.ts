import { DocumentState, serializeDocumentState } from "@ordinate/core";
import type { FileSessionState } from "../store/fileSessionStore";

/** New documents start empty; the development editor has its own sample. */
export const BLANK_DOCUMENT = "# Sheet 1\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n";
export const CANONICAL_BLANK_DOCUMENT = serializeDocumentState(DocumentState.fromText(BLANK_DOCUMENT));

/** Provenance matters: an imported file with identical bytes is not a disposable starter. */
export function isUntouchedDefaultDocument(state: Pick<FileSessionState, "file" | "documentDirty" | "untitledBaselineText">): boolean {
  return state.file === null && state.documentDirty === "clean" && state.untitledBaselineText === CANONICAL_BLANK_DOCUMENT;
}
