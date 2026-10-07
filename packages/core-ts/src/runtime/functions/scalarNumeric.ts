import { isError, makeInternalError } from "../errors";
import type { RuntimeValue } from "../types";
import { assertArityRange, expectNumberArg } from "./args";
import type { FunctionCategory, FunctionDefinition, FunctionExample } from "./index";
import { NumericalConvergenceError } from "./specialMath";

export interface NumericParameter { name: string; summary: string; default?: number; defaultFrom?: number }
interface NumericDefinition {
  name: string; category: FunctionCategory; summary: string;
  parameters: readonly NumericParameter[]; examples: readonly FunctionExample[];
  calculate: (args: readonly number[], name: string) => number | RuntimeValue;
}

/** A strict scalar-number contract shared by elementary and distribution
 * functions. Defaults, metadata and evaluation come from one definition. */
export function scalarNumericFunction(spec: NumericDefinition): FunctionDefinition {
  const minimum = spec.parameters.filter(parameter => parameter.default === undefined && parameter.defaultFrom === undefined).length;
  return {
    name: spec.name, category: spec.category, summary: spec.summary, examples: spec.examples,
    signatures: Array.from({ length: spec.parameters.length - minimum + 1 }, (_, i) => ({
      parameters: spec.parameters.slice(0, minimum + i).map(({ name, summary }) => ({ name, summary, type: "Scalar[number]" })),
      returns: "number",
    })),
    evaluator: (call, ctx) => {
      const error = assertArityRange(call.name, call.args.length, minimum, spec.parameters.length);
      if (error) return error;
      const args: number[] = [];
      for (let i = 0; i < spec.parameters.length; i++) {
        if (i >= call.args.length) {
          const parameter = spec.parameters[i];
          args.push(parameter.defaultFrom === undefined ? parameter.default! : args[parameter.defaultFrom]); continue;
        }
        const value = expectNumberArg(ctx, call.name, call.args[i]);
        if (isError(value)) return value;
        if (!Number.isFinite(value.value as number)) return numericDomainError(call.name, "non_finite_argument");
        args.push(value.value as number);
      }
      let result: number | RuntimeValue;
      try { result = spec.calculate(args, call.name); }
      catch (error) {
        if (!(error instanceof NumericalConvergenceError)) throw error;
        return numericDomainError(call.name, "numerical_convergence");
      }
      if (typeof result !== "number") return result;
      return Number.isFinite(result) ? { kind: "number", value: result }
        : numericDomainError(call.name, "non_finite_result");
    },
  };
}

export const numericDomainError = (name: string, reason: string): RuntimeValue =>
  makeInternalError("invalid_function_call", { function: name, reason });
