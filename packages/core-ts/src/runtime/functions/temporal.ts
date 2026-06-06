import { makeInternalError } from "../errors";
import {
  dateFromDatetime,
  datetimeFromUnixMillisValue,
  makeDateValue,
  makeDatetimeValue,
  makeDurationValue,
  makeTimeValue,
  temporalComponent,
  timeFromDatetime,
  unixMillisValue,
} from "../temporal";
import { assertArity, assertArityRange } from "./args";
import type { FunctionEvaluator } from "./index";

export function dateEvaluator(): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArityRange(call.name, call.args.length, 1, 3);
    if (arityError) return arityError;
    if (call.args.length === 1) {
      return dateFromDatetime(ctx.evalScalarArg(call.args[0]), call.name);
    }
    if (call.args.length !== 3) {
      return makeInternalError("invalid_function_call", { function: call.name, expectedArgs: [1, 3], got: call.args.length });
    }
    return makeDateValue(ctx.evalScalarArg(call.args[0]), ctx.evalScalarArg(call.args[1]), ctx.evalScalarArg(call.args[2]), call.name);
  };
}

export function timeEvaluator(): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArityRange(call.name, call.args.length, 1, 3);
    if (arityError) return arityError;
    if (call.args.length === 1) {
      return timeFromDatetime(ctx.evalScalarArg(call.args[0]), call.name);
    }
    return makeTimeValue(
      ctx.evalScalarArg(call.args[0]),
      ctx.evalScalarArg(call.args[1]),
      call.args.length === 3 ? ctx.evalScalarArg(call.args[2]) : null,
      call.name,
    );
  };
}

export function datetimeEvaluator(): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 2);
    if (arityError) return arityError;
    return makeDatetimeValue(ctx.evalScalarArg(call.args[0]), ctx.evalScalarArg(call.args[1]), call.name);
  };
}

export function durationEvaluator(): FunctionEvaluator {
  return (call, ctx) => {
    if (call.args.length > 4) {
      return makeInternalError("invalid_function_call", { function: call.name, maxArgs: 4, got: call.args.length });
    }
    return makeDurationValue(call.args.map((arg) => ctx.evalScalarArg(arg)), call.name);
  };
}

export function temporalComponentEvaluator(component: "year" | "month" | "day" | "hour" | "minute" | "second" | "millisecond"): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    return temporalComponent(ctx.evalScalarArg(call.args[0]), component, call.name);
  };
}

export function unixMillisEvaluator(): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    return unixMillisValue(ctx.evalScalarArg(call.args[0]), call.name);
  };
}

export function datetimeFromUnixMillisEvaluator(): FunctionEvaluator {
  return (call, ctx) => {
    const arityError = assertArity(call.name, call.args.length, 1);
    if (arityError) return arityError;
    return datetimeFromUnixMillisValue(ctx.evalScalarArg(call.args[0]), call.name);
  };
}
