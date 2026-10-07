import type { ReferenceExpr } from "../runtime/types";

/** Excel syntax is deliberately separate from Ordinate's expression representation. */
export type ExcelExpression =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "error"; value: string }
  | { kind: "missing" }
  | { kind: "name"; value: string }
  | { kind: "reference"; sheet?: string; reference: ReferenceExpr }
  | { kind: "unary"; op: "+" | "-" | "%"; operand: ExcelExpression }
  | { kind: "binary"; op: string; left: ExcelExpression; right: ExcelExpression }
  | { kind: "call"; name: string; args: ExcelExpression[] }
  | { kind: "array"; rows: ExcelExpression[][] };
