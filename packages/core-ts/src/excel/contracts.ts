/** No XLSX library types may cross the public boundary. */
export interface ExcelLimits {
  maxInputBytes: number;
  maxExpandedBytes: number;
  maxArchiveEntries: number;
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxFormulaLength: number;
  maxFormulaDepth: number;
}

/** XLSX's coordinate space, independent of the caller's smaller resource budget. */
export const EXCEL_GRID_LIMITS = Object.freeze({ rows: 1_048_576, columns: 16_384 });

export const DEFAULT_EXCEL_LIMITS: Readonly<ExcelLimits> = Object.freeze({
  maxInputBytes: 16_777_216,
  maxExpandedBytes: 67_108_864,
  maxArchiveEntries: 10_000,
  maxSheets: 100,
  maxRows: 100_000,
  maxColumns: EXCEL_GRID_LIMITS.columns,
  maxCells: 1_000_000,
  maxFormulaLength: 8_192,
  maxFormulaDepth: 64,
});

export type ExcelDiagnosticCode =
  | "invalid_options" | "invalid_workbook" | "limit_exceeded" | "unsupported_feature"
  | "unsupported_formula" | "formula_syntax" | "invalid_sheet_name" | "invalid_reference"
  | "unrepresentable_value" | "presentation_omitted" | "presentation_approximated" | "metadata_omitted"
  | "semantic_difference" | "cached_value_ignored" | "cell_omitted"
  | "formula_preserved_as_text" | "formula_exported_as_value" | "external_content_removed" | "import_content_omitted";

/** A declared lossy conversion, never a catch-all recovery from corrupt input. */
export type UnsupportedContent = "reject" | "preserve-text";

export interface ExcelDiagnostic {
  code: ExcelDiagnosticCode;
  severity: "error" | "warning";
  message: string;
  sheetName?: string;
  rowIndex?: number;
  colIndex?: number;
  formula?: string;
  offset?: number;
  count?: number;
}

export type ExcelResult<T> =
  | { ok: true; value: T; diagnostics: ExcelDiagnostic[] }
  | { ok: false; diagnostics: ExcelDiagnostic[] };

export interface ExcelOptions { limits?: Partial<ExcelLimits> }
export interface ExcelExportOptions extends ExcelOptions {
  /** Blank failed/unsupported cells with located warnings; never substitute caches. */
  cellErrors?: "reject" | "blank";
  /** Explicit projection of an untranslatable, successfully evaluated formula to
   * a literal. Never use imported caches, swallow errors or resource failures. */
  unsupportedFormulas?: "reject" | "value";
  /** Freeze each sheet's existing header bands. Off unless explicitly selected. */
  freezeHeaders?: boolean;
}

export function excelExportOptions(options: ExcelExportOptions): { limits: ExcelLimits; cellErrors: "reject" | "blank"; unsupportedFormulas: "reject" | "value"; freezeHeaders: boolean } {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(key => !["limits", "cellErrors", "unsupportedFormulas", "freezeHeaders"].includes(key))
    || (options.cellErrors !== undefined && options.cellErrors !== "reject" && options.cellErrors !== "blank")
    || (options.unsupportedFormulas !== undefined && !["reject", "value"].includes(options.unsupportedFormulas))
    || (options.freezeHeaders !== undefined && typeof options.freezeHeaders !== "boolean")) {
    throw new ExcelFailure("invalid_options", "Expected limits, cellErrors: reject or blank, unsupportedFormulas: reject or value, and boolean freezeHeaders.");
  }
  return { limits: excelLimits({ limits: options.limits }), cellErrors: options.cellErrors ?? "reject", unsupportedFormulas: options.unsupportedFormulas ?? "reject", freezeHeaders: options.freezeHeaders ?? false };
}
export type ExcelLocation = Pick<ExcelDiagnostic, "sheetName" | "rowIndex" | "colIndex" | "formula" | "offset">;

export class ExcelFailure extends Error {
  readonly diagnostic: ExcelDiagnostic;
  constructor(code: ExcelDiagnosticCode, message: string, location: ExcelLocation = {}) {
    super(message);
    this.name = "ExcelFailure";
    this.diagnostic = { code, severity: "error", message, ...location };
  }
}

export function excelLimits(options: ExcelOptions = {}): ExcelLimits {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => k !== "limits")) {
    throw new ExcelFailure("invalid_options", "Expected only an optional limits object.");
  }
  const overrides = options.limits === undefined ? {} : options.limits;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new ExcelFailure("invalid_options", "limits must be an object.");
  }
  const limits = { ...DEFAULT_EXCEL_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(limits, key) || !Number.isSafeInteger(value) || value <= 0) {
      throw new ExcelFailure("invalid_options", `Invalid Excel limit: ${key}.`);
    }
    limits[key as keyof ExcelLimits] = value;
  }
  return limits;
}

export class ExcelReport {
  readonly diagnostics: ExcelDiagnostic[] = [];
  private readonly grouped = new Map<string, ExcelDiagnostic>();
  private readonly uniqueWarnings = new Set<string>();
  constructor(private readonly consolidate = false) {}
  /** Several stages may observe the same loss in one cell. Count the loss,
   * not how many subexpressions or projection stages observed it. */
  warnOnce(code: ExcelDiagnosticCode, message: string, location: ExcelLocation): void {
    const key = JSON.stringify([code, message, location.sheetName, location.rowIndex, location.colIndex]);
    if (this.uniqueWarnings.has(key)) return;
    this.uniqueWarnings.add(key);
    this.warn(code, message, location);
  }
  warn(code: ExcelDiagnosticCode, message: string, location: ExcelLocation = {}): void {
    if (!this.consolidate) { this.diagnostics.push({code,severity:"warning",message,...location}); return; }
    // Keep the first location and a count; do not allocate one notice per styled cell.
    const key = JSON.stringify([code, message, location.sheetName]);
    const previous = this.grouped.get(key);
    if (previous) previous.count = (previous.count ?? 1) + 1;
    else {
      const diagnostic: ExcelDiagnostic = { code, severity: "warning", message, ...location };
      this.grouped.set(key, diagnostic);
      this.diagnostics.push(diagnostic);
    }
  }
  merge(diagnostics: readonly ExcelDiagnostic[]): void {
    for (const item of diagnostics) {
      if (item.severity === "error" || !this.consolidate) { this.diagnostics.push({...item}); continue; }
      const { code, message, count, severity: _severity, ...location } = item;
      this.warn(code, message, location);
      if ((item.count ?? 1) > 1) {
        const key = JSON.stringify([item.code, item.message, item.sheetName]);
        const merged = this.grouped.get(key)!;
        merged.count = (merged.count ?? 1) + item.count! - 1;
      }
    }
  }
  async run<T>(operation: () => Promise<T>): Promise<ExcelResult<T>> {
    try {
      return { ok: true, value: await operation(), diagnostics: this.diagnostics };
    } catch (error) {
      if (!(error instanceof ExcelFailure)) throw error;
      return { ok: false, diagnostics: [...this.diagnostics, error.diagnostic] };
    }
  }
}
