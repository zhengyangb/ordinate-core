import { describe, expect, it } from "vitest";
import { DocumentState, resolveDocumentPresentation } from "@ordinate/core";
import { convertExport, convertImport, diagnosticLocation, groupDiagnostics, requiresImportConsent, defaultImportNotes } from "./conversion";
import { writeXlsx } from "../../../../packages/core-ts/src/excel/workbookCodec";
import { DEFAULT_EXCEL_LIMITS } from "../../../../packages/core-ts/src/excel/contracts";
import { exportName, importFormat, validateExport, validateImport } from "./contracts";

const bytes = (text: string) => new TextEncoder().encode(text);
const report = '# Inputs\n| 2 | 3 | = A1 * B1 |\n# Notes\n| "hello, world" | "two\\\\nlines" |';

describe("interchange presentation adapter", () => {
  it("defaults both note regions on independently for every sheet, excluding unsafe candidates", () => {
    const candidate={sheetName:'Data',position:'beforeTable' as const,rowCount:2,firstRow:1,lastRow:2,markdown:'Title'};
    expect(defaultImportNotes([candidate,{...candidate,position:'afterTable',rowCount:3},
      {...candidate,sheetName:'Other'}, {...candidate,sheetName:'Referenced',unavailableReason:'Referenced by A1'}])).toEqual([
      {sheetName:'Data',beforeRows:2,afterRows:3},{sheetName:'Other',beforeRows:2,afterRows:0},
    ]);
  });
  it("applies default notes to the very first preview and document; explicit empty choices turn them off", async () => {
    const file={name:'notes.xlsx',bytes:await writeXlsx({sheets:[{name:'Data',rows:[
      [{value:'Report title'},{value:null}],[{value:'Name'},{value:'Value'}],[{value:'One'},{value:2}],
      [{value:'Two'},{formula:'B3*2',value:4}],[{value:'Source: Example'},{value:null}],
    ]}]},DEFAULT_EXCEL_LIMITS)};
    const enabled=await convertImport(file,'text');
    if(!enabled.ok)throw new Error(JSON.stringify(enabled.diagnostics));
    expect(enabled.value.notes).toEqual([{sheetName:'Data',beforeRows:1,afterRows:1}]);
    expect(enabled.value.preview[0].rows).toBe(3);
    const sheet=DocumentState.fromText(enabled.value.text).sheets[0];
    expect(sheet.getSheetNote('beforeTable').blocks).toHaveLength(1);
    expect(sheet.getSheetNote('afterTable').blocks).toHaveLength(1);
    expect(enabled.value.text).toContain('B2 * 2');
    const disabled=await convertImport(file,'text',undefined,[]);
    if(!disabled.ok)throw new Error(JSON.stringify(disabled.diagnostics));
    expect(disabled.value.notes).toEqual([]);
    expect(disabled.value.preview[0].rows).toBe(5);
    expect(DocumentState.fromText(disabled.value.text).sheets[0].getSheetNote('beforeTable').blocks).toHaveLength(0);
  });
  it("prepares unsupported Excel formulas as text and requires explicit loss consent", async () => {
    const bytes=await writeXlsx({sheets:[{name:'Data',rows:[[{formula:'TODAY()',value:123}],[{formula:'TODAY()',value:124}],[{formula:'FUTURE(1)',value:125}]]}]},DEFAULT_EXCEL_LIMITS);
    const result=await convertImport({name:'unsupported.xlsx',bytes},'text');
    if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.preview[0].cells).toEqual([['=TODAY()'],['=TODAY()'],['=FUTURE(1)']]);
    expect(requiresImportConsent(result.diagnostics)).toBe(true);
    const notes=groupDiagnostics(result.diagnostics);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({title:'Formulas kept as text',count:2});
    expect(notes[1]).toMatchObject({title:'Formulas kept as text',count:1});
  });
  it("distinguishes optional presentation notes from import losses requiring consent",()=>{
    expect(requiresImportConsent([{code:'presentation_omitted',severity:'warning',message:'Borders omitted'}])).toBe(false);
    for(const code of ['external_content_removed','import_content_omitted','formula_preserved_as_text'] as const)
      expect(requiresImportConsent([{code,severity:'warning',message:'Changed'}])).toBe(true);
  });
  it("previews CSV and applies explicit row/column headers without changing the input file", async () => {
    const file={name:'data.csv',bytes:bytes('Name,Amount\nFirst,12\nSecond,24\nThird,36')};
    const preview=await convertImport(file,'infer');
    if(!preview.ok)throw new Error('Import failed');
    expect(preview.value.preview[0]).toMatchObject({headerRows:0,headerColumns:0,rows:4,columns:2,cells:[['Name','Amount'],['First','12'],['Second','24'],['Third','36']]});
    const result=await convertImport(file,'infer',[{sheetName:'Imported',headerRows:1,headerColumns:1}]);
    if(!result.ok)throw new Error('Import failed');
    const sheet=DocumentState.fromText(result.value.text).sheets[0];
    expect([sheet.headerRowCount,sheet.headerColCount]).toEqual([1,1]);
    const reset=await convertImport(file,'infer',[{sheetName:'Imported',headerRows:0,headerColumns:0}]);
    expect(reset).toEqual(preview);
  });
  it("keeps independent per-sheet settings and bounds preview size",async()=>{
    const source='# One\n| "Name" | "Amount" |\n| "A" | 12 |\n# Two\n'+Array.from({length:20},(_,r)=>'| '+Array.from({length:10},(_,c)=>String(r+c)).join(' | ')+' |').join('\n');
    const excel=await convertExport(source,'xlsx','Example',null,false);
    if(!excel.ok)throw new Error('Export failed');
    const result=await convertImport(excel.value,'text',[{sheetName:'One',headerRows:1,headerColumns:1},{sheetName:'Two',headerRows:0,headerColumns:0}]);
    if(!result.ok)throw new Error('Import failed');
    expect(result.value.preview[0]).toMatchObject({headerRows:1,headerColumns:1});
    expect(result.value.preview[1]).toMatchObject({headerRows:0,headerColumns:0,rows:20,columns:10});
    expect(result.value.preview[1].cells).toHaveLength(12);
    expect(result.value.preview[1].cells[0]).toHaveLength(8);
  });
  it("retains supported XLSX styles through the shared browser/desktop source adapter", async () => {
    const result = await convertExport('# Data\n| 12 {::bold,red,>} | "hello" {::blue,^} |', "xlsx", "Styled", null, false);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const imported = await convertImport(result.value, "text");
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const cells = resolveDocumentPresentation(DocumentState.fromText(imported.value.text)).sheets[0].cells[0];
    expect(cells[0].styleLayer.effective).toEqual({ align: "right", weight: "bold", color: "red" });
    expect(cells[1].styleLayer.effective).toEqual({ align: "center", weight: null, color: "blue" });
  });
  it.each(["csv", "tsv"] as const)("imports %s identifiers as text unless inference is selected", async format => {
    const file = { name: `source.${format}`, bytes: bytes(["0012", "true", "=1+1"].join(format === "csv" ? "," : "\t")) };
    const text = await convertImport(file, "text");
    expect(text.ok).toBe(true);
    if (!text.ok) throw new Error("Expected successful import");
    expect(DocumentState.fromText(text.value.text).evaluate().sheets[0].values[0]).toEqual([
      { kind: "string", value: "0012" }, { kind: "string", value: "true" }, { kind: "string", value: "=1+1" },
    ]);
    const inferred = await convertImport({ ...file, bytes: bytes(`12${format === "csv" ? "," : "\t"}true`) }, "infer");
    if (!inferred.ok) throw new Error("Expected successful inference");
    expect(DocumentState.fromText(inferred.value.text).evaluate().sheets[0].values[0]).toEqual([
      { kind: "number", value: 12 }, { kind: "boolean", value: true },
    ]);
  });
  it("rejects invalid UTF-8 instead of inserting replacement characters", async () => {
    await expect(convertImport({ name: "broken.csv", bytes: new Uint8Array([0xff]) }, "text")).rejects.toThrow();
  });
  it("does not offer an imported document after malformed CSV", async () => {
    const result = await convertImport({ name: "broken.csv", bytes: bytes('"unterminated') }, "text");
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
    expect(result.diagnostics.some(item => item.severity === "error")).toBe(true);
  });
  it.each(["csv", "tsv"] as const)("exports only the selected %s sheet with calculated values and notes", async format => {
    const result = await convertExport(report, format, "Budget.ord", "Inputs", false);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.name).toBe(`Budget - Inputs.${format}`);
    expect(result.value.bytes.slice(0, 3)).toEqual(new Uint8Array([239, 187, 191]));
    expect(new TextDecoder().decode(result.value.bytes)).toBe(["2", "3", "6"].join(format === "csv" ? "," : "\t") + "\r\n");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "formulas_as_values" }));
  });
  it("preserves multiline text and CSV quoting", async () => {
    const result = await convertExport(report, "csv", "Budget.ord", "Notes", false);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(new TextDecoder().decode(result.value.bytes)).toBe('"hello, world","two\nlines"\r\n');
  });
  it.each(["csv", "tsv"] as const)("keeps errors as readable text in %s without blocking export", async format => {
    const result = await convertExport('# Data\n| 42 | = "x"*2 | = 1/0 |', format, "Budget", "Data", false);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(new TextDecoder().decode(result.value.bytes)).toBe(["42", "Type Error", "Divide by Zero"].join(format === "csv" ? "," : "\t") + "\r\n");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"errors_as_text", severity:"warning",count:2}));
  });
  it("fails on a missing sheet rather than exporting another sheet", async () => {
    await expect(convertExport(report, "csv", "Budget", null, false)).rejects.toThrow("Choose a sheet");
    expect((await convertExport(report, "csv", "Budget", "Missing", false)).ok).toBe(false);
  });
  it("requires explicit consent before preserving executable-looking text", async () => {
    const source = '# Data\n| "=1+1" |';
    const blocked = await convertExport(source, "csv", "Budget", "Data", false);
    expect(blocked.ok).toBe(false);
    expect(blocked).not.toHaveProperty("value");
    const allowed = await convertExport(source, "csv", "Budget", "Data", true);
    if (!allowed.ok) throw new Error(JSON.stringify(allowed.diagnostics));
    expect(new TextDecoder().decode(allowed.value.bytes)).toContain("=1+1");
    expect(allowed.diagnostics.some(item => item.severity === "warning")).toBe(true);
  });
  it("copies ORD source byte-for-byte, including invalid drafts", async () => {
    const raw = '---\nfuture: yes\n---\n# Incomplete\n| = sum( |';
    const result = await convertExport(raw, "ord", "Budget.ord", null, false);
    expect(result).toEqual({ ok: true, diagnostics: [], value: { name: "Budget copy.ord", format: "ord", bytes: bytes(raw) } });
  });
  it("exports every XLSX sheet and imports supported executable formulas", async () => {
    const result = await convertExport(report, "xlsx", "Budget.ord", "Notes", false);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.bytes.slice(0, 2)).toEqual(bytes("PK"));
    const imported = await convertImport(result.value, "text");
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    expect(imported.value.sheets).toEqual(["Inputs", "Notes"]);
    expect(imported.value.text).toContain("=");
    expect(DocumentState.fromText(imported.value.text).evaluate().sheets[0].values[0][2]).toEqual({ kind: "number", value: 6 });
  });
  it("leaves unsupported formulas blank and reports their location", async () => {
    const result = await convertExport('# Data\n| = len(trim(" word ")) |', "xlsx", "Budget", null, false);
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty("value");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "cell_omitted", severity: "warning", sheetName: "Data", rowIndex: 0, colIndex: 0 }));
  });
  it("exports Excel despite runtime errors in the document", async () => {
    const result = await convertExport('# Data\n| = 1/0 | = "x" * 2 | 42 |', "xlsx", "Budget", null, false);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter(item => item.code === "cell_omitted")).toHaveLength(2);
  });
  it("returns diagnostics for corrupt Excel bytes without adopting a document", async () => {
    const result = await convertImport({ name: "broken.xlsx", bytes: bytes("Not a workbook") }, "text");
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });
  it("groups repeated notes without hiding the first location or total occurrences", () => {
    const note = { code: "formulas_as_values" as const, severity: "warning" as const, message: "Converted", sheetName: "Data", rowIndex: 1, colIndex: 26, count: 2 };
    const groups = groupDiagnostics([note, { ...note, count: 3, rowIndex: 8 }]);
    expect(groups).toEqual([{ item: note, title: "Warning", count: 5, messages: ["Converted"], sheets: ["Data"] }]);
    expect(diagnosticLocation(groups[0].item)).toBe("Data · AA2");
  });
  it("consolidates categories while retaining every distinct reason and keeping errors separate", () => {
    const notes = [
      { code: "presentation_omitted" as const, severity: "warning" as const, message: "Borders omitted.", sheetName: "One", count: 400 },
      { code: "presentation_omitted" as const, severity: "warning" as const, message: "Borders omitted.", sheetName: "Two" },
      { code: "presentation_approximated" as const, severity: "warning" as const, message: "Colors approximated.", sheetName: "Two" },
      { code: "unsupported_formula" as const, severity: "error" as const, message: "Unsupported function.", sheetName: "Two", rowIndex: 2, colIndex: 3 },
      { code: "cached_value_ignored" as const, severity: "warning" as const, message: "Recalculated." },
      { code: "semantic_difference" as const, severity: "warning" as const, message: "Native calculation rules." },
      { code: "cell_omitted" as const, severity: "warning" as const, message: "Cell left blank.", sheetName: "Two", rowIndex: 4, colIndex: 5 },
    ];
    const groups = groupDiagnostics(notes);
    expect(groups).toHaveLength(4);
    expect(groups[0]).toMatchObject({ title: "Cannot convert", item: notes[3] });
    expect(groups[1]).toMatchObject({ title: "Formatting", count: 402, sheets: ["One", "Two"], messages: ["Borders omitted.", "Colors approximated."] });
    expect(groups[2]).toMatchObject({ title: "Formula results", messages: ["Recalculated.", "Native calculation rules."] });
    expect(groups[3]).toMatchObject({ title: "Cell omitted", item: notes[6] });
  });
});

