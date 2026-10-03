import { isImplicitTextInput } from "@ordinate/core";

/** Validate the proposed draft, not the previous cell's runtime type. */
export function canInsertTextLineBreak(input: string, start = input.length, end = start): boolean {
  return isImplicitTextInput(`${input.slice(0, start)}\n${input.slice(end)}`);
}

export function plainTextPreview(input: string): { text: string; lineCount: number } {
  const lines = input.split(/\r\n|\r|\n/);
  return { text: lines.join(" · "), lineCount: lines.length };
}
