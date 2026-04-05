import { DocumentState } from "./incremental";
import { serializeDocumentState } from "./serializer";

// Evaluate formulas and return canonical .ord text with cached values.
export function evaluateAndFormatDocument(text: string): string {
  const state = DocumentState.fromText(text);
  state.evaluate();
  return serializeDocumentState(state);
}

