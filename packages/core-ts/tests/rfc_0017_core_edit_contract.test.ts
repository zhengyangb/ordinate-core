import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyBatchAtomic,
  type CoreCellTarget,
  type CoreEdit,
  type CoreEditErrorCategory,
  type FormatSpec,
  DocumentState,
  evaluateDocument,
  formatDocument,
  parseDocumentModel,
  resolveDocumentPresentation,
  resolvePresentationFromText,
  resolveCellInputText,
  resolveSheetRowStructure,
  serializeDocumentState,
  splitCellDisplayMetadata,
} from "../src";

const FORMAT_GROUPED_2F: FormatSpec = {
  sign: "default",
  padWidth: null,
  grouping: true,
  precision: 2,
  type: "f",
};

const API_DOC = `
# Sheet
| @display |      || {:,.1f:>,blue,bold} | {::>,bold} |         |
|          | Item || Price                | Qty        | Out     |
| -------- | ---- || -----                | ---        | ---     |
|          | A    || 12.345 {::green}     | 2          | = B2 * C2 {:,.2f} |
|          | Bad  || = sum(B2             | 1          | = B3    |
`.trim();

const EDIT_DOC = `
# Sheet
| Item || 2024 | 2025 | Out |
| ---- || ---- | ---- | --- |
| A    || 1    | 2    | = B2 + C2 |
| B    || 3    | 4    | = B3 + C3 |
`.trim();

const AMBIGUOUS_DOC = `
# Sheet
| Item || 2024 | 2025 |
| ---- || ---- | ---- |
| A    || 1    | 2    |
| A    || 3    | 4    |
`.trim();

const CELL_INPUT_TARGET: CoreCellTarget = { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "2024" };

function cellInputSource(cell: any): string {
  const body = cell.body;
  if (!body.valid) return body.unparsedBodyRaw;
  return body.inputText;
}

type CoreEditCase = {
  name: string;
  doc: string;
  ops: CoreEdit[];
  expect: string;
  expectOk: boolean;
  expectErrorCategory?: CoreEditErrorCategory;
};

function loadCoreEditCases(path: string): CoreEditCase[] {
  const content = readFileSync(path, "utf-8");
  const chunks = content
    .split("===")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const cases: CoreEditCase[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    const name = lines[0].trim();
    const body = lines.slice(1).join("\n");

    const doc = extractBlock(body, name, "doc");
    const opsRaw = extractBlock(body, name, "ops");
    const expectDoc = extractBlock(body, name, "expect");
    const tail = body.slice(body.indexOf("[/expect]") + "[/expect]".length).trim();
    const fields = parseTailFields(tail);

    const expectOk = fields.expect_ok === "true";
    const expectErrorCategory = fields.expect_error_category as CoreEditErrorCategory | undefined;
    const parsedOps = JSON.parse(opsRaw) as unknown;
    if (!Array.isArray(parsedOps)) {
      throw new Error(`case '${name}' ops must be a JSON array`);
    }

    cases.push({
      name,
      doc,
      ops: parsedOps as CoreEdit[],
      expect: expectDoc,
      expectOk,
      expectErrorCategory,
    });
  }

  return cases;
}

function extractBlock(body: string, caseName: string, block: "doc" | "ops" | "expect"): string {
  const startTag = `[${block}]\n`;
  const endTag = `\n[/${block}]`;
  const start = body.indexOf(startTag);
  const end = body.indexOf(endTag);
  if (start === -1 || end === -1) {
    throw new Error(`case '${caseName}' missing [${block}] block`);
  }
  return body.slice(start + startTag.length, end).trim();
}

function parseTailFields(tail: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of tail.split(/\r?\n/)) {
    const item = line.trim();
    if (item.length === 0 || item.startsWith("#")) continue;
    const idx = item.indexOf(":");
    if (idx === -1) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    fields[key] = value;
  }
  return fields;
}

