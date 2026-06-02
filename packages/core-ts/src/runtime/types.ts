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
}

export type ReferenceStyle = "ordinate" | "spreadsheet";

export interface ReferenceExpr {
  rowSelector: RefSelector;
  colSelector: RefSelector;
  style?: ReferenceStyle;
}

export interface ViewSelection {
  rowIndices: number[];
  colIndices: number[];
}

export interface RuntimeView {
  kind: "view";
  dimension: 0 | 1 | 2;
  rowCount: number;
  colCount: number;
  values: RuntimeValue[];
}

export interface FunctionCall {
  name: string;
  args: ExprNode[];
}

export interface ExprNode {
  kind: string;
  value?: unknown;
  left?: ExprNode | null;
  right?: ExprNode | null;
}

export type FormatSignPolicy = "default" | "plus" | "parentheses";
export type NumericFormatType = "f" | "e" | "%" | "d";
export type TextAlign = "left" | "right" | "center";
export type TextColor = "red" | "green" | "blue";
export type TextWeight = "bold" | "normal";

export interface FormatSpec {
  sign: FormatSignPolicy;
  padWidth: number | null;
  grouping: boolean;
  precision: number | null;
  type: NumericFormatType | null;
}

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
