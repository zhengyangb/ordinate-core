import { isAbsolute, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { importWorkbook } from "ordinate-core";
import { FileAdapter } from "./file_adapter";
import manifest from "../package.json";

const header = z.strictObject({ sheetName: z.string(), headerRows: z.number().int().nonnegative(), headerColumns: z.number().int().nonnegative() });
const note = z.strictObject({ sheetName: z.string(), beforeRows: z.number().int().nonnegative(), afterRows: z.number().int().nonnegative() });
const paths = {
  sourcePath: z.string().min(1).describe("Absolute path to an XLSX, CSV, or TSV file"),
  outputPath: z.string().min(1).describe("New absolute .ord path; an existing file is never overwritten"),
};
const delimited = {
  ...paths,
  sheetName: z.string().min(1),
  valueMode: z.enum(["text", "infer"]).optional().describe("Defaults to text; inference is explicit"),
  headers: z.array(header).optional(),
};
const input = z.discriminatedUnion("format", [
  z.strictObject({
    ...paths,
    format: z.literal("xlsx"),
    unsupportedContent: z.enum(["reject", "preserve-text"]).optional().describe("XLSX defaults to reject; preservation as text is lossy"),
    headers: z.array(header).optional(),
    notes: z.array(note).optional(),
  }),
  z.strictObject({ ...delimited, format: z.literal("csv") }),
  z.strictObject({ ...delimited, format: z.literal("tsv") }),
]);

function createServer(): McpServer {
  const server = new McpServer({ name: "ordinate", version: manifest.version });
  server.registerTool("ordinate_import", {
    description: "Deterministically convert an Excel XLSX, CSV, or TSV file into a new Ordinate workbook before editing it. Never overwrites the input or an existing output.",
    inputSchema: input,
  }, async ({ sourcePath, outputPath, ...request }) => {
    if (!isAbsolute(sourcePath) || !isAbsolute(outputPath)) return { isError: true, content: [{ type: "text", text: "sourcePath and outputPath must be absolute paths." }] };
    const adapter = new FileAdapter(resolve(sourcePath), { kind: "file", path: resolve(outputPath) });
    try {
      const bytes = await adapter.readBytes(process.stdin, 16 * 1024 * 1024);
      const result = await importWorkbook(bytes, request);
      if (result.status === "rejected") return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }] };
      await adapter.publish(result.data.candidate);
      return { content: [{ type: "text", text: JSON.stringify({
        outputPath: adapter.write.path,
        sourceRevision: result.sourceRevision,
        revision: result.data.candidate.revision,
        sheetCount: result.data.sheetCount,
        diagnostics: result.diagnostics,
      }) }] };
    }
    catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
    finally { await adapter.close(); }
  });
  return server;
}

void serveStdio(createServer);
