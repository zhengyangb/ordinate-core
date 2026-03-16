export interface RuntimeValue {
  kind: string;
  value?: unknown;
}

export interface RefSelector {
  kind: string;
  value?: unknown;
}

export interface ReferenceExpr {
  rowSelector: RefSelector;
  colSelector: RefSelector;
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

export interface ParsedCell {
  kind: string;
  literal: RuntimeValue | null;
  expression: ExprNode | null;
  cached: RuntimeValue | null;
  expressionText?: string | null;
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
