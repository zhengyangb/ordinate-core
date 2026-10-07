/** Shared CSV / quoted-TSV transport. No document or formula semantics here. */
export type DelimitedFormat = "csv" | "tsv";

export interface DelimitedLimits {
  maxTextLength: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxFieldLength: number;
}

export const DEFAULT_DELIMITED_LIMITS: Readonly<DelimitedLimits> = Object.freeze({
  maxTextLength: 16_777_216,
  maxRows: 100_000,
  maxColumns: 10_000,
  maxCells: 1_000_000,
  maxFieldLength: 1_048_576,
});

export type DelimitedDiagnosticCode =
  | "invalid_options" | "invalid_input" | "syntax_error" | "ragged_rows" | "limit_exceeded"
  | "sheet_not_found" | "ambiguous_sheet" | "multiple_tables" | "errors_as_text" | "non_finite_number"
  | "formula_like_text" | "types_inferred" | "numeric_text_preserved" | "types_not_preserved"
  | "formulas_as_values" | "display_metadata_omitted" | "hierarchy_omitted" | "front_matter_omitted"
  | "sheet_content_omitted" | "null_as_empty";

export interface DelimitedDiagnostic {
  code: DelimitedDiagnosticCode;
  severity: "error" | "warning";
  message: string;
  sheetName?: string;
  rowIndex?: number;
  colIndex?: number;
  /** UTF-16 offset in original input, including an optional file BOM. */
  offset?: number;
  /** Aggregated warnings retain the first location and total occurrence count. */
  count?: number;
  limit?: keyof DelimitedLimits;
}

export type DelimitedResult<T> =
  | { ok: true; value: T; diagnostics: DelimitedDiagnostic[] }
  | { ok: false; diagnostics: DelimitedDiagnostic[] };

type Location = Pick<DelimitedDiagnostic, "sheetName" | "rowIndex" | "colIndex" | "offset">;

export class DelimitedFailure extends Error {
  readonly diagnostic: DelimitedDiagnostic;

  constructor(code: DelimitedDiagnosticCode, message: string, details: Location & { limit?: keyof DelimitedLimits } = {}) {
    super(message);
    this.name = "DelimitedFailure";
    this.diagnostic = { code, severity: "error", message, ...details };
  }
}

export function resolveDelimitedLimits(overrides: Partial<DelimitedLimits> = {}): DelimitedLimits {
  assertOptions(overrides, Object.keys(DEFAULT_DELIMITED_LIMITS), "limits");
  const limits = { ...DEFAULT_DELIMITED_LIMITS, ...overrides };
  for (const key of Object.keys(limits) as Array<keyof DelimitedLimits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      throw new DelimitedFailure("invalid_options", `${key} must be a positive safe integer.`);
    }
  }
  return limits;
}

export function assertOptions(value: unknown, keys: readonly string[], name = "options"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DelimitedFailure("invalid_options", `${name} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new DelimitedFailure("invalid_options", `Unknown ${name} key: ${key}.`);
  }
}

export function delimiterFor(format: DelimitedFormat): string {
  switch (format) {
    case "csv": return ",";
    case "tsv": return "\t";
    default: throw new DelimitedFailure("invalid_options", "format must be csv or tsv.");
  }
}

export function checkDelimitedLimit(actual: number, key: keyof DelimitedLimits, limits: DelimitedLimits, location: Location = {}): void {
  if (actual > limits[key]) {
    throw new DelimitedFailure("limit_exceeded", `${key} exceeds the limit of ${limits[key]}.`, { ...location, limit: key });
  }
}

export function parseDelimitedRecords(text: string, format: DelimitedFormat, limits: DelimitedLimits): string[][] {
  if (typeof text !== "string") throw new DelimitedFailure("invalid_input", "Input must be a decoded text string.");
  checkDelimitedLimit(text.length, "maxTextLength", limits);
  const delimiter = delimiterFor(format);
  const start = text.startsWith("\uFEFF") ? 1 : 0;
  if (start === text.length) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "start" | "unquoted" | "quoted" | "closed" = "start";
  let cellCount = 0;
  let endedRecord = false;
  const location = (offset: number): Location => ({ rowIndex: rows.length, colIndex: row.length, offset });
  const append = (value: string, offset: number) => {
    checkDelimitedLimit(field.length + value.length, "maxFieldLength", limits, location(offset));
    field += value;
  };
  const finishField = (offset: number) => {
    checkDelimitedLimit(row.length + 1, "maxColumns", limits, location(offset));
    checkDelimitedLimit(++cellCount, "maxCells", limits, location(offset));
    row.push(field);
    field = "";
    state = "start";
  };
  const finishRecord = (offset: number) => {
    checkDelimitedLimit(rows.length + 1, "maxRows", limits, location(offset));
    if (rows.length > 0 && row.length !== rows[0].length) {
      throw new DelimitedFailure("ragged_rows", `Expected ${rows[0].length} fields, received ${row.length}.`, {
        rowIndex: rows.length, colIndex: Math.min(row.length, rows[0].length), offset,
      });
    }
    rows.push(row);
    row = [];
  };

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') {
          append('"', i);
          i += 1;
        } else {
          state = "closed";
        }
      } else {
        append(char, i);
      }
      continue;
    }
    if (char === delimiter) {
      finishField(i);
      endedRecord = false;
    } else if (char === "\r" || char === "\n") {
      finishField(i);
      finishRecord(i);
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endedRecord = true;
    } else {
      endedRecord = false;
      if (state === "closed") {
        throw new DelimitedFailure("syntax_error", "Only a delimiter or record ending may follow a closing quote.", location(i));
      }
      if (char === '"') {
        if (state !== "start") {
          throw new DelimitedFailure("syntax_error", "A quote must start a field, or be doubled inside a quoted field.", location(i));
        }
        state = "quoted";
      } else {
        append(char, i);
        state = "unquoted";
      }
    }
  }
  if (state === "quoted") throw new DelimitedFailure("syntax_error", "Quoted field is not closed.", location(text.length));
  if (!endedRecord) {
    finishField(text.length);
    finishRecord(text.length);
  }
  return rows;
}

export function encodeDelimitedRecords(
  rows: readonly (readonly string[])[],
  format: DelimitedFormat,
  lineEnding: "\r\n" | "\n",
  bom: boolean,
  limits: DelimitedLimits,
): string {
  const delimiter = delimiterFor(format);
  const parts: string[] = [];
  let length = 0;
  const append = (text: string) => {
    checkDelimitedLimit(length + text.length, "maxTextLength", limits);
    parts.push(text);
    length += text.length;
  };
  if (bom) append("\uFEFF");
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    for (let c = 0; c < row.length; c += 1) {
      const field = row[c];
      checkDelimitedLimit(field.length, "maxFieldLength", limits, { rowIndex: r, colIndex: c });
      if (c > 0) append(delimiter);
      const quote = field === "" || field.includes(delimiter) || /["\r\n]/.test(field) ||
        (r === 0 && c === 0 && field.startsWith("\uFEFF"));
      append(quote ? `"${field.replace(/"/g, '""')}"` : field);
    }
    append(lineEnding);
  }
  return parts.join("");
}
