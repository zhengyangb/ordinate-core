import { describe, expect, it } from "vitest";
import { attachmentKind, attachmentPickerAccept, checkAttachmentSelection, readAttachments, verifyAttachmentBytes } from "./attachments";

describe("assistant attachments", () => {
  it("accepts a text-only message without attachments", async () => {
    expect(() => checkAttachmentSelection([])).not.toThrow();
    expect(await readAttachments([])).toEqual([]);
  });
  it.each([["scan.PDF", "pdf"], ["photo.jpeg", "image"], ["data.csv", "text"], ["model.ord", "text"], ["model.xlsx", "workbook"]] as const)("classifies %s", (name, kind) => {
    expect(attachmentKind(name)).toBe(kind);
  });
  it("offers exactly the supported extensions in each picker", () => {
    expect(attachmentPickerAccept("image")).toBe(".png,.jpg,.jpeg,.webp");
    expect(attachmentPickerAccept("document")).toBe(".pdf,.txt,.md,.csv,.tsv,.ord,.xlsx");
  });
  it("rejects unknown, empty, oversized and excessive input before reading", () => {
    expect(() => attachmentKind("archive.zip")).toThrow("Attach");
    expect(() => checkAttachmentSelection([{ name: "x.pdf", size: 0 }])).toThrow("empty");
    expect(() => checkAttachmentSelection([{ name: "x.pdf", size: 16 * 1024 * 1024 + 1 }])).toThrow("too large");
    expect(() => checkAttachmentSelection(Array.from({ length: 5 }, (_, index) => ({ name: `${index}.txt`, size: 1 })))).toThrow("four");
  });
  it("reads file bytes and rejects masquerading types", async () => {
    const files = [new File(["%PDF-1.7\n"], "report.pdf")];
    const [attachment] = await readAttachments(files);
    expect(attachment).toMatchObject({ name: "report.pdf", kind: "pdf" });
    expect(() => verifyAttachmentBytes(attachment)).not.toThrow();
    expect(() => verifyAttachmentBytes({ ...attachment, bytes: new Uint8Array([1, 2, 3]) })).toThrow("does not match");
    expect(() => verifyAttachmentBytes({ ...attachment, kind: "image" })).toThrow("does not match");
  });
  it("keeps XLSX as binary input for the import capability", () => {
    const workbook = { name: "data.xlsx", kind: "workbook" as const, bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]) };
    expect(() => verifyAttachmentBytes(workbook)).not.toThrow();
    expect(() => verifyAttachmentBytes({ ...workbook, bytes: new Uint8Array([1, 2, 3]) })).toThrow("does not match");
  });
});
