import { DocumentState, SheetState } from "./incremental";
import { copyExpressionReferenceMetadata } from "./runtime/references";

/** Isolate evaluation/edit state, including the reference bindings in WeakMaps. */
export function cloneDocumentState(document: DocumentState): DocumentState {
  const clone = structuredClone(document) as DocumentState;
  Object.setPrototypeOf(clone, DocumentState.prototype);
  for (const sheet of clone.sheets) Object.setPrototypeOf(sheet, SheetState.prototype);
  document.sheets.forEach((sheet, s) => {
    sheet.cells.forEach((row, r) => {
      row.forEach((cell, c) => {
        const source = cell.body;
        if (!source.valid || source.kind !== "formula") return;
        const target = clone.sheets[s].cells[r][c].body;
        if (!target.valid || target.kind !== "formula") throw new Error("Document clone changed a formula cell.");
        copyExpressionReferenceMetadata(source.expression, target.expression);
      });
    });
  });
  return clone;
}
