import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DocumentState, exportExcelWorkbook, getCellTextView, importExcelWorkbook, serializeDocumentState } from "../src";

async function workbook(formula: string) {
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet("Data");
  sheet.getCell('A1').value = 1234.5;
  sheet.getCell('B1').value = 0.125;
  sheet.getCell('C1').value = { formula, result: 'stale cached text' };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("RFC-0044 readable Excel TEXT interoperability", () => {
  it.each([
    ['TEXT(A1,"#,##0.00")', 'format(A1, ",.2f")', '1,234.50'],
    ['TEXT(B1,"0.0%")', 'format(B1, ".1%")', '12.5%'],
    ['TEXT(A1,"0")', 'format(A1, ".0f")', '1235'],
    ['TEXT(A1,"0.00")', 'format(A1, ".2f")', '1234.50'],
  ])("imports %s as %s, ignoring stale caches", async (formula, native, expected) => {
    const imported = await importExcelWorkbook(await workbook(formula));
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const doc = imported.value;
    expect(getCellTextView(doc.sheets[0].cells[0][2]).inputText).toBe('= ' + native);
    expect(doc.evaluate().sheets[0].values[0][2]).toEqual({ kind: 'string', value: expected });
    const restored = DocumentState.fromText(serializeDocumentState(doc));
    const output = await exportExcelWorkbook(restored);
    if (!output.ok) throw new Error(JSON.stringify(output.diagnostics));
    const reader = new ExcelJS.Workbook(); await reader.xlsx.load(output.value as never);
    expect(reader.worksheets[0].getCell('C1').formula).toBe(formula);
    expect(reader.worksheets[0].getCell('C1').result).toBeUndefined();
    restored.setCellByIndex('Data', 0, 0, '9');
    expect(getCellTextView(restored.sheets[0].cells[0][2]).inputText).toBe('= ' + native);
  });
  it.each([
    ['f"Revenue: {A1:,.2f} USD"', '"Revenue: "&TEXT(A1,"#,##0.00")&" USD"'],
    ['f"{A1}/{B1:.1%}"', 'A1&"/"&TEXT(B1,"0.0%")'],
    ['f"{A1}"', 'A1&""'],
    ['format(A1)', 'A1&""'],
    ['f"{if(A1 > 0, A1, B1):.2f}"', 'TEXT(IF(A1>0,A1,B1),"0.00")'],
  ])("exports %s without generated defensive guards", async (formula, expected) => {
    const doc = DocumentState.fromText('# Data\n| 12 | 0.2 | |');
    doc.setCellByIndex('Data', 0, 2, '= ' + formula);
    const original = serializeDocumentState(doc);
    const output = await exportExcelWorkbook(doc);
    if (!output.ok) throw new Error(JSON.stringify(output.diagnostics));
    const reader = new ExcelJS.Workbook(); await reader.xlsx.load(output.value as never);
    expect(reader.worksheets[0].getCell('C1').formula).toBe(expected);
    expect(serializeDocumentState(doc)).toBe(original);
  });
  it.each(['"$0.00"', '"yyyy-mm-dd"', '"[$-409]0.00"', '"0.00;[Red]-0.00"', '"0.00;0.00"', 'B1', '"0."&"00"', '"General"'])('preserves unsupported TEXT format %s only with consent', async code => {
    const formula = `TEXT(A1,${code})`, bytes = await workbook(formula);
    expect((await importExcelWorkbook(bytes)).ok).toBe(false);
    const result = await importExcelWorkbook(bytes, { unsupportedContent: 'preserve-text' });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.evaluate().sheets[0].values[0][2]).toEqual({ kind: 'string', value: '=' + formula });
    expect(result.diagnostics.some(d => d.code === 'formula_preserved_as_text')).toBe(true);
  });
  it.each(['format(A1, "." + "2f")', 'format(2025-06-29, "%:z")', 'format(A1, "d")', 'format(A1, "+.2f")', 'format(A1,".2e")'])('does not export unsupported %s as cached text', async formula => {
    const doc = DocumentState.fromText('# Data\n| 12 | |');
    doc.setCellByIndex('Data', 0, 1, '= ' + formula);
    const output = await exportExcelWorkbook(doc);
    expect(output.ok).toBe(false);
    expect(output.diagnostics.some(d => d.code === 'unsupported_formula')).toBe(true);
  });
});
