import { describe, expect, it } from "vitest";

import { fixturePath, loadSpecCases } from "./spec_loader";

describe("spec loader", () => {
  it("loads RFC 0004 reference cases", () => {
    const cases = loadSpecCases(fixturePath("rfc_0004", "reference_cases.cases"));
    expect(cases.length).toBeGreaterThan(0);
  });
});