describe("RFC-0017 core edit contract: cell read surfaces", () => {
  it("exposes evaluated values independently from presentation layers", () => {
    const evaluation = evaluateDocument(API_DOC);
    const evalSheet = evaluation.sheets[0];
    const outValue = evalSheet.values[0][3];
    expect(outValue.kind).toBe("number");
    expect(Number(outValue.value)).toBeCloseTo(24.69, 10);

    const presentation = resolvePresentationFromText(API_DOC);
    const pSheet = presentation.sheets[0];

    // Column defaults from control frame.
    expect(pSheet.columnDefaults[1].formatLayer.effective).toMatchObject({
      grouping: true,
      precision: 1,
      type: "f",
    });
    expect(pSheet.columnDefaults[1].styleLayer.effective).toMatchObject({
      align: "right",
      weight: "bold",
      color: "blue",
    });

    // A.Price: inherited format + axis-cascaded style.
    const aPrice = pSheet.cells[0][1];
    expect(aPrice.source).toBe("cell");
    expect(aPrice.formatLayer.local).toBeNull();
    expect(aPrice.formatLayer.inherited).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(aPrice.formatLayer.effective).toMatchObject({ grouping: true, precision: 1, type: "f" });
    expect(aPrice.styleLayer.local).toMatchObject({ align: null, weight: null, color: "green" });
    expect(aPrice.styleLayer.inherited).toMatchObject({ align: "right", weight: "bold", color: "blue" });
    expect(aPrice.styleLayer.effective).toMatchObject({ align: "right", weight: "bold", color: "green" });
    expect(aPrice.displayText).toBe("12.3");

    // A.Out: local format metadata affects display only.
    const aOut = pSheet.cells[0][3];
    const aOutValue = evalSheet.values[0][3];
    expect(aOutValue?.kind).toBe("number");
    expect(Number(aOutValue?.value)).toBeCloseTo(24.69, 10);
    expect(aOut.formatLayer.local).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(aOut.formatLayer.inherited).toBeNull();
    expect(aOut.formatLayer.effective).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(aOut.displayText).toBe("24.69");
  });

  it("preserves raw input for invalid formula and round-trips without losing text", () => {
    const state = DocumentState.fromText(API_DOC);
    const sheet = state.sheets[0];
    const badRowRel = sheet.rowPaths.indexOf("Bad");
    expect(badRowRel).toBeGreaterThanOrEqual(0);
    const badRowAbs = sheet.bodyStart + badRowRel;
    const badPrice = sheet.cells[badRowAbs][1];

    expect(badPrice.body.valid).toBe(false);
    if (badPrice.body.valid) throw new Error("expected invalid body");
    expect(badPrice.body.unparsedBodyRaw).toBe("= sum(B2");
    expect(badPrice.localDisplay).toBeNull();

    state.evaluate();
    const output = serializeDocumentState(state);
    expect(output).toContain("| -------- | ---- ||");
    expect(output).toContain("= sum(B2");
    expect(output).toContain("error[parse_error] = B3");
  });

  it("keeps display metadata parsing separate from content text", () => {
    expect(splitCellDisplayMetadata('= B2 * C2 {:,.2f:>,blue}')).toEqual({
      contentText: "= B2 * C2",
      displayMetaRaw: "{:,.2f:>,blue}",
    });
    expect(splitCellDisplayMetadata('12.345 {::green}')).toEqual({
      contentText: "12.345",
      displayMetaRaw: "{::green}",
    });
  });

  it("derives read/edit input from cached formula body without exposing cache", () => {
    expect(resolveCellInputText("6 = B2 + 1 {:,.2f:>,blue}")).toEqual({
      cellText: "6 = B2 + 1 {:,.2f:>,blue}",
      bodyText: "6 = B2 + 1",
      inputText: "= B2 + 1",
      displayMetaRaw: "{:,.2f:>,blue}",
    });

    expect(resolveCellInputText("= B2 + 1 {:,.2f:>,blue}")).toEqual({
      cellText: "= B2 + 1 {:,.2f:>,blue}",
      bodyText: "= B2 + 1",
      inputText: "= B2 + 1",
      displayMetaRaw: "{:,.2f:>,blue}",
    });

    expect(resolveCellInputText('"abc" {::green}')).toEqual({
      cellText: '"abc" {::green}',
      bodyText: '"abc"',
      inputText: '"abc"',
      displayMetaRaw: "{::green}",
    });
  });

  it("strips display control frame from IR semantic rows", () => {
    const ir = parseDocumentModel(API_DOC);
    const table = ir.sheets[0].table;
    expect(table).not.toBeNull();
    if (!table) return;
    const labels = table.rows.map((r) => r.label);
    expect(labels.includes("@display")).toBe(false);
    expect(labels[0]).toBe("A");
    expect(labels[1]).toBe("Bad");
  });
});

