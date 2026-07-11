import { describe, expect, it } from "vitest";

import { resolveReferenceOverlayPlane, resolveSelectionOverlayPlane } from "./selectionRing";

describe("selection overlay plane", () => {
  it("keeps center body selections below frozen body columns", () => {
    expect(resolveSelectionOverlayPlane("body", 2, 1)).toBe("body-center");
  });

  it("raises pinned body selections above the frozen body surface", () => {
    expect(resolveSelectionOverlayPlane("body", 0, 1)).toBe("body-pinned");
  });

  it("leaves header selections in the native clipped header plane", () => {
    expect(resolveSelectionOverlayPlane("header", 0, 1)).toBe("header-native");
    expect(resolveSelectionOverlayPlane("header", 3, 1)).toBe("header-native");
  });

  it("treats every body column as center when no columns are frozen", () => {
    expect(resolveSelectionOverlayPlane("body", 0, 0)).toBe("body-center");
  });

  it("fails early for invalid geometry", () => {
    expect(() => resolveSelectionOverlayPlane("body", -1, 1)).toThrow(
      "selection overlay column index must be a non-negative integer",
    );
    expect(() => resolveSelectionOverlayPlane("body", 1, -1)).toThrow(
      "selection overlay header column count must be a non-negative integer",
    );
  });
});

describe("formula reference overlay plane", () => {
  it("keeps body dependencies in the center plane below frozen columns", () => {
    expect(resolveReferenceOverlayPlane({ rowStart: 4, rowEnd: 6, colStart: 1, colEnd: 3 }, 2, 1)).toBe(
      "body-center",
    );
  });

  it("raises dependencies wholly inside frozen body columns", () => {
    expect(resolveReferenceOverlayPlane({ rowStart: 4, rowEnd: 6, colStart: 0, colEnd: 0 }, 2, 1)).toBe(
      "body-pinned",
    );
  });

  it("places dependencies wholly inside header rows above the native header", () => {
    expect(resolveReferenceOverlayPlane({ rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 }, 2, 1)).toBe(
      "header-native",
    );
  });

  it("keeps ranges crossing the frozen boundary in the center plane", () => {
    expect(resolveReferenceOverlayPlane({ rowStart: 3, rowEnd: 3, colStart: 0, colEnd: 2 }, 2, 1)).toBe(
      "body-center",
    );
  });

  it("fails early for invalid dependency geometry", () => {
    expect(() => resolveReferenceOverlayPlane({ rowStart: 4, rowEnd: 3, colStart: 0, colEnd: 0 }, 2, 1)).toThrow(
      "formula reference overlay range must be normalized",
    );
    expect(() => resolveReferenceOverlayPlane({ rowStart: 1, rowEnd: 1, colStart: -1, colEnd: 0 }, 2, 1)).toThrow(
      "formula reference overlay colStart must be a non-negative integer",
    );
  });
});
