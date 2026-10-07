import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, importExcelWorkbook, serializeDocumentState, type ExcelExportOptions } from "../src";
import { exportFormula } from "../src/excel/exportFormula";
import { DEFAULT_EXCEL_LIMITS, ExcelReport } from "../src/excel/contracts";
import { parseCellText } from "../src/runtime/parse";
import { exportTemporalFunction, temporalFunctions } from "../src/excel/temporalExport";

const native = (formula: string) => DocumentState.fromText(`# Data\n| = ${formula} |`);
async function load(document: DocumentState, options: ExcelExportOptions = {}) {
  const before = serializeDocumentState(document);
  const result = await exportExcelWorkbook(document, options);
  expect(serializeDocumentState(document)).toBe(before);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.value.slice().buffer);
  return { cell: workbook.worksheets[0].getCell("A1"), sheet: workbook.worksheets[0], diagnostics: result.diagnostics };
}

describe("text indexing sugar uses the text adapter, not reference slicing", () => {
  it.each([
    ['"abcdef"[0]', "a"], ['"abcdef"[-1]', "f"], ['"abcdef"[1:4]', "bcd"],
    ['"abcdef"[:3]', "abc"], ['"abcdef"[2:]', "cdef"], ['"abcdef"[:]', "abcdef"],
    ['"abcdef"[-3:-1]', "de"], ['"abcdef"[99:]', ""], ['"abcdef"[4:1]', ""],
    ['""[:]', ""], ['"A😀B"[1]', "😀"], ['("ab"+"cd")[1:3]', "bc"],
    ['upper("abcdef")[1:3][-1]', "C"], ['format(12345)[1:3]', "23"],
    ['"abcdef"[1+1:len("abcdef")-1]', "cde"],
    ['"abcdef"[len("abcdef")-1]', "f"], ['"abcdef"[1+1]', "c"],
    ['take("abcdef",-2)', "ef"], ['take("abcdef",0)', ""], ['take("abcdef",99)', "abcdef"],
    ['drop("abcdef",-2)', "abcd"], ['drop("abcdef",99)', ""],
  ])("exports %s as an editable formula", async (formula, expected) => {
    const document = native(formula);
    expect(document.evaluate().sheets[0].values[0][0]).toEqual({kind:"string",value:expected});
    const { cell } = await load(document, {unsupportedFormulas:"value"});
    expect(cell.formula).toBeTruthy();
    expect(cell.result).toBeUndefined();
  });
  it("shares the existing slice translation exactly", async () => {
    expect((await load(native('"abc"[1:2]'))).cell.formula)
      .toBe((await load(native('slice("abc",1,2)'))).cell.formula);
  });
  it("does not generate defensive sign/length guards for positive literal coordinates", async () => {
    expect((await load(native('"abcdef"[1:4]'))).cell.formula).toBe('MID("abcdef",2,3)');
    expect((await load(native('"abcdef"[1]'))).cell.formula).toBe('MID("abcdef",2,1)');
    expect((await load(native('"abcdef"[-1]'))).cell.formula).toBe('MID("abcdef",LEN("abcdef"),1)');
  });
  it("warns that negative elapsed-time display differs without losing the numeric value", async () => {
    const {cell,diagnostics}=await load(native("-duration(0,1)"));
    expect(cell.formula).toBeTruthy();
    expect(diagnostics.some(item=>item.message.includes("####"))).toBe(true);
  });
  it("keeps A1 indexing as view indexing, even when A1 contains text", async () => {
    const {sheet} = await load(DocumentState.fromText('# Data\n| "abc" | = A1[0] |'));
    expect(sheet.getCell("B1").formula).toBe("INDEX(A1,1,1)");
  });
  it("does not claim to export dynamic reference slices or temporary array slices", async () => {
    for (const formula of ["sum([1,2,3][1:])", "sum(A1:C1[B1:])"]) {
      const document=DocumentState.fromText(`# Data\n| 1 | 1 | 3 | = ${formula} |`);
      const result=await exportExcelWorkbook(document);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.at(-1)?.code).toBe("unsupported_formula");
    }
  });
});

