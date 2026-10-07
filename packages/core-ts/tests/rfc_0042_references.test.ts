import { describe, expect, it } from "vitest";
import { applyBatchAtomic, DocumentState, parseFormulaReferenceSyntax, planFillRegion, serializeDocumentState, type CoreEdit } from "../src";
import { ExcelFailure } from "../src/excel/contracts";
import { parseExcelFormula } from "../src/excel/formulaParser";
import { exportReference, importReference, type FormulaLocation } from "../src/excel/referenceTranslation";
import { walkExpressionReferences } from "../src/runtime/references";
import type { ReferenceExpr } from "../src/runtime/types";

const point = (row: number, col: number) => ({ rowStart: row, rowEnd: row, colStart: col, colEnd: col });
const location: FormulaLocation = { sheetName: "Sheet", rowIndex: 4, colIndex: 4 };

function reference(source: string): ReferenceExpr {
  const ref = parseFormulaReferenceSyntax(source)?.reference;
  if (!ref) throw new Error(`Invalid fixture reference ${source}`);
  return ref;
}

function matrix(input = "= A1", name = "Sheet"): DocumentState {
  const rows = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => String(r * 10 + c + 1)));
  rows[4][4] = input;
  return DocumentState.fromText(`# ${name}\n${rows.map(row => `| ${row.join(" | ")} |`).join("\n")}`);
}

function boundReference(document: DocumentState, row = 4, col = 4, sheet = 0): ReferenceExpr {
  document.evaluate();
  const body = document.sheets[sheet].cells[row][col].body;
  if (!body.valid || body.kind !== "formula") throw new Error("Expected a formula fixture");
  const refs: ReferenceExpr[] = [];
  walkExpressionReferences(body.expression, ref => refs.push(ref));
  expect(refs).toHaveLength(1);
  return refs[0];
}

function exported(document: DocumentState, row = 4, col = 4, sheet = 0) {
  const ref = boundReference(document, row, col, sheet);
  const source = document.sheets[sheet];
  return exportReference(ref, document, source, { sheetName: source.name, rowIndex: row, colIndex: col });
}

function imported(source: string, names: string[] = ["Sheet"]): string {
  const parsed = parseExcelFormula(source);
  if (parsed.kind !== "reference") throw new Error(`Expected an Excel reference: ${source}`);
  return importReference(parsed.reference, parsed.sheet, names, location);
}

function edit(document: DocumentState, changes: CoreEdit[]): DocumentState {
  const result = applyBatchAtomic(document, changes);
  if (!result.ok) throw new Error(result.error.message);
  return result.nextDocument;
}

function valueAt(document: DocumentState, row: number, col: number, sheet = 0) {
  return document.evaluate().sheets[sheet].values[row - document.sheets[sheet].bodyStart][col];
}