describe("transport preflight", () => {
  it.each(["csv", "tsv", "xlsx"])("accepts case-insensitive %s filenames", format => {
    expect(importFormat(`BUDGET.${format.toUpperCase()}`)).toBe(format);
  });
  it.each(["file.xls", "file.ord", "file.pdf", "file.csv.exe"])("rejects unsupported %s", name => {
    expect(() => importFormat(name)).toThrow();
  });
  it("bounds input before reading and output before showing a save panel", () => {
    expect(() => validateImport("file.csv", 16_777_216)).not.toThrow();
    expect(() => validateImport("file.csv", 16_777_217)).toThrow("too large");
    expect(() => validateImport("file.csv", -1)).toThrow();
    expect(() => validateExport({ name: "file.csv", format: "csv", bytes: bytes("1") })).not.toThrow();
    expect(() => validateExport({ name: "file.xlsx", format: "csv", bytes: bytes("1") })).toThrow();
    expect(() => validateExport({ name: "../file.csv", format: "csv", bytes: bytes("1") })).toThrow();
  });
  it("keeps meaningful dots in names and removes unsafe path characters", () => {
    expect(exportName("Plan v1.2.ord", "xlsx")).toBe("Plan v1.2.xlsx");
    expect(exportName("Budget - Q1.2", "csv")).toBe("Budget - Q1.2.csv");
    expect(exportName("North/South", "csv")).toBe("North-South.csv");
  });
});
