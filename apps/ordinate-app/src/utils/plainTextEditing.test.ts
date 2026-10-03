import { describe, expect, it } from "vitest";
import { canInsertTextLineBreak, plainTextPreview } from "./plainTextEditing";

describe("plain text editing", () => {
  it("lets ordinary values become multiline text without a prefix workaround", () => {
    for (const input of ["1", "1.23", "true", "false", "null", "2026-09-26", "14:30", "2026-09-26T14:30:00Z", "PT1H", "", "hello", "1\n2"]) {
      expect(canInsertTextLineBreak(input), input).toBe(true);
    }
  });
  it("keeps formulas, explicit strings, and display metadata in source mode", () => {
    for (const input of ['"hello"', '"', "= 1", '  = 1', "hello {::bold}"]) {
      expect(canInsertTextLineBreak(input), input).toBe(false);
    }
  });
  it("validates the actual insertion or selection replacement", () => {
    expect(canInsertTextLineBreak("123", 1)).toBe(true);
    expect(canInsertTextLineBreak("123", 0, 3)).toBe(true);
    expect(canInsertTextLineBreak('x"quoted"', 1, 1)).toBe(true);
    expect(canInsertTextLineBreak('x"quoted"', 0, 1)).toBe(false);
  });
  it("previews lines compactly without hiding blank or trailing lines", () => {
    expect(plainTextPreview("one\n\nthree\n")).toEqual({ text: "one ·  · three · ", lineCount: 4 });
    expect(plainTextPreview("one\r\ntwo")).toEqual({ text: "one · two", lineCount: 2 });
    expect(plainTextPreview(String.raw`one\ntwo`)).toEqual({ text: String.raw`one\ntwo`, lineCount: 1 });
  });
});