const temporalCases = [
  ["date(2025,6,29)", "date"], ["date(2025-06-29T12:34:56)", "date"],
  ["time(12,34)", "time"], ["time(12,34,56.789)", "time"], ["time(2025-06-29T12:34:56.789Z)", "time"],
  ["datetime(2025-06-29,12:34:56.789+08:00)", "datetime"],
  ["duration()", "duration"], ["duration(1,2,3,4.567)", "duration"],
  ["year(2025-06-29)", "number"], ["month(2025-06-29)", "number"], ["day(2025-06-29)", "number"],
  ["hour(12:34:56.789)", "number"], ["minute(12:34:56.789)", "number"],
  ["second(12:34:56.789)", "number"], ["millisecond(12:34:56.789)", "number"],
  ["unixMillis(2025-06-29T12:34:56.789+08:00)", "number"],
  ["datetimeFromUnixMillis(0)", "datetime"],
] as const;
describe("temporal expressions have an explicit Excel projection", () => {
  it("exercises every temporal function, not just constructor examples", () => {
    expect([...new Set(temporalCases.map(([formula])=>formula.split("(")[0]))].sort()).toEqual([...temporalFunctions].sort());
  });
  it.each(temporalCases)("exports %s and preserves its display kind", async (formula, kind) => {
    const document=native(formula);
    expect(document.evaluate().sheets[0].values[0][0].kind).toBe(kind);
    const {cell}=await load(document);
    expect(cell.formula).toBeTruthy();
    expect(cell.result).toBeUndefined();
    if (kind !== "number") expect(cell.numFmt).not.toBe("General");
  });
  it.each(["2025-06-29T12:34:56Z", "2025-06-29T12:34:56+08:00", "2025-06-29T12:34:56-05:00"])(
    "removes only the offset from %s, not the wall-clock time", async literal => {
      const offset=await load(DocumentState.fromText(`# Data\n| ${literal} |`));
      const plain=await load(DocumentState.fromText('# Data\n| 2025-06-29T12:34:56 |'));
      expect(offset.cell.value).toEqual(plain.cell.value);
      expect(offset.diagnostics.filter(item=>item.message.includes("Timezone"))).toHaveLength(1);
    });
  it.each(["12:34:56.789", "PT1H30M", "-PT1H", "P1D"])("exports literal %s with units and format", async literal => {
    const {cell}=await load(DocumentState.fromText(`# Data\n| ${literal} |`));
    expect(cell.value).not.toBeNull();
    expect(cell.numFmt).not.toBe("General");
  });
  it("does not fabricate a fixed length for calendar durations", async () => {
    const result=await exportExcelWorkbook(DocumentState.fromText('# Data\n| P1M |'));
    expect(result).toMatchObject({ok:false,diagnostics:expect.arrayContaining([expect.objectContaining({code:"unrepresentable_value"})])});
  });
  it("warns once per cell even when multiple stages observe the same offset loss", async () => {
    const {diagnostics}=await load(native("time(2025-06-29T12:34:56Z)"));
    expect(diagnostics.filter(item=>item.message.includes("Timezone"))).toHaveLength(1);
  });
  it("uses source literal offsets for references, never a current guessed timezone", async () => {
    const {sheet}=await load(DocumentState.fromText('# Data\n| 2025-06-29T12:34:56+08:00 | = unixMillis(A1) |'));
    expect(sheet.getCell("B1").formula).toContain("-(480)*60000");
    const dynamic=DocumentState.fromText('# Data\n| = datetimeFromUnixMillis(0) | = unixMillis(A1) |');
    expect((await exportExcelWorkbook(dynamic)).ok).toBe(false);
    const projected=await load(dynamic,{unsupportedFormulas:"value"});
    expect(projected.sheet.getCell("B1").value).toBe(0);
  });
  it("does not infer a conditional offset from just its currently selected branch", async () => {
    const {cell}=await load(native("unixMillis(if(true,2025-06-29T12:00Z,2025-06-29T12:00+08:00))"),{unsupportedFormulas:"value"});
    expect(cell.formula).toBeUndefined();
    expect(cell.value).toBe(Date.parse("2025-06-29T12:00Z"));
  });
  it.each([
    "1970-01-01T00:00Z==1970-01-01T08:00+08:00",
    "1970-01-01T00:00Z-1970-01-01T08:00+08:00",
    "unixMillis(1970-01-01T00:00Z+duration(0,1))",
    "unixMillis(if(true,1970-01-01T00:00Z,1970-01-02T00:00Z))",
    "hour(time(12,34)-duration(0,1))",
  ])("preserves declared temporal metadata through %s", async formula => {
    expect((await load(native(formula))).cell.formula).toBeTruthy();
  });
  it("retains date strings when explicitly converting source constructor references", async () => {
    const {sheet}=await load(DocumentState.fromText('# Data\n| = date(2025,6,29) | = text(A1) |'));
    expect(sheet.getCell("B1").formula).toBe('TEXT(A1,"yyyy-mm-dd")');
  });
  it.each(["date", "time", "datetime", "year", "unixMillis"])("rejects invalid %s arity without generating broken formulas", name => {
    expect(()=>exportTemporalFunction(name,[],{})).toThrow("arity");
  });
  it("fails early if the temporal registry points at an unimplemented rule", () => {
    expect(()=>exportTemporalFunction("missing",[{text:"1"}],{})).toThrow("Missing temporal Excel translation");
  });
});

