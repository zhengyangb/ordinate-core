/** A round-trippable finite number in Ordinate's non-exponential literal syntax. */
export function encodeNumberLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("An Ordinate number literal must be finite.");
  if (Object.is(value, -0)) return "-0";
  const text = String(value);
  const e = text.indexOf("e");
  if (e < 0) return text;
  const sign = value < 0 ? "-" : "";
  const digits = text.slice(sign.length, e).replace(".", "");
  const exponent = Number(text.slice(e + 1));
  // JS emits exponential notation only below 1e-6 or at/above 1e21,
  // with exactly one mantissa digit before the decimal point.
  return exponent < 0
    ? `${sign}0.${"0".repeat(-exponent - 1)}${digits}`
    : `${sign}${digits.padEnd(exponent + 1, "0")}`;
}
