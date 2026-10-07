import { describe, expect, it } from "vitest";
import { DocumentState, applyBatchWithUndo, applyCoreEditMemento, serializeDocumentState } from "../src";

const source = '# Data\n| "Sales" | "Group" | 12 | = @[#1,#3] + 1 |\n| "Cost" | "Group" | 4 | 5 |';
function convert(document: DocumentState, count: number) {
  const result = applyBatchWithUndo(document, [{ op: "set_header_columns", sheet: "Data", count }], { recalculate: true });
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
describe("header column structural edits", () => {
  it("changes the boundary without moving cells or changing bound references", () => {
    const document = DocumentState.fromText(source);
    const { nextDocument } = convert(document, 2);
    expect(nextDocument.sheets[0].headerColCount).toBe(2);
    expect(nextDocument.sheets[0].colIds).toEqual(document.sheets[0].colIds);
    expect(nextDocument.sheets[0].rowPaths).toEqual(["Sales", "Cost"]);
    expect(nextDocument.evaluate().sheets[0].values[0][3]).toEqual({ kind: "number", value: 13 });
    const restored = DocumentState.fromText(serializeDocumentState(nextDocument));
    expect(restored.sheets[0].headerColCount).toBe(2);
    expect(restored.evaluate().sheets[0].values[0][3]).toEqual({ kind: "number", value: 13 });
    expect(document.sheets[0].headerColCount).toBe(0);
  });
  it("removes the boundary and restores editable data columns", () => {
    const promoted = convert(DocumentState.fromText(source), 2).nextDocument;
    const demoted = convert(promoted, 0).nextDocument;
    const restored = DocumentState.fromText(serializeDocumentState(demoted));
    expect(restored.sheets[0].headerColCount).toBe(0);
    expect(restored.evaluate().sheets[0].values[0][0]).toEqual({ kind: "string", value: "Sales" });
  });
  it("undoes and redoes as one structural operation", () => {
    const document = DocumentState.fromText(source);
    const edit = convert(document, 1);
    const undone = applyCoreEditMemento(edit.nextDocument, edit.memento, "undo");
    if (!undone.ok) throw new Error(undone.error.message);
    expect(serializeDocumentState(undone.nextDocument)).toBe(serializeDocumentState(document));
    const redone = applyCoreEditMemento(undone.nextDocument, edit.memento, "redo");
    if (!redone.ok) throw new Error(redone.error.message);
    expect(redone.nextDocument.sheets[0].headerColCount).toBe(1);
  });
  it.each([-1, 4, 1.5, NaN, Infinity])("rejects invalid counts %s atomically", count => {
    const document = DocumentState.fromText(source);
    expect(() => convert(document, count)).toThrow();
    expect(document.sheets[0].headerColCount).toBe(0);
  });
  it("refuses to turn executable formulas into labels", () => {
    expect(() => convert(DocumentState.fromText('# Data\n| = 1+1 | 3 |'), 1)).toThrow(/formulas/);
  });
  it("does not expand a former label cell's bold style to the entire row", () => {
    const document = DocumentState.fromText('# Data\n| "Sales" {::bold} | 12 |');
    const next = convert(document, 1).nextDocument;
    expect(next.sheets[0].rowDisplayMetadata[0]).toBeNull();
    expect(DocumentState.fromText(serializeDocumentState(next)).sheets[0].rowDisplayMetadata[0]).toBeNull();
  });
  it("preserves row formatting when removing its last label column", () => {
    const document = DocumentState.fromText('# Data\n| Total {::bold} || 12 |');
    const next = convert(document, 0).nextDocument;
    expect(DocumentState.fromText(serializeDocumentState(next)).sheets[0].rowDisplayMetadata[0]).toMatchObject({style:{weight:"bold"}});
  });
});
