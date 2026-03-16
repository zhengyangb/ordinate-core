import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseDocumentModel, validateDocument } from "../src";
import { fixturePath } from "./spec_loader";

const fixtureDir = fixturePath("rfc_0003");

function readFixture(name: string): string {
  return readFileSync(`${fixtureDir}/${name}`, "utf-8");
}

describe("RFC-0003 sections", () => {
  it("valid sections and summary", () => {
    const text = readFixture("valid_sections_hierarchy.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(true);
    const sheet = result.summary.sheets[0];
    expect(sheet.sectionCount).toBe(3);
    expect(sheet.maxSectionLevel).toBe(2);
  });

  it("invalid section level jump", () => {
    const text = readFixture("invalid_section_jump.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("section level jumps"))).toBe(true);
  });

  it("invalid row indent exceeds section level", () => {
    const text = readFixture("invalid_row_indent.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("indentation level"))).toBe(true);
  });

  it("parse document model exposes hierarchy", () => {
    const text = readFixture("valid_sections_hierarchy.ord");
    const model = parseDocumentModel(text);
    expect(model.sheets.length).toBe(1);
    const table = model.sheets[0].table;
    expect(table).not.toBeNull();
    expect(table?.sectionCount).toBe(3);
    expect(table?.maxSectionDepth).toBe(2);
    expect(table?.sections[0].name).toBe("Revenue");
  });
});
