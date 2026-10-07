// File transport only. No editor state, filesystem paths or XLSX library types.
export const FORMATS = {
  xlsx: { label: "Excel workbook", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", description: "All sheets · editable, supported formulas", maxInput: 16_777_216 },
  csv: { label: "CSV", mime: "text/csv", description: "One sheet · calculated values", maxInput: 16_777_216 },
  tsv: { label: "TSV", mime: "text/tab-separated-values", description: "One sheet · calculated values", maxInput: 16_777_216 },
  ord: { label: "Ordinate copy", mime: "text/plain", description: "Native document · keeps formulas and structure", maxInput: 16_777_216 },
} as const;
export type ExportFormat = keyof typeof FORMATS;
export const IMPORT_FORMATS = ["csv", "tsv", "xlsx"] as const;
export type ImportFormat = typeof IMPORT_FORMATS[number];
export type ImportFile = { name: string; bytes: Uint8Array };
export type ExportFile = { name: string; format: ExportFormat; bytes: Uint8Array };
export const MAX_EXPORT_BYTES = 67_108_864;
export interface InterchangeTransport {
  pickImport(): Promise<ImportFile | null>;
  saveExport(file: ExportFile): Promise<"saved" | "downloaded" | null>;
}
export function importFormat(name: string): ImportFormat {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (!IMPORT_FORMATS.includes(extension as ImportFormat)) throw new Error("Choose a .csv, .tsv or .xlsx file. Use Open for .ord documents.");
  return extension as ImportFormat;
}
export function validateImport(name: string, size: number): ImportFormat {
  const format = importFormat(name);
  if (!Number.isSafeInteger(size) || size < 0 || size > FORMATS[format].maxInput) throw new Error("This file is too large to import (maximum 16 MiB).");
  return format;
}
export function importedDocumentName(name: string): string {
  importFormat(name);
  const stem = name.replace(/\.(csv|tsv|xlsx)$/i, "").trim();
  return stem || name;
}
export function validateExport(file: ExportFile): void {
  if (!file || !Object.hasOwn(FORMATS, file.format) || typeof file.name !== "string"
    || !file.name || /[/\\\u0000-\u001f]/.test(file.name) || !file.name.toLowerCase().endsWith(`.${file.format}`)
    || !(file.bytes instanceof Uint8Array) || file.bytes.length > MAX_EXPORT_BYTES) throw new Error("Invalid export file.");
}
export function exportName(name: string, format: ExportFormat): string {
  const stem = name.replace(/\.(ord|xlsx|csv|tsv)$/i, "").replace(/[/\\\u0000-\u001f]/g, "-").trim() || "Untitled";
  return `${stem}${format === "ord" ? " copy" : ""}.${format}`;
}

export function delimitedExportName(name: string, format: "csv" | "tsv", sheetName: string): string {
  return exportName(`${name.replace(/\.ord$/i, "")} - ${sheetName}`, format);
}
