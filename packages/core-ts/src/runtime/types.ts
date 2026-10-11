export type ExternalErrorKind =
  | "generic"
  | "parse_error"
  | "type_error"
  | "div_by_zero"
  | "unresolved_reference"
  | "ambiguous_reference"
  | "cycle";

export interface ErrorRuntimeValue {
  kind: "error";
  errorKind: ExternalErrorKind | string;
  internalKind: string;
  context: Record<string, unknown>;
}

export interface Diagnostic {
  code: string;
  context: Record<string, unknown>;
}

export interface BlankRuntimeValue {
  kind: "blank";
  value: null;
}

export interface NullRuntimeValue {
  kind: "null";
  value: null;
}

export interface NumberRuntimeValue {
  kind: "number";
  value: number;
}

export interface StringRuntimeValue {
  kind: "string";
  value: string;
}

export interface BooleanRuntimeValue {
  kind: "boolean";
  value: boolean;
}

export interface DateRuntimeValue {
  kind: "date";
  value: string;
  isOffsetQualified: false;
}

export interface TimeRuntimeValue {
  kind: "time";
  value: string;
  isOffsetQualified: boolean;
}

export interface DatetimeRuntimeValue {
  kind: "datetime";
  value: string;
  isOffsetQualified: boolean;
}

export interface DurationRuntimeValue {
  kind: "duration";
  value: string;
}

export type RuntimeValue =
  | BlankRuntimeValue
  | NullRuntimeValue
  | NumberRuntimeValue
  | StringRuntimeValue
  | BooleanRuntimeValue
  | DateRuntimeValue
  | TimeRuntimeValue
  | DatetimeRuntimeValue
  | DurationRuntimeValue
  | ErrorRuntimeValue;

export interface RefSelector {
  kind: string;
  value?: unknown;
  /** Keep this axis fixed during copy/fill, not during structural edits. */
  copyFixed?: true;
}

export interface SheetRefSelector {
  kind: "sheet_name";
  value: string;
}

export type ReferenceStyle = "ordinate" | "spreadsheet";

export interface ReferenceExpr {
  sheetSelector?: SheetRefSelector;
  rowSelector: RefSelector;
  colSelector: RefSelector;
  style?: ReferenceStyle;
}

export interface ViewSelection {
  rowIndices: number[];
  colIndices: number[];
}

export interface RuntimeArray {
  kind: "array";
  values: RuntimeValue[];
}

export interface RuntimeView {
  kind: "view";
  rowCount: number;
  colCount: number;
  values: RuntimeValue[];
}

export type RuntimeCollection = RuntimeArray | RuntimeView;

export interface FunctionCall {
  name: string;
  args: ExprNode[];
}

export type IndexAxisExpr =
  | {
      kind: "scalar";
      value: ExprNode;
    }
  | {
      kind: "slice";
      start: ExprNode | null;
      end: ExprNode | null;
    };

export interface IndexExpr {
  target: ExprNode;
  axes: IndexAxisExpr[];
}

export interface ArrayExpr {
  rows: ExprNode[][];
  depth: 1 | 2;
}

export interface ExprNode {
  kind: string;
  /** Source notation only; evaluation and reference traversal use the ordinary tree. */
  sourceForm?: "f_string" | "f_concat" | "f_field";
  value?: unknown;
  left?: ExprNode | null;
  right?: ExprNode | null;
}

export type FormatSignPolicy = "default" | "plus" | "parentheses";
export type NumericFormatType = "f" | "e" | "%" | "d";
export type TemporalFormatDirective =
  | "literal_percent"
  | "year"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "fraction"
  | "offset_compact"
  | "offset_colon"
  | "date_iso"
  | "time_iso"
  | "duration_total_days"
  | "duration_total_hours"
  | "duration_total_minutes"
  | "duration_total_seconds"
  | "duration_total_milliseconds";
export type TextAlign = "left" | "right" | "center";
export type TextColor = "red" | "green" | "blue";
export type TextWeight = "bold" | "normal";

export interface NumericFormatSpec {
  kind: "numeric";
  sign: FormatSignPolicy;
  padWidth: number | null;
  grouping: boolean;
  precision: number | null;
  type: NumericFormatType | null;
}

export interface TemporalFormatToken {
  directive: TemporalFormatDirective;
  raw: string;
}

export interface TemporalFormatSpec {
  kind: "temporal";
  pattern: string;
  tokens: TemporalFormatToken[];
}

export type FormatSpec = NumericFormatSpec | TemporalFormatSpec;

export interface StyleSpec {
  align: TextAlign | null;
  weight: TextWeight | null;
  color: TextColor | null;
}

export type StylePatch = Partial<StyleSpec>;

export type ParsedDisplayMetadata = ValidDisplayMetadata | InvalidDisplayMetadata;

export interface ValidDisplayMetadata {
  valid: true;
  format: FormatSpec | null;
  style: StyleSpec | null;
}

export interface InvalidDisplayMetadata {
  valid: false;
  rawBlock: string;
  issue: Diagnostic;
}

export type CellBodyState = ValidLiteralCellBody | ValidFormulaCellBody | InvalidCellBody;

export interface ValidLiteralCellBody {
  valid: true;
  kind: "literal";
  literal: RuntimeValue;
  inputText: string;
}

export interface ValidFormulaCellBody {
  valid: true;
  kind: "formula";
  expression: ExprNode;
  expressionText: string;
  inputText: string;
}

export interface InvalidCellBody {
  valid: false;
  unparsedBodyRaw: string;
  issue: Diagnostic;
}

export type CellDisplayState = ParsedDisplayMetadata | null;

export interface ParsedCell {
  body: CellBodyState;
  localDisplay: CellDisplayState;
  initialCachedValue: RuntimeValue | null;
}

export interface SheetEvaluation {
  name: string;
  rowPaths: string[];
  colLabels: string[];
  values: RuntimeValue[][];
}

export interface EvaluationResult {
  sheets: SheetEvaluation[];
}
