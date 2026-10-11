import { importExcelWorkbook, type ExcelImportOptions } from "./excel";
import { importDelimitedDocument } from "./delimited";
import { configureImportedDocument, ImportHeaderError, type ImportSheetHeaders } from "./import_layout";
import { serializeDocumentState } from "./serializer";
import { validateDocument } from "./validator";
import { workbookSourceRevision, type CandidateSource, type CapabilityDiagnostic, type CapabilityResult } from "./workbook_capabilities";

export type WorkbookImportRequest =
  | ({ format: "xlsx" } & Pick<ExcelImportOptions, "headers" | "notes" | "unsupportedContent">)
  | { format: "csv" | "tsv"; sheetName: string; valueMode?: "text" | "infer"; headers?: ImportSheetHeaders[] };

export type WorkbookImportReport = { sheetCount: number; candidate: CandidateSource };
export type WorkbookImportResult = CapabilityResult<WorkbookImportReport>;

const INPUT_LIMIT = 16 * 1024 * 1024;
class InvalidDelimitedEncoding extends Error {}
function decodeDelimited(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) {
    if (error instanceof TypeError) throw new InvalidDelimitedEncoding("Delimited input is not valid UTF-8.");
    throw error;
  }
}
function requestError(message: string): never { throw new TypeError(message); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) requestError(`Unknown import option '${unexpected}'.`);
}
function decodeRequest(value: unknown): WorkbookImportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) requestError("Import request must be an object.");
  const request = value as Record<string, unknown>;
  if (request.format === "xlsx") {
    keys(request, ["format", "headers", "notes", "unsupportedContent"]);
    if (request.headers !== undefined && !Array.isArray(request.headers)) requestError("headers must be an array.");
    if (request.notes !== undefined && !Array.isArray(request.notes)) requestError("notes must be an array.");
    if (request.unsupportedContent !== undefined && !["reject", "preserve-text"].includes(String(request.unsupportedContent))) requestError("unsupportedContent must be reject or preserve-text.");
    return request as WorkbookImportRequest;
  }
  if (request.format === "csv" || request.format === "tsv") {
    keys(request, ["format", "sheetName", "valueMode", "headers"]);
    if (typeof request.sheetName !== "string" || !request.sheetName) requestError("Delimited import requires sheetName.");
    if (request.valueMode !== undefined && !["text", "infer"].includes(String(request.valueMode))) requestError("valueMode must be text or infer.");
    if (request.headers !== undefined && !Array.isArray(request.headers)) requestError("headers must be an array.");
    return request as WorkbookImportRequest;
  }
  return requestError("format must be xlsx, csv, or tsv.");
}
function diagnostics(items: readonly { code: string; severity: "warning" | "error"; message: string; sheetName?: string; rowIndex?: number; colIndex?: number; count?: number }[]): CapabilityDiagnostic[] {
  return items.map(({ code, severity, message, sheetName, rowIndex, colIndex, count }) => ({
    phase: "import", code, severity, message,
    ...(sheetName === undefined ? {} : { location: rowIndex !== undefined && colIndex !== undefined
      ? { kind: "cell" as const, sheet: sheetName, rowIndex, colIndex }
      : { kind: "sheet" as const, sheet: sheetName } }),
    ...(count === undefined ? {} : { details: { count } }),
  }));
}
async function inputRevision(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return `sha256:${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Shared, filesystem-free import capability for CLI and protocol adapters. */
export async function importWorkbook(bytes: Uint8Array, requestValue: unknown): Promise<WorkbookImportResult> {
  if (!(bytes instanceof Uint8Array) || bytes.length > INPUT_LIMIT) return {
    status: "rejected", sourceRevision: null, diagnostics: [],
    failure: { stage: "request", code: "limit_exceeded", message: `Input must be at most ${INPUT_LIMIT} bytes.` },
  };
  const sourceRevision = await inputRevision(bytes);
  let request: WorkbookImportRequest;
  try { request = decodeRequest(requestValue); }
  catch (error) { return { status: "rejected", sourceRevision, diagnostics: [], failure: { stage: "request", code: "invalid_request", message: String(error instanceof Error ? error.message : error) } }; }
  try {
    const imported = request.format === "xlsx"
      ? await importExcelWorkbook(bytes, { headers: request.headers, notes: request.notes, unsupportedContent: request.unsupportedContent })
      : importDelimitedDocument(decodeDelimited(bytes), {
          format: request.format, sheetName: request.sheetName, valueMode: request.valueMode,
        });
    const warnings = diagnostics(imported.diagnostics);
    if (!imported.ok) return { status: "rejected", sourceRevision, diagnostics: warnings, failure: { stage: "import", code: warnings.find(item => item.severity === "error")?.code ?? "import_failed", message: "Source could not be imported." } };
    const document = request.format === "xlsx" ? imported.value : configureImportedDocument(imported.value, request.headers);
    const source = serializeDocumentState(document);
    if (new TextEncoder().encode(source).length > INPUT_LIMIT) return {
      status: "rejected", sourceRevision, diagnostics: warnings,
      failure: { stage: "import", code: "limit_exceeded", message: "Imported workbook exceeds the 16 MiB source limit." },
    };
    const validation = validateDocument(source);
    if (!validation.ok) return {
      status: "rejected", sourceRevision, diagnostics: warnings,
      failure: { stage: "validation", code: "invalid_import_result", message: validation.errors.map(error => error.message).join("; ") },
    };
    const candidate = { source, revision: await workbookSourceRevision(source) };
    return { status: "completed", sourceRevision, diagnostics: warnings, data: { sheetCount: document.sheets.length, candidate } };
  }
  catch (error) {
    if (error instanceof ImportHeaderError)
      return { status: "rejected", sourceRevision, diagnostics: [], failure: { stage: "request", code: "invalid_request", message: error.message } };
    if (error instanceof InvalidDelimitedEncoding)
      return { status: "rejected", sourceRevision, diagnostics: [], failure: { stage: "import", code: "invalid_utf8", message: error.message } };
    throw error;
  }
}
