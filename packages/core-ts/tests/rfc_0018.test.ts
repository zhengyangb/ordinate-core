import { describe, expect, it } from "vitest";

import {
  applyBatchAtomic,
  type FormatSpec,
  DocumentState,
  previewDeleteColumn,
  previewDeleteRow,
  resolveDocumentPresentation,
  serializeDocumentState,
} from "../src";

const GROUPED_1F: FormatSpec = {
  sign: "default",
  padWidth: null,
  grouping: true,
  precision: 1,
  type: "f",
};

describe("RFC-0018 header surface editing and row area operations", () => {
  it("sets header cell input and rebuilds column labels", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    | = B2 |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "index", sheet: "Sheet", rowIndex: 0, colIndex: 1 },
        input: "FY2024",
      },
    ]);

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const sheet = result.nextDocument.sheets[0];
    expect(sheet.colLabels[1]).toBe("FY2024");
    expect(sheet.colMap.get("FY2024")).toEqual([1]);
    const roundTripped = DocumentState.fromText(serializeDocumentState(result.nextDocument));
    expect(roundTripped.sheets[0].colLabels[1]).toBe("FY2024");
  });

  it("sets row label input and rebuilds row paths", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    | = B2 |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 0 },
        input: "Revenue",
      },
    ]);

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const sheet = result.nextDocument.sheets[0];
    expect(sheet.rowPaths).toEqual(["Revenue"]);
    expect(sheet.rowMap.get(JSON.stringify(["Revenue"]))).toEqual([1]);
    const roundTripped = DocumentState.fromText(serializeDocumentState(result.nextDocument));
    expect(roundTripped.sheets[0].rowPaths).toEqual(["Revenue"]);
  });

  it("refreshes bound formula input text after a label edit", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item  || 2024 | Out |
| ----- || ---- | --- |
| Group ||      |     |
| * A   || 1    |     |
| Total || 0    | = @[Group.A,2024] |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 0 },
        input: "* Alpha",
      },
    ]);

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const sheet = result.nextDocument.sheets[0];
    expect(sheet.cells[3][2].body.valid).toBe(true);
    if (!sheet.cells[3][2].body.valid || sheet.cells[3][2].body.kind !== "formula") {
      throw new Error("expected formula cell");
    }
    expect(sheet.cells[3][2].body.inputText).toBe("= @[Group.Alpha,2024]");
    expect(serializeDocumentState(result.nextDocument)).toContain("= @[Group.Alpha,2024]");
  });

  it("clears header and label cell input as semantic empty cells", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    | = B2 |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "clear_cell",
        target: { kind: "index", sheet: "Sheet", rowIndex: 0, colIndex: 1 },
      },
      {
        op: "clear_cell",
        target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 0 },
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const sheet = result.nextDocument.sheets[0];
    expect(sheet.colLabels[1]).toBe("C2");
    expect(sheet.rowPaths).toEqual([""]);
    const roundTripped = DocumentState.fromText(serializeDocumentState(result.nextDocument));
    expect(roundTripped.sheets[0].colLabels[1]).toBe("C2");
    expect(roundTripped.sheets[0].rowPaths).toEqual([""]);
  });

  it("rejects display metadata in header and label cell input", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    | = B2 |
`.trim());

    const headerResult = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "index", sheet: "Sheet", rowIndex: 0, colIndex: 1 },
        input: "FY2024 {::blue}",
      },
    ]);
    expect(headerResult.ok).toBe(false);
    if (headerResult.ok) throw new Error("expected failure");
    expect(headerResult.error.category).toBe("invalid_operation");

    const labelResult = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 0 },
        input: "Revenue {::blue}",
      },
    ]);
    expect(labelResult.ok).toBe(false);
    if (labelResult.ok) throw new Error("expected failure");
    expect(labelResult.error.category).toBe("invalid_operation");
  });

  it("keeps cell-local display metadata edits restricted to data cells", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    | = B2 |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_local_style",
        target: { kind: "index", sheet: "Sheet", rowIndex: 0, colIndex: 1 },
        style: { color: "blue" },
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.category).toBe("invalid_operation");
  });

  it("sets and serializes column display defaults by colId", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Price | Qty |
| ---- || ----- | --- |
| A    || 12.34 | 2   |
`.trim());
    const priceColId = state.sheets[0].colIds[1];

    const result = applyBatchAtomic(state, [
      {
        op: "set_column_default_format",
        sheet: "Sheet",
        colId: priceColId,
        format: GROUPED_1F,
      },
      {
        op: "set_column_default_style",
        sheet: "Sheet",
        colId: priceColId,
        style: { align: "right", color: "blue" },
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const presentation = resolveDocumentPresentation(result.nextDocument);
    const priceDefault = presentation.sheets[0].columnDefaults[1];
    expect(priceDefault.formatLayer.effective).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(priceDefault.styleLayer.effective).toMatchObject({ align: "right", color: "blue" });
    expect(presentation.sheets[0].cells[0][1].displayText).toBe("12.3");

    const output = serializeDocumentState(result.nextDocument);
    expect(output).toContain("@display");
    const roundTripped = DocumentState.fromText(output);
    expect(roundTripped.sheets[0].columnDisplayMetadata[1]?.valid).toBe(true);
  });

  it("patches and clears column default style independently from format", () => {
    const state = DocumentState.fromText(`
# Sheet
| @display |      || {:,.1f} {::>,blue,bold} |
|          | Item || Price                |
| -------- | ---- || -----                |
|          | A    || 12.34                |
`.trim());
    const priceColId = state.sheets[0].colIds[1];

    const patched = applyBatchAtomic(state, [
      {
        op: "set_column_default_style",
        sheet: "Sheet",
        colId: priceColId,
        style: { color: "green" },
      },
    ]);

    expect(patched.ok).toBe(true);
    if (!patched.ok) throw new Error("expected success");
    const patchedMeta = patched.nextDocument.sheets[0].columnDisplayMetadata[1];
    expect(patchedMeta?.valid).toBe(true);
    if (!patchedMeta?.valid) throw new Error("expected valid metadata");
    expect(patchedMeta.format).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(patchedMeta.style).toMatchObject({ align: "right", weight: "bold", color: "green" });

    const clearedStyle = applyBatchAtomic(patched.nextDocument, [
      { op: "clear_column_default_style", sheet: "Sheet", colId: priceColId },
    ]);
    expect(clearedStyle.ok).toBe(true);
    if (!clearedStyle.ok) throw new Error("expected success");
    const styleClearedMeta = clearedStyle.nextDocument.sheets[0].columnDisplayMetadata[1];
    expect(styleClearedMeta?.valid).toBe(true);
    if (!styleClearedMeta?.valid) throw new Error("expected valid metadata");
    expect(styleClearedMeta.format).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(styleClearedMeta.style).toBeNull();

    const clearedFormat = applyBatchAtomic(clearedStyle.nextDocument, [
      { op: "clear_column_default_format", sheet: "Sheet", colId: priceColId },
    ]);
    expect(clearedFormat.ok).toBe(true);
    if (!clearedFormat.ok) throw new Error("expected success");
    expect(clearedFormat.nextDocument.sheets[0].columnDisplayMetadata[1]).toBeNull();
  });

  it("rejects invalid column default targets and payloads", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Price |
| ---- || ----- |
| A    || 12.34 |
`.trim());

    const unknown = applyBatchAtomic(state, [
      {
        op: "set_column_default_style",
        sheet: "Sheet",
        colId: 999,
        style: { color: "blue" },
      },
    ]);
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("expected failure");
    expect(unknown.error.category).toBe("invalid_target");

    const invalidPayload = applyBatchAtomic(state, [
      {
        op: "set_column_default_style",
        sheet: "Sheet",
        colId: state.sheets[0].colIds[1],
        style: { color: "orange" } as any,
      },
    ]);
    expect(invalidPayload.ok).toBe(false);
    if (invalidPayload.ok) throw new Error("expected failure");
    expect(invalidPayload.error.category).toBe("invalid_operation");
  });

  it("sets a rectangular region by rowId and colId", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | 2025 |
| ---- || ---- | ---- |
| A    || 1    | 2    |
| B    || 3    | 4    |
`.trim());
    const sheet = state.sheets[0];

    const result = applyBatchAtomic(state, [
      {
        op: "set_region",
        target: {
          sheet: "Sheet",
          start: { rowId: sheet.rowIds[1], colId: sheet.colIds[1] },
          end: { rowId: sheet.rowIds[2], colId: sheet.colIds[2] },
        },
        values: [
          ["10", "20"],
          ["30", "40"],
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const nextSheet = result.nextDocument.sheets[0];
    expect(nextSheet.cells[1][1].body.valid && nextSheet.cells[1][1].body.inputText).toBe("10");
    expect(nextSheet.cells[1][2].body.valid && nextSheet.cells[1][2].body.inputText).toBe("20");
    expect(nextSheet.cells[2][1].body.valid && nextSheet.cells[2][1].body.inputText).toBe("30");
    expect(nextSheet.cells[2][2].body.valid && nextSheet.cells[2][2].body.inputText).toBe("40");
  });

  it("sets a region with reversed endpoints after normalizing the rectangle", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | 2025 |
| ---- || ---- | ---- |
| A    || 1    | 2    |
| B    || 3    | 4    |
`.trim());
    const sheet = state.sheets[0];

    const result = applyBatchAtomic(state, [
      {
        op: "set_region",
        target: {
          sheet: "Sheet",
          start: { rowId: sheet.rowIds[2], colId: sheet.colIds[2] },
          end: { rowId: sheet.rowIds[1], colId: sheet.colIds[1] },
        },
        values: [
          ["10", "20"],
          ["30", "40"],
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const nextSheet = result.nextDocument.sheets[0];
    expect(nextSheet.cells[1][1].body.valid && nextSheet.cells[1][1].body.inputText).toBe("10");
    expect(nextSheet.cells[2][2].body.valid && nextSheet.cells[2][2].body.inputText).toBe("40");
  });

  it("rejects region sets with mismatched dimensions or display metadata input", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | 2025 |
| ---- || ---- | ---- |
| A    || 1    | 2    |
| B    || 3    | 4    |
`.trim());
    const sheet = state.sheets[0];
    const target = {
      sheet: "Sheet",
      start: { rowId: sheet.rowIds[1], colId: sheet.colIds[1] },
      end: { rowId: sheet.rowIds[2], colId: sheet.colIds[2] },
    };

    const badShape = applyBatchAtomic(state, [
      {
        op: "set_region",
        target,
        values: [["10", "20"]],
      },
    ]);
    expect(badShape.ok).toBe(false);
    if (badShape.ok) throw new Error("expected failure");
    expect(badShape.error.category).toBe("invalid_operation");

    const displayInput = applyBatchAtomic(state, [
      {
        op: "set_region",
        target,
        values: [
          ["10 {::blue}", "20"],
          ["30", "40"],
        ],
      },
    ]);
    expect(displayInput.ok).toBe(false);
    if (displayInput.ok) throw new Error("expected failure");
    expect(displayInput.error.category).toBe("invalid_operation");
  });

  it("clears regions across header, label, and data cells", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    | = B2 |
`.trim());
    const sheet = state.sheets[0];

    const result = applyBatchAtomic(state, [
      {
        op: "clear_region",
        target: {
          sheet: "Sheet",
          start: { rowId: sheet.rowIds[0], colId: sheet.colIds[0] },
          end: { rowId: sheet.rowIds[1], colId: sheet.colIds[1] },
        },
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const nextSheet = result.nextDocument.sheets[0];
    expect(nextSheet.colLabels[1]).toBe("C2");
    expect(nextSheet.rowPaths).toEqual([""]);
    expect(nextSheet.cells[1][1].body.valid && nextSheet.cells[1][1].body.inputText).toBe("");
  });

  it("converts the first body rows to header rows", () => {
    const state = DocumentState.fromText(`
# Sheet
| A || 1 |
| B || 2 |
| C || 3 |
`.trim());
    const sheet = state.sheets[0];

    const result = applyBatchAtomic(state, [
      { op: "convert_rows_to_header", sheet: "Sheet", rowIds: [sheet.rowIds[0], sheet.rowIds[1]] },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const nextSheet = result.nextDocument.sheets[0];
    expect(nextSheet.headerRowCount).toBe(2);
    expect(nextSheet.bodyStart).toBe(2);
    expect(nextSheet.rowPaths).toEqual(["C"]);
    const roundTripped = DocumentState.fromText(serializeDocumentState(result.nextDocument));
    expect(roundTripped.sheets[0].headerRowCount).toBe(2);
    expect(roundTripped.sheets[0].rowPaths).toEqual(["C"]);
  });

  it("converts the last header row to a body row", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 |
| Dept || FY24 |
| ---- || ---- |
| A    || 1    |
`.trim());
    const sheet = state.sheets[0];

    const result = applyBatchAtomic(state, [
      { op: "convert_rows_to_body", sheet: "Sheet", rowIds: [sheet.rowIds[1]], depth: 0 },
    ]);

    expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const nextSheet = result.nextDocument.sheets[0];
    expect(nextSheet.headerRowCount).toBe(1);
    expect(nextSheet.bodyStart).toBe(1);
    expect(nextSheet.rowPaths).toEqual(["Dept", "A"]);
    const roundTripped = DocumentState.fromText(serializeDocumentState(result.nextDocument));
    expect(roundTripped.sheets[0].headerRowCount).toBe(1);
    expect(roundTripped.sheets[0].rowPaths).toEqual(["Dept", "A"]);
  });

  it("can round-trip a promoted parent row back to body above its children", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    ||      |
| * B  || 1    |
`.trim());
    const sheet = state.sheets[0];

    const promoted = applyBatchAtomic(state, [
      { op: "convert_rows_to_header", sheet: "Sheet", rowIds: [sheet.rowIds[1]] },
    ]);
    expect(promoted.ok, promoted.ok ? undefined : promoted.error.message).toBe(true);
    if (!promoted.ok) throw new Error("expected success");

    const promotedSheet = promoted.nextDocument.sheets[0];
    const demoted = applyBatchAtomic(promoted.nextDocument, [
      { op: "convert_rows_to_body", sheet: "Sheet", rowIds: [promotedSheet.rowIds[1]], depth: 0 },
    ]);
    expect(demoted.ok, demoted.ok ? undefined : demoted.error.message).toBe(true);
    if (!demoted.ok) throw new Error("expected success");
    expect(demoted.nextDocument.sheets[0].rowPaths).toEqual(["A", "A.B"]);
  });

  it("rejects row conversion for non-contiguous or non-boundary rows", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 1    |
| B    || 2    |
| C    || 3    |
`.trim());
    const sheet = state.sheets[0];

    const nonContiguous = applyBatchAtomic(state, [
      { op: "convert_rows_to_header", sheet: "Sheet", rowIds: [sheet.rowIds[1], sheet.rowIds[3]] },
    ]);
    expect(nonContiguous.ok).toBe(false);
    if (nonContiguous.ok) throw new Error("expected failure");
    expect(nonContiguous.error.category).toBe("invalid_operation");

    const notPrefix = applyBatchAtomic(state, [
      { op: "convert_rows_to_header", sheet: "Sheet", rowIds: [sheet.rowIds[2]] },
    ]);
    expect(notPrefix.ok).toBe(false);
    if (notPrefix.ok) throw new Error("expected failure");
    expect(notPrefix.error.category).toBe("invalid_operation");

    const twoHeaderRows = DocumentState.fromText(`
# Sheet
| Item || 2024 |
| Dept || FY24 |
| ---- || ---- |
| A    || 1    |
`.trim());
    const twoHeaderSheet = twoHeaderRows.sheets[0];
    const notSuffix = applyBatchAtomic(twoHeaderRows, [
      { op: "convert_rows_to_body", sheet: "Sheet", rowIds: [twoHeaderSheet.rowIds[0]], depth: 0 },
    ]);
    expect(notSuffix.ok).toBe(false);
    if (notSuffix.ok) throw new Error("expected failure");
    expect(notSuffix.error.category).toBe("invalid_operation");
  });

  it("previews row delete impact without mutating document state", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    |     |
| B    || 2    | = @[A,2024] |
`.trim());
    const sheet = state.sheets[0];

    const preview = previewDeleteRow(state, {
      op: "delete_row",
      sheet: "Sheet",
      rowId: sheet.rowIds[1],
    });

    expect(preview.deletedRowCount).toBe(1);
    expect(preview.affectedFormulaCellCount).toBe(1);
    expect(preview.affectedFormulaCells[0]).toMatchObject({
      sheet: "Sheet",
      rowId: sheet.rowIds[2],
      colId: sheet.colIds[2],
      rowIndex: 2,
      colIndex: 2,
    });
    expect(state.sheets[0].rowCount).toBe(3);
  });

  it("previews column delete impact without mutating document state", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 | Out |
| ---- || ---- | --- |
| A    || 1    | = @[A,2024] |
`.trim());

    const preview = previewDeleteColumn(state, {
      sheet: "Sheet",
      colIndex: 1,
    });

    expect(preview.deletedColumnCount).toBe(1);
    expect(preview.affectedFormulaCellCount).toBe(1);
    expect(preview.affectedFormulaCells[0]).toMatchObject({
      sheet: "Sheet",
      rowId: state.sheets[0].rowIds[1],
      colId: state.sheets[0].colIds[2],
      rowIndex: 1,
      colIndex: 2,
    });
    expect(state.sheets[0].colCount).toBe(3);
  });

  it("inserts a header row into a sheet that previously had no header rows", () => {
    const state = DocumentState.fromText(`
# Sheet
| A | 1 |
| B | 2 |
`.trim());

    const inserted = applyBatchAtomic(state, [
      { op: "insert_row", sheet: "Sheet", area: "header", rowGapIndex: 0, depth: 0 },
    ]);

    expect(inserted.ok).toBe(true);
    if (!inserted.ok) throw new Error("expected success");

    const sheet = inserted.nextDocument.sheets[0];
    expect(sheet.headerRowCount).toBe(1);
    expect(sheet.bodyStart).toBe(1);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.logicalRows[0]?.rawCells[0]).toBe("");

    const roundTripped = DocumentState.fromText(serializeDocumentState(inserted.nextDocument));
    expect(roundTripped.sheets[0].headerRowCount).toBe(1);
    expect(roundTripped.sheets[0].bodyStart).toBe(1);
  });

  it("inserts a header row at the header/body boundary gap", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 1    |
`.trim());

    const inserted = applyBatchAtomic(state, [
      { op: "insert_row", sheet: "Sheet", area: "header", rowGapIndex: 1, depth: 0 },
    ]);

    expect(inserted.ok).toBe(true);
    if (!inserted.ok) throw new Error("expected success");

    const sheet = inserted.nextDocument.sheets[0];
    expect(sheet.headerRowCount).toBe(2);
    expect(sheet.bodyStart).toBe(2);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.logicalRows[1]?.rawCells[0]).toBe("");
  });

  it("deletes header rows by rowId and removes the divider when the last header row is deleted", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 1    |
| B    || 2    |
`.trim());
    const headerRowId = state.sheets[0].rowIds[0];

    const deleted = applyBatchAtomic(state, [
      { op: "delete_row", sheet: "Sheet", rowId: headerRowId },
    ]);

    expect(deleted.ok).toBe(true);
    if (!deleted.ok) throw new Error("expected success");

    const sheet = deleted.nextDocument.sheets[0];
    expect(sheet.headerRowCount).toBe(0);
    expect(sheet.bodyStart).toBe(0);
    expect(sheet.rowCount).toBe(2);

    const roundTripped = DocumentState.fromText(serializeDocumentState(deleted.nextDocument));
    expect(roundTripped.sheets[0].headerRowCount).toBe(0);
    expect(roundTripped.sheets[0].bodyStart).toBe(0);
  });

  it("rejects subtree deletion mode for header rows", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || 2024 |
| ---- || ---- |
| A    || 1    |
`.trim());
    const headerRowId = state.sheets[0].rowIds[0];

    const result = applyBatchAtomic(state, [
      { op: "delete_row", sheet: "Sheet", rowId: headerRowId, mode: "subtree" },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.category).toBe("invalid_operation");
    expect(result.error.message).toContain("header row deletion does not support subtree mode");
  });
});
