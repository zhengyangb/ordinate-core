import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, serializeDocumentState } from "../src";
import { importExcelWorkbook } from "../src/excel";

async function imported(date1904: boolean, formula: string, inputs: number[] = [], dateFormat = false) {
  const workbook = new ExcelJS.Workbook();
  workbook.properties.date1904 = date1904;
  const sheet = workbook.addWorksheet("Dates");
  inputs.forEach((value, i) => {
    sheet.getCell(1, i + 1).value = value;
    if (dateFormat) sheet.getCell(1, i + 1).numFmt = "yyyy-mm-dd hh:mm:ss.000";
  });
  sheet.getCell("J1").value = { formula, result: -999 };
  const result = await importExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

const output = (doc: DocumentState) => doc.evaluate().sheets[0].values[0][9];

describe.each([false, true])("RFC-0042 serial dates, date1904=%s", date1904 => {
  it.each([1, 59, 61, 45351.5])(
    "converts formatted serial %s to a native datetime, with no Excel display metadata", async serial => {
      const { value, diagnostics } = await imported(date1904, "ISNUMBER(A1)", [serial], true);
      const native = value.evaluate().sheets[0].values[0][0];
      expect(native.kind).toBe("datetime");
      expect(value.sheets[0].cells[0][0].localDisplay).toBeNull();
      expect(output(value)).toEqual({ kind: "boolean", value: true });
      expect(diagnostics.some(d => d.message.includes("Date display"))).toBe(false);
      const reopened = DocumentState.fromText(serializeDocumentState(value));
      expect(reopened.evaluate().sheets[0].values[0][0]).toEqual(native);
    },
  );

  it("keeps date arithmetic editable without converting serial differences to durations", async () => {
    const { value } = await imported(date1904, "B1-A1", [59, 61], true);
    expect(output(value)).toEqual({ kind: "number", value: 2 });
    value.setCellByIndex("Dates", 0, 1, date1904 ? "1904-03-03T00:00:00" : "1900-03-02T00:00:00");
    expect(output(value)).toEqual({ kind: "number", value: 3 });
  });

  it.each([
    ["DATE(2024,2,29)", 45351], ["DATE(108,1,2)", 39449],
    ["DATE(2023,14,29)", 45351], ["DATE(2024,3,0)", 45351],
    ["DATE(2024,-1,1)", 45231], ["DATE(2024,1,60)", 45351],
    ["DATE(2024.9,2.9,29.9)", 45351], ["DATE(9999,12,31)", 2958465],
  ] as const)("constructs %s in the original workbook calendar", async (formula, serial1900) => {
    const { value } = await imported(date1904, formula);
    expect(output(value)).toEqual({ kind: "number", value: serial1900 - (date1904 ? 1462 : 0) });
  });

  it.each(["DATE(-1,1,1)", "DATE(10000,1,1)", "DATE(9999,12,32)", "YEAR(-1)", "MONTH(-0.1)", "DAY(2958466)"])(
    "retains invalid calendar inputs as errors: %s", async formula => {
      expect(output((await imported(date1904, formula)).value).kind).toBe("error");
    },
  );

  it.each(["YEAR", "MONTH", "DAY"])("%s remains tied to source calendar after native save/reopen and input edits", async name => {
    const { value } = await imported(date1904, `${name}(A1)`, [date1904 ? 43889.75 : 45351.75], true);
    expect(output(value)).toEqual({ kind: "number", value: name === "YEAR" ? 2024 : name === "MONTH" ? 2 : 29 });
    const reopened = DocumentState.fromText(serializeDocumentState(value));
    reopened.setCellByIndex("Dates", 0, 0, "2025-01-01T00:00:00");
    expect(output(reopened)).toEqual({ kind: "number", value: name === "YEAR" ? 2025 : 1 });
  });

  it("normalizes dynamic DATE arguments rather than capturing imported cached values", async () => {
    const { value } = await imported(date1904, "DATE(A1,B1,C1)", [2024, 2, 29]);
    expect(output(value)).toEqual({ kind: "number", value: date1904 ? 43889 : 45351 });
    value.setCellByIndex("Dates", 0, 1, "3");
    value.setCellByIndex("Dates", 0, 2, "0");
    expect(output(value)).toEqual({ kind: "number", value: date1904 ? 43889 : 45351 });
  });
});

describe("RFC-0042 Excel calendar discontinuities", () => {
  it.each([
    [0, 1900, 1, 0], [1, 1900, 1, 1], [59, 1900, 2, 28],
    [60, 1900, 2, 29], [60.75, 1900, 2, 29], [61, 1900, 3, 1], [1462, 1904, 1, 1],
  ])("retains 1900-system components for serial %s", async (serial, year, month, day) => {
    for (const [name, expected] of [["YEAR", year], ["MONTH", month], ["DAY", day]] as const) {
      expect(output((await imported(false, `${name}(A1)`, [serial])).value)).toEqual({ kind: "number", value: expected });
    }
  });

  it.each([
    ["DATE(1900,1,0)", 0], ["DATE(1900,1,1)", 1], ["DATE(1900,2,29)", 60],
    ["DATE(1900,3,0)", 60], ["DATE(1900,1,60)", 60], ["DATE(1900,3,1)", 61],
  ] as const)("preserves the 1900 leap-day quirk in %s", async (formula, expected) => {
    expect(output((await imported(false, formula)).value)).toEqual({ kind: "number", value: expected });
  });

  it.each([[0, 1904, 1, 1], [59, 1904, 2, 29], [60, 1904, 3, 1]])(
    "does not apply the 1900 quirk to 1904 serial %s", async (serial, year, month, day) => {
      for (const [name, expected] of [["YEAR", year], ["MONTH", month], ["DAY", day]] as const) {
        expect(output((await imported(true, `${name}(A1)`, [serial])).value)).toEqual({ kind: "number", value: expected });
      }
    },
  );
});
