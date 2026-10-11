import { describe, expect, it } from "vitest";
import { isMissingScratchFile } from "./agentScratchFile";

describe("assistant scratch-file errors", () => {
  it("recognizes a temporarily missing file without hiding other failures", () => {
    expect(isMissingScratchFile(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe(true);
    expect(isMissingScratchFile(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
    expect(isMissingScratchFile(new Error("invalid workbook"))).toBe(false);
  });
});