describe("fresh static-result projection is a loss policy, not cache substitution", () => {
  it.each([
    ['trim(" a  b ")', "a  b"], ["isNull(null)", true],
    ['format(2025-06-29T12:34:56Z,"%:z")', "+00:00"],
    ["sum([1,2,3][1:])", 5],
  ])("projects valid unsupported %s and reports the lost formula", async (formula, expected) => {
    const {cell,diagnostics}=await load(native(formula),{unsupportedFormulas:"value"});
    expect(cell.value).toBe(expected);
    expect(cell.formula).toBeUndefined();
    expect(diagnostics).toContainEqual(expect.objectContaining({code:"formula_exported_as_value",sheetName:"Data",rowIndex:0,colIndex:0,formula:`= ${formula}`}));
  });
  it("retains supported formulas, downstream references and explicit strict policy", async () => {
    const document=DocumentState.fromText('# Data\n| = len(trim(" hi ")) | = A1+1 |');
    expect((await exportExcelWorkbook(document)).ok).toBe(false);
    const {sheet}=await load(document,{unsupportedFormulas:"value"});
    expect(sheet.getCell("A1").value).toBe(2);
    expect(sheet.getCell("B1").formula).toBe("A1+1");
  });
  it("does not replace failed evaluation or invalid syntax with a stale answer", async () => {
    for (const formula of ['trim(1)', 'trim(', 'trim(A1)', 'trim("a")/0']) {
      const result=await load(native(formula),{unsupportedFormulas:"value",cellErrors:"blank"});
      expect(result.cell.value).toBeNull();
      expect(result.diagnostics.some(item=>item.code==="formula_exported_as_value")).toBe(false);
    }
  });
  it("never suppresses limits in static-result mode", async () => {
    const result=await exportExcelWorkbook(native('"abc"[1:2]'),{unsupportedFormulas:"value",cellErrors:"blank",limits:{maxFormulaLength:12}});
    expect(result.diagnostics.at(-1)?.code).toBe("limit_exceeded");
    expect(result.ok).toBe(false);
  });
  it.each([null,"cache","blank",true])("rejects invalid result policy %j", async option => {
    expect((await exportExcelWorkbook(native("1"),{unsupportedFormulas:option as never})).diagnostics.at(-1)?.code).toBe("invalid_options");
  });
  it("separates an unrepresentable calendar operand from its representable final text", async () => {
    const {cell}=await load(native('format(1800-01-01,"%F")'),{unsupportedFormulas:"value"});
    expect(cell.value).toBe("1800-01-01");
    const calendar=await load(native("if(true,P1M,P1M)"),{unsupportedFormulas:"value",cellErrors:"blank"});
    expect(calendar.cell.value).toBeNull();
    expect(calendar.diagnostics.some(item=>item.code === "cell_omitted")).toBe(true);
    expect(calendar.diagnostics.some(item=>item.code === "formula_exported_as_value")).toBe(false);
  });
  it("ignores imported caches before any later static projection", async () => {
    const workbook=new ExcelJS.Workbook(), sheet=workbook.addWorksheet("Data");
    sheet.getCell("A1").value={formula:'LOWER("HELLO")',result:"poisoned"};
    const imported=await importExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    imported.value.setCellByIndex("Data",0,0,'= trim(lower("HELLO"))');
    expect((await load(imported.value,{unsupportedFormulas:"value"})).cell.value).toBe("hello");
  });
  it("does not export an implicit ISO datetime string as its Excel serial number", async () => {
    const {cell,diagnostics}=await load(native('f"At {datetimeFromUnixMillis(0)}"'),{unsupportedFormulas:"value"});
    expect(cell.value).toBe("At 1970-01-01T00:00:00Z");
    expect(diagnostics.some(item=>item.code==="formula_exported_as_value")).toBe(true);
    const ref=await load(DocumentState.fromText('# Data\n| = datetimeFromUnixMillis(0) | = format(A1) |'),{unsupportedFormulas:"value"});
    expect(ref.sheet.getCell("B1").value).toBe("1970-01-01T00:00:00Z");
  });
  it("does not retain discarded translation warnings when static text preserves the offset", async () => {
    const {cell,diagnostics}=await load(native('format(2025-06-29T12:34:56+08:00,"%:z")'),{unsupportedFormulas:"value"});
    expect(cell.value).toBe("+08:00");
    expect(diagnostics.some(item=>item.message.includes("Timezone offset is removed"))).toBe(false);
  });
});

describe("source notation has no separate export bypass", () => {
  it.each([
    'f"Total {2+3:.2f}"', 'f"Date {2025-06-29:%F}"', 'f"Time {12:34:56:%T}"',
    'f"Date/time {2025-06-29T12:34:56:%FT%T}"',
    'f"At {2025-06-29T12:34:56Z}"', 'f"Date {date(2025,6,29)}"',
    'text(2025-06-29)', 'text(date(2025,6,29))', 'text(12:34:56+08:00)',
    '(2+3)*4', '-(2**2)', 'sum([1,2,3])', '[[1,2],[3,4]][1,0]',
    'if(true,"abc","xyz")[1:]', 'size(shape([1,2]))',
  ])("exports source syntax %s through its parsed expression", async formula => {
    const document=native(formula);
    expect(document.evaluate().sheets[0].values[0][0].kind).not.toBe("error");
    expect((await load(document)).cell.formula).toBeTruthy();
  });
  it("does not quietly accept an unknown future expression kind", () => {
    const document=native("1"), body=parseCellText("= 1").body;
    if (!body.valid || body.kind!=="formula") throw new Error("test setup");
    expect(()=>exportFormula({...body.expression,kind:"futureSugar"},document,document.sheets[0],{sheetName:"Data",rowIndex:0,colIndex:0},DEFAULT_EXCEL_LIMITS,new ExcelReport())).toThrow("Unsupported expression");
  });
});
