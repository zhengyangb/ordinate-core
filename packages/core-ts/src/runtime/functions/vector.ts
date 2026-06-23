import { isError, makeInternalError } from "../errors";
import type { RuntimeValue, RuntimeView } from "../types";

export function dotProduct(left: RuntimeView, right: RuntimeView): RuntimeValue {
  const leftVals = vectorValues(left);
  const rightVals = vectorValues(right);
  if (!leftVals || !rightVals) {
    return makeInternalError("invalid_function_call", { function: "dotProduct", reason: "non_vector" });
  }
  if (leftVals.length !== rightVals.length) {
    return makeInternalError("invalid_function_call", { function: "dotProduct", reason: "length_mismatch" });
  }

  let total = 0;
  for (let i = 0; i < leftVals.length; i += 1) {
    const lVal = leftVals[i];
    const rVal = rightVals[i];
    if (isError(lVal)) return lVal;
    if (isError(rVal)) return rVal;
    if (lVal.kind !== "number" || rVal.kind !== "number") {
      return makeInternalError("invalid_function_call", { function: "dotProduct", reason: "non_number_element" });
    }
    total += Number(lVal.value) * Number(rVal.value);
  }
  return { kind: "number", value: Number.isInteger(total) ? Math.trunc(total) : total };
}

function vectorValues(view: RuntimeView): RuntimeValue[] | null {
  if (view.rowCount === 1) {
    return view.values;
  }
  if (view.colCount === 1) {
    return view.values;
  }
  return null;
}