describe("RFC-0017 core edit contract: atomic write surfaces", () => {
  it("fails atomically and preserves the original authoritative state", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    const before = state.evaluate().sheets[0].values[0][3];
    expect(before.kind).toBe("number");
    expect(Number(before.value)).toBeCloseTo(3, 10);

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "2024" },
        input: "10",
      },
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["Missing"], colLabel: "2024" },
        input: "999",
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected atomic failure");
    expect(result.error.category).toBe("invalid_target");
    expect(result.error.editIndex).toBe(1);
    expect(result.error.op).toBe("set_cell_input");

    const after = state.evaluate().sheets[0].values[0][3];
    expect(after.kind).toBe("number");
    expect(Number(after.value)).toBeCloseTo(3, 10);
  });

  it("tracks cachedValue + dirty separately after dependency edits", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    state.evaluate();

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "2024" },
        input: "10",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const next = result.nextDocument;
    const sheet = next.sheets[0];
    const rowA = (sheet.rowMap.get(JSON.stringify(["A"])) ?? [])[0];
    const col2024 = (sheet.colMap.get("2024") ?? [])[0];
    const colOut = (sheet.colMap.get("Out") ?? [])[0];
    if (rowA === undefined || col2024 === undefined || colOut === undefined) {
      throw new Error("expected resolved target indices");
    }

    const edited = sheet.cells[rowA][col2024];
    expect(edited.dirty).toBe(true);
    expect(edited.cachedValue).toBeNull();

    const dependent = sheet.cells[rowA][colOut];
    expect(dependent.dirty).toBe(true);
    expect(dependent.cachedValue?.kind).toBe("number");
    expect(Number(dependent.cachedValue?.value)).toBeCloseTo(3, 10);
  });

  it("keeps table shape when set_cell_input clears a cell with empty input", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "2024" },
        input: "",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const edited = result.nextDocument.sheets[0].cells[result.nextDocument.sheets[0].bodyStart][1];
    expect(cellInputSource(edited)).toBe("");

    const output = serializeDocumentState(result.nextDocument);
    expect(output).toContain("| A    ||      | 2    | = B2 + C2 |");
    const roundTripped = DocumentState.fromText(output);
    expect(roundTripped.sheets[0].colCount).toBe(4);
    expect(cellInputSource(roundTripped.sheets[0].cells[roundTripped.sheets[0].bodyStart][1])).toBe("");
  });

  const allowedCellInputs = [
    { name: "number literal", input: "123", expectedInputText: "123" },
    { name: "implicit string literal", input: "abc", expectedInputText: "abc" },
    { name: "unclosed brace in implicit string literal", input: "abc {", expectedInputText: "abc {" },
    { name: "unclosed display-like brace in implicit string literal", input: "abc {::green", expectedInputText: "abc {::green" },
    { name: "non-display brace block in implicit string literal", input: "abc {foo}", expectedInputText: "abc {foo}" },
    { name: "quoted display-like text literal", input: '"abc {::green}"', expectedInputText: '"abc {::green}"' },
    { name: "formula string literal with display-like text", input: '= "123 {::green}" + 1', expectedInputText: '= "123 {::green}" + 1' },
    { name: "formula parse error remains preservable input", input: "= sum(B2", expectedInputText: "= sum(B2" },
  ];

  it.each(allowedCellInputs)("allows set_cell_input for $name", ({ input, expectedInputText }) => {
    const result = applyBatchAtomic(DocumentState.fromText(EDIT_DOC), [
      {
        op: "set_cell_input",
        target: CELL_INPUT_TARGET,
        input,
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const sheet = result.nextDocument.sheets[0];
    const rowA = (sheet.rowMap.get(JSON.stringify(["A"])) ?? [])[0];
    const col2024 = (sheet.colMap.get("2024") ?? [])[0];
    if (rowA === undefined || col2024 === undefined) {
      throw new Error("expected resolved target indices");
    }
    expect(cellInputSource(sheet.cells[rowA][col2024])).toBe(expectedInputText);
  });

  const rejectedCellInputs = [
    { name: "valid style display segment", input: "abc {::green}" },
    { name: "invalid display segment", input: "abc {:bad}" },
    { name: "formula with display segment", input: "= B2 + 1 {::green}" },
    { name: "cached formula body", input: "6 = B2 + 1" },
    { name: "real line feed", input: "abc\nxyz" },
    { name: "real carriage return", input: "abc\rxyz" },
  ];

  it.each(rejectedCellInputs)("rejects set_cell_input for $name", ({ input }) => {
    const result = applyBatchAtomic(DocumentState.fromText(EDIT_DOC), [
      {
        op: "set_cell_input",
        target: CELL_INPUT_TARGET,
        input,
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.category).toBe("invalid_operation");
    expect(result.error.op).toBe("set_cell_input");
  });

  it("supports local format/style edits without conflating presentation and value", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    const updated = applyBatchAtomic(state, [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        format: FORMAT_GROUPED_2F,
      },
      {
        op: "set_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        style: { color: "green" },
      },
    ]);
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("expected success");

    const presentation = resolveDocumentPresentation(updated.nextDocument);
    const aOut = presentation.sheets[0].cells[0][3];
    expect(aOut.formatLayer.local).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(aOut.styleLayer.local).toMatchObject({ color: "green" });
    expect("value" in aOut).toBe(false);

    const cleared = applyBatchAtomic(updated.nextDocument, [
      {
        op: "clear_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
      },
    ]);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) throw new Error("expected success");
    const aOutCleared = resolveDocumentPresentation(cleared.nextDocument).sheets[0].cells[0][3];
    expect(aOutCleared.styleLayer.local).toBeNull();
  });

  it("rejects invalid local format combinations through structured edit", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    const updated = applyBatchAtomic(state, [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        format: {
          sign: "default",
          padWidth: null,
          grouping: false,
          precision: 2,
          type: "d",
        },
      },
    ]);

    expect(updated.ok).toBe(false);
    if (updated.ok) throw new Error("expected failure");
    expect(updated.error.category).toBe("invalid_operation");
    expect(updated.error.op).toBe("set_cell_local_format");
    expect(updated.error.message).toContain("precision is not allowed for integer format");
  });

  it("rejects scientific grouping through structured edit", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    const updated = applyBatchAtomic(state, [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        format: {
          sign: "default",
          padWidth: null,
          grouping: true,
          precision: 2,
          type: "e",
        },
      },
    ]);

    expect(updated.ok).toBe(false);
    if (updated.ok) throw new Error("expected failure");
    expect(updated.error.category).toBe("invalid_operation");
    expect(updated.error.op).toBe("set_cell_local_format");
    expect(updated.error.message).toContain("grouping is not allowed for scientific format");
  });

  it("replaces invalid display metadata when setting structured local metadata", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:bad fmt:purple} |
