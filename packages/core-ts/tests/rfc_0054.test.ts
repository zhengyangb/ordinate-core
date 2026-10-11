import { describe, expect, it } from "vitest";
import { DocumentState, ORD_FORMAT_VERSION, evaluateAndFormatDocument, formatDocument, serializeDocumentState, validateDocument } from "../src";

const body = "# Sheet\n| @ | Value |\n| 1 | 2 |\n";
const marker = `---\nord-format: "${ORD_FORMAT_VERSION}"\n---`;

describe("RFC-0054 ORD format and metadata frame", () => {
  it("stamps all Core serialization, while plain formatting leaves authoring source alone", () => {
    expect(ORD_FORMAT_VERSION).toBe("0.1");
    expect(formatDocument(body).startsWith("# Sheet\n")).toBe(true);
    const saved = serializeDocumentState(DocumentState.fromText(body));
    expect(saved.startsWith(`${marker}\n\n# Sheet\n`)).toBe(true);
    expect(serializeDocumentState(DocumentState.fromText(saved))).toBe(saved);
    expect(evaluateAndFormatDocument(body).startsWith(`${marker}\n\n`)).toBe(true);
    expect(validateDocument(saved).ok).toBe(true);
  });

  it("inserts the marker before other opaque metadata and preserves it on subsequent saves", () => {
    const source = `---\r\nowner: sample\r\n---\n\n${body}`;
    const saved = serializeDocumentState(DocumentState.fromText(source));
    expect(saved.startsWith(`---\r\nord-format: "0.1"\r\nowner: sample\r\n---\n\n`)).toBe(true);
    expect(serializeDocumentState(DocumentState.fromText(saved))).toBe(saved);
  });

  it.each([
    ["ord-format: 0.1", "invalid_ord_format"],
    ['ord-format: "0.2"', "unsupported_ord_format"],
    ['owner: sample\nord-format: "0.1"', "invalid_ord_format"],
    ['ord-format: "0.1"\nord-format: "0.1"', "invalid_ord_format"],
  ])("rejects an invalid or unsupported explicit format: %s", (contents, code) => {
    const source = `---\n${contents}\n---\n\n${body}`;
    expect(validateDocument(source).errors[0]?.code).toBe(code);
    expect(() => DocumentState.fromText(source)).toThrow();
  });

  it("uses only @meta as the control marker without shifting semantic coordinates", () => {
    const source = `# Sheet\n| @meta | | {:,.2f} |\n| | Item || Value |\n| | --- || --- |\n| | Revenue || 1234.5 |\n`;
    expect(validateDocument(source).ok).toBe(true);
    const saved = serializeDocumentState(DocumentState.fromText(source));
    expect(saved).toContain("@meta");
    expect(saved).not.toContain("@display");
    expect(validateDocument(saved).summary.sheets[0]).toMatchObject({ rowCount: 3, columnCount: 2 });
    const legacy = source.replace("@meta", "@display");
    expect(validateDocument(legacy).errors[0]?.code).toBe("legacy_meta_frame");
  });
});
