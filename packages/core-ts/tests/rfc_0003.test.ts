import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseDocumentModel, validateDocument } from "../src";
import { fixturePath } from "./spec_loader";

const fixtureDir = fixturePath("rfc_0003");

function readFixture(name: string): string {
  return readFileSync(`${fixtureDir}/${name}`, "utf-8");
}

describe("RFC-0003 hierarchy", () => {
  it("valid hierarchy and summary", () => {
    const text = readFixture("valid_sections_hierarchy.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(true);
    const sheet = result.summary.sheets[0];
    expect(sheet.maxHierarchyDepth).toBe(2);
  });

  it("invalid hierarchy depth jump", () => {
    const text = readFixture("invalid_section_jump.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("exceeds available parent depth"))).toBe(true);
  });

  it("invalid row indent exceeds available parent depth", () => {
    const text = readFixture("invalid_row_indent.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("exceeds available parent depth"))).toBe(true);
  });

  it("parse document model exposes hierarchy", () => {
    const text = readFixture("valid_sections_hierarchy.ord");
    const model = parseDocumentModel(text);
    expect(model.sheets.length).toBe(1);
    const table = model.sheets[0].table;
    expect(table).not.toBeNull();
    expect(table?.maxHierarchyDepth).toBe(2);
    const paths = table?.rows.map((row) => row.path.join("."));
    expect(paths).toEqual([
      "Revenue",
      "Revenue.Product Revenue",
      "Revenue.Product Revenue.Phone Revenue",
      "Revenue.Product Revenue.Computer Revenue",
      "Revenue.Service Revenue",
      "Cost of Sales",
      "Cost of Sales.Materials",
      "Operating Income",
    ]);
  });

  it("tracks deep mixed hierarchy row paths", () => {
    const text = readFixture("valid_deep_mixed_hierarchy.ord");
    const result = validateDocument(text);
    expect(result.ok).toBe(true);
    const sheet = result.summary.sheets[0];
    expect(sheet.maxHierarchyDepth).toBe(2);

    const model = parseDocumentModel(text);
    const table = model.sheets[0].table;
    expect(table).not.toBeNull();
    if (!table) throw new Error("expected table");

    expect(table.maxHierarchyDepth).toBe(2);

    const phone = table.rows.find((row) => row.label === "Phone");
    expect(phone).toMatchObject({
      depth: 2,
      path: ["Revenue", "Product", "Phone"],
    });

    const services = table.rows.find((row) => row.label === "Services");
    expect(services).toMatchObject({
      depth: 1,
      path: ["Revenue", "Services"],
    });

    const lastMile = table.rows.find((row) => row.label === "Last-mile");
    expect(lastMile).toMatchObject({
      depth: 2,
      path: ["Cost", "Fulfillment", "Last-mile"],
    });

    const operatingProfit = table.rows.find((row) => row.label === "Operating Profit");
    expect(operatingProfit).toMatchObject({
      depth: 0,
      path: ["Operating Profit"],
    });
  });
});
