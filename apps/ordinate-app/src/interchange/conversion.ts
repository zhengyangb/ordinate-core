import { DocumentState, importDelimitedDocument, exportDelimitedSheet, serializeDocumentState, configureImportedDocument, resolveDocumentPresentation, getCellTextView,
  prepareExcelImport, importPreparedExcelWorkbook, excelImportNoteCandidates,
  type PreparedExcelImport, type ExcelNoteCandidate, type ExcelNoteChoice,
  type ImportSheetHeaders, type DelimitedDiagnostic, type ExcelDiagnostic, type ExcelExportOptions } from "@ordinate/core";
import { delimitedExportName, exportName, validateImport, type ExportFile, type ExportFormat, type ImportFile } from "./contracts";
import { toColumnLetters } from "../utils/appHelpers";

export type ConversionDiagnostic = DelimitedDiagnostic | ExcelDiagnostic;
export type Review<T> = { ok: true; value: T; diagnostics: ConversionDiagnostic[] } | { ok: false; diagnostics: ConversionDiagnostic[] };
export interface ImportSheetPreview extends ImportSheetHeaders { rows: number; columns: number; cells: string[][] }
export interface PreparedImport { text: string; sheets: string[]; preview: ImportSheetPreview[]; noteCandidates: ExcelNoteCandidate[]; notes: ExcelNoteChoice[] }
export type ImportSource = {kind:"excel"; source:PreparedExcelImport} | {kind:"delimited"; document:DocumentState; diagnostics:ConversionDiagnostic[]};
export async function prepareImportSource(file: ImportFile, valueMode: "text" | "infer"): Promise<Review<ImportSource>> {
  const format = validateImport(file.name, file.bytes.length);
  if (format === "xlsx") {
    const result=await prepareExcelImport(file.bytes,{unsupportedContent:"preserve-text"});
    return result.ok ? {...result,value:{kind:"excel",source:result.value}} : result;
  }
  const result=importDelimitedDocument(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes), { format, sheetName: "Imported", valueMode });
  return result.ok ? {...result,value:{kind:"delimited",document:result.value,diagnostics:result.diagnostics}} : result;
}
export async function configureImport(source:ImportSource, headers?:ImportSheetHeaders[], notes?:ExcelNoteChoice[]):Promise<Review<PreparedImport>> {
  const noteCandidates = source.kind === "excel" ? excelImportNoteCandidates(source.source) : [];
  // Defaults belong to the prepared conversion, not just the controls: the first
  // preview and imported bytes must already reflect the selected note regions.
  const selectedNotes = notes ?? defaultImportNotes(noteCandidates);
  const result=source.kind==="excel" ? await importPreparedExcelWorkbook(source.source,{headers,notes:selectedNotes,unsupportedContent:"preserve-text"})
    : {ok:true as const,value:configureImportedDocument(source.document,headers),diagnostics:source.diagnostics};
  if (!result.ok) return result;
  const document = result.value;
  const presentation = resolveDocumentPresentation(document);
  const preview = document.sheets.map((sheet, s): ImportSheetPreview => ({
    sheetName:sheet.name, headerRows:sheet.headerRowCount, headerColumns:sheet.headerColCount,
    rows:sheet.rowCount, columns:sheet.colCount,
    cells:sheet.cells.slice(0,12).map((row,r) => row.slice(0,8).map((cell,c) =>
      r < sheet.bodyStart ? getCellTextView(cell).inputText : presentation.sheets[s].cells[r-sheet.bodyStart][c].displayText)),
  }));
  return {ok:true, value:{text:serializeDocumentState(document), sheets:document.sheets.map(sheet=>sheet.name), preview,
    noteCandidates, notes:selectedNotes}, diagnostics:result.diagnostics};
}
export function defaultImportNotes(candidates: ExcelNoteCandidate[]): ExcelNoteChoice[] {
  const choices = new Map<string, ExcelNoteChoice>();
  for (const candidate of candidates) {
    if (candidate.unavailableReason) continue;
    const choice = choices.get(candidate.sheetName) ?? { sheetName:candidate.sheetName, beforeRows:0, afterRows:0 };
    choice[candidate.position === "beforeTable" ? "beforeRows" : "afterRows"] = candidate.rowCount;
    choices.set(candidate.sheetName, choice);
  }
  return [...choices.values()];
}
export async function convertImport(file: ImportFile, valueMode: "text" | "infer", headers?: ImportSheetHeaders[], notes?:ExcelNoteChoice[]): Promise<Review<PreparedImport>> {
  const prepared=await prepareImportSource(file,valueMode);
  return prepared.ok ? configureImport(prepared.value,headers,notes) : prepared;
}
export function describeExcelExport(source: string, name: string) {
  const document = DocumentState.fromText(source);
  return { name: exportName(name, "xlsx"), sheetCount: document.sheets.length,
    headerSheetCount: document.sheets.filter(sheet => sheet.headerRowCount > 0 || sheet.headerColCount > 0).length };
}
export async function convertExport(source: string, format: ExportFormat, name: string, sheetName: string | null, preserveFormulaText: boolean,
  excelOptions: Pick<ExcelExportOptions, "freezeHeaders" | "unsupportedFormulas"> = {}): Promise<Review<ExportFile>> {
  if (format === "ord") return { ok: true, value: { name: exportName(name, format), format, bytes: new TextEncoder().encode(source) }, diagnostics: [] };
  const document = DocumentState.fromText(source);
  if (format === "xlsx") {
    const result = await (await import("@ordinate/core")).exportExcelWorkbook(document, { cellErrors: "blank", ...excelOptions });
    return result.ok ? { ...result, value: { name: exportName(name, format), format, bytes: result.value } } : result;
  }
  if (!sheetName) throw new Error("Choose a sheet to export.");
  const result = exportDelimitedSheet(document, { format, sheetName, formulaLikeText: preserveFormulaText ? "preserve" : "reject", bom: true });
  return result.ok ? { ...result, value: { name: delimitedExportName(name, format, sheetName), format, bytes: new TextEncoder().encode(result.value.text) } } : result;
}
export function diagnosticLocation(item: ConversionDiagnostic): string {
  const column = item.colIndex === undefined ? "" : toColumnLetters(item.colIndex + 1);
  const address = item.rowIndex === undefined ? column : `${column || "Row "}${item.rowIndex + 1}`;
  return [item.sheetName, address].filter(Boolean).join(" · ");
}
export function requiresImportConsent(items: ConversionDiagnostic[]): boolean {
  return items.some(item => ["formula_preserved_as_text", "external_content_removed", "import_content_omitted"].includes(item.code));
}
export function groupDiagnostics(items: ConversionDiagnostic[]) {
  const groups = new Map<string, { item: ConversionDiagnostic; title: string; count: number; messages: string[]; sheets: string[] }>();
  for (const item of items) {
    // Consolidate presentation and calculation notes, never mix losses with
    // fatal errors or hide the distinct reasons in a collapsed details panel.
    const category = item.severity === "error" ? null
      : item.code === "formula_preserved_as_text" ? "Formulas kept as text"
      : item.code === "formula_exported_as_value" ? "Formulas converted to values"
      : item.code === "external_content_removed" ? "External connections removed"
      : item.code === "import_content_omitted" ? "Content not retained"
      : ["presentation_omitted", "presentation_approximated"].includes(item.code) ? "Formatting"
      : ["cached_value_ignored", "semantic_difference"].includes(item.code) ? "Formula results"
      : item.code === "metadata_omitted" ? "Other content" : null;
    const key = item.code === "formula_preserved_as_text" ? `${category}:${item.message}`
      : category ?? `${item.severity}:${item.code}:${item.message}`;
    const group = groups.get(key);
    if (group) {
      group.count += item.count ?? 1;
      if (!group.messages.includes(item.message)) group.messages.push(item.message);
      if (item.sheetName && !group.sheets.includes(item.sheetName)) group.sheets.push(item.sheetName);
    } else groups.set(key, { item, title: category ?? (item.severity === "error" ? "Cannot convert" : item.code === "cell_omitted" ? "Cell omitted" : "Warning"),
      count: item.count ?? 1, messages: [item.message], sheets: item.sheetName ? [item.sheetName] : [] });
  }
  return [...groups.values()].sort((a, b) => Number(b.item.severity === "error") - Number(a.item.severity === "error"));
}
