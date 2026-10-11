import { describe, expect, it } from "vitest";
import { exampleAssetUrl, exampleById, isMacPlatform, macDownloadUrl, shouldOfferExamples, type Example } from "./onlineModel";
import { CANONICAL_BLANK_DOCUMENT } from "../platform/blankDocument";
import { buildExampleAssets } from "../../tooling/onlineExamples";
import { ORD_FORMAT_VERSION } from "@ordinate/core";

describe("online examples and release configuration", () => {
  it("publishes all authoritative workbooks with calculated previews", async () => {
    const assets = await buildExampleAssets();
    const examples = JSON.parse(assets.get("examples/catalog.json")!) as Example[];
    expect(examples).toHaveLength(9);
    expect(examples.filter(item => item.featured).map(item => item.id)).toEqual(["getting-started"]);
    expect(examples.reduce((total, item) => total + item.sheets, 0)).toBe(44);
    for (const example of examples) {
      expect(assets.get(`examples/${example.file}`)?.startsWith(`---\nord-format: "${ORD_FORMAT_VERSION}"\n---\n\n# `)).toBe(true);
      expect(example.preview.rows).toHaveLength(5);
      expect(example.preview.rows.flat().some(cell => cell.startsWith("="))).toBe(false);
    }
    expect(exampleById(examples, "mortgage").preview.rows[2]).toEqual(["Principal", "320,000.00"]);
    expect(() => exampleById(examples, "https://example.com/malicious.ord")).toThrow("Unknown example");
  });
  it("offers examples automatically only for the untouched default new document", () => {
    const state = { file: null, documentDirty: "clean" as const, untitledBaselineText: CANONICAL_BLANK_DOCUMENT };
    expect(shouldOfferExamples(state)).toBe(true);
    expect(shouldOfferExamples({ ...state, documentDirty: "dirty" })).toBe(false);
    expect(shouldOfferExamples({ ...state, untitledBaselineText: null })).toBe(false);
    expect(shouldOfferExamples({ ...state, untitledBaselineText: "another template" })).toBe(false);
    expect(shouldOfferExamples({ ...state, file: { id: "saved", displayName: "Report.ord", adapterKind: "browser-download" } })).toBe(false);
  });
  it("resolves assets under a static hosting subdirectory", () => {
    expect(exampleAssetUrl("05-mortgage.ord", "/app/", "https://ordinate.example/app/online.html?example=mortgage").href).toBe("https://ordinate.example/app/examples/05-mortgage.ord");
    expect(() => exampleAssetUrl("../../private.ord", "/", "https://ordinate.example")).toThrow("Invalid example");
    expect(() => exampleAssetUrl("https://other.example/file.ord", "/", "https://ordinate.example")).toThrow();
  });
  it.each([["MacIntel", 0, true], ["macOS", 0, true], ["MacIntel", 5, false], ["iPhone", 1, false], ["Win32", 0, false], ["Linux x86_64", 0, false]])("uses platform %s only for the Mac shortcut", (platform, touches, expected) => {
    expect(isMacPlatform(platform as string, touches as number)).toBe(expected);
  });
  it("keeps unpublished downloads explicit and rejects invalid release URLs", () => {
    expect(macDownloadUrl(undefined)).toBeNull();
    expect(macDownloadUrl("https://ordinate.example/Ordinate.dmg")).toBe("https://ordinate.example/Ordinate.dmg");
    expect(() => macDownloadUrl("javascript:alert(1)")).toThrow("HTTPS");
    expect(() => macDownloadUrl("not a URL")).toThrow();
  });
});
