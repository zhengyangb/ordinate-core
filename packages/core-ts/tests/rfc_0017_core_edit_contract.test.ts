import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyBatchAtomic,
  type CoreEdit,
  type CoreEditErrorCategory,
  DocumentState,
  evaluateDocument,
  formatDocument,
  isError,
  parseDocumentModel,
  resolveDocumentPresentation,
  resolvePresentationFromText,
  serializeDocumentState,
  splitCellDisplayMetadata,
} from "../src";

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

    // Raw user text is preserved.
    expect(badPrice.text).toBe("= sum(B2");
    expect(badPrice.parsed.kind).toBe("formula");
    expect(badPrice.parsed.expression).not.toBeNull();
    if (!badPrice.parsed.expression || badPrice.parsed.expression.kind !== "literal") {
      throw new Error("expected parse-error literal expression");
    }
    expect(isError(badPrice.parsed.expression.value as any)).toBe(true);
    expect((badPrice.parsed.expression.value as any).errorKind).toBe("parse_error");

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

  it("supports local format/style edits without conflating presentation and value", () => {
    const state = DocumentState.fromText(EDIT_DOC);
    const updated = applyBatchAtomic(state, [
      {
        op: "set_cell_local_format",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        format: ",.2f",
      },
      {
        op: "set_cell_local_style",
        target: { kind: "label", sheet: "Sheet", rowPath: ["A"], colLabel: "Out" },
        style: "green",
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
    expect(badCell.text).toBe("= sum(B2");
    expect(badCell.parsed.kind).toBe("formula");
    expect(serializeDocumentState(result.nextDocument)).toContain("= sum(B2");
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
      { op: "insert_row", sheet: "Sheet", rowIndex: 0 },
    ]);
    expect(invalidScope.ok).toBe(false);
    if (invalidScope.ok) throw new Error("expected failure");
    expect(invalidScope.error.category).toBe("invalid_operation");
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
