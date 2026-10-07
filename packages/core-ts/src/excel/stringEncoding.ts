/** SpreadsheetML ST_Xstring escaping, separate from XML entity escaping. */
export function encodeXstring(value: string): string {
  const protectedEscapes = value.replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`);
  return Array.from(protectedEscapes, char => {
    const code = char.codePointAt(0)!;
    return code < 32 && code !== 9 && code !== 10 || code === 0xfffe || code === 0xffff || code >= 0xd800 && code <= 0xdfff
      ? `_x${code.toString(16).toUpperCase().padStart(4, "0")}_`
      : char;
  }).join("");
}

export function decodeXstring(value: string): string {
  // One pass is essential: _x005F_x0041_ denotes literal _x0041_, not A.
  return value.replace(/_x([0-9a-f]{4})_/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}
