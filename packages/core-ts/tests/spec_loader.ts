import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SpecCase = Record<string, string>;

export function loadSpecCases(path: string): SpecCase[] {
  const content = readFileSync(path, "utf-8");
  const chunks = content
    .split("===")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const cases: SpecCase[] = [];

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
    const tail = body.slice(docEnd + "\n[/doc]".length).trim();

    const specCase: SpecCase = { name, doc };
    for (const line of tail.split(/\r?\n/)) {
      const item = line.trim();
      if (!item || item.startsWith("#")) {
        continue;
      }
      const idx = item.indexOf(":");
      if (idx === -1) {
        continue;
      }
      const key = item.slice(0, idx).trim();
      const value = item.slice(idx + 1).trim();
      specCase[key] = value;
    }

    cases.push(specCase);
  }

  return cases;
}

export function fixturePath(...parts: string[]): string {
  return resolve(process.cwd(), "tests", "fixtures", ...parts);
}
