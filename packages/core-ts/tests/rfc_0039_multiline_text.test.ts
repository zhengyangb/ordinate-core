import { describe, expect, it } from "vitest";
import { DocumentState, applyBatchWithUndo, applyCoreEditMemento, getCellTextView, isImplicitTextInput, parseCellText, serializeDocumentState } from "../src";
import { escapeCellText } from "../src/parser";

const initial = () => DocumentState.fromText("# Sheet\n| Name || Note |\n| --- || --- |\n| A || old |\n| B || other |");
const value = (doc: DocumentState, row = 1) => doc.sheets[0].cells[row][1].body;

describe("RFC-0039 multiline text", () => {
  it.each(["hello\nworld", "hello\n\nworld\n", "\nhello", "\n", 'hello | "quoted"\nC:\\temp\\new', String.raw`literal \n stays literal`, "first\r\nsecond\rthird"])("round trips implicit input %j without creating document rows", input => {
    const before = initial();
    const result = applyBatchWithUndo(before, [{ op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 1 }, input }]);
    if (!result.ok) throw new Error(result.error.message);
    const expected = input.replace(/\r\n?/g, "\n");
    expect(value(result.nextDocument)).toMatchObject({ kind: "literal", inputText: expected, literal: { kind: "string", value: expected } });
    const text = serializeDocumentState(result.nextDocument);
    expect(text.trimEnd().split("\n")).toHaveLength(5);
    const reopened = DocumentState.fromText(text);
    expect(value(reopened)).toMatchObject({ kind: "literal", inputText: expected, literal: { kind: "string", value: expected } });
    expect(serializeDocumentState(reopened)).toBe(text);
    const undo = applyCoreEditMemento(result.nextDocument, result.memento, "undo");
    if (!undo.ok) throw new Error(undo.error.message);
    expect(serializeDocumentState(undo.nextDocument)).toBe(serializeDocumentState(before));
    const redo = applyCoreEditMemento(undo.nextDocument, result.memento, "redo");
    if (!redo.ok) throw new Error(redo.error.message);
    expect(serializeDocumentState(redo.nextDocument)).toBe(text);
  });
  it("decodes explicit string escapes and formula results without changing reference escaping", () => {
    const input = String.raw`"first\nsecond \\ \" |"`;
    expect(parseCellText(input).body).toMatchObject({ literal: { kind: "string", value: 'first\nsecond \\ " |' } });
    const doc = DocumentState.fromText(`# Sheet\n| ${escapeCellText(`= ${input}`)} |`);
    expect(doc.evaluate().sheets[0].values[0][0]).toEqual({ kind: "string", value: 'first\nsecond \\ " |' });
    const serialized = serializeDocumentState(doc);
    expect(serialized.trimEnd().split("\n")).toHaveLength(2);
    expect(DocumentState.fromText(serialized).evaluate().sheets[0].values[0][0]).toEqual(doc.evaluate().sheets[0].values[0][0]);
    expect(parseCellText(String.raw`"bad\q"`).body).toMatchObject({ literal: { kind: "error" } });
  });
  it("shares text eligibility with the UI, without treating numeric, quoted or formula inputs as implicit text", () => {
    for (const input of ["hello", "", "hello\n", String.raw`C:\temp`, "A|B"]) expect(isImplicitTextInput(input)).toBe(true);
    for (const input of ['"hello"', '"', "= 1", "true", "123", "2026-09-26", "hello {::bold}"]) expect(isImplicitTextInput(input)).toBe(false);
  });
  it("rejects structural multiline edits and invalid region inputs atomically", () => {
    const doc = initial();
    for (const [rowIndex, colIndex] of [[0, 1], [1, 0]]) {
      const result = applyBatchWithUndo(doc, [{ op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex, colIndex }, input: "first\nsecond" }]);
      expect(result.ok).toBe(false);
    }
    const sheet = doc.sheets[0];
    const target = { sheet: "Sheet", start: { rowId: sheet.rowIds[1], colId: sheet.colIds[1] }, end: { rowId: sheet.rowIds[2], colId: sheet.colIds[1] } };
    const before = serializeDocumentState(doc);
    const result = applyBatchWithUndo(doc, [{ op: "set_region", target, values: [["valid\ntext"], ["= 1\n+ 2"]] }]);
    expect(result.ok).toBe(false);
    expect(serializeDocumentState(doc)).toBe(before);
    const valid = applyBatchWithUndo(doc, [{ op: "set_region", target, values: [["valid\ntext"], ["another\nvalue"]] }]);
    expect(valid.ok).toBe(true);
  });
  it.each([
    ["1", "number"], ["true", "boolean"], ["null", "null"], ["2026-09-26", "date"],
    ["14:30", "time"], ["2026-09-26T14:30:00Z", "datetime"], ["PT1H", "duration"],
  ])("turns %s into text on newline alone and restores its type on undo", (input, kind) => {
    const target = { kind: "index" as const, sheet: "Sheet", rowIndex: 1, colIndex: 1 };
    const numeric = applyBatchWithUndo(initial(), [{ op: "set_cell_input", target, input }]);
    if (!numeric.ok) throw new Error(numeric.error.message);
    expect(value(numeric.nextDocument)).toMatchObject({ literal: { kind } });
    const edited = applyBatchWithUndo(numeric.nextDocument, [{ op: "set_cell_input", target, input: `${input}\n` }]);
    if (!edited.ok) throw new Error(edited.error.message);
    const reopened = DocumentState.fromText(serializeDocumentState(edited.nextDocument));
    expect(value(reopened)).toMatchObject({ literal: { kind: "string", value: `${input}\n` } });
    const undo = applyCoreEditMemento(edited.nextDocument, edited.memento, "undo");
    if (!undo.ok) throw new Error(undo.error.message);
    expect(value(undo.nextDocument)).toMatchObject({ literal: { kind } });
    const removed = applyBatchWithUndo(edited.nextDocument, [{ op: "set_cell_input", target, input }]);
    if (!removed.ok) throw new Error(removed.error.message);
    expect(value(removed.nextDocument)).toMatchObject({ literal: { kind } });
  });
  it("fills multiline inputs without flattening text and preserves style through serialization", () => {
    const doc = initial();
    const first = applyBatchWithUndo(doc, [{ op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 1 }, input: "one\ntwo\n" },
      { op: "set_cell_local_style", target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 1 }, style: { weight: "bold" } }]);
    if (!first.ok) throw new Error(first.error.message);
    const sheet = first.nextDocument.sheets[0];
    const region = (r: number) => ({ sheet: "Sheet", start: { rowId: sheet.rowIds[r], colId: sheet.colIds[1] }, end: { rowId: sheet.rowIds[r], colId: sheet.colIds[1] } });
    const filled = applyBatchWithUndo(first.nextDocument, [{ op: "fill_region", source: region(1), target: region(2), mode: "copy" }]);
    if (!filled.ok) throw new Error(filled.error.message);
    const reopened = DocumentState.fromText(serializeDocumentState(filled.nextDocument));
    expect(getCellTextView(reopened.sheets[0].cells[1][1]).inputText).toBe("one\ntwo\n");
    expect(getCellTextView(reopened.sheets[0].cells[2][1]).inputText).toBe("one\ntwo\n");
  });
});