`.trim());

    const replaced = applyBatchAtomic(state, [
      {
        op: "set_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        style: { color: "green" },
      },
    ]);

    expect(replaced.ok).toBe(true);
    if (!replaced.ok) throw new Error("expected success");
    const presentation = resolveDocumentPresentation(replaced.nextDocument);
    expect(presentation.sheets[0].cells[0][1].styleLayer.local).toMatchObject({ color: "green" });
    const output = serializeDocumentState(replaced.nextDocument);
    expect(output).toContain("1 {::green}");
    expect(output).not.toContain("bad fmt");
    expect(output).not.toContain("purple");
  });

  it("edits valid display metadata without rewriting an invalid body", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || = B2 + {::green} |
`.trim());

    const sheet = state.sheets[0];
    const cell = sheet.cells[sheet.bodyStart][1];
    expect(cell.body.valid).toBe(false);
    if (cell.body.valid) throw new Error("expected invalid body");
    expect(cell.body.unparsedBodyRaw).toBe("= B2 +");
    expect(cell.localDisplay?.valid).toBe(true);

    const updated = applyBatchAtomic(state, [
      {
        op: "set_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        style: { color: "blue" },
      },
    ]);

    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("expected success");
    const updatedCell = updated.nextDocument.sheets[0].cells[updated.nextDocument.sheets[0].bodyStart][1];
    expect(updatedCell.body.valid).toBe(false);
    if (updatedCell.body.valid) throw new Error("expected invalid body");
    expect(updatedCell.body.unparsedBodyRaw).toBe("= B2 +");
    expect(updatedCell.localDisplay?.valid).toBe(true);
    if (!updatedCell.localDisplay?.valid) throw new Error("expected valid display");
    expect(updatedCell.localDisplay.style).toMatchObject({ color: "blue" });
    expect(serializeDocumentState(updated.nextDocument)).toContain("= B2 + {::blue}");
  });

  it("keeps valid body and invalid display metadata independent", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:,.2fd} |
