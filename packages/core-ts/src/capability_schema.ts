import { validateFormatSpec, describeDisplayMetadataDiagnostic } from "./runtime/displayMetadata";
import { parseFormatSpec } from "./runtime/formatting";
import { MAX_TEXT_LENGTH, MAX_FORMAT_PRECISION } from "./runtime/textLimits";
import type { FormatSpec, NumericFormatSpec } from "./runtime/types";
export const WORKBOOK_LIMITS = Object.freeze({ sourceBytes: 16 * 1024 * 1024, selectedCells: 10000, operations: 1000, editedCells: 10000 });
export class CapabilityRequestError extends Error {
  constructor(message: string, readonly code = "invalid_request") { super(message); }
}
type JsonSchema = Record<string, unknown>;
type Schema<T> = {
  parse(value: unknown, path: string): T;
  jsonSchema: JsonSchema;
  optional?: true;
};
type Infer<S> = S extends Schema<infer T> ? T : never;
type Shape = Record<string, Schema<unknown>>;
type ObjectType<S extends Shape> = {
  [K in keyof S as S[K] extends {
    optional: true;
  } ? never : K]: Infer<S[K]>;
} & {
  [K in keyof S as S[K] extends {
    optional: true;
  } ? K : never]?: Infer<S[K]>;
};
function reject(path: string, message: string): never { throw new CapabilityRequestError(`${path}: ${message}`); }
function scalar<T>(jsonSchema: JsonSchema, check: (v: unknown) => v is T): Schema<T> {
  return {
    jsonSchema, parse(v, p) {
      if (!check(v))
        reject(p, `expected ${JSON.stringify(jsonSchema)}`);
      return v;
    }
  };
}
const text = scalar<string>({ type: "string" }, (v): v is string => typeof v === "string");
const name = scalar<string>({ type: "string", minLength: 1, description: "Nonempty exact name, no surrounding whitespace" }, (v): v is string => typeof v === "string" && v.length > 0 && v.trim() === v);
const integer = scalar<number>({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, (v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
const boolean = scalar<boolean>({ type: "boolean" }, (v): v is boolean => typeof v === "boolean");
function enumeration<const T extends readonly (string | null)[]>(values: T): Schema<T[number]> {
  return scalar({ enum: values }, (v): v is T[number] => values.includes(v as T[number]));
}
function optional<T>(schema: Schema<T>): Schema<T> & {
  optional: true;
} { return { ...schema, optional: true }; }
function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return { jsonSchema: { anyOf: [schema.jsonSchema, {type:"null"}] }, parse(v,p) { return v === null ? null : schema.parse(v,p); } };
}
function boundedInteger(max: number): Schema<number> {
  return scalar({...integer.jsonSchema,maximum:max}, (v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max);
}
function array<T>(schema: Schema<T>, min: number = 1, max: number = WORKBOOK_LIMITS.operations): Schema<T[]> {
  return {
    jsonSchema: { type: "array", items: schema.jsonSchema, minItems: min, maxItems: max }, parse(v, p) {
      if (!Array.isArray(v))
        reject(p, "expected an array");
      if (v.length < min || v.length > max)
        throw new CapabilityRequestError(`${p}: array length must be ${min}..${max}`, v.length > max ? "limit_exceeded" : "invalid_request");
      return Array.from(v, (item, i) => schema.parse(item, `${p}[${i}]`));
    }
  };
}
function object<S extends Shape>(shape: S): Schema<ObjectType<S>> {
  return {
    jsonSchema: { type: "object", additionalProperties: false, properties: Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, s.jsonSchema])), required: Object.keys(shape).filter(k => !shape[k].optional) }, parse(v, p) {
      if (v === null || typeof v !== "object" || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        reject(p, "expected a plain object");
      const input = v as Record<string, unknown>;
      for (const k of Reflect.ownKeys(input))
        if (typeof k !== "string" || !Object.hasOwn(shape, k))
          reject(p, `unknown field ${String(k)}`);
      const out: Record<string, unknown> = {};
      for (const [k, s] of Object.entries(shape)) {
        if (!Object.hasOwn(input, k)) {
          if (!s.optional)
            reject(`${p}.${k}`, "required field");
        }
        else
          out[k] = s.parse(input[k], `${p}.${k}`);
      }
      return out as ObjectType<S>;
    }
  };
}
function tagged<S extends Record<string, Schema<unknown>>>(key: string, schemas: S): Schema<Infer<S[keyof S]>> {
  return {
    jsonSchema: { oneOf: Object.values(schemas).map(s => s.jsonSchema) }, parse(v, p) {
      if (v === null || typeof v !== "object" || Array.isArray(v))
        reject(p, "expected an object");
      const tag = (v as Record<string, unknown>)[key];
      if (typeof tag !== "string" || !Object.hasOwn(schemas, tag))
        reject(p, `unknown ${key}: ${String(tag)}`);
      return schemas[tag].parse(v, p) as Infer<S[keyof S]>;
    }
  };
}
const literal = <const T extends string>(v: T) => enumeration([v] as const);
const windowSchema = object({ start: integer, end: integer });
export type IndexWindow = Infer<typeof windowSchema>;
const rowSchema = tagged("kind", {
  index: object({ kind: literal("index"), index: integer }),
  path: object({ kind: literal("path"), path: array(name, 1, 1000) }),
});
const columnSchema = tagged("kind", {
  index: object({ kind: literal("index"), index: integer }),
  label: object({ kind: literal("label"), label: name }),
});
export type RowSelector = Infer<typeof rowSchema>;
export type ColumnSelector = Infer<typeof columnSchema>;
const cellSchema = object({ sheet: name, row: rowSchema, column: columnSchema });
const regionSchema = object({ sheet: name, rows: windowSchema, columns: windowSchema });
export type CellTarget = Infer<typeof cellSchema>;
export type RegionTarget = Infer<typeof regionSchema>;
const numericSchema = object({
  kind: literal("numeric"), sign: enumeration(["default", "plus", "parentheses"] as const),
  padWidth: nullable(boundedInteger(MAX_TEXT_LENGTH)), grouping: boolean,
  precision: nullable(boundedInteger(MAX_FORMAT_PRECISION)), type: enumeration(["f", "e", "%", "d", null] as const)
});
const temporalPattern = scalar<string>({ type: "string", minLength: 1, description: "Native temporal pattern, e.g. %Y-%m-%d, %F or %[h] hr; no surrounding whitespace. Not Excel date-format codes." }, (v): v is string => typeof v === "string" && v.length > 0 && v.trim() === v);
numericSchema.jsonSchema.description = "Numeric display only: f=fixed, e=scientific, %=percentage of a ratio, d=integer. All fields are required; null means unspecified. Example: precision:1,type:% displays 0.583 as 58.3%.";
const formatSchema = tagged("kind", { numeric: numericSchema, temporal: object({ kind: literal("temporal"), pattern: temporalPattern }) });
export type PortableFormatSpec = Infer<typeof formatSchema>;
const styleSchema = object({ align: optional(enumeration(["left", "right", "center", null] as const)), weight: optional(enumeration(["bold", "normal", null] as const)), color: optional(enumeration(["red", "green", "blue", null] as const)) });
styleSchema.jsonSchema.description = "Nonempty patch: omitted axes are preserved; explicit null clears an axis. A row default styles the body row without formatting each cell separately.";
styleSchema.jsonSchema.minProperties = 1;
export const WORKBOOK_OPERATION_SCHEMAS = {
  set_cell_input: object({ op: literal("set_cell_input"), target: cellSchema, input: text }),
  clear_cell: object({ op: literal("clear_cell"), target: cellSchema }),
  set_region: object({ op: literal("set_region"), target: regionSchema, values: array(array(text, 1, WORKBOOK_LIMITS.editedCells), 1, WORKBOOK_LIMITS.editedCells) }),
  clear_region: object({ op: literal("clear_region"), target: regionSchema }),
  fill_region: object({ op: literal("fill_region"), source: regionSchema, target: regionSchema, mode: enumeration(["auto", "copy", "series"] as const) }),
  set_cell_local_format: object({ op: literal("set_cell_local_format"), target: cellSchema, format: formatSchema }),
  clear_cell_local_format: object({ op: literal("clear_cell_local_format"), target: cellSchema }),
  set_cell_local_style: object({ op: literal("set_cell_local_style"), target: cellSchema, style: styleSchema }),
  clear_cell_local_style: object({ op: literal("clear_cell_local_style"), target: cellSchema }),
  set_row_default_format: object({ op: literal("set_row_default_format"), sheet: name, row: rowSchema, format: formatSchema }),
  clear_row_default_format: object({ op: literal("clear_row_default_format"), sheet: name, row: rowSchema }),
  set_row_default_style: object({ op: literal("set_row_default_style"), sheet: name, row: rowSchema, style: styleSchema }),
  clear_row_default_style: object({ op: literal("clear_row_default_style"), sheet: name, row: rowSchema }),
  set_column_default_format: object({ op: literal("set_column_default_format"), sheet: name, column: columnSchema, format: formatSchema }),
  clear_column_default_format: object({ op: literal("clear_column_default_format"), sheet: name, column: columnSchema }),
  set_column_default_style: object({ op: literal("set_column_default_style"), sheet: name, column: columnSchema, style: styleSchema }),
  clear_column_default_style: object({ op: literal("clear_column_default_style"), sheet: name, column: columnSchema }),
  set_sheet_note: object({ op: literal("set_sheet_note"), sheet: name, position: enumeration(["beforeTable", "afterTable"] as const), markdown: text }),
  insert_row: object({ op: literal("insert_row"), sheet: name, area: enumeration(["header", "body"] as const), rowGapIndex: integer, depth: integer }),
  delete_row: object({ op: literal("delete_row"), sheet: name, row: rowSchema, mode: enumeration(["node", "subtree"] as const) }),
  insert_column: object({ op: literal("insert_column"), sheet: name, colIndex: integer }),
  delete_column: object({ op: literal("delete_column"), sheet: name, column: columnSchema }),
  move_rows: object({ op: literal("move_rows"), sheet: name, rows: array(rowSchema), targetGapIndex: integer }),
  move_columns: object({ op: literal("move_columns"), sheet: name, columns: array(columnSchema), targetGapIndex: integer }),
  duplicate_rows: object({ op: literal("duplicate_rows"), sheet: name, rows: array(rowSchema), targetGapIndex: integer }),
  duplicate_columns: object({ op: literal("duplicate_columns"), sheet: name, columns: array(columnSchema), targetGapIndex: integer }),
  insert_sheet: object({ op: literal("insert_sheet"), name, sheetIndex: integer }),
  delete_sheet: object({ op: literal("delete_sheet"), sheet: name }),
  move_sheet: object({ op: literal("move_sheet"), sheet: name, targetGapIndex: integer }),
  rename_sheet: object({ op: literal("rename_sheet"), sheet: name, newName: name }),
};
export type WorkbookOperation = Infer<(typeof WORKBOOK_OPERATION_SCHEMAS)[keyof typeof WORKBOOK_OPERATION_SCHEMAS]>;
const operationSchema = tagged("op", WORKBOOK_OPERATION_SCHEMAS);
const revisionSchema = scalar<string>({ type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, (v): v is string => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v));
const editSchema = object({ baseRevision: revisionSchema, operations: array(operationSchema) });
export type EditRequest = Infer<typeof editSchema>;
const queryShape = { sheet: name, rows: optional(windowSchema), columns: optional(windowSchema) };
const querySchema = object({ ...queryShape, includeNotes: optional(boolean) });
const evaluationQuerySchema = object(queryShape);
const evaluationSchema = object({ query: optional(evaluationQuerySchema), materialize: optional(boolean) });
export type CellQuery = Infer<typeof querySchema>;
export type EvaluationOptions = Infer<typeof evaluationSchema>;
export function decodeCellQuery(value: unknown): CellQuery { return querySchema.parse(value, "query"); }
export function decodeEvaluationOptions(value: unknown): EvaluationOptions { return evaluationSchema.parse(value, "options"); }
export function decodeEditRequest(value: unknown): EditRequest {
  const request = editSchema.parse(value, "request");
  for (const op of request.operations) {
    if ("format" in op)
      decodePortableFormat(op.format);
    if ("style" in op && Object.keys(op.style).length === 0)
      reject("style", "empty patch");
  }
  return request;
}
export function decodePortableFormat(value: PortableFormatSpec): FormatSpec {
  if (value.kind === "temporal") {
    const parsed = parseFormatSpec(value.pattern);
    if ("issue" in parsed)
      reject("format.pattern", describeDisplayMetadataDiagnostic(parsed.issue));
    if (parsed.value.kind !== "temporal")
      reject("format.pattern", "expected a temporal pattern");
    return parsed.value;
  }
  const issue = validateFormatSpec(value as NumericFormatSpec);
  if (issue)
    reject("format", describeDisplayMetadataDiagnostic(issue));
  return value;
}
export function workbookEditSchema(): JsonSchema { return structuredClone(editSchema.jsonSchema); }
export function listWorkbookOperations(): {
  op: string;
  schema: JsonSchema;
}[] {
  return Object.entries(WORKBOOK_OPERATION_SCHEMAS).map(([op, s]) => ({ op, schema: structuredClone(s.jsonSchema) }));
}
