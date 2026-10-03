import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DocumentState, formatDocument, serializeDocumentState } from "../src";
import { parseDocument } from "../src/parser";

type RoundTripCase = {
  name: string;
  doc: string;
  expect: string;
  evaluate: boolean;
};

function loadRoundTripCases(path: string): RoundTripCase[] {
  const content = readFileSync(path, "utf-8");
  const chunks = content
    .split("===")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const cases: RoundTripCase[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    const name = lines[0].trim();
    const body = lines.slice(1).join("\n");

    const docStart = body.indexOf("[doc]\n");
    const docEnd = body.indexOf("\n[/doc]");
    if (docStart === -1 || docEnd === -1) {
      throw new Error(`case '${name}' missing [doc] block`);
    }
    const doc = body.slice(docStart + "[doc]\n".length, docEnd).trim();

    const expectStart = body.indexOf("[expect]\n");
    const expectEnd = body.indexOf("\n[/expect]");
    if (expectStart === -1 || expectEnd === -1) {
      throw new Error(`case '${name}' missing [expect] block`);
    }
    const expectDoc = body.slice(expectStart + "[expect]\n".length, expectEnd).trim();

    const tail = body
      .slice(expectEnd + "\n[/expect]".length)
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let evaluate = false;
    for (const line of tail) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key === "evaluate") {
        evaluate = value === "true";
      }
    }

    cases.push({ name, doc, expect: expectDoc, evaluate });
  }
  return cases;
}

describe("RFC-0011 serialization round-trip", () => {
  const fixturePath = resolve(process.cwd(), "tests", "fixtures", "rfc_0011", "round_trip.cases");

  it("serializes to canonical form while preserving semantics", () => {
    const cases = loadRoundTripCases(fixturePath);
    for (const spec of cases) {
      const state = DocumentState.fromText(spec.doc);
      if (spec.evaluate) {
        state.evaluate();
      }
      const output = serializeDocumentState(state);
      const expected = formatDocument(`${spec.expect}\n`);
      expect(output).toBe(expected);
    }
  });

  it("keeps later sheets parseable when an earlier sheet has unparsed content", () => {
    const doc = `
# Broken
| Item || 2024 |
| ---- || ---- |
| A || 10 |
this line is not parseable as table row
| B || 20 |

# Good
| Item || 2024 | 2025 | Sum |
| ---- || ---- | ---- | --- |
| Rev  || 3    | 4    | = sum(@[Rev,2024:2025]) |
`;
    const state = DocumentState.fromText(doc);
    state.evaluate();
    const output = serializeDocumentState(state);

    const { sheets: parsed } = parseDocument(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].blocks.some((b) => b.kind === "unparsed")).toBe(true);
    expect(parsed[1].name).toBe("Good");
    expect(parsed[1].table).not.toBeNull();
    expect(parsed[1].table?.rows.some((row) => row.includes("7 = sum(@[Rev,2024:2025])"))).toBe(true);
  });
});