`.trim());

    const sheet = state.sheets[0];
    const cell = sheet.cells[sheet.bodyStart][1];
    expect(cell.body.valid).toBe(true);
    expect(cell.localDisplay?.valid).toBe(false);
    expect(serializeDocumentState(state)).toContain("1 {:,.2fd}");

    const replaced = applyBatchAtomic(state, [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        format: FORMAT_GROUPED_2F,
      },
    ]);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) throw new Error("expected success");
    const output = serializeDocumentState(replaced.nextDocument);
    expect(output).toContain("1 {:,.2f}");
    expect(output).not.toContain(":,.2fd");
  });

  it("clears local display metadata without mutating an invalid body", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || = B2 + {::green} |
`.trim());

    const cleared = applyBatchAtomic(state, [
      {
        op: "clear_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
      },
    ]);

    expect(cleared.ok).toBe(true);
    if (!cleared.ok) throw new Error("expected success");
    const cell = cleared.nextDocument.sheets[0].cells[cleared.nextDocument.sheets[0].bodyStart][1];
    expect(cell.body.valid).toBe(false);
    if (cell.body.valid) throw new Error("expected invalid body");
    expect(cell.body.unparsedBodyRaw).toBe("= B2 +");
    expect(cell.localDisplay).toBeNull();
    expect(serializeDocumentState(cleared.nextDocument)).toContain("= B2 +");
    expect(serializeDocumentState(cleared.nextDocument)).not.toContain("{::green}");
  });

  it("does not mutate body or display state when recalculating cache", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || = 2 + 1 {::green} |
`.trim());
    const sheet = state.sheets[0];
    const outCell = sheet.cells[sheet.bodyStart][1];
    const beforeBody = structuredClone(outCell.body);
    const beforeDisplay = structuredClone(outCell.localDisplay);

    state.evaluate();

    expect(outCell.body).toEqual(beforeBody);
    expect(outCell.localDisplay).toEqual(beforeDisplay);
    expect(outCell.cachedValue?.kind).toBe("number");
    expect(serializeDocumentState(state)).toContain("3 = 2 + 1 {::green}");
  });

  it("applies style patches by axis and uses null to clear an axis", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {::>,blue} |
`.trim());

    const clearedColor = applyBatchAtomic(state, [
      {
        op: "set_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        style: { color: null },
      },
    ]);

    expect(clearedColor.ok).toBe(true);
    if (!clearedColor.ok) throw new Error("expected success");
    const cell = resolveDocumentPresentation(clearedColor.nextDocument).sheets[0].cells[0][1];
    expect(cell.styleLayer.local).toMatchObject({ align: "right", color: null, weight: null });
    expect(serializeDocumentState(clearedColor.nextDocument)).toContain("1 {::>}");

    const addedWeight = applyBatchAtomic(clearedColor.nextDocument, [
      {
        op: "set_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        style: { weight: "bold" },
      },
    ]);
    expect(addedWeight.ok).toBe(true);
    if (!addedWeight.ok) throw new Error("expected success");
    expect(serializeDocumentState(addedWeight.nextDocument)).toContain("1 {::>,bold}");
  });

  it("rejects legacy raw display edit payloads", () => {
    const rawFormat = applyBatchAtomic(DocumentState.fromText(EDIT_DOC), [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        format: ",.2f" as any,
      },
    ]);
    expect(rawFormat.ok).toBe(false);
    if (rawFormat.ok) throw new Error("expected raw format payload to fail");
    expect(rawFormat.error.category).toBe("invalid_operation");

    const rawStyle = applyBatchAtomic(DocumentState.fromText(EDIT_DOC), [
      {
        op: "set_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        style: { raw: "green" } as any,
      },
    ]);
    expect(rawStyle.ok).toBe(false);
    if (rawStyle.ok) throw new Error("expected raw style payload to fail");
    expect(rawStyle.error.category).toBe("invalid_operation");
  });

  it("preserves invalid formula source text on set_cell_input parse failure", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["B"], colLabel: "Out" },
        input: "= sum(B2",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const sheet = result.nextDocument.sheets[0];
    const rowB = (sheet.rowMap.get(JSON.stringify(["B"])) ?? [])[0];
    const colOut = (sheet.colMap.get("Out") ?? [])[0];
    if (rowB === undefined || colOut === undefined) {
      throw new Error("expected resolved target indices");
    }
    const badCell = sheet.cells[rowB][colOut];
    expect(badCell.body.valid).toBe(false);
    if (badCell.body.valid) throw new Error("expected invalid body");
    expect(badCell.body.unparsedBodyRaw).toBe("= sum(B2");
    expect(serializeDocumentState(result.nextDocument)).toContain("= sum(B2");
  });

  it("preserves local display metadata when set_cell_input updates only the body text", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:,.2f:>,blue} |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        input: "= 2 + 1",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const nextSheet = result.nextDocument.sheets[0];
    const cell = nextSheet.cells[nextSheet.bodyStart][1];
    expect(cell.body.valid).toBe(true);
    if (!cell.body.valid) throw new Error("expected valid body");
    expect(cell.body.kind).toBe("formula");
    expect(cell.localDisplay?.valid).toBe(true);
    if (!cell.localDisplay?.valid) throw new Error("expected valid display metadata");
    expect(cell.localDisplay.format).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(cell.localDisplay.style).toMatchObject({ align: "right", color: "blue" });

    const output = serializeDocumentState(result.nextDocument);
    expect(output).toContain('= 2 + 1 {:,.2f:>,blue}');
  });

  it("preserves local display metadata when set_cell_input clears body text to empty input", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:,.2f:>,blue} |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        input: "",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const nextSheet = result.nextDocument.sheets[0];
    const cell = nextSheet.cells[nextSheet.bodyStart][1];
    expect(cell.body.valid).toBe(true);
    if (!cell.body.valid) throw new Error("expected valid body");
    expect(cell.body.kind).toBe("literal");
    expect(cell.body.literal.kind).toBe("blank");
    expect(cell.localDisplay?.valid).toBe(true);
    if (!cell.localDisplay?.valid) throw new Error("expected valid display metadata");
    expect(cell.localDisplay.format).toMatchObject({ grouping: true, precision: 2, type: "f" });
    expect(cell.localDisplay.style).toMatchObject({ align: "right", color: "blue" });

    const output = serializeDocumentState(result.nextDocument);
    expect(output).toContain('| A    || {:,.2f:>,blue} |');
    const roundTripped = DocumentState.fromText(output);
    const roundTrippedCell = roundTripped.sheets[0].cells[roundTripped.sheets[0].bodyStart][1];
    expect(roundTrippedCell.body.valid).toBe(true);
    if (!roundTrippedCell.body.valid) throw new Error("expected valid body");
    expect(roundTrippedCell.body.kind).toBe("literal");
    expect(roundTrippedCell.body.literal.kind).toBe("blank");
    expect(roundTrippedCell.localDisplay?.valid).toBe(true);
  });

  it("preserves invalid local display metadata when set_cell_input updates the body text", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:,.2fd} |
