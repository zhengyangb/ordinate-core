/** Excel-only sign conventions. Native floor/ceil retain integer contracts;
 * multiple rounding retains explicit magnitude/mode contracts. */
export const multipleRoundingImports = {
  FLOOR: { native: "floorMultiple", integer: "floor", zeroError: "error[div_by_zero]" },
  CEILING: { native: "ceilMultiple", integer: "ceil", zeroError: null },
} as const;

interface ScalarExpression { text: string; literal?: number }
export function importMultipleRounding(name: keyof typeof multipleRoundingImports,
  value: ScalarExpression, multiple: ScalarExpression): string {
  const profile = multipleRoundingImports[name];
  // Only source literals drive simplification, never cached/current cell values.
  if (multiple.literal === 1) return `${profile.integer}(${value.text})`;
  const magnitude = multiple.literal === undefined ? `abs(${multiple.text})` : String(Math.abs(multiple.literal));
  const negativeMode = value.literal !== undefined && value.literal <= 0
    ? "1" : value.literal !== undefined ? "error[type_error]" : `if((${value.text}) > 0, error[type_error], 1)`;
  if (multiple.literal !== undefined) {
    if (multiple.literal === 0 && profile.zeroError !== null) return profile.zeroError;
    if (multiple.literal >= 0) return `${profile.native}(${value.text}, ${magnitude})`;
    if (negativeMode === "error[type_error]") return negativeMode;
    return `${profile.native}(${value.text}, ${magnitude}, ${negativeMode})`;
  }
  // These branches express the source operation's sign/mode selection, including
  // invalid positive-number/negative-significance domain. They are not
  // type/error guards, coercions or fallback results; argument errors propagate.
  const signMode = `if((${multiple.text}) < 0, ${negativeMode}, 0)`;
  const mode = profile.zeroError === null ? signMode : `if((${multiple.text}) == 0, ${profile.zeroError}, ${signMode})`;
  return `${profile.native}(${value.text}, ${magnitude}, ${mode})`;
}
