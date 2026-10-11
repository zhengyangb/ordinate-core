import { parseArgs } from "node:util";
import { resolve } from "node:path";
import {
  inspectWorkbook, validateWorkbook, evaluateWorkbook, editWorkbook, decodeEditRequest,
  importWorkbook,
  CapabilityRequestError, listWorkbookOperations, workbookEditSchema,
  type CapabilityResult, type Inspection, type ValidationReport, type EvaluationReport,
  type EditReport, type CellQuery, type CandidateSource, type WorkbookImportResult,
} from "ordinate-core";
import { CliError, FileAdapter, readFileLimited, readStream, decodeUtf8, checkInterrupted, type WriteState } from "./file_adapter";
import cliPackage from "../package.json";
import corePackage from "../../core-ts/package.json";
import { languageReference, renderLanguageReference, LanguageReferenceError } from "./language_reference";
type Command = "inspect" | "validate" | "evaluate" | "edit" | "import";
type Result = CapabilityResult<Inspection | ValidationReport | EvaluationReport | EditReport> | WorkbookImportResult;
type Report = {
  contract: "ordinate-cli/1";
  ok: boolean;
  exitCode: number;
  command: Command | null;
  input: {
    path: string | null;
    revision: string | null;
  };
  result: Result | null;
  error: {
    kind: CliError["kind"];
    code: string;
    message: string;
    path?: string;
  } | null;
  write: WriteState;
};
const argv = process.argv.slice(2), commands = ["inspect", "validate", "evaluate", "edit", "import"] as const;
const optionNames = { json: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean" }, operation: { type: "string" }, schema: { type: "boolean" }, sheet: { type: "string" }, rows: { type: "string" }, columns: { type: "string" }, notes: { type: "boolean" }, operations: { type: "string" }, format: { type: "string" }, options: { type: "string" }, write: { type: "boolean" }, output: { type: "string" } } as const;
function usage(message: string): never { throw new CliError("usage", "invalid_arguments", message); }
function help(command?: Command, operation?: string, schema = false): string {
  if (operation) {
    const selected = listWorkbookOperations().find(o => o.op === operation);
    if (!selected)
      usage(`Unknown operation '${operation}'.`);
    return `${operation}\n${JSON.stringify(selected.schema, null, 2)}\n`;
  }
  if (schema)
    return JSON.stringify(workbookEditSchema(), null, 2) + "\n";
  const common = `Ordinate — inspect, validate, calculate, edit and import workbooks\n\nUsage: ordinate-cli <command> <source> [options]\nCommands: inspect, validate, evaluate, edit, import\nSource: file path, or - for stdin\nOptions: -h, --help; --json; --version\nDefaults: text reports; no file changes. Errors return a nonzero exit status.\n\nExamples:\n  ordinate-cli inspect model.ord --json\n  ordinate-cli validate model.ord\n  ordinate-cli evaluate model.ord --sheet Sheet --json\n  ordinate-cli edit model.ord --operations changes.json --write\n  ordinate-cli import data.xlsx --format xlsx --output data.ord\n\nUse ordinate-cli <command> --help for command options.\nLanguage reference: ordinate-cli help [syntax|formulas|references|formats|notes|functions]\nFunction detail: ordinate-cli help function <name>\n`;
  if (!command)
    return common;
  if (command === "import")
    return `${common}\nimport: convert XLSX, CSV or TSV to a new .ord workbook. The source is never modified.\n--format xlsx|csv|tsv is required; --output <new-file|-> writes the result.\n--options <file|-> supplies optional JSON fields from the shared import request.\nFor CSV/TSV, sheetName is required; valueMode defaults to text (use infer explicitly).\nFor XLSX, unsupportedContent defaults to reject; preserve-text is explicit and lossy.\nExample: ordinate-cli import data.csv --format csv --options import.json --output data.ord\nOptions example: {"sheetName":"Data","valueMode":"infer","headers":[{"sheetName":"Data","headerRows":1,"headerColumns":0}]}\n`;
  if (command !== "edit")
    return `${common}\n${command}: ${command === "validate" ? "Check syntax/structure; does not evaluate formulas." : command === "inspect" ? "Read inputs, labels and display metadata; does not calculate." : "Recompute the whole workbook; does not trust stored caches."}\n${command === "validate" ? "" : "Selection: --sheet <exact-name> [--rows start:end] [--columns start:end]\nRanges use zero-based semantic indexes and exclusive end; default is first 50 rows/20 columns.\n"}${command === "inspect" ? "--notes includes notes for --sheet.\n" : command === "evaluate" ? "--write refreshes source caches; --output <new-file|-> writes a candidate.\n" : ""}`;
  return `${common}\nedit: ordered atomic batch; edit does not evaluate formulas.\n--operations <file|-> supplies JSON; a pipe/here-document needs no temporary file.\n--write applies it in place; --output <new-file|-> writes a candidate.\nWithout a destination, returns a proposal and leaves the source unchanged.\nRequired JSON: {"baseRevision":"sha256:...","operations":[...]}\nObtain baseRevision from inspect/validate; names are exact; ambiguous names fail.\nRow: {"kind":"path","path":["Revenue","Services"]} or {"kind":"index","index":1}\nColumn: {"kind":"label","label":"2027"} or {"kind":"index","index":2}\nTargets use current staged coordinates; previous operations can change indexes.\nRegion: {"sheet":"Sheet","rows":{"start":1,"end":3},"columns":{"start":1,"end":2}}\nset_region writes explicit inputs/formulas. fill_region extends an adjacent data region.\nMove gaps are measured after removal; duplicate gaps are measured before insertion.\nYou can also edit the .ord text directly, then validate and evaluate it.\n\nOperations (required payload fields):\n${listWorkbookOperations().map(({ op, schema }) => `  ${op}: ${(schema.required as string[]).filter(k => k !== "op").join(", ")}`).join("\n")}\n\nOperation details: ordinate-cli edit --help --operation <name>\nComplete JSON Schema: ordinate-cli edit --help --schema\n`;
}
function parseWindow(value: string): {
  start: number;
  end: number;
} {
  if (!/^\d+:\d+$/.test(value))
    usage("Ranges must be start:end using nonnegative integers.");
  const [start, end] = value.split(":").map(Number);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end)
    usage("Ranges must be nonempty and use safe integers.");
  return { start, end };
}
const HOST_EXIT_CODES: Record<CliError["kind"], number> = { usage: 2, io: 7, conflict: 6, internal: 8, interrupted: 130 };
function exitCode(result: Result | null, error: Report["error"]): number {
  if (error)
    return HOST_EXIT_CODES[error.kind];
  if (!result)
    return 8;
  if (result.status === "rejected") {
    const f = result.failure;
    if (f.code === "stale_source")
      return 6;
    if (f.code === "invalid_request" || f.code === "limit_exceeded")
      return 2;
    if (f.stage === "validation")
      return 3;
    if (f.stage === "import")
      return 5;
    if (f.stage === "serialize")
      return 8;
    return f.stage === "resolve" ? 2 : 5;
  }
  if ("valid" in result.data && !result.data.valid)
    return 3;
  if ("summary" in result.data && "errorCount" in result.data.summary && result.data.summary.errorCount)
    return 4;
  return 0;
}
function textReport(r: Report): {
  out: string;
  err: string;
} {
  const err: string[] = [];
  if (r.error)
    err.push(`${r.error.code}: ${r.error.message}${r.error.path ? ` (${r.error.path})` : ""}`);
  if (r.result?.status === "rejected")
    err.push(`${r.result.failure.code}: ${r.result.failure.message}${"operationIndex" in r.result.failure && r.result.failure.operationIndex !== undefined ? ` (operation ${r.result.failure.operationIndex})` : ""}`);
  for (const d of r.result?.diagnostics ?? [])
    if (!("severity" in d) || d.severity === "error") err.push(`${d.code}: ${d.message}`);
  let out = `${r.command ?? "Command"} failed.\n`;
  if (r.result?.status === "completed") {
    const data = r.result.data;
    if (r.command === "import" && "sheetCount" in data)
      out = `Imported ${data.sheetCount} sheet${data.sheetCount === 1 ? "" : "s"}.\nCandidate revision: ${data.candidate.revision}\n${r.result.diagnostics.filter(d => "severity" in d && d.severity === "warning").length} conversion warnings.\n`;
    else if ("valid" in data)
      out = `Validation ${data.valid ? "passed" : "failed"}: ${r.result.diagnostics.length} errors.\nRevision: ${r.input.revision}\n`;
    else if ("operationCount" in data)
      out = `Edit proposal created: ${data.operationCount} operations.\nCandidate revision: ${data.candidate.revision}\n`;
    else if ("summary" in data && "errorCount" in data.summary)
      out = `Evaluation ${data.summary.errorCount ? "failed" : "passed"}: ${data.summary.evaluatedCellCount} cells, ${data.summary.errorCount} errors.\n${data.selection ? JSON.stringify(data.selection, null, 2) + "\n" : ""}`;
    else if ("sheets" in data)
      out = `Revision: ${r.input.revision}\n${data.sheets.map(s => `${s.name}: ${s.rowCount} rows × ${s.columnCount} columns`).join("\n")}\n${data.selection ? JSON.stringify(data.selection, null, 2) + "\n" : ""}`;
  }
  if (r.write.status === "written" || r.write.status === "unchanged")
    out += `${r.write.status === "written" ? "Written" : "Unchanged"}: ${r.write.path}\n`;
  else if (r.write.status === "unknown")
    out += `Write outcome unknown: ${r.write.path}. Inspect the file before retrying.\n`;
  else if (r.result?.status === "completed" && "operationCount" in r.result.data)
    out += "Source file unchanged. Use --write to apply the proposal.\n";
  return { out, err: err.length ? err.join("\n") + "\n" : "" };
}
function jsonReport(r: Report, fileDestinationRequested: boolean): string {
  const result = r.result;
  if (!fileDestinationRequested || result?.status !== "completed" || !("candidate" in result.data))
    return JSON.stringify(r);
  const data: Record<string, unknown> = { ...result.data };
  delete data.candidate;
  return JSON.stringify({ ...r, result: { ...result, data } });
}
function writeStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => { stream.write(text, e => e ? reject(e) : resolve()); });
}
// Error listeners prevent a second unhandled stream error after the write callback.
process.stdout.on("error", () => { });
process.stderr.on("error", () => { });
const jsonMode = argv.slice(0, argv.indexOf("--") < 0 ? undefined : argv.indexOf("--")).includes("--json");
let adapter: FileAdapter | undefined, raw: string | undefined;
let fileDestinationRequested = false;
const interruption = new AbortController();
process.on("SIGINT", () => interruption.abort());
const report: Report = { contract: "ordinate-cli/1", ok: false, exitCode: 8, command: null, input: { path: null, revision: null }, result: null, error: null, write: { status: "not_requested", path: null, revision: null } };
try {
  const { values, positionals, tokens } = parseArgs({ args: argv, options: optionNames, allowPositionals: true, tokens: true, strict: true });
  const seen = new Set<string>();
  for (const t of tokens)
    if (t.kind === "option") {
      if (seen.has(t.name))
        usage(`Duplicate option --${t.name}.`);
      seen.add(t.name);
    }
  const first = positionals[0];
  if (first === "help") {
    if (Object.keys(values).some(k => !["help", "json"].includes(k)) || (values.help && (values.json || positionals.length !== 1)))
      usage("Use ordinate-cli help [topic] [--json], or ordinate-cli help function <name> [--json].");
    const reference = languageReference(positionals.slice(1));
    await writeStream(process.stdout, values.json ? JSON.stringify({ contract: "ordinate-language-reference/1", cliVersion: cliPackage.version, coreVersion: corePackage.version, ...reference }) + "\n" : renderLanguageReference(reference));
    process.exitCode = 0;
  }
  else {
    if (first && !commands.includes(first as Command))
      usage(`Unknown command '${first}'.`);
    report.command = first as Command ?? null;
    if (values.help || values.version) {
      if (values.json || (values.version && first) || Object.keys(values).some(k => !["help", "version", "operation", "schema"].includes(k)) || positionals.length > 1 || (values.help && values.version) || ((values.operation || values.schema) && (!values.help || first !== "edit")) || (values.operation && values.schema))
        usage("Use help/version alone; edit --help accepts --operation <name> or --schema.");
      await writeStream(process.stdout, values.version ? `${cliPackage.name} ${cliPackage.version} (core ${corePackage.version})\n` : help(report.command ?? undefined, values.operation, values.schema));
      process.exitCode = 0;
    }
    else {
      if (!first || positionals.length !== 2)
        usage("Supply a command and one source. Run ordinate-cli --help.");
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(positionals[1]))
        usage("Source must be a file path or -; URLs are not supported.");
      const command = report.command!;
      const allowed = new Set(["json", ...(["inspect", "evaluate"].includes(command) ? ["sheet", "rows", "columns"] : []), ...(command === "inspect" ? ["notes"] : []), ...(command === "evaluate" || command === "edit" ? ["write", "output"] : []), ...(command === "edit" ? ["operations"] : []), ...(command === "import" ? ["format", "options", "output"] : [])]);
      for (const k of Object.keys(values))
        if (!allowed.has(k))
          usage(`--${k} does not apply to ${command}.`);
      for (const [k, v] of Object.entries(values))
        if (typeof v === "string" && v.length === 0)
          usage(`--${k} requires a nonempty value.`);
      if ((values.rows || values.columns || values.notes) && !values.sheet)
        usage("--rows, --columns and --notes require --sheet.");
      if (values.write && values.output !== undefined)
        usage("Choose --write or --output, not both.");
      if (values.output === "-" && values.json)
        usage("Raw document output cannot be combined with --json.");
      if (command === "import" && !["xlsx", "csv", "tsv"].includes(values.format ?? ""))
        usage("import requires --format xlsx|csv|tsv.");
      fileDestinationRequested = values.write === true || (values.output !== undefined && values.output !== "-");
      if (command === "edit" && values.operations === undefined)
        usage("edit requires --operations <file|->. Run ordinate-cli edit --help.");
      if (positionals[1] === "-" && values.write)
        usage("--write requires a named source.");
      if (positionals[1] === "-" && values.operations === "-")
        usage("Source and operations cannot both consume stdin.");
      if (positionals[1] === "-" && values.options === "-")
        usage("Source and import options cannot both consume stdin.");
      if (process.stdin.isTTY && (positionals[1] === "-" || values.operations === "-" || values.options === "-"))
        usage("Pipe input to stdin; interactive input is not supported.");
      const query: CellQuery | undefined = values.sheet === undefined ? undefined : { sheet: values.sheet, ...(values.rows ? { rows: parseWindow(values.rows) } : {}), ...(values.columns ? { columns: parseWindow(values.columns) } : {}), ...(values.notes ? { includeNotes: true } : {}) };
      report.input.path = positionals[1] === "-" ? null : resolve(positionals[1]);
      adapter = new FileAdapter(report.input.path, values.write ? { kind: "inplace" } : values.output && values.output !== "-" ? { kind: "file", path: values.output } : undefined, interruption.signal);
      report.write = adapter.write;
      let request: ReturnType<typeof decodeEditRequest> | undefined;
      if (command === "edit") {
        const path = values.operations === "-" ? undefined : resolve(values.operations!);
        const bytes = path ? await readFileLimited(path, 4 * 1024 * 1024) : await readStream(process.stdin, 4 * 1024 * 1024, interruption.signal);
        let parsed: unknown;
        try {
          parsed = JSON.parse(decodeUtf8(bytes, path));
        }
        catch (e) {
          if (e instanceof SyntaxError)
            throw new CliError("usage", "invalid_operations_json", "Operations input is not valid JSON.", path);
          throw e;
        }
        request = decodeEditRequest(parsed);
      }
      if (command === "import") {
        let options: Record<string, unknown> = {};
        if (values.options !== undefined) {
          const path = values.options === "-" ? undefined : resolve(values.options);
          const bytes = path ? await readFileLimited(path, 4 * 1024 * 1024) : await readStream(process.stdin, 4 * 1024 * 1024, interruption.signal);
          try { options = JSON.parse(decodeUtf8(bytes, path)); }
          catch (e) {
            if (e instanceof SyntaxError) throw new CliError("usage", "invalid_import_options_json", "Import options are not valid JSON.", path);
            throw e;
          }
          if (!options || typeof options !== "object" || Array.isArray(options)) usage("Import options must be a JSON object.");
          if (Object.hasOwn(options, "format")) usage("Set import format with --format, not in --options.");
        }
        report.result = await importWorkbook(await adapter.readBytes(process.stdin, 16 * 1024 * 1024), { ...options, format: values.format });
      }
      else {
        const source = await adapter.read(process.stdin);
        report.result = command === "inspect" ? await inspectWorkbook(source, query) : command === "validate" ? await validateWorkbook(source) : command === "evaluate" ? await evaluateWorkbook(source, { ...(query ? { query } : {}), materialize: values.write === true || values.output !== undefined }) : await editWorkbook(source, request!);
      }
      report.input.revision = report.result.sourceRevision;
      if (exitCode(report.result, null) === 0 && report.result.status === "completed") {
        const data = report.result.data;
        const candidate: CandidateSource | null = "candidate" in data ? data.candidate : null;
        if (candidate && values.output === "-")
          raw = candidate.source;
        else if (candidate)
          await adapter.publish(candidate);
      }
      checkInterrupted(interruption.signal);
    }
  }
}
catch (e) {
  if (e instanceof LanguageReferenceError)
    report.error = { kind: "usage", code: "invalid_arguments", message: e.message };
  else if (e instanceof CliError)
    report.error = { kind: e.kind, code: e.code, message: e.message, ...(e.path ? { path: e.path } : {}) };
  else if (e instanceof CapabilityRequestError)
    report.result = { status: "rejected", sourceRevision: null, diagnostics: [], failure: { stage: "request", code: e.code, message: e.message } };
  else if (e instanceof TypeError && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS"))
    report.error = { kind: "usage", code: "invalid_arguments", message: e.message };
  else
    report.error = { kind: "internal", code: "internal_error", message: e instanceof Error ? e.message : String(e) };
}
try {
  await adapter?.close();
}
catch (e) {
  report.error = { kind: "io", code: "cleanup_failed", message: e instanceof Error ? e.message : String(e) };
}
if (process.exitCode !== 0) {
  report.exitCode = exitCode(report.result, report.error);
  report.ok = report.exitCode === 0;
  process.exitCode = report.exitCode;
  try {
    if (raw !== undefined && report.ok)
      await writeStream(process.stdout, raw);
    else if (jsonMode)
      await writeStream(process.stdout, jsonReport(report, fileDestinationRequested) + "\n");
    else {
      const text = textReport(report);
      if (text.err)
        await writeStream(process.stderr, text.err);
      await writeStream(process.stdout, text.out);
    }
  }
  catch (e) {
    process.exitCode = 7;
    try {
      await writeStream(process.stderr, `output_failed: ${e instanceof Error ? e.message : String(e)}; write status: ${report.write.status}\n`);
    }
    catch { /* No stream remains available. */ }
  }
}