`.trim());

    const beforeCell = state.sheets[0].cells[state.sheets[0].bodyStart][1];
    expect(beforeCell.localDisplay?.valid).toBe(false);
    if (beforeCell.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(beforeCell.localDisplay.rawBlock).toBe("{:,.2fd}");

    const result = applyBatchAtomic(state, [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        input: "= 2 + 1",
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const nextSheet = result.nextDocument.sheets[0];
    const cell = nextSheet.cells[nextSheet.bodyStart][1];
    expect(cell.body.valid).toBe(true);
    if (!cell.body.valid) throw new Error("expected valid body");
    expect(cell.body.kind).toBe("formula");
    expect(cell.localDisplay?.valid).toBe(false);
    if (cell.localDisplay?.valid !== false) throw new Error("expected invalid display metadata");
    expect(cell.localDisplay.rawBlock).toBe("{:,.2fd}");
    expect(cell.localDisplay.issue.code).toBe("invalid_format_spec_trailing_chars");

    const output = serializeDocumentState(result.nextDocument);
    expect(output).toContain('= 2 + 1 {:,.2fd}');
  });

  it("clear_cell removes both body and local display metadata", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item || Out |
| ---- || --- |
| A    || 1 {:,.2f:>,blue} |
`.trim());

    const result = applyBatchAtomic(state, [
      {
        op: "clear_cell",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
      },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const nextSheet = result.nextDocument.sheets[0];
    const cell = nextSheet.cells[nextSheet.bodyStart][1];
    expect(cell.body.valid).toBe(true);
    if (!cell.body.valid) throw new Error("expected valid body");
    expect(cell.body.kind).toBe("literal");
    expect(cell.body.literal.kind).toBe("blank");
    expect(cell.localDisplay).toBeNull();

    const output = serializeDocumentState(result.nextDocument);
    expect(output).not.toContain('{:,.2f:>,blue}');
    const roundTripped = DocumentState.fromText(output);
    const roundTrippedCell = roundTripped.sheets[0].cells[roundTripped.sheets[0].bodyStart][1];
    expect(roundTrippedCell.body.valid).toBe(true);
    if (!roundTrippedCell.body.valid) throw new Error("expected valid body");
    expect(roundTrippedCell.body.kind).toBe("literal");
    expect(roundTrippedCell.body.literal.kind).toBe("blank");
    expect(roundTrippedCell.localDisplay).toBeNull();
  });

  it("returns deterministic target errors for ambiguous labels and invalid structural scope", () => {
    const ambiguous = applyBatchAtomic(DocumentState.fromText(AMBIGUOUS_DOC), [
      {
        op: "set_cell_input",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "2024" },
        input: "9",
      },
    ]);
    expect(ambiguous.ok).toBe(false);
    if (ambiguous.ok) throw new Error("expected failure");
    expect(ambiguous.error.category).toBe("ambiguous_target");

    const invalidScope = applyBatchAtomic(DocumentState.fromText(EDIT_DOC), [
      { op: "insert_row", sheet: "Sheet", area: "body", rowGapIndex: 0, depth: 0 },
    ]);
    expect(invalidScope.ok).toBe(false);
    if (invalidScope.ok) throw new Error("expected failure");
    expect(invalidScope.error.category).toBe("invalid_operation");
  });

  it("exposes minimal row structure read surface from core", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item |
| ---- |
| Revenue |
| * Product A |
| ** SKU 1 |
| * Product B |
`.trim());

    const rows = resolveSheetRowStructure(state.sheets[0]);
    expect(rows.map((row) => ({
      rowId: row.rowId,
      depth: row.depth,
      hasChildren: row.hasChildren,
      subtreeRowCount: row.subtreeRowCount,
      rowPath: row.rowPath,
    }))).toEqual([
      {
        rowId: state.sheets[0].rowIds[state.sheets[0].bodyStart],
        depth: 0,
        hasChildren: true,
        subtreeRowCount: 4,
        rowPath: "Revenue",
      },
      {
        rowId: state.sheets[0].rowIds[state.sheets[0].bodyStart + 1],
        depth: 1,
        hasChildren: true,
        subtreeRowCount: 2,
        rowPath: "Revenue.Product A",
      },
      {
        rowId: state.sheets[0].rowIds[state.sheets[0].bodyStart + 2],
        depth: 2,
        hasChildren: false,
        subtreeRowCount: 1,
        rowPath: "Revenue.Product A.SKU 1",
      },
      {
        rowId: state.sheets[0].rowIds[state.sheets[0].bodyStart + 3],
        depth: 1,
        hasChildren: false,
        subtreeRowCount: 1,
        rowPath: "Revenue.Product B",
      },
    ]);
  });

  it("uses rowGapIndex + depth for body-row insertion and rejects implicit reparenting", () => {
    const base = DocumentState.fromText(`
# Sheet
| Item |
| ---- |
| Root |
| * Child A |
| * Child B |
`.trim());

    const inserted = applyBatchAtomic(base, [
      { op: "insert_row", sheet: "Sheet", area: "body", rowGapIndex: 3, depth: 1 },
    ]);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) throw new Error("expected success");
    expect(inserted.nextDocument.sheets[0].logicalRows[3]?.rawCells[0]).toBe("*");

    const invalid = applyBatchAtomic(DocumentState.fromText(`
# Sheet
| Item |
| ---- |
| Root |
| * Child A |
| * Child B |
`.trim()), [
      { op: "insert_row", sheet: "Sheet", area: "body", rowGapIndex: 3, depth: 0 },
    ]);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error("expected failure");
    expect(invalid.error.category).toBe("invalid_operation");
    expect(invalid.error.message).toContain("implicitly adopt following rows");
  });

  it("deletes leaf rows by rowId and requires subtree mode for non-leaf rows", () => {
    const state = DocumentState.fromText(`
# Sheet
| Item |
| ---- |
| Root |
| * Child A |
| * Child B |
`.trim());
    const sheet = state.sheets[0];
    const rootRowId = sheet.rowIds[sheet.bodyStart];
    const childBRowId = sheet.rowIds[sheet.bodyStart + 2];

    const invalid = applyBatchAtomic(state, [
      { op: "delete_row", sheet: "Sheet", rowId: rootRowId },
    ]);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error("expected failure");
    expect(invalid.error.category).toBe("invalid_operation");

    const leafDeleted = applyBatchAtomic(state, [
      { op: "delete_row", sheet: "Sheet", rowId: childBRowId },
    ]);
    expect(leafDeleted.ok).toBe(true);
    if (!leafDeleted.ok) throw new Error("expected success");
    const output = serializeDocumentState(leafDeleted.nextDocument);
    expect(output).not.toContain("Child B");

    const subtreeDeleted = applyBatchAtomic(DocumentState.fromText(`
# Sheet
| Item |
| ---- |
| Root |
| * Child A |
| * Child B |
`.trim()), [
      { op: "delete_row", sheet: "Sheet", rowId: rootRowId, mode: "subtree" },
    ]);
    expect(subtreeDeleted.ok).toBe(true);
    if (!subtreeDeleted.ok) throw new Error("expected success");
    expect(serializeDocumentState(subtreeDeleted.nextDocument)).not.toContain("Root");
  });

  it("supports fixture-driven .cases for doc + ops + expected doc", () => {
    const path = resolve(process.cwd(), "tests", "fixtures", "rfc_0017", "core_edit_atomic.cases");
    const cases = loadCoreEditCases(path);

    for (const spec of cases) {
      const state = DocumentState.fromText(spec.doc);
      const result = applyBatchAtomic(state, spec.ops);

      expect(result.ok, spec.name).toBe(spec.expectOk);
      if (spec.expectOk) {
        if (!result.ok) throw new Error(`case '${spec.name}' should have succeeded`);
        const output = serializeDocumentState(result.nextDocument);
        const expected = formatDocument(`${spec.expect}\n`);
        expect(output, spec.name).toBe(expected);
      } else {
        if (result.ok) throw new Error(`case '${spec.name}' should have failed`);
        if (spec.expectErrorCategory) {
          expect(result.error.category, spec.name).toBe(spec.expectErrorCategory);
        }
        const output = serializeDocumentState(state);
        const expected = formatDocument(`${spec.expect}\n`);
        expect(output, spec.name).toBe(expected);
      }
    }
  });
});
