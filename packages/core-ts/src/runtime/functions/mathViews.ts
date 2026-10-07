import { isError } from "../errors";
import type { RuntimeValue } from "../types";
import { assertArity, expectNumberArg, expectViewArg } from "./args";
import type { FunctionDefinition } from "./index";
import { combinations } from "./specialMath";
import { numericDomainError } from "./scalarNumeric";

interface NumericView { values: number[]; rows: number; columns: number }
interface MathViewOperation {
  name: string; excel: string; variadic?: number;
  parameters: { name: string; type: "scalar" | "view" }[];
  summary: string;
  calculate: (args: readonly (number | NumericView)[], name: string) => number | RuntimeValue;
}

/** These operations consume views but return one number, so they do not need
 * a cell-spill implementation. The catalog owns runtime and adapter contracts.
 * New mathematics accepts numbers only: never silently coerce/skip text. */
export const mathViewOperations: readonly MathViewOperation[] = [
  { name: "multinomial", excel: "MULTINOMIAL", variadic: 0,
    parameters: [{ name: "counts", type: "view" }], summary: "Multinomial coefficient for nonnegative integer counts.",
    calculate: ([arg], name) => {
      const counts = (arg as NumericView).values, sum = counts.reduce((a, b) => a + b, 0);
      if (!counts.every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(sum))
        return numericDomainError(name, "invalid_integer_counts");
      let remaining = sum, result = 1;
      for (const n of counts) { result *= combinations(remaining, n); remaining -= n; }
      return result;
    } },
  { name: "seriesSum", excel: "SERIESSUM",
    parameters: [{ name: "x", type: "scalar" }, { name: "initialPower", type: "scalar" },
      { name: "powerStep", type: "scalar" }, { name: "coefficients", type: "view" }],
    summary: "Sum coefficients[i] × x raised to initialPower + i × powerStep.",
    calculate: ([x, start, step, coefficients]) => (coefficients as NumericView).values.reduce(
      (sum, coefficient, i) => sum + coefficient * (x as number) ** ((start as number) + i * (step as number)), 0) },
  ...([
    ["sumSquaredDifference", "SUMXMY2", (x: number, y: number) => (x - y) ** 2],
    ["sumSquareDifference", "SUMX2MY2", (x: number, y: number) => x * x - y * y],
    ["sumSquareSum", "SUMX2PY2", (x: number, y: number) => x * x + y * y],
  ] as const).map(([name, excel, term]): MathViewOperation => ({ name, excel,
    parameters: [{ name: "left", type: "view" }, { name: "right", type: "view" }],
    summary: `Paired numeric reduction (${excel}).`, calculate: ([left, right], fn) => {
      const a = left as NumericView, b = right as NumericView;
      if (a.rows !== b.rows || a.columns !== b.columns) return numericDomainError(fn, "shape_mismatch");
      return a.values.reduce((total, x, i) => total + term(x, b.values[i]), 0);
    } })),
  { name: "determinant", excel: "MDETERM", parameters: [{ name: "matrix", type: "view" }],
    summary: "Determinant of a nonempty square numeric matrix.", calculate: ([arg], name) => {
      const view = arg as NumericView, n = view.rows;
      if (n === 0 || n !== view.columns) return numericDomainError(name, "non_square_matrix");
      const matrix = view.values.slice(); let result = 1;
      for (let column = 0; column < n; column++) {
        let pivot = column;
        for (let row = column + 1; row < n; row++)
          if (Math.abs(matrix[row * n + column]) > Math.abs(matrix[pivot * n + column])) pivot = row;
        if (matrix[pivot * n + column] === 0) return 0;
        if (pivot !== column) {
          for (let j = column; j < n; j++)
            [matrix[column * n + j], matrix[pivot * n + j]] = [matrix[pivot * n + j], matrix[column * n + j]];
          result = -result;
        }
        const diagonal = matrix[column * n + column]; result *= diagonal;
        for (let row = column + 1; row < n; row++) {
          const factor = matrix[row * n + column] / diagonal;
          for (let j = column + 1; j < n; j++) matrix[row * n + j] -= factor * matrix[column * n + j];
        }
      }
      return result;
    } },
];

export const mathViewFunctionDefinitions: FunctionDefinition[] = mathViewOperations.map(spec => ({
  name: spec.name, category: "numeric", summary: spec.summary, examples: [],
  signatures: [{ parameters: spec.parameters.map(({ name, type }) => ({ name,
    type: type === "scalar" ? "Scalar[number]" : "View[number]", summary: `Numeric ${name}.` })), returns: "number" }],
  evaluator: (call, ctx) => {
    const arity = assertArity(call.name, call.args.length, spec.parameters.length); if (arity) return arity;
    const args: (number | NumericView)[] = [];
    for (const [i, parameter] of spec.parameters.entries()) {
      if (parameter.type === "scalar") {
        const value = expectNumberArg(ctx, call.name, call.args[i]); if (isError(value)) return value;
        if (!Number.isFinite(value.value as number)) return numericDomainError(call.name, "non_finite_argument");
        args.push(value.value as number);
      } else {
        const view = expectViewArg(ctx, call.name, call.args[i]);
        if (!("values" in view)) return view;
        const values: number[] = [];
        for (const value of view.values) {
          if (isError(value)) return value;
          if (value.kind !== "number" || !Number.isFinite(value.value as number))
            return numericDomainError(call.name, "non_numeric_element");
          values.push(value.value as number);
        }
        args.push({ values, rows: view.rowCount, columns: view.colCount });
      }
    }
    const result = spec.calculate(args, call.name);
    return typeof result !== "number" ? result : Number.isFinite(result)
      ? { kind: "number", value: result } : numericDomainError(call.name, "non_finite_result");
  },
}));
