import { describe, expect, it } from "vitest";

import {
  applyBatchAtomic,
  applyBatchWithUndo,
  applyCoreEditMemento,
  DocumentState,
  evaluateDocument,
  isError,
  serializeDocumentState,
  SheetState,
  type RuntimeValue,
} from "../src";
import { parseCellInput } from "../src/runtime";

const CROSS_SHEET_DOC = `
# Inputs
| Metric || Amount | Flag |
| ------ || ------ | ---- |
| Revenue || 100 | true |
| Cost || 40 | false |
| Units || 5 | true |

# Summary
| Item || Value |
| ---- || ----- |
| Revenue || = @["Inputs"::[Revenue,Amount]] |
| Profit || = @["Inputs"::[Revenue,Amount]] - @["Inputs"::[Cost,Amount]] |
| Total || = sum(@["Inputs"::[:,Amount]]) |
| FirstFlag || = @["Inputs"::[Revenue,Flag]] |
| Indexed || = @["Inputs"::[:,Amount]][1] |
`.trim();

function sheet(result: ReturnType<typeof evaluateDocument>, name: string) {
  const found = result.sheets.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing sheet ${name}`);
  return found;
}

function cellValue(documentText: string, sheetName: string, rowPath: string, colLabel: string): RuntimeValue {
  return cellValueFromState(DocumentState.fromText(documentText), sheetName, rowPath, colLabel);
}

function cellValueFromState(document: DocumentState, sheetName: string, rowPath: string, colLabel: string): RuntimeValue {
  const result = document.evaluate();
  const targetSheet = sheet(result, sheetName);
  const row = targetSheet.rowPaths.indexOf(rowPath);
  const col = targetSheet.colLabels.indexOf(colLabel);
  if (row < 0 || col < 0) {
    throw new Error(`missing cell ${sheetName}:${rowPath},${colLabel}`);
  }
  return targetSheet.values[row][col];
}

function expectNumber(value: RuntimeValue, expected: number): void {
  expect(value.kind).toBe("number");
  if (value.kind !== "number") throw new Error("expected number");
  expect(value.value).toBeCloseTo(expected);
}

function expectBoolean(value: RuntimeValue, expected: boolean): void {
  expect(value.kind).toBe("boolean");
  if (value.kind !== "boolean") throw new Error("expected boolean");
  expect(value.value).toBe(expected);
}

function expectErrorKind(value: RuntimeValue, errorKind: string): void {
  expect(isError(value)).toBe(true);
  if (!isError(value)) throw new Error("expected error");
  expect(value.errorKind).toBe(errorKind);
}

function expectInvalidFormula(input: string, internalKind: string): void {
  const parsed = parseCellInput(input);
  expect(parsed.body.valid).toBe(false);
  if (parsed.body.valid) throw new Error(`expected invalid formula: ${input}`);
  expect(parsed.body.issue.code).toBe(internalKind);
}

describe("RFC-0036 cross-sheet references", () => {
  it("evaluates scalar, aggregate, boolean, and indexed cross-sheet references", () => {
    expectNumber(cellValue(CROSS_SHEET_DOC, "Summary", "Revenue", "Value"), 100);
    expectNumber(cellValue(CROSS_SHEET_DOC, "Summary", "Profit", "Value"), 60);
    expectNumber(cellValue(CROSS_SHEET_DOC, "Summary", "Total", "Value"), 145);
    expectBoolean(cellValue(CROSS_SHEET_DOC, "Summary", "FirstFlag", "Value"), true);
    expectNumber(cellValue(CROSS_SHEET_DOC, "Summary", "Indexed", "Value"), 40);
  });

  it("supports explicit references to the current sheet by sheet name", () => {
    const doc = `
# Sheet
| Item || Value |
| ---- || ----- |
| Base || 7 |
| Copy || = @["Sheet"::[Base,Value]] |
`.trim();

    expectNumber(cellValue(doc, "Sheet", "Copy", "Value"), 7);
  });

  it("rejects malformed cross-sheet reference syntax early", () => {
    expectInvalidFormula(
      '= @["Inputs"::Revenue,Amount]',
      "parse_cross_sheet_reference_missing_target_brackets",
    );
    expectInvalidFormula(
      '= @["Inputs"::[_,Amount]]',
      "parse_cross_sheet_reference_contextual_selector",
    );
    expectInvalidFormula(
      '= @["Inputs"::[Revenue,_+1]]',
      "parse_cross_sheet_reference_contextual_selector",
    );
    expectInvalidFormula(
      '= @["Inputs"::A0]',
      "parse_cross_sheet_reference_missing_target_brackets",
    );
    expectInvalidFormula(
      '= @[Input_Sheet::[Revenue,Amount]]',
      "parse_cross_sheet_reference_invalid_sheet_selector",
    );
  });

  it("reports missing and ambiguous sheets as reference errors", () => {
    const missing = `
# Summary
| Item || Value |
| ---- || ----- |
| Missing || = @["Inputs"::[Revenue,Amount]] |
`.trim();
    expectErrorKind(cellValue(missing, "Summary", "Missing", "Value"), "unresolved_reference");

    const ambiguous = `
# Inputs
| Metric || Amount |
| ------ || ------ |
| Revenue || 100 |

# Inputs
| Metric || Amount |
| ------ || ------ |
| Revenue || 200 |

# Summary
| Item || Value |
| ---- || ----- |
| Revenue || = @["Inputs"::[Revenue,Amount]] |
`.trim();
    expectErrorKind(cellValue(ambiguous, "Summary", "Revenue", "Value"), "ambiguous_reference");
  });

  it("detects cycles across sheets", () => {
    const doc = `
# A
| Item || Value |
| ---- || ----- |
| X || = @["B"::[Y,Value]] |

# B
| Item || Value |
| ---- || ----- |
| Y || = @["A"::[X,Value]] |
`.trim();

    expectErrorKind(cellValue(doc, "A", "X", "Value"), "cycle");
    expectErrorKind(cellValue(doc, "B", "Y", "Value"), "cycle");
  });

  it("serializes and reparses canonical sheet-qualified formula text", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    const text = serializeDocumentState(state);
    expect(text).toContain("= @[Inputs::[Revenue,Amount]]");
    expect(text).toContain("= sum(@[Inputs::[:,Amount]])");

    const roundTripped = DocumentState.fromText(text);
    expect(roundTripped.evaluate().sheets).toEqual(state.evaluate().sheets);
  });

  it("keeps internal formula binding metadata out of public JSON-shaped AST inspection", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    state.evaluate();
    const summary = state.sheets[1];
    const formulaCell = summary.cells[summary.bodyStart][1];
    expect(formulaCell.body.valid).toBe(true);
    if (!formulaCell.body.valid || formulaCell.body.kind !== "formula") {
      throw new Error("expected formula cell");
    }

    const astJson = JSON.stringify(formulaCell.body.expression);
    expect(astJson).not.toContain("__sheetId");
    expect(astJson).not.toContain('"source"');
    expect(formulaCell.body.expression.kind).toBe("reference");
    if (formulaCell.body.expression.kind !== "reference") {
      throw new Error("expected reference expression");
    }
    const ref = formulaCell.body.expression.value as {
      sheetSelector?: Record<string, unknown>;
      rowSelector?: Record<string, unknown>;
      colSelector?: Record<string, unknown>;
    };
    expect(Object.keys(ref.sheetSelector ?? {})).toEqual(["kind", "value"]);
    expect(Object.keys(ref.rowSelector ?? {})).not.toContain("source");
    expect(Object.keys(ref.colSelector ?? {})).not.toContain("source");
  });

  it("renames a referenced sheet without breaking bound formulas", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    const renamed = applyBatchAtomic(state, [{ op: "rename_sheet", sheet: "Inputs", newName: "Assumptions" }]);
    expect(renamed.ok, renamed.ok ? undefined : renamed.error.message).toBe(true);
    if (!renamed.ok) throw new Error("expected rename success");

    expectNumber(cellValueFromState(renamed.nextDocument, "Summary", "Profit", "Value"), 60);
    const text = serializeDocumentState(renamed.nextDocument);
    expect(text).toContain("@[Assumptions::[Revenue,Amount]]");
    expect(text).not.toContain("@[Inputs::[Revenue,Amount]]");
  });

  it("does not rebind a deleted sheet reference to a later same-name replacement in the same session", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    state.evaluate();

    const replaced = applyBatchAtomic(state, [
      { op: "delete_sheet", sheet: "Inputs" },
      { op: "insert_sheet", name: "Inputs", sheetIndex: 0 },
      { op: "set_cell_input", target: { kind: "index", sheet: "Inputs", rowIndex: 0, colIndex: 0 }, input: "999" },
    ]);
    expect(replaced.ok, replaced.ok ? undefined : replaced.error.message).toBe(true);
    if (!replaced.ok) throw new Error("expected same-name replacement success");

    expectErrorKind(cellValueFromState(replaced.nextDocument, "Summary", "Revenue", "Value"), "unresolved_reference");

    const reparsed = DocumentState.fromText(serializeDocumentState(replaced.nextDocument));
    expectErrorKind(cellValueFromState(reparsed, "Summary", "Revenue", "Value"), "unresolved_reference");
  });

  it("documents that serialize and reparse name-bind a deleted same-name replacement when labels match", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    state.evaluate();

    const replaced = applyBatchAtomic(state, [
      { op: "delete_sheet", sheet: "Inputs" },
      { op: "insert_sheet", name: "Inputs", sheetIndex: 0 },
    ]);
    expect(replaced.ok, replaced.ok ? undefined : replaced.error.message).toBe(true);
    if (!replaced.ok) throw new Error("expected same-name replacement success");

    const replacement = replaced.nextDocument.sheets[0];
    replaced.nextDocument.sheets[0] = SheetState.fromTableRows(
      "Inputs",
      [
        "| Metric || Amount | Flag |",
        "| ------ || ------ | ---- |",
        "| Revenue || 999 | true |",
        "| Cost || 1 | false |",
        "| Units || 1 | true |",
      ],
      undefined,
      undefined,
      replacement.sheetId,
    );

    expectErrorKind(cellValueFromState(replaced.nextDocument, "Summary", "Revenue", "Value"), "unresolved_reference");

    const reparsed = DocumentState.fromText(serializeDocumentState(replaced.nextDocument));
    expectNumber(cellValueFromState(reparsed, "Summary", "Revenue", "Value"), 999);
  });

  it("undo restores the original sheet identity for cross-sheet references", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    state.evaluate();

    const deleted = applyBatchWithUndo(state, [{ op: "delete_sheet", sheet: "Inputs" }]);
    expect(deleted.ok, deleted.ok ? undefined : deleted.error.message).toBe(true);
    if (!deleted.ok) throw new Error("expected delete success");
    expectErrorKind(cellValueFromState(deleted.nextDocument, "Summary", "Profit", "Value"), "unresolved_reference");

    const undone = applyCoreEditMemento(deleted.nextDocument, deleted.memento, "undo");
    expect(undone.ok, undone.ok ? undefined : undone.error.message).toBe(true);
    if (!undone.ok) throw new Error("expected undo success");
    expectNumber(cellValueFromState(undone.nextDocument, "Summary", "Profit", "Value"), 60);
  });

  it("binds formulas created through set_cell_input before later sheet lifecycle edits", () => {
    const state = DocumentState.fromText(`
# Inputs
| Metric || Amount |
| ------ || ------ |
| Revenue || 100 |

# Summary
| Item || Value |
| ---- || ----- |
| Revenue || 0 |
`.trim());

    const edited = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Summary", rowPath: "Revenue", colLabel: "Value" },
        input: '= @["Inputs"::[Revenue,Amount]]',
      },
      { op: "delete_sheet", sheet: "Inputs" },
      { op: "insert_sheet", name: "Inputs", sheetIndex: 0 },
    ]);
    expect(edited.ok, edited.ok ? undefined : edited.error.message).toBe(true);
    if (!edited.ok) throw new Error("expected edit success");

    expectErrorKind(cellValueFromState(edited.nextDocument, "Summary", "Revenue", "Value"), "unresolved_reference");
  });

  it("keeps cross-sheet references bound across target sheet column movement", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    state.evaluate();
    const inputs = state.sheets[0];
    const amountColId = inputs.colIds[1];

    const moved = applyBatchAtomic(state, [
      { op: "move_columns", sheet: "Inputs", colIds: [amountColId], targetGapIndex: 2 },
    ]);
    expect(moved.ok, moved.ok ? undefined : moved.error.message).toBe(true);
    if (!moved.ok) throw new Error("expected column move success");

    expect(moved.nextDocument.sheets[0].colLabels).toEqual(["Metric", "Flag", "Amount"]);
    expectNumber(cellValueFromState(moved.nextDocument, "Summary", "Revenue", "Value"), 100);
    expect(serializeDocumentState(moved.nextDocument)).toContain("@[Inputs::[Revenue,Amount]]");
  });

  it("keeps cross-sheet references bound across target sheet row movement", () => {
    const state = DocumentState.fromText(CROSS_SHEET_DOC);
    state.evaluate();
    const inputs = state.sheets[0];
    const revenueRowId = inputs.rowIds[inputs.bodyStart + inputs.rowPaths.indexOf("Revenue")];

    const moved = applyBatchAtomic(state, [
      { op: "move_rows", sheet: "Inputs", rowIds: [revenueRowId], targetGapIndex: inputs.bodyStart + 2 },
    ]);
    expect(moved.ok, moved.ok ? undefined : moved.error.message).toBe(true);
    if (!moved.ok) throw new Error("expected row move success");

    expect(moved.nextDocument.sheets[0].rowPaths).toEqual(["Cost", "Units", "Revenue"]);
    expectNumber(cellValueFromState(moved.nextDocument, "Summary", "Revenue", "Value"), 100);
    expect(serializeDocumentState(moved.nextDocument)).toContain("@[Inputs::[Revenue,Amount]]");
  });
});
