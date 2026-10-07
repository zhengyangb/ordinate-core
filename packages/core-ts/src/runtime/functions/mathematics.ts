import { gamma, logGamma, combinations, permutations, factorial, gammaProbability } from "./specialMath";
import { standardNormalDensity } from "./normalKernel";
import { numericDomainError, scalarNumericFunction, type NumericParameter } from "./scalarNumeric";
import type { RuntimeValue } from "../types";

const parameter = (name: string, value?: number): NumericParameter => ({ name,
  summary: `Numeric ${name}.` + (value === undefined ? "" : ` Defaults to ${value}.`),
  ...(value === undefined ? {} : { default: value }) });
interface MathOperation {
  name: string; excel: string; aliases?: string[]; parameters: NumericParameter[];
  importArities?: Record<string, { required: number; maximum: number }>;
  argumentOrder?: (number | string)[];
  calculate: (args: readonly number[], name: string) => number | RuntimeValue;
}
const unary = (name: string, excel: string, f: (x: number) => number,
  valid: (x: number) => boolean = () => true): MathOperation => ({ name, excel,
  parameters: [parameter("x")], calculate: ([x], fn) => valid(x) ? f(x) : numericDomainError(fn, "invalid_domain") });
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const erf = (x: number) => Math.sign(x) * gammaProbability(0.5, x * x);
const countPair = (name: string, excel: string, f: (n: number, k: number) => number,
  repeats = false): MathOperation => ({ name, excel, parameters: [parameter("n"), parameter("k")],
  calculate: ([n, k], fn) => integer(n) && integer(k) && (repeats || k <= n)
    ? f(n, k) : numericDomainError(fn, "invalid_integer_counts") });

/** Each new scalar operation declares its native contract and Excel spelling
 * once. Evaluator metadata and both adapter directions consume this catalog. */
export const mathOperations: readonly MathOperation[] = [
  unary("sin", "SIN", Math.sin), unary("cos", "COS", Math.cos), unary("tan", "TAN", Math.tan),
  unary("asin", "ASIN", Math.asin, x => Math.abs(x) <= 1),
  unary("acos", "ACOS", Math.acos, x => Math.abs(x) <= 1), unary("atan", "ATAN", Math.atan),
  { name: "atan2", excel: "ATAN2", parameters: [parameter("y"), parameter("x")], argumentOrder: [1, 0],
    calculate: ([y, x], fn) => x === 0 && y === 0 ? numericDomainError(fn, "undefined_origin") : Math.atan2(y, x) },
  unary("cot", "_xlfn.COT", x => 1 / Math.tan(x), x => x !== 0),
  unary("acot", "_xlfn.ACOT", x => Math.atan2(1, x)),
  unary("sec", "_xlfn.SEC", x => 1 / Math.cos(x)),
  unary("csc", "_xlfn.CSC", x => 1 / Math.sin(x), x => x !== 0),
  unary("sinh", "SINH", Math.sinh), unary("cosh", "COSH", Math.cosh),
  { ...unary("tanh", "TANH", Math.tanh), aliases: ["FISHERINV"] },
  unary("asinh", "ASINH", Math.asinh), unary("acosh", "ACOSH", Math.acosh, x => x >= 1),
  { ...unary("atanh", "ATANH", Math.atanh, x => Math.abs(x) < 1), aliases: ["FISHER"] },
  unary("coth", "_xlfn.COTH", x => 1 / Math.tanh(x), x => x !== 0),
  unary("acoth", "_xlfn.ACOTH", x => (Math.log1p(1 / x) - Math.log1p(-1 / x)) / 2, x => Math.abs(x) > 1),
  unary("sech", "_xlfn.SECH", x => 1 / Math.cosh(x)), unary("csch", "_xlfn.CSCH", x => 1 / Math.sinh(x), x => x !== 0),
  unary("radians", "RADIANS", x => x / 180 * Math.PI), unary("degrees", "DEGREES", x => x / Math.PI * 180),
  unary("sqrtPi", "SQRTPI", x => Math.sqrt(x) * Math.sqrt(Math.PI), x => x >= 0),
  unary("factorial", "FACT", x => factorial(x), integer), unary("doubleFactorial", "FACTDOUBLE", x => factorial(x, 2), integer),
  countPair("combinations", "COMBIN", combinations),
  countPair("combinationsWithRepetition", "_xlfn.COMBINA", (n, k) => k === 0 ? 1 : n === 0 ? 0 : combinations(n + k - 1, k), true),
  countPair("permutations", "PERMUT", permutations),
  countPair("permutationsWithRepetition", "_xlfn.PERMUTATIONA", (n, k) => n ** k, true),
  { name: "quotient", excel: "QUOTIENT", parameters: [parameter("numerator"), parameter("denominator")],
    calculate: ([a, b], fn) => b === 0 ? numericDomainError(fn, "zero_denominator") : Math.trunc(a / b) },
  unary("even", "EVEN", x => Math.sign(x) * Math.ceil(Math.abs(x) / 2) * 2),
  unary("odd", "ODD", x => (x < 0 ? -1 : 1) * (Math.ceil((Math.abs(x) - 1) / 2) * 2 + 1)),
  { name: "roundMultiple", excel: "MROUND", parameters: [parameter("x"), parameter("multiple")],
    calculate: ([x, m], fn) => m === 0 ? 0 : x * m < 0 ? numericDomainError(fn, "opposite_signs")
      : Math.sign(x) * Math.floor(Math.abs(x / m) + 0.5) * Math.abs(m) },
  ...(["floor", "ceil"] as const).map(direction => ({ name: `${direction}Multiple`, excel: `_xlfn.${direction === "floor" ? "FLOOR" : "CEILING"}.MATH`,
    aliases: direction === "floor" ? ["FLOOR.PRECISE"] : ["CEILING.PRECISE", "ISO.CEILING"],
    importArities: Object.fromEntries((direction === "floor" ? ["FLOOR.PRECISE"] : ["CEILING.PRECISE", "ISO.CEILING"])
      .map(name => [name, { required: 1, maximum: 2 }])),
    parameters: [parameter("x"), parameter("multiple", 1), parameter("mode", 0)],
    calculate: ([x, m, mode]: readonly number[]) => {
      if (m === 0) return 0;
      const ratio = x / Math.abs(m), positive = direction === "ceil";
      const useCeil = x < 0 && mode !== 0 ? !positive : positive;
      return (useCeil ? Math.ceil(ratio) : Math.floor(ratio)) * Math.abs(m);
    } })),
  unary("gamma", "_xlfn.GAMMA", gamma, x => x !== 0 && !(x < 0 && Number.isInteger(x))),
  { ...unary("logGamma", "_xlfn.GAMMALN.PRECISE", logGamma, x => x > 0), aliases: ["GAMMALN"] },
  unary("normalDensity", "_xlfn.PHI", standardNormalDensity),
  unary("normalCenteredCdf", "_xlfn.GAUSS", x => erf(x / Math.SQRT2) / 2),
  unary("erf", "_xlfn.ERF.PRECISE", erf),
  { ...unary("erfc", "_xlfn.ERFC.PRECISE", x => {
    const q = gammaProbability(0.5, x * x, true); return x < 0 ? 2 - q : q;
  }), aliases: ["ERFC"] },
];
export const mathematicalFunctionDefinitions = mathOperations.map(operation => scalarNumericFunction({
  ...operation, category: "numeric", summary: `${operation.name}: deterministic scalar mathematics.`,
  examples: [{ expression: `${operation.name}(${operation.parameters.filter(p => p.default === undefined).map(() => "1").join(", ")})` }],
}));
