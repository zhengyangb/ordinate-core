import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stageAgentAttachments } from "./agentAttachments";

const directories: string[] = [];
async function workspace() { const directory = await mkdtemp(path.join(tmpdir(), "ordinate-agent-attachments-test-")); directories.push(directory); return directory; }
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("assistant scratch attachments", () => {
  it("stages a PDF's text and all page images without exposing a user filename as a path", async () => {
    const directory = await workspace();
    const extract = vi.fn(() => ({ text: "--- Page 1 ---\nRevenue 100", pageCount: 2, images: [Buffer.from("png one"), Buffer.from("png two")] }));
    const staged = await stageAgentAttachments(directory, [{ name: "../revenue.pdf", kind: "pdf", bytes: new TextEncoder().encode("%PDF-1.7") }], extract);
    expect(extract).toHaveBeenCalledOnce();
    expect(staged.images).toEqual([
      { type: "localImage", path: path.join(directory, "attachments/01-page-01.png") },
      { type: "localImage", path: path.join(directory, "attachments/01-page-02.png") },
    ]);
    expect(await readFile(path.join(directory, "attachments/01-text.txt"), "utf8")).toContain("Revenue 100");
    expect(staged.prompt).toContain("attachments/01.pdf");
    expect(staged.prompt).not.toContain("attachments/../");
  });
  it("rejects incomplete PDF rendering before invoking the model", async () => {
    const directory = await workspace();
    await expect(stageAgentAttachments(directory, [{ name: "report.pdf", kind: "pdf", bytes: new TextEncoder().encode("%PDF-1.7") }],
      () => ({ text: "", pageCount: 2, images: [Buffer.from("png")] }))).rejects.toThrow("incomplete");
  });
  it("rejects invalid UTF-8 text", async () => {
    const directory = await workspace();
    await expect(stageAgentAttachments(directory, [{ name: "data.csv", kind: "text", bytes: new Uint8Array([0xff]) }],
      () => { throw new Error("PDF extractor should not run"); })).rejects.toThrow();
  });
  it("stages an Excel workbook as binary without decoding it as UTF-8", async () => {
    const directory = await workspace();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]);
    const staged = await stageAgentAttachments(directory, [{ name: "data.xlsx", kind: "workbook", bytes }],
      () => { throw new Error("PDF extractor should not run"); });
    expect(new Uint8Array(await readFile(path.join(directory, "attachments/01.xlsx")))).toEqual(bytes);
    expect(staged.prompt).toContain("ordinate-cli import --format xlsx");
  });
});