function expectFailure(operation: () => unknown, code: string) {
  try { operation(); } catch (error) {
    expect(error).toBeInstanceOf(ExcelFailure);
    if (!(error instanceof ExcelFailure)) throw error;
    expect(error.diagnostic).toMatchObject({ code, severity: "error", ...location });
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("RFC-0042 reference import and independently anchored export", () => {
  it.each([
    ["B2", "@[#2,#2]"], ["$B2", "@[#2,#2$]"], ["B$2", "@[#2$,#2]"], ["$B$2", "@[#2$,#2$]"],
    ["$A1:B$2", "@[#1:#2$,#1$:#2]"], ["$A:$B", "@[:,#1$:#2$]"], ["$1:2", "@[#1$:#2,:]"],
  ])("imports %s with explicit axis-specific copy locks", (excel, native) => {
    expect(imported(excel)).toBe(excel);
    const expected = matrix(`= sum(${native})`);
    const actual = matrix(`= sum(${imported(excel)})`);
    expect(valueAt(actual, 4, 4)).toEqual(valueAt(expected, 4, 4));
  });

  it.each(["B2", "$B2", "B$2", "$B$2", "$A1:B$2", "$A$1:$B$2"])(
    "exports bound %s without changing its copy/fill meaning", source => {
      const document = matrix(`= sum(${source})`);
      document.evaluate();
      const before = serializeDocumentState(document);
      const result = exported(document);
      expect(result.text).toBe(source);
      const converted = matrix(`= sum(${imported(result.text)})`);
      expect(valueAt(converted, 4, 4)).toEqual(valueAt(document, 4, 4));
      const fill = (state: DocumentState) => planFillRegion(state.sheets[0], point(4, 4), point(5, 4), "copy").values;
      const nativeFill = fill(document)[0][0];
      const importedFill = fill(converted)[0][0];
      document.setCellByIndex("Sheet", 5, 4, nativeFill);
      converted.setCellByIndex("Sheet", 5, 4, importedFill);
      expect(valueAt(converted, 5, 4)).toEqual(valueAt(document, 5, 4));
      // Export itself must not mutate input or binding metadata.
      const untouched = matrix(`= sum(${source})`);
      exported(untouched);
      expect(serializeDocumentState(untouched)).toBe(before);
    },
  );

  it.each(["$A1:A$1", "$A$1:A1", "A1:$A$1"])(
    "retains both endpoint locks of the currently single-cell range %s", source => {
      const original = matrix(`= sum(${source})`);
      const result = exported(original);
      expect(result.view).toBe(true);
      const restored = matrix(`= sum(${imported(result.text)})`);
      for (const [r, c] of [[5, 4], [4, 5]] as const) {
        const nativeCopy = planFillRegion(original.sheets[0], point(4, 4), point(r, c), "copy").values[0][0];
        const importedCopy = planFillRegion(restored.sheets[0], point(4, 4), point(r, c), "copy").values[0][0];
        original.setCellByIndex("Sheet", r, c, nativeCopy);
        restored.setCellByIndex("Sheet", r, c, importedCopy);
        expect(valueAt(restored, r, c)).toEqual(valueAt(original, r, c));
      }
    },
  );

  it("keeps one-cell ranges as views while scalars remain scalars", () => {
    expect(exported(matrix("= A1"))).toMatchObject({ text: "A1", cells: [["A1"]], rows: 1, columns: 1, view: false });
    expect(exported(matrix("= sum(A1:A1)"))).toMatchObject({ rows: 1, columns: 1, view: true });
  });

  it.each([
    ["'O''Brien'!$B2", "O'Brien"], ["'INPUT DATA'!A$1", "Input Data"], ["sales!$A$1", "Sales"],
  ])("resolves Excel sheet spelling %s to the exact native name", (source, targetName) => {
    const native = imported(source, ["Sheet", targetName]);
    const syntax = parseFormulaReferenceSyntax(native);
    expect(syntax).toMatchObject({ crossSheet: true, sheetName: targetName });
    expect(syntax?.reference?.rowSelector).toEqual((parseExcelFormula(source) as { reference: ReferenceExpr }).reference.rowSelector);
    expect(syntax?.reference?.colSelector).toEqual((parseExcelFormula(source) as { reference: ReferenceExpr }).reference.colSelector);
  });

  it.each([["Missing", ["Sheet"]], ["sales", ["Sales", "SALES"]]])(
    "rejects absent or case-ambiguous imported sheet %s", (name, names) => {
      expectFailure(() => importReference(reference("A1"), name as string, names as string[], location), "invalid_reference");
    },
  );
});

describe("RFC-0042 references retain native identity during structural edits", () => {
  it.each(["A1", "$A1", "A$1", "$A$1"])("exports the moved target of %s after insertion", source => {
    const document = matrix(`= ${source}`);
    expect(valueAt(document, 4, 4)).toEqual({ kind: "number", value: 1 });
    document.insertRow("Sheet", 0);
    document.insertCol("Sheet", 0);
    const expected = source.replace("A", "B").replace("1", "2");
    expect(exported(document, 5, 5).text).toBe(expected);
    expect(valueAt(document, 5, 5)).toEqual({ kind: "number", value: 1 });
  });

  it("keeps label targets through row/column renames, insertions and reordering", () => {
    let document = DocumentState.fromText(`# Sheet\n| Item || Amount | Other | Result |\n| --- || --- | --- | --- |\n| Alpha || 7 | 17 | |\n| Beta || 9 | 19 | |\n| Output || 0 | 0 | = @[Alpha,Amount] |`);
    expect(exported(document, 3, 3).text).toBe("$B$2");
    document.renameRowLabel("Sheet", "Alpha", "Renamed");
    document.renameColLabel("Sheet", "Amount", "Revenue");
    document.insertRow("Sheet", 1);
    document.insertCol("Sheet", 1);
    expect(valueAt(document, 4, 4)).toEqual({ kind: "number", value: 7 });
    expect(exported(document, 4, 4).text).toBe("$C$3");
    const rowId = document.sheets[0].rowIds[2];
    document = edit(document, [{ op: "move_rows", sheet: "Sheet", rowIds: [rowId], targetGapIndex: 3 }]);
    expect(valueAt(document, 4, 4)).toEqual({ kind: "number", value: 7 });
    expect(exported(document, 4, 4).text).toBe("$C$4");
  });

  it("follows bound cross-sheet identity after sheet rename and target insertion", () => {
    let document = DocumentState.fromText(`# O'Brien\n| 7 | 8 |\n| 9 | 10 |\n\n# Summary\n| = @["O'Brien"::[#1$,#1]] |`);
    expect(exported(document, 0, 0, 1).text).toBe("'O''Brien'!A$1");
    document = edit(document, [{ op: "rename_sheet", sheet: "O'Brien", newName: "New Inputs" }]);
    document.insertRow("New Inputs", 0);
    document.insertCol("New Inputs", 0);
    expect(valueAt(document, 0, 0, 1)).toEqual({ kind: "number", value: 7 });
    expect(exported(document, 0, 0, 1).text).toBe("'New Inputs'!B$2");
  });

  it("expands and shrinks a bound range when an interior row is inserted and removed", () => {
    const document = matrix("= sum($A$1:B3)");
    const initial = valueAt(document, 4, 4);
    document.insertRow("Sheet", 1);
    expect(exported(document, 5, 4)).toMatchObject({ text: "$A$1:B4", rows: 4, columns: 2 });
    expect(valueAt(document, 5, 4)).toEqual(initial);
    document.deleteRow("Sheet", 1);
    expect(exported(document)).toMatchObject({ text: "$A$1:B3", rows: 3, columns: 2 });
    expect(valueAt(document, 4, 4)).toEqual(initial);
  });

  it("preserves endpoint-associated copy locks when rows exchange order", () => {
    let document = matrix("= sum($A$1:B2)");
    document.evaluate();
    const first = document.sheets[0].rowIds[0];
    document = edit(document, [{ op: "move_rows", sheet: "Sheet", rowIds: [first], targetGapIndex: 3 }]);
    const converted = DocumentState.fromText(serializeDocumentState(document));
    converted.setCellByIndex("Sheet", 4, 4, `= sum(${imported(exported(document).text)})`);
    const fillDown = (state: DocumentState) => {
      const input = planFillRegion(state.sheets[0], point(4, 4), point(5, 4), "copy").values[0][0];
      state.setCellByIndex("Sheet", 5, 4, input);
      return valueAt(state, 5, 4);
    };
    expect(fillDown(converted)).toEqual(fillDown(document));
    // Before moving: row 1 owns the row lock. Afterwards that row is at position 4.
    // Column A keeps the independently owned column lock.
    expect(exported(document).text).toBe("$A1:B$4");
    expect(exported(converted).text).toBe("$A1:B$4");
  });

  it("fails for a deleted target instead of silently switching to its replacement position", () => {
    const document = matrix("= $A$1");
    document.evaluate();
    document.deleteRow("Sheet", 0);
    const ref = boundReference(document, 3, 4);
    expectFailure(() => exportReference(ref, document, document.sheets[0], location), "invalid_reference");
  });
});

describe("RFC-0042 hierarchy-aware selections and contextual positions", () => {
  it("keeps the native all-row meaning, which currently includes populated parent rows", () => {
    const document = DocumentState.fromText(`# Sheet\n| Item || Amount | Other | Result |\n| --- || --- | --- | --- |\n| North || 1000 | 2000 | |\n| * One || 1 | 2 | |\n| * Two || 3 | 4 | |\n| South || 3000 | 4000 | |\n| * Three || 5 | 6 | |\n| Output || 0 | 0 | = sum(@[:,Amount:Other]) |`);
    const result = exported(document, 6, 3);
    expect(valueAt(document, 6, 3)).toEqual({ kind: "number", value: 10021 });
    expect(result).toMatchObject({ text: "$B$2:$C$7", rows: 6, columns: 2, view: true });
  });

  it("retains explicitly noncontiguous selection membership without inserting skipped parent rows", () => {
    const document = DocumentState.fromText(`# Sheet\n| Item || Amount | Other | Result |\n| --- || --- | --- | --- |\n| North || 1000 | 2000 | |\n| * One || 1 | 2 | |\n| * Two || 3 | 4 | |\n| South || 3000 | 4000 | |\n| * Three || 5 | 6 | |\n| Output || 0 | 0 | = sum(@[:,Amount:Other]) |`);
    const ref = boundReference(document, 6, 3);
    // Explicit selector-resolution fixture, not a claim that native ':' filters parents.
    document.sheets[0].dataRowIndices = [2, 3, 5, 6];
    const result = exportReference(ref, document, document.sheets[0], { sheetName: "Sheet", rowIndex: 6, colIndex: 3 });
    expect(result).toMatchObject({
      text: "CHOOSE({1,2;3,4;5,6;7,8},$B$3,$C$3,$B$4,$C$4,$B$6,$C$6,$B$7,$C$7)",
      cells: [["$B$3", "$C$3"], ["$B$4", "$C$4"], ["$B$6", "$C$6"], ["$B$7", "$C$7"]],
      rows: 4, columns: 2, view: true,
    });
  });

  it("all columns excludes the structural label column", () => {
    const document = DocumentState.fromText(`# Sheet\n| Item || Amount | Other | Result |\n| --- || --- | --- | --- |\n| Alpha || 1 | 2 | 3 |\n| Output || 0 | 0 | = sum(@[Alpha,:]) |`);
    expect(exported(document, 2, 3)).toMatchObject({ text: "$B$2:$D$2", cells: [["$B$2", "$C$2", "$D$2"]], rows: 1, columns: 3, view: true });
    expect(valueAt(document, 2, 3)).toEqual({ kind: "number", value: 6 });
  });

  it.each([
    ["@[_-1,_-2]", "C4", 33],
    ["@[_,_-1]", "D5", 44],
    ["@[_-2,_]", "E3", 25],
    ["@[#1!,#1!]", "$A$1", 1],
    ["@[#2!,_-1]", "D$2", 14],
  ])("exports contextual %s as a readable A1 address", (source, text, expected) => {
    const document = matrix(`= ${source}`);
    const result = exported(document);
    expect(result).toMatchObject({ cells: [[result.text]], rows: 1, columns: 1, view: false });
    expect(result.text).toBe(text);
    expect(valueAt(document, 4, 4)).toEqual({ kind: "number", value: expected });
  });

  it("resolves offsets against the document at export time", () => {
    const document = matrix("= @[_-1,_-2]");
    expect(valueAt(document, 4, 4)).toEqual({ kind: "number", value: 33 });
    document.insertRow("Sheet", 4);
    expect(valueAt(document, 5, 4).kind).toBe("blank");
    expect(exported(document, 5, 4).text).toBe("C5");
  });

  it.each([
    ["@[_-1,#2]", 'B4', 32],
    ["@[_-1,#2$]", '$B4', 32],
    ["@[#2,_-1]", 'D2', 14],
    ["@[#2$,_-1]", 'D$2', 14],
    ["@[#2!,#2]", 'B$2', 12],
  ])("keeps the non-contextual axis of %s as an actual structural reference", (source, expected, value) => {
    const document = matrix(`= ${source}`);
    expect(valueAt(document, 4, 4)).toEqual({ kind: "number", value });
    // Compare reference ASTs, including the axis-specific copy locks.
    expect(parseExcelFormula(exported(document).text)).toEqual(parseExcelFormula(expected as string));
  });

  it("keeps a label axis live beside an offset through target-column insertion", () => {
    const document = DocumentState.fromText(`# Sheet\n| Item || Amount | Other | Result |\n| --- || --- | --- | --- |\n| Alpha || 7 | 17 | |\n| Beta || 9 | 19 | |\n| Output || 0 | 0 | = @[_-1,Amount] |`);
    expect(valueAt(document, 3, 3)).toEqual({ kind: "number", value: 9 });
    expect(parseExcelFormula(exported(document, 3, 3).text)).toEqual(parseExcelFormula('$B3'));
    document.insertCol("Sheet", 1);
    expect(valueAt(document, 3, 4)).toEqual({ kind: "number", value: 9 });
    expect(parseExcelFormula(exported(document, 3, 4).text)).toEqual(parseExcelFormula('$C3'));
  });

  it("keeps #n! at the same physical position across structural insertion", () => {
    const document = matrix("= @[#1!,#1!]");
    expect(valueAt(document, 4, 4)).toEqual({ kind: "number", value: 1 });
    document.insertRow("Sheet", 0);
    document.insertCol("Sheet", 0);
    expect(valueAt(document, 5, 5).kind).toBe("blank");
    expect(exported(document, 5, 5).text).toBe("$A$1");
  });

  it("quotes cross-sheet fixed-position $A$1 text without losing apostrophes", () => {
    const document = DocumentState.fromText(`# O'Brien\n| 7 | 8 |\n| 9 | 10 |\n\n# Summary\n| 0 | 0 |\n| 0 | = @["O'Brien"::[#1!,#1!]] |`);
    expect(valueAt(document, 1, 1, 1)).toEqual({ kind: "number", value: 7 });
    expect(exported(document, 1, 1, 1).text).toBe("'O''Brien'!$A$1");
  });

  it("rejects unresolved or ambiguous labels with cell-local diagnostics", () => {
    const document = DocumentState.fromText(`# Sheet\n| Item || Amount | Result |\n| --- || --- | --- |\n| Same || 1 | |\n| Same || 2 | |\n| Output || 0 | = @[Missing,Amount] |`);
    for (const source of ["@[Missing,Amount]", "@[Same,Amount]"]) {
      expectFailure(() => exportReference(reference(source), document, document.sheets[0], location), "invalid_reference");
    }
  });

  it("refuses an empty selected axis instead of manufacturing a zero-valued cell", () => {
    const document = matrix("= sum(@[:,#1])");
    const ref = boundReference(document);
    document.sheets[0].dataRowIndices = [];
    expectFailure(() => exportReference(ref, document, document.sheets[0], location), "unsupported_formula");
  });

  it("enforces CHOOSE's argument budget without widening a sparse selection", () => {
    const document = DocumentState.fromText(`# Sheet\n${Array.from({ length: 510 }, (_, row) => `| ${row + 1} | ${row === 509 ? "= sum(@[:,#1])" : "0"} |`).join("\n")}`);
    const ref = boundReference(document, 509, 1);
    const source = document.sheets[0];
    source.dataRowIndices = Array.from({ length: 254 }, (_, index) => index * 2);
    expect(exportReference(ref, document, source, location)).toMatchObject({ rows: 254, columns: 1, view: true });
    source.dataRowIndices.push(508);
    expectFailure(() => exportReference(ref, document, source, location), "unsupported_formula");
  });
});
