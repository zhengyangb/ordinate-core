import { describe, it, expect, vi } from "vitest";
import { workbookSourceRevision, inspectWorkbook, validateWorkbook, evaluateWorkbook, editWorkbook, listWorkbookOperations, workbookEditSchema, decodeEditRequest, DocumentState, type CapabilityResult, type WorkbookOperation, type CellTarget, type RegionTarget, } from "../src";
const SOURCE = `# Plan
Quarterly plan.

| Item || Q1 | Q2 | Q3 | Q4 |
| --- || --- | --- | --- | --- |
| Revenue || 100 | 120 |  |  |
| Costs || 40 | 50 |  |  |
| Profit || = B2 - B3 | = C2 - C3 |  |  |

Review the forecast.
`;
const cell = (row: number, column: number, sheet = "Plan"): CellTarget => ({ sheet, row: { kind: "index", index: row }, column: { kind: "index", index: column } });
const region = (r0: number, r1: number, c0: number, c1: number, sheet = "Plan"): RegionTarget => ({ sheet, rows: { start: r0, end: r1 }, columns: { start: c0, end: c1 } });
const named = (row: string, column = "Q1"): CellTarget => ({ sheet: "Plan", row: { kind: "path", path: [row] }, column: { kind: "label", label: column } });
const format = { kind: "numeric", sign: "default", padWidth: null, grouping: true, precision: 2, type: "f" } as const;
function data<T>(result: CapabilityResult<T>): T {
  expect(result.status, JSON.stringify(result)).toBe("completed");
  if (result.status !== "completed")
    throw new Error(result.failure.message);
  return result.data;
}
async function edit(operations: WorkbookOperation[], source = SOURCE) { return editWorkbook(source, { baseRevision: await workbookSourceRevision(source), operations }); }
async function inputs(source: string) { return data(await inspectWorkbook(source, { sheet: "Plan" })).selection!.cells.map(row => row.map(c => c.input)); }
async function values(source: string) { return data(await evaluateWorkbook(source, { query: { sheet: "Plan" } })).selection!.values; }
describe("RFC-0049 portable source capabilities", () => {
  it("hashes exact UTF-8 including BOM, caches and whitespace", async () => {
    expect(await workbookSourceRevision("abc")).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await workbookSourceRevision(SOURCE)).not.toBe(await workbookSourceRevision("\ufeff" + SOURCE));
    expect(await workbookSourceRevision(SOURCE)).not.toBe(await workbookSourceRevision(SOURCE + " "));
  });
  it("rejects invalid Unicode and oversized source before parsing", async () => {
    for (const source of ["\ud800", "\udc00", "x".repeat(16 * 1024 * 1024 + 1)]) {
      expect(await validateWorkbook(source)).toMatchObject({ status: "rejected", sourceRevision: null, failure: { stage: "request" } });
    }
  });
  it("returns overview without a matrix; exposes semantic coordinates and canonical notes", async () => {
    const overview = data(await inspectWorkbook(SOURCE));
    expect(overview.selection).toBeUndefined();
    expect(overview.sheets[0]).toMatchObject({ name: "Plan", rowCount: 4, columnCount: 5, headerRowCount: 1, headerColumnCount: 1 });
    const view = data(await inspectWorkbook(SOURCE, { sheet: "Plan", includeNotes: true })).selection!;
    expect(view.rowDescriptors[1]).toEqual({ rowIndex: 1, area: "body", depth: 0, path: ["Revenue"] });
    expect(view.columnDescriptors[1]).toEqual({ colIndex: 1, label: "Q1" });
    expect(view.notes).toEqual({ beforeTable: "Quarterly plan.", afterTable: "Review the forecast." });
    expect(JSON.stringify(view)).not.toMatch(/"(?:rowId|colId|sheetId|tokens|ast)":/);
  });
  it("preserves dotted hierarchy components instead of flattening paths", async () => {
    const source = `# Plan\n| Item || Value |\n| --- || --- |\n| A.B || |\n| * C.D || 1 |`;
    const view = data(await inspectWorkbook(source, { sheet: "Plan" })).selection!;
    expect(view.rowDescriptors[2].path).toEqual(["A.B", "C.D"]);
    const candidate = data(await edit([{ op: "set_cell_input", target: { sheet: "Plan", row: { kind: "path", path: ["A.B", "C.D"] }, column: { kind: "label", label: "Value" } }, input: "2" }], source)).candidate;
    expect((await inputs(candidate.source))[2][1]).toBe("2");
  });
  it.each([
    { sheet: "Missing" }, { sheet: "Plan", rows: { start: 1, end: 1 } }, { sheet: "Plan", columns: { start: 0, end: 6 } },
  ])("fails invalid selections without clipping: %j", async (query) => {
    expect(await inspectWorkbook(SOURCE, query)).toMatchObject({ status: "rejected", failure: { stage: "resolve" } });
  });
  it("bounds the default window and distinguishes explicit windows", async () => {
    const source = "# Plan\n| Item || Value |\n| --- || --- |\n" + Array.from({ length: 65 }, (_, i) => `| R${i} || ${i} |`).join("\n");
    const view = data(await inspectWorkbook(source, { sheet: "Plan" })).selection!;
    expect(view.rows).toEqual({ start: 0, end: 50 });
    expect(view.hasMoreRows).toBe(true);
    expect(data(await inspectWorkbook(source, { sheet: "Plan", rows: { start: 60, end: 66 } })).selection!.cells).toHaveLength(6);
  });
  it("returns completed invalid validation and rejects edits/inspection of invalid source", async () => {
    const invalid = SOURCE.replace("100", "= (");
    expect(data(await validateWorkbook(invalid)).valid).toBe(false);
    expect(await inspectWorkbook(invalid)).toMatchObject({ status: "rejected", failure: { stage: "validation" } });
    expect(await edit([{ op: "clear_cell", target: cell(1, 1) }], invalid)).toMatchObject({ status: "rejected", failure: { stage: "validation" } });
  });
  it("recomputes poisoned caches and materializes only when requested", async () => {
    const source = SOURCE.replace("= B2 - B3", "999 = B2 - B3");
    const result = data(await evaluateWorkbook(source, { query: { sheet: "Plan" } }));
    expect(result.selection!.values[3][1]).toEqual({ kind: "number", value: "60" });
    expect(result.candidate).toBeNull();
    const materialized = data(await evaluateWorkbook(source, { materialize: true })).candidate!;
    expect(materialized.source).not.toContain("999 = B2 - B3");
    expect(await workbookSourceRevision(materialized.source)).toBe(materialized.revision);
  });
  it("reports errors outside a selected window and refuses materialization", async () => {
    const source = SOURCE.replace("= C2 - C3", "= 1 / 0");
    const result = await evaluateWorkbook(source, { query: { sheet: "Plan", rows: { start: 1, end: 2 }, columns: { start: 1, end: 2 } }, materialize: true });
    expect(data(result).summary.errorCount).toBe(1);
    expect(data(result).candidate).toBeNull();
    expect(result.diagnostics[0].location).toEqual({ kind: "cell", sheet: "Plan", rowIndex: 3, colIndex: 2 });
  });
  it("projects temporal values, booleans, nulls and lossless numbers", async () => {
    const source = `# Plan\n| 2026-01-02 | 09:30 | 2026-01-02T09:30:00Z | PT2H | true | null | -0 | 0.00000001 |`;
    const row = (await values(source))[0];
    expect(row.map(v => v.kind)).toEqual(["date", "time", "datetime", "duration", "boolean", "null", "number", "number"]);
    expect(row[6]).toEqual({ kind: "number", value: "-0" });
    expect(row[7]).toEqual({ kind: "number", value: "0.00000001" });
  });
  it("strictly decodes unknown fields, sparse matrices, empty patches and bad formats", async () => {
    const revision = await workbookSourceRevision(SOURCE);
    const bad = [
      { baseRevision: revision, operations: [], extra: 1 },
      { baseRevision: revision, operations: [{ op: "mystery" }] },
      { baseRevision: revision, operations: [{ op: "set_cell_input", target: { ...cell(1, 1), id: 1 }, input: "1" }] },
      { baseRevision: revision, operations: [{ op: "set_cell_local_style", target: cell(1, 1), style: {} }] },
      { baseRevision: revision, operations: [{ op: "set_cell_local_format", target: cell(1, 1), format: { kind: "temporal", pattern: "garbage" } }] },
      { baseRevision: revision, operations: [{ op: "set_region", target: region(1, 2, 1, 2), values: [Array(1)] }] },
    ];
    for (const request of bad)
      expect(await editWorkbook(SOURCE, request as never)).toMatchObject({ status: "rejected", failure: { stage: "request" } });
    expect(await evaluateWorkbook(SOURCE, { query: undefined } as never)).toMatchObject({ status: "rejected", failure: { stage: "request" } });
  });
  it("rejects stale revisions and oversized batches", async () => {
    const request = { baseRevision: await workbookSourceRevision(SOURCE), operations: [{ op: "clear_cell", target: cell(1, 1) }] };
    expect(await editWorkbook(SOURCE + "\n", request as never)).toMatchObject({ status: "rejected", failure: { code: "stale_source" } });
    expect(await editWorkbook(SOURCE, { ...request, operations: Array(1001).fill(request.operations[0]) } as never)).toMatchObject({ status: "rejected", failure: { code: "limit_exceeded" } });
  });
  it("applies ordered staged selectors, rebases named references and stays unevaluated", async () => {
    const candidate = data(await edit([
      { op: "set_cell_input", target: cell(1, 0), input: "Sales" },
      { op: "set_cell_input", target: named("Sales"), input: "200" },
      { op: "set_cell_input", target: named("Profit"), input: '= @["Sales","Q1"] - @["Costs","Q1"]' },
    ])).candidate;
    expect((await values(candidate.source))[3][1]).toEqual({ kind: "number", value: "160" });
    expect(candidate.source).not.toContain("=>");
    expect(await edit([{ op: "set_cell_input", target: named("Revenue"), input: "1" }], candidate.source)).toMatchObject({ status: "rejected", failure: { operationIndex: 0 } });
  });
  it("rejects ambiguous labels; a failed later operation returns no partial candidate", async () => {
    const result = await edit([
      { op: "set_cell_input", target: cell(2, 0), input: "Revenue" },
      { op: "set_cell_input", target: named("Revenue"), input: "900" },
    ]);
    expect(result).toMatchObject({ status: "rejected", failure: { code: "ambiguous_target", operationIndex: 1 } });
    expect(result).not.toHaveProperty("data");
    expect((await inputs(SOURCE))[1][1]).toBe("100");
  });
  it("sets exact regions and preserves local formatting until cleared", async () => {
    const candidate = data(await edit([
      { op: "set_cell_local_format", target: cell(1, 1), format },
      { op: "set_region", target: region(1, 3, 1, 3), values: [["200", "300"], ["60", "70"]] },
    ])).candidate;
    let view = data(await inspectWorkbook(candidate.source, { sheet: "Plan" })).selection!;
    expect(view.cells[1][1].localDisplay!.format).toEqual(format);
    expect((await values(candidate.source))[3][2]).toEqual({ kind: "number", value: "230" });
    view = data(await inspectWorkbook(data(await edit([{ op: "clear_region", target: region(1, 2, 1, 2) }], candidate.source)).candidate.source, { sheet: "Plan" })).selection!;
    expect(view.cells[1][1]).toEqual({ input: "", localDisplay: null });
    expect(await edit([{ op: "set_region", target: region(1, 3, 1, 3), values: [["1"]] }])).toMatchObject({ status: "rejected", failure: { stage: "edit" } });
  });
  it.each(["auto", "copy", "series"] as const)("fills using native %s rules", async (mode) => {
    const candidate = data(await edit([{ op: "fill_region", source: region(1, 2, 1, 3), target: region(1, 2, 3, 5), mode }])).candidate;
    expect((await inputs(candidate.source))[1].slice(3)).toEqual(mode === "copy" ? ["100", "120"] : ["140", "160"]);
  });
  it("copy fill shifts positional references and preserves fixed/current axes", async () => {
    const source = SOURCE.replace("= C2 - C3", "= C2 - C3 + @[#2!,#2!] * 0");
    const candidate = data(await edit([{ op: "fill_region", source: region(3, 4, 2, 3), target: region(3, 4, 3, 5), mode: "copy" }], source)).candidate;
    expect((await inputs(candidate.source))[3][3]).toBe("= D2 - D3 + @[#2!,#2!] * 0");
  });
  it("fails non-adjacent/cross-sheet fill rather than inventing a fill algorithm", async () => {
    expect(await edit([{ op: "fill_region", source: region(1, 2, 1, 2), target: region(1, 2, 3, 4), mode: "auto" }])).toMatchObject({ status: "rejected", failure: { stage: "edit" } });
    const source = SOURCE + "\n# Other\n| 1 | 2 |";
    expect(await edit([{ op: "fill_region", source: region(0, 1, 0, 1, "Other"), target: region(1, 2, 1, 2), mode: "copy" }], source)).toMatchObject({ status: "rejected", failure: { stage: "edit" } });
  });
  it("duplicates columns with fresh identity, copied formulas and later header renaming", async () => {
    const candidate = data(await edit([
      { op: "duplicate_columns", sheet: "Plan", columns: [{ kind: "label", label: "Q2" }], targetGapIndex: 3 },
      { op: "set_cell_input", target: cell(0, 3), input: "Forecast" },
    ])).candidate;
    expect((await inputs(candidate.source))[3][3]).toBe("= D2 - D3");
    expect((await values(candidate.source))[3][3]).toEqual({ kind: "number", value: "70" });
  });
  it("duplicates complete row subtrees and rejects incomplete subtrees", async () => {
    const source = "# Plan\n| Item || Value |\n| --- || --- |\n| Group || |\n| * A || 1 |\n| * B || = B3 * 2 |\n| Total || = B3 + B4 |";
    expect(await edit([{ op: "duplicate_rows", sheet: "Plan", rows: [{ kind: "path", path: ["Group"] }], targetGapIndex: 4 }], source)).toMatchObject({ status: "rejected", failure: { stage: "edit" } });
    const candidate = data(await edit([{ op: "duplicate_rows", sheet: "Plan", rows: [1, 2, 3].map(index => ({ kind: "index", index })), targetGapIndex: 4 }], source)).candidate;
    const rows = await inputs(candidate.source);
    expect(rows).toHaveLength(8);
    expect(rows[6][1]).toBe("= B6 * 2");
    expect((await values(candidate.source))[7][1]).toEqual({ kind: "number", value: "3" });
  });
  it("moves axes and preserves existing formula targets", async () => {
    const candidate = data(await edit([
      { op: "move_rows", sheet: "Plan", rows: [{ kind: "path", path: ["Costs"] }], targetGapIndex: 3 },
      { op: "move_columns", sheet: "Plan", columns: [{ kind: "label", label: "Q1" }], targetGapIndex: 4 },
    ])).candidate;
    expect((await values(candidate.source))[2][4]).toEqual({ kind: "number", value: "60" });
  });
  it("inserts/deletes rows and columns, then resolves new staged coordinates", async () => {
    const candidate = data(await edit([
      { op: "insert_row", sheet: "Plan", area: "body", rowGapIndex: 2, depth: 0 },
      { op: "set_cell_input", target: cell(2, 0), input: "New" },
      { op: "set_cell_input", target: named("New"), input: "9" },
      { op: "insert_column", sheet: "Plan", colIndex: 2 },
      { op: "set_cell_input", target: cell(0, 2), input: "New Q" },
      { op: "delete_column", sheet: "Plan", column: { kind: "label", label: "New Q" } },
      { op: "delete_row", sheet: "Plan", row: { kind: "path", path: ["New"] }, mode: "node" },
    ])).candidate;
    expect((await values(candidate.source))[3][1]).toEqual({ kind: "number", value: "60" });
  });
  it("edits sheet structure and notes through the same atomic batch", async () => {
    const candidate = data(await edit([
      { op: "insert_sheet", name: "Extra", sheetIndex: 1 },
      { op: "rename_sheet", sheet: "Extra", newName: "Appendix" },
      { op: "move_sheet", sheet: "Appendix", targetGapIndex: 0 },
      { op: "delete_sheet", sheet: "Appendix" },
      { op: "set_sheet_note", sheet: "Plan", position: "beforeTable", markdown: "**Approved plan**\n\n1. Review revenue\n2. Review costs" },
    ])).candidate;
    expect(data(await inspectWorkbook(candidate.source)).sheets).toHaveLength(1);
    expect(data(await inspectWorkbook(candidate.source, { sheet: "Plan", includeNotes: true })).selection!.notes!.beforeTable).toContain("Approved plan");
    expect(await edit([{ op: "set_sheet_note", sheet: "Plan", position: "afterTable", markdown: "<script>alert(1)</script>" }])).toMatchObject({ status: "rejected", failure: { stage: "edit" } });
  });
  it("sets and clears local/axis display defaults without affecting values", async () => {
    const candidate = data(await edit([
      { op: "set_cell_local_style", target: cell(1, 1), style: { align: "right", weight: "bold" } },
      { op: "set_cell_local_style", target: cell(1, 1), style: { weight: null, color: "green" } },
      { op: "set_row_default_format", sheet: "Plan", row: { kind: "path", path: ["Profit"] }, format },
      { op: "set_row_default_style", sheet: "Plan", row: { kind: "path", path: ["Profit"] }, style: { weight: "bold" } },
      { op: "set_column_default_format", sheet: "Plan", column: { kind: "label", label: "Q2" }, format: { kind: "temporal", pattern: "%Y-%m-%d" } },
      { op: "set_column_default_style", sheet: "Plan", column: { kind: "label", label: "Q2" }, style: { align: "center" } },
    ])).candidate;
    const view = data(await inspectWorkbook(candidate.source, { sheet: "Plan" })).selection!;
    expect(view.cells[1][1].localDisplay!.style).toEqual({ align: "right", weight: null, color: "green" });
    expect(view.rowDefaults[3]!.format).toEqual(format);
    expect(view.columnDefaults[2]!.format).toEqual({ kind: "temporal", pattern: "%Y-%m-%d" });
    const cleared = data(await edit([
      { op: "clear_cell_local_style", target: cell(1, 1) },
      { op: "set_cell_local_format", target: cell(1, 1), format },
      { op: "clear_cell_local_format", target: cell(1, 1) },
      { op: "clear_row_default_format", sheet: "Plan", row: { kind: "index", index: 3 } },
      { op: "clear_row_default_style", sheet: "Plan", row: { kind: "index", index: 3 } },
      { op: "clear_column_default_format", sheet: "Plan", column: { kind: "index", index: 2 } },
      { op: "clear_column_default_style", sheet: "Plan", column: { kind: "index", index: 2 } },
      { op: "clear_cell", target: cell(2, 1) },
    ], candidate.source)).candidate;
    const after = data(await inspectWorkbook(cleared.source, { sheet: "Plan" })).selection!;
    expect(after.cells[1][1].localDisplay).toBeNull();
    expect(after.rowDefaults[3]).toBeNull();
    expect(after.columnDefaults[2]).toBeNull();
    expect(after.cells[2][1].input).toBe("");
  });
  it("rejects area violations and final invalid inputs with no candidate", async () => {
    expect(await edit([{ op: "set_row_default_style", sheet: "Plan", row: { kind: "index", index: 0 }, style: { weight: "bold" } }])).toMatchObject({ status: "rejected", failure: { code: "invalid_operation" } });
    expect(await edit([{ op: "set_cell_local_format", target: cell(1, 0), format }])).toMatchObject({ status: "rejected", failure: { stage: "edit" } });
    expect(await edit([{ op: "set_cell_input", target: cell(1, 1), input: "= (" }])).toMatchObject({ status: "rejected" });
  });
  it("enforces cumulative direct edit/copy budget, not only per-operation size", async () => {
    const operations = Array.from({ length: 834 }, () => ({ op: "set_region", target: region(1, 4, 1, 5), values: Array.from({ length: 3 }, () => Array(4).fill("1")) } as WorkbookOperation));
    expect(await edit(operations)).toMatchObject({ status: "rejected", failure: { code: "limit_exceeded", operationIndex: 833 } });
  });
  it("generates schema/help from the decoder and does not swallow programmer faults", async () => {
    const operations = listWorkbookOperations();
    expect(operations).toHaveLength(30);
    expect(JSON.stringify(workbookEditSchema())).toContain("fill_region");
    for (const { op, schema } of operations)
      expect(schema).toMatchObject({ additionalProperties: false, properties: { op: { enum: [op] } } });
    const spy = vi.spyOn(DocumentState.prototype, "evaluate").mockImplementation(() => { throw new Error("programmer fault"); });
    try {
      await expect(evaluateWorkbook(SOURCE)).rejects.toThrow("programmer fault");
    }
    finally {
      spy.mockRestore();
    }
    expect(() => decodeEditRequest({ baseRevision: "bad", operations: [] })).toThrow();
  });
  it("keeps multi-header/control-frame coordinates aligned with semantic cells", async () => {
    const source = "# Plan\n| @meta | || {:,.2f} | {:,.2f} |\n| | || 2026 | 2026 |\n| | Item || H1 | H2 |\n| | --- || --- | --- |\n| | Revenue || 10 | 20 |";
    const view = data(await inspectWorkbook(source, { sheet: "Plan" })).selection!;
    expect(view.cells).toHaveLength(3);
    expect(view.cells[2][1].input).toBe("10");
    expect(view.rowDescriptors.map(r => r.area)).toEqual(["header", "header", "body"]);
    const candidate = data(await edit([{ op: "set_cell_input", target: cell(2, 1), input: "15" }], source)).candidate;
    expect((await values(candidate.source))[2][1]).toEqual({ kind: "number", value: "15" });
  });
  it("preserves cross-sheet targets through label and column renames", async () => {
    const source = SOURCE + '\n# Summary\n| Item || Value |\n| --- || --- |\n| Result || = @["Plan"::["Revenue","Q1"]] |';
    const candidate = data(await edit([
      { op: "set_cell_input", target: cell(1, 0), input: "Sales" },
      { op: "set_cell_input", target: cell(0, 1), input: "Forecast" },
      { op: "set_cell_input", target: named("Sales", "Forecast"), input: "250" },
    ], source)).candidate;
    const view = data(await evaluateWorkbook(candidate.source, { query: { sheet: "Summary" } }));
    expect(view.selection!.values[1][1]).toEqual({ kind: "number", value: "250" });
    expect(candidate.source).toContain("Sales,Forecast");
  });
  it("permits structured edits on syntactically valid documents with runtime errors", async () => {
    const source = SOURCE.replace("= C2 - C3", "= 1 / 0");
    const candidate = data(await edit([{ op: "set_cell_input", target: cell(1, 1), input: "200" }], source)).candidate;
    expect(data(await evaluateWorkbook(candidate.source)).summary.errorCount).toBe(1);
    expect((await inputs(candidate.source))[1][1]).toBe("200");
  });
  it("counts literal errors and cycles and returns JSON-safe diagnostics", async () => {
    const source = "# Plan\n| error[div_by_zero] | = B1 |";
    const result = await evaluateWorkbook(source, { query: { sheet: "Plan" }, materialize: true });
    expect(data(result).summary.errorCount).toBe(2);
    expect(data(result).candidate).toBeNull();
    expect(data(result).selection!.values.map(r => r.map(v => v.kind))).toEqual([["error", "error"]]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("never exposes private runtime identities through diagnostic contexts", async () => {
    const spy = vi.spyOn(DocumentState.prototype, "evaluate").mockReturnValue({ sheets: [{ name: "Plan", values: [[{ kind: "error", errorKind: "unresolved_reference", internalKind: "unresolved_reference_sheet", context: { sheet: "Missing", id: 111, sheetId: 123, rowId: 456, colId: 789 } }]] }] } as never);
    try {
      const result = await evaluateWorkbook(SOURCE);
      expect(result.diagnostics[0].details).toEqual({ sheet: "Missing" });
      expect(JSON.stringify(result)).not.toMatch(/"(?:rowId|colId|sheetId)":/);
    }
    finally {
      spy.mockRestore();
    }
  });
  it("rejects aliases to the same duplicate source without exposing its ID", async () => {
    const result = await edit([{ op: "duplicate_rows", sheet: "Plan", rows: [{ kind: "index", index: 1 }, { kind: "path", path: ["Revenue"] }], targetGapIndex: 4 }]);
    expect(result).toMatchObject({ status: "rejected", failure: { code: "invalid_target" } });
    expect(JSON.stringify(result)).not.toContain("rowId");
  });
  it("rejects oversized selections and counts duplicate-cell work cumulatively", async () => {
    const large = "# Plan\n" + Array.from({ length: 500 }, () => `| ${Array(21).fill("1").join(" | ")} |`).join("\n");
    expect(await inspectWorkbook(large, { sheet: "Plan", rows: { start: 0, end: 500 }, columns: { start: 0, end: 21 } })).toMatchObject({ status: "rejected", failure: { code: "limit_exceeded" } });
    const source = "# Plan\n| Item || Q1 | Q2 |\n| --- || --- | --- |\n" + Array.from({ length: 4000 }, (_, i) => `| R${i} || 1 | 2 |`).join("\n");
    expect(await edit(Array.from({ length: 3 }, () => ({ op: "duplicate_columns", sheet: "Plan", columns: [{ kind: "index", index: 1 }], targetGapIndex: 3 })), source)).toMatchObject({ status: "rejected", failure: { code: "limit_exceeded", operationIndex: 2 } });
  });
  it("returns detached schema descriptions without changing strict decoding", async () => {
    const schema = workbookEditSchema();
    schema.properties = {};
    expect(workbookEditSchema()).toHaveProperty("properties.operations");
    expect(await edit([{ op: "set_cell_local_format", target: cell(1, 1), format: { kind: "temporal", pattern: " %F " } }])).toMatchObject({ status: "rejected", failure: { stage: "request" } });
  });
});
