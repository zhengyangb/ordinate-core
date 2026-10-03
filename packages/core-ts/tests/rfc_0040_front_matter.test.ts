import { describe, expect, it } from "vitest";
import {
  DocumentParseError, DocumentState, applyBatchWithUndo, applyCoreEditMemento,
  evaluateAndFormatDocument, evaluateDocument, formatDocument, parseDocumentModel,
  serializeDocumentState, validateDocument,
} from "../src";
import { parseDocument } from "../src/parser";

const body = "# Sheet\n| Name || Value |\n| ---- || ----- |\n| Cash || 10 |\n| Total || = @[Cash, Value] + 2 |\n";
const envelope = "---\n# Ghost\n| not | a table |\nunknown: !future &anchor\n  nested: [one, two]\nmultiline: |\n  # Also not a sheet\n  ---\n  | neither | a table |\n# comments and trailing spaces stay  \n---";

describe("RFC-0040 opaque YAML front matter", () => {
  it("isolates front matter from sheets, tables, references, validation, and evaluation", () => {
    const source = `${envelope}\n\n${body}`;
    const parsed = parseDocument(source);
    expect(parsed.frontMatter).toBe(envelope);
    expect(parsed.sheets).toEqual(parseDocument(body).sheets);
    expect(validateDocument(source)).toEqual(validateDocument(body));
    expect(evaluateDocument(source)).toEqual(evaluateDocument(body));
    expect(parseDocumentModel(source)).toEqual({ ...parseDocumentModel(body), frontMatter: envelope });
    const doc = DocumentState.fromText(source);
    expect(doc.frontMatter).toBe(envelope);
    expect(doc.evaluate()).toEqual(DocumentState.fromText(body).evaluate());
  });

  it.each(["---", "..."])("preserves %s closure, comments, indentation, spaces, and CRLF verbatim", closing => {
    const raw = `---  \r\nfuture: arbitrary\r\n# comment  \r\nnested:\r\n  value: |\r\n    ---\r\n\r\n${closing}\t `;
    const source = `\uFEFF${raw}\r\n${body}`;
    const formatted = formatDocument(source);
    expect(formatted).toBe(`${raw}\n\n${formatDocument(body)}`);
    expect(formatDocument(formatted)).toBe(formatted);
    const doc = DocumentState.fromText(source);
    expect(doc.frontMatter).toBe(raw);
    const saved = serializeDocumentState(doc);
    expect(saved.startsWith(`${raw}\n\n# Sheet\n`)).toBe(true);
    expect(serializeDocumentState(DocumentState.fromText(saved))).toBe(saved);
    const evaluated = evaluateAndFormatDocument(source);
    expect(evaluated.startsWith(`${raw}\n\n`)).toBe(true);
    expect(evaluateAndFormatDocument(evaluated)).toBe(evaluated);
  });

  it("distinguishes empty front matter from absent front matter without inventing YAML fields", () => {
    for (const raw of ["---\n---", "---\n\n---", "---\nthis: [is not valid YAML\n---", '---\nfuture: "hello\u2028---\u2028world"\n---']) {
      expect(DocumentState.fromText(`${raw}\n${body}`).frontMatter).toBe(raw);
      expect(validateDocument(`${raw}\n${body}`).ok).toBe(true);
    }
    expect(parseDocument(body).frontMatter).toBeNull();
    expect(parseDocumentModel(body).frontMatter).toBeNull();
    expect(serializeDocumentState(DocumentState.fromText(body))).not.toMatch(/^---/);
    expect(formatDocument(`\uFEFF${body}`)).toBe(formatDocument(body));
  });

  it.each(["---", "---\nfuture: value", `---\n${body}`, "---\n  ---\n# Sheet\n| 1 |"])(
    "fails early on an unterminated envelope %j", source => {
      expect(() => parseDocument(source)).toThrow(DocumentParseError);
      expect(() => DocumentState.fromText(source)).toThrow(DocumentParseError);
      expect(() => formatDocument(source)).toThrow(DocumentParseError);
      expect(() => evaluateDocument(source)).toThrow(DocumentParseError);
      expect(validateDocument(source)).toMatchObject({
        ok: false, errors: [{ code: "front_matter_unterminated" }], summary: { sheetCount: 0 },
      });
    },
  );

  it("retains existing body requirements and does not treat later delimiters as envelopes", () => {
    const raw = "---\nfuture: value\n...  ";
    expect(formatDocument(raw)).toBe(`${raw}\n`);
    expect(formatDocument(formatDocument(raw))).toBe(`${raw}\n`);
    expect(validateDocument(raw).ok).toBe(false);
    expect(validateDocument(`${raw}\n# Empty`).errors).toMatchObject([{ message: "Sheet has no table." }]);
    for (const source of [`\n---\n${body}`, ` ---\n${body}`, `---extra\n${body}`, `${body}\n---\nfuture: ordinary sheet text`]) {
      expect(parseDocument(source).frontMatter).toBeNull();
    }
  });

  it("retains unknown metadata through atomic edits, recalculation, undo, redo, and sheet lifecycle changes", () => {
    const doc = DocumentState.fromText(`${envelope}\n${body}`);
    const before = serializeDocumentState(doc);
    const result = applyBatchWithUndo(doc, [{
      op: "set_cell_input", target: { kind: "index", sheet: "Sheet", rowIndex: 1, colIndex: 1 }, input: "25",
    }]);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.nextDocument.frontMatter).toBe(envelope);
    expect(result.nextDocument.evaluate().sheets[0].values[1][1]).toMatchObject({ kind: "number", value: 27 });
    const after = serializeDocumentState(result.nextDocument);
    expect(after.startsWith(`${envelope}\n\n`)).toBe(true);
    const undo = applyCoreEditMemento(result.nextDocument, result.memento, "undo");
    if (!undo.ok) throw new Error(undo.error.message);
    expect(serializeDocumentState(undo.nextDocument)).toBe(before);
    const redo = applyCoreEditMemento(undo.nextDocument, result.memento, "redo");
    if (!redo.ok) throw new Error(redo.error.message);
    redo.nextDocument.evaluate();
    expect(serializeDocumentState(redo.nextDocument)).toBe(after);
    const renamed = applyBatchWithUndo(redo.nextDocument, [{ op: "rename_sheet", sheet: "Sheet", newName: "Renamed" }]);
    if (!renamed.ok) throw new Error(renamed.error.message);
    expect(serializeDocumentState(renamed.nextDocument).startsWith(`${envelope}\n\n# Renamed\n`)).toBe(true);
  });
});
