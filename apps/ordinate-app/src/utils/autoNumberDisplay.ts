/** Compact editor-only Auto display. Never round the stored or evaluated value. */
export function autoNumberDisplay(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Auto number display requires a finite number");
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.0001 || magnitude >= 1e12)) {
    const [mantissa, exponent] = value.toExponential(4).split("e");
    return `${Number(mantissa)}e${exponent}`;
  }
  return String(Number(value.toFixed(4)));
}
