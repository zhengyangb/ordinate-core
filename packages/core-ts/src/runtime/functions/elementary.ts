import { numericDomainError, scalarNumericFunction } from "./scalarNumeric";

const x = { name: "x", summary: "Numeric input; logarithms require a positive value." };
export const elementaryFunctionDefinitions = [
  scalarNumericFunction({ name: "exp", category: "numeric", summary: "Returns e raised to x (the natural exponential).",
    parameters: [x], examples: [{ expression: "exp(1)", result: "2.718281828459045" }],
    calculate: ([value]) => Math.exp(value) }),
  scalarNumericFunction({ name: "ln", category: "numeric", summary: "Returns the natural logarithm of a positive number.",
    parameters: [x], examples: [{ expression: "ln(exp(2))", result: "2" }],
    calculate: ([value], name) => value > 0 ? Math.log(value) : numericDomainError(name, "non_positive_argument") }),
  scalarNumericFunction({ name: "log10", category: "numeric", summary: "Returns the base-ten logarithm of a positive number.",
    parameters: [x], examples: [{ expression: "log10(100)", result: "2" }],
    calculate: ([value], name) => value > 0 ? Math.log10(value) : numericDomainError(name, "non_positive_argument") }),
  scalarNumericFunction({ name: "log", category: "numeric", summary: "Returns a logarithm in the given base (default ten).",
    parameters: [x, { name: "base", summary: "Positive base other than one. Defaults to ten.", default: 10 }],
    examples: [{ expression: "log(8, 2)", result: "3" }, { expression: "log(100)", result: "2" }],
    calculate: ([value, base], name) => value <= 0 ? numericDomainError(name, "non_positive_argument")
      : base <= 0 || base === 1 ? numericDomainError(name, "invalid_log_base")
      : base === 10 ? Math.log10(value) : Math.log(value) / Math.log(base) }),
];
