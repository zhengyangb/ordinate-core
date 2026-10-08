import { DocumentState, serializeDocumentState } from "@ordinate/core";

/** New documents start empty; the development editor has its own sample. */
export const BLANK_DOCUMENT = "# Sheet 1\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n";
export const CANONICAL_BLANK_DOCUMENT = serializeDocumentState(DocumentState.fromText(BLANK_DOCUMENT));
