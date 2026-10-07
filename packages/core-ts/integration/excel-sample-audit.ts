/** Read-only real-file audit. Build with esbuild --bundle --platform=node and
 * pass a durable report directory followed by XLSX paths. Samples never enter
 * this repository; caches are evidence, never inputs or fixes. */
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  excelImportNoteCandidates, exportExcelWorkbook, getCellTextView, importPreparedExcelWorkbook,
  prepareExcelImport,
} from "../src";
import { parseExcelFormula } from "../src/excel/formulaParser";
import type { ExcelExpression } from "../src/excel/formulaAst";
import { excelImportRules } from "../src/excel/importRegistry";
import { listStandardFunctionMetadata } from "../src/runtime/functions";
import { columnAddress } from "../src/runtime/spreadsheetAddress";

const [directory, ...paths] = process.argv.slice(2);
if (!directory || !paths.length) throw new Error("Expected a durable report directory and at least one XLSX source path.");
const nativeNames = new Set(listStandardFunctionMetadata().map(item => item.name.toUpperCase()));
const knownGaps: Record<string, string> = {
  VLOOKUP: "Native exact lookup exists; inspect mode/return-column restrictions. Approximate lookup needs a native matching contract, not filter guards.",
  HLOOKUP: "Existing native lookup can cover horizontal exact matching; adapter projection is missing.",
  LOOKUP: "Excel legacy LOOKUP is approximate, not the same contract as native exact lookup.",
  SUMIF: "Native filtering/reduction exists; Excel criterion parsing/shape semantics need a deliberate adapter rule.",
  SUMIFS: "Native filtering/reduction exists; Excel criterion parsing/shape semantics need a deliberate adapter rule.",
  COUNTIF: "Native filtering/counting exists; Excel criterion parsing/shape semantics need a deliberate adapter rule.",
  COUNTIFS: "Native filtering/counting exists; Excel criterion parsing/shape semantics need a deliberate adapter rule.",
  CHOOSE: "Native indexing exists; 1-based dynamic selection and bounds need an explicit adapter rule.",
  ISNA: "Native error handling exists; exact Excel #N/A classification is not equivalent to broad isError.",
  TRIM: "Intentional semantic gap: native Unicode edge trim must not acquire Excel interior-space compression.",
  OFFSET: "Dynamic reference construction needs explicit native view/reference semantics; not inherently impossible.",
  INDIRECT: "Text-to-reference construction is absent; adding it changes dependency tracking and reference semantics.",
  TODAY: "Volatile current-date semantics are absent; native date construction is not equivalent.",
  NOW: "Volatile clock semantics are absent; native datetime construction is not equivalent.",
  TABLE: "Excel what-if data tables require scenario recalculation, not a scalar function rename.",
};
function inventory(node: ExcelExpression, counts: Map<string, number>, lookupModes: Record<string, number>): void {
  if (node.kind === "call") {
    const name = node.name.replace(/^_xlfn\./i, "").replace(/^_xlws\./i, "");
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (name === "VLOOKUP") {
      const mode = node.args[3];
      const key = !mode || mode.kind === "missing" ? "omittedApproximate"
        : mode.kind === "boolean" ? mode.value ? "explicitApproximate" : "explicitExactLiteral"
        : mode.kind === "number" ? mode.value === 0 ? "explicitExactLiteral" : "explicitApproximate" : "dynamic";
      lookupModes[key]++;
    }
    for (const arg of node.args) inventory(arg, counts, lookupModes);
  } else if (node.kind === "binary") { inventory(node.left, counts, lookupModes); inventory(node.right, counts, lookupModes); }
  else if (node.kind === "unary") inventory(node.operand, counts, lookupModes);
  else if (node.kind === "array") for (const row of node.rows) for (const arg of row) inventory(arg, counts, lookupModes);
}

