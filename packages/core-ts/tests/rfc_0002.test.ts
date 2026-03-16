import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatDocument, validateDocument } from "../src";
import { fixturePath } from "./spec_loader";

const fixtureDir = fixturePath("rfc_0002");

function readFixture(name: string): string {
  return readFileSync(`${fixtureDir}/${name}`, "utf-8");
}

describe("RFC-0002 requirements", () => {
  it("valid header row and column", () => {
    const result = validateDocument(readFixture("valid_header_row_and_column.ord"));
    expect(result.ok).toBe(true);
  });

  it("valid multi level header rows", () => {
    const result = validateDocument(readFixture("valid_multi_level_header_rows.ord"));
    expect(result.ok).toBe(true);
  });

  it("valid multiple sheets", () => {
    const result = validateDocument(readFixture("valid_multiple_sheets.ord"));
    expect(result.ok).toBe(true);
    expect(result.summary.sheetCount).toBe(2);
    expect(result.summary.sheets.length).toBe(2);
    expect(result.summary.sheets[0].name).toBe("Revenue");
    expect(result.summary.sheets[0].rowCount).toBe(2);
    expect(result.summary.sheets[0].columnCount).toBe(3);
    expect(result.summary.sheets[0].headerRowCount).toBe(0);
    expect(result.summary.sheets[0].headerColumnCount).toBe(1);
  });

  it("invalid inconsistent boundary presence", () => {
    const result = validateDocument(readFixture("invalid_inconsistent_boundary.ord"));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("inconsistent || boundary"))).toBe(true);
  });

  it("invalid inconsistent boundary position", () => {
    const result = validateDocument(readFixture("invalid_boundary_position_mismatch.ord"));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("inconsistent || boundary"))).toBe(true);
  });

  it("invalid non rectangular table", () => {
    const result = validateDocument(readFixture("invalid_non_rectangular.ord"));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("not rectangular"))).toBe(true);
  });

  it("invalid separator row first", () => {
    const result = validateDocument(readFixture("invalid_separator_first.ord"));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("separator row cannot be first row"))).toBe(true);
  });

  it("invalid multiple tables in one sheet", () => {
    const result = validateDocument(readFixture("invalid_multiple_tables_one_sheet.ord"));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("multiple tables"))).toBe(true);
  });

  it("file level escape rules for pipe and backslash", () => {
    const text = readFixture("valid_escaped_pipe.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(true);

    const formatted = formatDocument(text);
    expect(formatted).toContain(String.raw`a\|b`);
    expect(formatted).toContain(String.raw`slash\\test`);
  });

  it("format matches expected fixture", () => {
    const text = readFixture("format_input_unaligned.ord");
    const expected = readFixture("format_expected_unaligned.ord");
    expect(formatDocument(text)).toBe(expected);
  });
});
