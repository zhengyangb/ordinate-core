export interface RuntimeValue {
  kind: string;
  value?: unknown;
}

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

export interface FormatSpec {
  sign: FormatSignPolicy;
  zeroPad: boolean;
  width: number | null;
  grouping: boolean;
  precision: number | null;
  type: NumericFormatType | null;
  raw: string;
}

export interface StyleSpec {
  align: TextAlign | null;
  bold: boolean;
  color: TextColor | null;
  raw: string;
}

export interface ParsedDisplayMetadata {
  format: string | null;
  style: string | null;
  formatSpec: FormatSpec | null;
  styleSpec: StyleSpec | null;
  valid: boolean;
  rawBlock: string | null;
  errors: string[];
}

export interface ParsedCell {
  kind: string;
  literal: RuntimeValue | null;
  expression: ExprNode | null;
  cached: RuntimeValue | null;
  expressionText?: string | null;
  display?: ParsedDisplayMetadata | null;
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
