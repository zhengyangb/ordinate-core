import { describe, expect, it } from "vitest";
import { DocumentState } from "@ordinate/core";
import { isFillSessionCurrent } from "./fillSession";

describe("fill session ownership", () => {
  const document = DocumentState.fromText("# Sheet\n| 1 | 2 |");
  const snapshot = { document, sheet: "Sheet" };
  const state = { docState: document, activeSheet: "Sheet", mode: "table" };
  it("permits only the captured document and sheet", () => expect(isFillSessionCurrent(snapshot, state)).toBe(true));
  it("rejects file reloads even when the text is identical", () => {
    expect(isFillSessionCurrent(snapshot, { ...state, docState: DocumentState.fromText("# Sheet\n| 1 | 2 |") })).toBe(false);
  });
  it("rejects sheet switches, source editing and closed documents", () => {
    expect(isFillSessionCurrent(snapshot, { ...state, activeSheet: "Other" })).toBe(false);
    expect(isFillSessionCurrent(snapshot, { ...state, mode: "source" })).toBe(false);
    expect(isFillSessionCurrent(snapshot, { ...state, docState: null })).toBe(false);
  });
});
