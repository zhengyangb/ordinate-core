import { describe, expect, it } from "vitest";
import { DocumentState, serializeDocumentState } from "../src";
import { encodeNumberLiteral } from "../src/number_encoding";

describe("shared native number literal encoding", () => {
  it.each([
    [0, "0"], [-0, "-0"], [42, "42"], [-42, "-42"],
    [0.12345678901234566, "0.12345678901234566"],
    [1e-6, "0.000001"], [1e-7, "0.0000001"],
    [-1.23e-8, "-0.0000000123"],
    [1e21, `1${"0".repeat(21)}`], [-1.23e21, `-123${"0".repeat(19)}`],
    [Number.MIN_VALUE, `0.${"0".repeat(323)}5`],
    [Number.MAX_VALUE, `17976931348623157${"0".repeat(292)}`],
  ] as const)("preserves %s in literals, formulas and saved formula caches", (value, literal) => {
    expect(encodeNumberLiteral(value)).toBe(literal);
    const document = DocumentState.fromText(`# Numbers\n| ${literal} | = ${literal} |\n`);
    const expected = [{ kind: "number", value }, { kind: "number", value }];
    expect(document.evaluate().sheets[0].values[0]).toEqual(expected);
    const saved = serializeDocumentState(document);
    expect(saved).not.toMatch(/\d[eE][+-]?\d/);
    const reopened = DocumentState.fromText(saved);
    expect(reopened.evaluate().sheets[0].values[0]).toEqual(expected);
    expect(serializeDocumentState(reopened)).toBe(saved);
  });

  it.each([NaN, Infinity, -Infinity])("rejects unrepresentable %s rather than writing a substitute", value => {
    expect(() => encodeNumberLiteral(value)).toThrow(RangeError);
  });

  it("retains the same finite value across the full decimal exponent range", () => {
    for (let exponent = -323; exponent <= 308; exponent += 1) {
      for (const sign of [-1, 1]) {
        const value = sign * Number(`1.2345678901234567e${exponent}`);
        const literal = encodeNumberLiteral(value);
        expect(literal).toMatch(/^-?\d+(?:\.\d+)?$/);
        expect(Number(literal)).toBe(value);
      }
    }
  });
});
