import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, importExcelWorkbook, serializeDocumentState } from "../src";

type Input = number | string | boolean | null | { error: "#DIV/0!" | "#VALUE!" };
type Expected = Input;
interface Example { formula: string; inputs?: Input[][]; expected: Expected }
const matrix: Input[][] = [[2, 3], [4, 5]];
const errorCell = { error: "#DIV/0!" } as const;
function assertNative(document: DocumentState, expected: Expected): void {
  const value = document.evaluate().sheets[0].values[0][9];
  if (expected === null) expect(value.kind).toBe("blank");
  else if (typeof expected === "object") expect(value.kind).toBe("error");
  else expect(value).toEqual({ kind: typeof expected === "string" ? "string" : typeof expected, value: expected });
}

async function imported(formula: string, inputs = matrix) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  inputs.forEach((row, r) => row.forEach((value, c) => { sheet.getCell(r + 1, c + 1).value = value; }));
  sheet.getCell("J1").value = { formula, result: 987654321 };
  return importExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
}

describe("RFC-0042 Excel INDEX references compose with existing native views", () => {
  it.each([
    { formula: "INDEX(A1:B2,2,2)", expected: 5 },
    { formula: "INDEX(A1:B1,2)", expected: 3 },
    { formula: "INDEX(A1:A2,2)", expected: 4 },
    { formula: "SUM(INDEX(A1:B2,0,2))", expected: 8 },
    { formula: "SUM(INDEX(A1:B2,2,0))", expected: 9 },
    { formula: "SUM(INDEX(A1:B2,2))", expected: 9 },
    { formula: "SUM(INDEX(A1:B2,,2))", expected: 8 },
    { formula: "SUM(INDEX(A1:B2))", expected: 14 },
    { formula: "SUM(INDEX(A1:B2,0,0))", expected: 14 },
    { formula: "ROWS(INDEX(A1:B2,0,2))", expected: 2 },
    { formula: "COLUMNS(INDEX(A1:B2,2,0))", expected: 2 },
    { formula: "ROWS(INDEX(A1:B2,2,2))", expected: 1 },
    { formula: "ROWS(A:A)", expected: 1048576 },
    { formula: "COLUMNS(1:1)", expected: 16384 },
    { formula: "INDEX(A1:B2,1,2)", inputs: [[2, null], [4, 5]], expected: null },
    { formula: "ISBLANK(INDEX(A1:B2,1,2))", inputs: [[2, null], [4, 5]], expected: true },
    { formula: "SUM(INDEX(A1:B2,1,2))", inputs: [[2, true], [4, 5]], expected: 1 },
    { formula: "COUNT(INDEX(A1:B2,1,2))", inputs: [[2, true], [4, 5]], expected: 1 },
    { formula: "COUNTA(INDEX(A1:B2,1,2))", inputs: [[2, null], [4, 5]], expected: 0 },
    { formula: "SUM(INDEX(A1:B2,1,2))", inputs: [[2, "3"], [4, 5]], expected: { error: "#VALUE!" } },
    { formula: "MIN(INDEX(A1:B2,1,2),7)", inputs: [[2, true], [4, 5]], expected: 1 },
    { formula: "INDEX(A1:B2,1,1)", inputs: [[2, errorCell], [4, 5]], expected: 2 },
    { formula: "INDEX(A1:B2,1,2)", inputs: [[2, errorCell], [4, 5]], expected: errorCell },
    { formula: "ROWS(A1:B2)", inputs: [[2, errorCell], [4, 5]], expected: 2 },
    { formula: "COLUMNS({1,2,3;4,5,6})", expected: 3 },
    { formula: "INDEX(INDEX(A1:B2,0,2),2)", expected: 5 },
    { formula: "COUNT(INDEX(A1:B2,99,1))", expected: errorCell },
    { formula: "COUNTA(INDEX(A1:B2,99,1))", expected: errorCell },
    { formula: "COUNT(INDEX(A1:B2,0,0))", inputs: [[2, errorCell], [null, 5]], expected: errorCell },
    { formula: "COUNTA(INDEX(A1:B2,0,0))", inputs: [[2, errorCell], [null, 5]], expected: errorCell },
    { formula: 'INDEX(A1:B2,"bad",1)', expected: errorCell },
  ] satisfies Example[])("imports $formula without using its poisoned cache", async ({ formula, inputs, expected }) => {
    const result = await imported(formula, inputs);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    assertNative(result.value, expected);
    assertNative(DocumentState.fromText(serializeDocumentState(result.value)), expected);
  });

  it.each(["INDEX(A1:B2,3,1)", "INDEX(A1:B2,1,3)"])(
    "does not clamp an invalid Excel index in %s", async formula => {
      const result = await imported(formula);
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      assertNative(result.value, { error: "#VALUE!" });
    },
  );

  it("keeps dynamic zero-axis selection, bounds and reference membership live after input edits", async () => {
    const result = await imported("SUM(INDEX(A1:B2,C1,D1))", [[2, 3, 1, 2], [4, 5]]);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const doc = result.value;
    assertNative(doc, 3);
    doc.setCellByIndex("Data", 0, 2, "0");
    assertNative(doc, 8);
    doc.setCellByIndex("Data", 0, 3, "0");
    assertNative(doc, 14);
    doc.setCellByIndex("Data", 1, 1, "true");
    assertNative(doc, 10);
    doc.setCellByIndex("Data", 0, 2, "3");
    assertNative(doc, { error: "#VALUE!" });
  });

  it.each(["INDEX(A:A,2)", "INDEX(A1:B2,0,2)", "INDEX(A1:B2,2)", "INDEX(A1:B2,-1,1)", "INDEX(A1:B2,1,1,2)", "INDEX(A1:B2,1.9,1)"])("reports unimplemented INDEX forms atomically: %s", async formula => {
    const result = await imported(formula);
    expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_formula", sheetName: "Data", rowIndex: 0, colIndex: 9 }),
    ]) });
    expect(result).not.toHaveProperty("value");
  });
});