const reports = [];
for (const path of paths) {
  const bytes = new Uint8Array(await readFile(path));
  const started = performance.now();
  const prepared = await prepareExcelImport(bytes, { unsupportedContent: "preserve-text" });
  if (!prepared.ok) {
    reports.push({ path: resolve(path), ok: false, diagnostics: prepared.diagnostics });
    console.log(JSON.stringify({ sample: basename(path), ok: false, diagnostics: prepared.diagnostics }));
    continue;
  }
  const counts = new Map<string, number>();
  const lookupModes = { explicitExactLiteral: 0, omittedApproximate: 0, explicitApproximate: 0, dynamic: 0 };
  let formulaCount = 0;
  const formulaParseFailures: unknown[] = [];
  for (const sheet of prepared.value.workbook.sheets) sheet.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.formula === undefined) return;
    formulaCount++;
    try { inventory(parseExcelFormula(cell.formula), counts, lookupModes); }
    catch (error) {
      // Formula parsing has a declared compatibility error; programmer defects
      // must fail this audit instead of disappearing into a report.
      if (!(error instanceof Error) || error.name !== "ExcelFailure") throw error;
      formulaParseFailures.push({ sheet: sheet.name, cell: `${columnAddress(c)}${r + 1}`, formula: cell.formula, error: error.message });
    }
  }));
  const imported = await importPreparedExcelWorkbook(prepared.value, { unsupportedContent: "preserve-text",
    headers: prepared.value.workbook.sheets.map(sheet => ({ sheetName: sheet.name, headerRows: 0, headerColumns: 0 })), notes: [] });
  if (!imported.ok) {
    reports.push({ path: resolve(path), ok: false, formulaCount, diagnostics: imported.diagnostics });
    console.log(JSON.stringify({ sample: basename(path), ok: false, formulaCount, diagnostics: imported.diagnostics }));
    continue;
  }
  const importMs = performance.now() - started, evaluated = imported.value.evaluate();
  const differences: unknown[] = [], preserved: unknown[] = [], nativeErrors: unknown[] = [], cachedErrors: unknown[] = [];
  const sourceErrors: unknown[] = [];
  let numericMatches = 0, otherMatches = 0, missingCaches = 0;
  prepared.value.workbook.sheets.forEach((sheet, s) => sheet.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.formula === undefined) return;
    const location = { sheet: sheet.name, cell: `${columnAddress(c)}${r + 1}`, formula: cell.formula };
    if (cell.value !== null && typeof cell.value === "object") sourceErrors.push({ ...location, cached: cell.value });
    const target = imported.value.sheets[s].cells[r][c], actual = evaluated.sheets[s].values[r][c];
    if (target.body.valid && target.body.kind === "literal") { preserved.push(location); return; }
    if (actual.kind === "error") { nativeErrors.push({ ...location, actual }); return; }
    if (cell.value === null) { missingCaches++; return; }
    if (typeof cell.value === "object") { cachedErrors.push({ ...location, cached: cell.value, actual }); return; }
    if (typeof cell.value === "number" && actual.kind === "number") {
      const delta = Math.abs(cell.value - actual.value), tolerance = 1e-9 + 1e-9 * Math.abs(cell.value);
      if (delta <= tolerance) numericMatches++;
      else differences.push({ ...location, cached: cell.value, actual, delta, tolerance });
    } else if (actual.value === cell.value) otherMatches++;
    else differences.push({ ...location, cached: cell.value, actual });
  })));
  const evaluationMs = performance.now() - started - importMs;
  const exportStarted = performance.now(), exported = await exportExcelWorkbook(imported.value);
  const report = {
    path: resolve(path), ok: true, bytes: bytes.length, sheets: prepared.value.workbook.sheets.length,
    formulaCount, importMs, evaluationMs, lookupModes,
    functions: [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count,
      mapping: excelImportRules.has(name) ? "registered (argument modes may be restricted)" : "missing",
      review: excelImportRules.has(name) ? undefined : knownGaps[name] ?? (nativeNames.has(name)
        ? "Native capability exists, but an explicit Excel adapter decision is missing."
        : "Native function is absent; inspect its semantics before deciding whether to add it."),
    })),
    diagnostics: imported.diagnostics, formulaParseFailures,
    cacheComparison: { numericMatches, otherMatches, missingCaches, differences, preserved, nativeErrors, cachedErrors, sourceErrors },
    preservedReviews: imported.diagnostics.filter(item => item.code === "formula_preserved_as_text")
      .map(item => ({ sheet: item.sheetName, firstCell: item.rowIndex === undefined || item.colIndex === undefined
        ? undefined : `${columnAddress(item.colIndex)}${item.rowIndex + 1}`, count: item.count ?? 1,
        reason: item.message, example: item.formula })),
    noteCandidates: excelImportNoteCandidates(prepared.value),
    strictExport: { ok: exported.ok, ms: performance.now() - exportStarted, diagnostics: exported.diagnostics },
  };
  reports.push(report);
  console.log(JSON.stringify({ sample: basename(path), ok: true, formulaCount, importMs: Math.round(importMs),
    numericMatches, otherMatches, missingCaches, differences: differences.length, preserved: preserved.length,
    nativeErrors: nativeErrors.length, cachedErrors: cachedErrors.length, strictExport: exported.ok,
    missingMappings: report.functions.filter(item => item.mapping === "missing") }));
}
await writeFile(join(directory, "report.json"), JSON.stringify({ numericTolerance: "abs=1e-9 + rel=1e-9; caches may be stale; no repairs performed", reports }, null, 2));
