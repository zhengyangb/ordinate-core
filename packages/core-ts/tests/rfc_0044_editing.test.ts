import { describe, expect, it, vi } from "vitest";
import { applyBatchWithUndo, applyCoreEditMemento, DocumentState, exportDelimitedSheet, getCellTextView, serializeDocumentState } from "../src";
import { parseCellInput } from "../src/runtime/parse";
import { evalExpr } from "../src/runtime/eval";

describe("RFC-0044 structural integration", () => {
  it("evaluates each interpolation expression once", () => {
    const parsed = parseCellInput('= f"{A1:,.2f}/{B1}"');
    if (!parsed.body.valid || parsed.body.kind !== 'formula') throw new Error('Expected formula');
    const evalCell = vi.fn(() => ({ kind: 'number' as const, value: 3 }));
    expect(evalExpr(parsed.body.expression, 0, 2, evalCell, new Map(), new Map(), 1, 3, 0, 1, [0], [0,1,2])).toEqual({ kind: 'string', value: '3.00/3' });
    expect(evalCell.mock.calls).toHaveLength(2);
  });
  it("renames cross-sheet references with undo/redo and never flattens the f-string", () => {
    const doc = DocumentState.fromText('# Inputs\n| 12 |\n\n# Report\n| |');
    doc.setCellByIndex('Report', 0, 0, '= f"Total: {@[Inputs::A1]:.2f}"');
    expect(doc.evaluate().sheets[1].values[0][0]).toEqual({ kind: 'string', value: 'Total: 12.00' });
    const result = applyBatchWithUndo(doc, [{ op: 'rename_sheet', sheet: 'Inputs', newName: 'New Inputs' }]);
    if (!result.ok) throw new Error(result.error.message);
    const renamed = result.nextDocument;
    expect(getCellTextView(renamed.sheets[1].cells[0][0]).inputText).toBe('= f"Total: {@["New Inputs"::A1]:.2f}"');
    expect(renamed.evaluate().sheets[1].values[0][0]).toEqual({ kind: 'string', value: 'Total: 12.00' });
    const undo = applyCoreEditMemento(renamed, result.memento, 'undo');
    if (!undo.ok) throw new Error(undo.error.message);
    expect(getCellTextView(undo.nextDocument.sheets[1].cells[0][0]).inputText).toBe('= f"Total: {@[Inputs::A1]:.2f}"');
    const redo = applyCoreEditMemento(undo.nextDocument, result.memento, 'redo');
    if (!redo.ok) throw new Error(redo.error.message);
    redo.nextDocument.evaluate();
    expect(serializeDocumentState(redo.nextDocument)).toBe(serializeDocumentState(renamed));
  });
  it("rebases inserted columns and invalidates deleted references", () => {
    const doc = DocumentState.fromText('# Data\n| 2 | 3 | |');
    doc.setCellByIndex('Data', 0, 2, '= f"{A1}/{B1}"');
    doc.insertCol('Data', 0);
    expect(getCellTextView(doc.sheets[0].cells[0][3]).inputText).toBe('= f"{B1}/{C1}"');
    doc.deleteCol('Data', 1);
    expect(doc.evaluate().sheets[0].values[0][2].kind).toBe('error');
  });
  it.each([
    'f"pipe | slash \\\\ \\"quote\\" line\\n{A1}"',
    'f"{{{A1}}} 😀 汉字 \\u007B"',
    'f"{if(true, "{:d}", "{:f}")}" {::bold}',
    'f"{sum(@[#1:#2,#1][0:2]):.2f}"',
  ])("round trips cell escaping and metadata: %s", formula => {
    const doc = DocumentState.fromText('# Data\n| 2 | |\n| 3 | |');
    doc.setCellByIndex('Data', 0, 1, '= ' + formula);
    const before = doc.evaluate().sheets[0].values[0][1];
    expect(before.kind).toBe('string');
    const restored = DocumentState.fromText(serializeDocumentState(doc));
    expect(restored.evaluate().sheets[0].values[0][1]).toEqual(before);
    expect(getCellTextView(restored.sheets[0].cells[0][1]).inputText).toContain('f"');
  });
  it.each(['csv', 'tsv'] as const)("exports calculated text through %s without bypassing safety", format => {
    const doc = DocumentState.fromText('# Data\n| 2 | |');
    doc.setCellByIndex('Data', 0, 1, '= f"Amount: {A1:.2f}"');
    const result = exportDelimitedSheet(doc, { format, sheetName: 'Data' });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.text).toContain('Amount: 2.00');
    doc.setCellByIndex('Data', 0, 1, '= f"={A1}"');
    expect(exportDelimitedSheet(doc, { format, sheetName: 'Data' }).ok).toBe(false);
    const confirmed = exportDelimitedSheet(doc, { format, sheetName: 'Data', formulaLikeText: 'preserve' });
    if (!confirmed.ok) throw new Error(JSON.stringify(confirmed.diagnostics));
    expect(confirmed.value.text).toContain('=2');
  });
  it("does not execute f-strings in Sheet Notes", () => {
    const doc = DocumentState.fromText('# Data\nf"{A1}"\n\n| 2 |');
    expect(serializeDocumentState(doc)).toContain('f"{A1}"');
  });
});
