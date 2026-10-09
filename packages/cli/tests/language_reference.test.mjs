import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

const cli = resolve("dist/ordinate-cli.mjs");
function run(args, input, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, status, result.stderr + result.stdout);
  return result;
}
function reference(...args) {
  const result = run(["help", ...args, "--json"]);
  assert.equal(result.stderr, "");
  const ref = JSON.parse(result.stdout);
  assert.equal(ref.contract, "ordinate-language-reference/1");
  assert.ok(ref.cliVersion && ref.coreVersion);
  return ref;
}
test("short help discovers read-only language topics without a source", () => {
  assert.match(run(["--help"]).stdout, /ordinate-cli help/);
  assert.equal(reference().topic, "index");
  assert.match(run(["help", "--help"]).stdout, /Function detail/);
  for (const topic of ["syntax", "formulas", "references", "formats", "notes", "functions"]) {
    assert.equal(reference(topic).topic, topic);
    assert.ok(run(["help", topic]).stdout.length);
  }
});
test("function discovery returns runtime metadata and resolves aliases/case", () => {
  const functions = reference("functions").functions;
  assert.ok(functions.length > 0);
  assert.equal(new Set(functions.map(f => f.name)).size, functions.length);
  for (const name of ["sum", "filter", "format", "lookup", "date", "log10"]) {
    const fn = functions.find(f => f.name === name);
    assert.ok(fn, name);
    assert.deepEqual(reference("function", name.toUpperCase()).function, fn);
    for (const alias of fn.aliases ?? []) assert.deepEqual(reference("function", alias).function, fn);
  }
  assert.match(run(["help", "function", "sum"]).stdout, /sum\(x: view/);
});
test("unknown topics/functions and incompatible flags fail early", () => {
  for (const args of [["help", "missing"], ["help", "function"], ["help", "function", "not_a_function"], ["help", "syntax", "extra"], ["help", "function", "sum", "extra"], ["help", "formats", "--write"], ["help", "--version"], ["help", "--help", "--json"], ["help", "formulas", "--help"], ["help", "--json", "--json"]]) {
    const result = run([...args, ...(args.includes("--json") ? [] : ["--json"])], undefined, 2);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.exitCode, 2);
    assert.equal(report.error.kind, "usage");
    assert.equal(report.write.status, "not_requested");
  }
});
for (const topic of ["syntax", "formulas", "references", "formats", "notes"]) {
  test(`${topic} reference workbooks validate and compute their advertised values`, () => {
    const ref = reference(topic);
    assert.ok(ref.examples.length);
    for (const example of ref.examples) {
      const valid = JSON.parse(run(["validate", "-", "--json"], example.source).stdout);
      assert.equal(valid.ok, true);
      const evaluated = JSON.parse(run(["evaluate", "-", "--sheet", example.sheet, "--json"], example.source).stdout);
      assert.equal(evaluated.ok, true);
      assert.equal(evaluated.result.data.summary.errorCount, 0);
      const values = evaluated.result.data.selection.values;
      for (const check of example.checks) assert.deepEqual(values[check.row][check.column], { kind: check.kind, value: check.value });
    }
  });
}
test("coordinate-shaped Ordinate selectors resolve header names, not spreadsheet coordinates", () => {
  const source = `# Labels
| Item || K1 | Q1 | Result |
| --- || --- | --- | --- |
| North || 10 | 120 | = sum(@[:,K1]) |
| South || 20 | 50 | = sum(@[:,Q1]) |
`;
  const evaluated = JSON.parse(run(["evaluate", "-", "--sheet", "Labels", "--json"], source).stdout);
  assert.equal(evaluated.ok, true);
  const values = evaluated.result.data.selection.values;
  assert.deepEqual(values[1][3], { kind: "number", value: "30" });
  assert.deepEqual(values[2][3], { kind: "number", value: "170" });
});
const catalogProbe = formula => `# Products
| SKU || Price |
| --- || --- |
| AC-1 || 25 |
| AC-3 || 40 |

# Check
| Metric || Value |
| --- || --- |
| Result || = ${formula} |
`;
for (const [wrong, correct, expected] of [
  ['@["Products"::[AC-1,Price]]', '@["Products"::["AC-1",Price]]', "25"],
  ["@['Products'::[\"AC-1\",Price]]", '@["Products"::["AC-1",Price]]', "25"],
  ['sum(@["Products"::[AC-1:AC-3,Price]])', 'sum(@["Products"::["AC-1":"AC-3",Price]])', "65"],
]) {
  test(`quoted selector correction: ${wrong}`, () => {
    const invalid = JSON.parse(run(["validate", "-", "--json"], catalogProbe(wrong), 3).stdout);
    assert.equal(invalid.ok, false);
    const source = catalogProbe(correct);
    assert.equal(JSON.parse(run(["validate", "-", "--json"], source).stdout).ok, true);
    const evaluated = JSON.parse(run(["evaluate", "-", "--sheet", "Check", "--json"], source).stdout);
    assert.deepEqual(evaluated.result.data.selection.values[1][1], { kind: "number", value: expected });
  });
}
for (const [wrong, correct, expected] of [
  ["@[Quantity,_]", "@[_,Quantity]", "2"],
  ["max(0, 10 - 20)", "max([0, 10 - 20])", "0"],
]) {
  test(`expression correction needs evaluation: ${wrong}`, () => {
    const ledger = formula => `# Ledger\n| Order || Quantity | Result |\n| --- || --- | --- |\n| O01 || 2 | = ${formula} |\n`;
    assert.equal(JSON.parse(run(["validate", "-", "--json"], ledger(wrong)).stdout).ok, true);
    const failed = JSON.parse(run(["evaluate", "-", "--sheet", "Ledger", "--json"], ledger(wrong), 4).stdout);
    assert.equal(failed.ok, false);
    assert.equal(failed.result.data.summary.errorCount, 1);
    const evaluated = JSON.parse(run(["evaluate", "-", "--sheet", "Ledger", "--json"], ledger(correct)).stdout);
    assert.deepEqual(evaluated.result.data.selection.values[1][2], { kind: "number", value: expected });
  });
}
test("multi-row column headers resolve full paths, not parent labels or repeated leaves", () => {
  const source = `# Years
| Item || 2026 | 2027 |
| Basis || Forecast | Forecast |
| --- || --- | --- |
| Revenue || 10 | 20 |
| Check || = @[Revenue,"2026".Forecast] | = @[Revenue,"2027".Forecast] |
`;
  const evaluate = (s, exit = 0) => JSON.parse(run(["evaluate", "-", "--sheet", "Years", "--json"], s, exit).stdout);
  const values = evaluate(source).result.data.selection.values;
  assert.deepEqual(values[3][1], { kind: "number", value: "10" });
  assert.deepEqual(values[3][2], { kind: "number", value: "20" });
  for (const [selector, code] of [['"2026"', "unresolved_reference_label_not_found"], ["Forecast", "ambiguous_reference_label"]]) {
    const wrong = source.replace('"2026".Forecast]', `${selector}]`);
    assert.equal(JSON.parse(run(["validate", "-", "--json"], wrong).stdout).ok, true);
    const failed = evaluate(wrong, 4);
    assert.equal(failed.result.data.summary.errorCount, 1);
    assert.equal(failed.result.diagnostics[0].code, code);
  }
});
test("quotes in header source are literal name characters, not selector delimiters", () => {
  const source = `# Years
| Item || 2026 |
| --- || --- |
| Revenue || 10 |
| Check || = @[Revenue,"2026"] |
`;
  assert.equal(JSON.parse(run(["evaluate", "-", "--json"], source).stdout).ok, true);
  const quoted = source.replace("| Item || 2026 |", '| Item || "2026" |');
  assert.equal(JSON.parse(run(["validate", "-", "--json"], quoted).stdout).ok, true);
  const failed = JSON.parse(run(["evaluate", "-", "--json"], quoted, 4).stdout);
  assert.equal(failed.result.data.summary.errorCount, 1);
  assert.equal(failed.result.diagnostics[0].code, "unresolved_reference_label_not_found");
});
test("filter scalar keys must be extracted from differently shaped reference views", () => {
  const source = `# Ledger
| Row || Client | Hours | Total |
| --- || --- | --- | --- |
| First || Atlas | 2 | = sum(filter(@[:,Hours], @[:,Client] == index(@[_,Client], 0))) |
| Second || Beacon | 3 | |
`;
  const values = JSON.parse(run(["evaluate", "-", "--sheet", "Ledger", "--json"], source).stdout).result.data.selection.values;
  assert.deepEqual(values[1][3], { kind: "number", value: "2" });
  const wrong = source.replace("index(@[_,Client], 0)", "@[_,Client]");
  assert.equal(JSON.parse(run(["validate", "-", "--json"], wrong).stdout).ok, true);
  const failed = JSON.parse(run(["evaluate", "-", "--json"], wrong, 4).stdout);
  assert.equal(failed.result.diagnostics[0].code, "invalid_view_comparison");
});
test("hierarchical range endpoints do not inherit each other's parent path", () => {
  const source = `# Plan
| Item || Q1 |
| --- || --- |
| Costs || |
| * Materials || 10 |
| * Labor || 20 |
| Other || |
| * Labor || 3 |
| Total || = sum(@[Costs.Materials:Costs.Labor,Q1]) |
`;
  const values = JSON.parse(run(["evaluate", "-", "--sheet", "Plan", "--json"], source).stdout).result.data.selection.values;
  assert.deepEqual(values[6][1], { kind: "number", value: "30" });
  const wrong = source.replace("Costs.Materials:Costs.Labor", "Costs.Materials:Labor");
  assert.equal(JSON.parse(run(["validate", "-", "--json"], wrong).stdout).ok, true);
  const failed = JSON.parse(run(["evaluate", "-", "--json"], wrong, 4).stdout);
  assert.equal(failed.result.diagnostics[0].code, "unresolved_reference_label_not_found");
});
test("duration seconds are components; datetime subtraction keeps overnight elapsed time", () => {
  const temporal = formula => `# Temporal\n| Item || Result |\n| --- || --- |\n| Elapsed || = ${formula} |\n`;
  const valid = JSON.parse(run(["evaluate", "-", "--sheet", "Temporal", "--json"], temporal("2027-02-16T01:30:00Z - 2027-02-15T23:00:00Z")).stdout);
  assert.deepEqual(valid.result.data.selection.values[1][1], { kind: "duration", value: "PT2H30M" });
  const wrong = temporal("duration(0, 0, 0, 9000)");
  assert.equal(JSON.parse(run(["validate", "-", "--json"], wrong).stdout).ok, true);
  const failed = JSON.parse(run(["evaluate", "-", "--json"], wrong, 4).stdout);
  assert.equal(failed.result.diagnostics[0].code, "invalid_function_call");
  assert.equal(failed.result.diagnostics[0].details.reason, "invalid_second");
});
test("direct row insertion preserves named targets but does not rebase positional references", () => {
  const source = `# Plan
| Item || Q1 |
| --- || --- |
| Revenue || 100 |
| Costs || 40 |
| Named profit || = @[Revenue,Q1] - @[Costs,Q1] |
| Positional profit || = B2 - B3 |
`;
  const values = s => JSON.parse(run(["evaluate", "-", "--sheet", "Plan", "--json"], s).stdout).result.data.selection.values;
  const before = values(source);
  assert.deepEqual(before[3][1], { kind: "number", value: "60" });
  assert.deepEqual(before[4][1], { kind: "number", value: "60" });
  const after = values(source.replace("| Revenue ||", "| Reserve || 7 |\n| Revenue ||"));
  assert.deepEqual(after[4][1], { kind: "number", value: "60" });
  assert.deepEqual(after[5][1], { kind: "number", value: "-93" });
});
test("current-row named columns survive direct column insertion and reordering", () => {
  const before = `# Ledger
| Order || Quantity | Unit price | Total |
| --- || --- | --- | --- |
| North || 2 | 15 | = @[_,Quantity] * @[_,"Unit price"] |
| South || 3 | 20 | = @[_,Quantity] * @[_,"Unit price"] |
`;
  const after = `# Ledger
| Order || Unit price | Discount | Quantity | Total |
| --- || --- | --- | --- | --- |
| North || 15 | 0 | 2 | = @[_,Quantity] * @[_,"Unit price"] |
| South || 20 | 0 | 3 | = @[_,Quantity] * @[_,"Unit price"] |
`;
  for (const [source,column] of [[before,3],[after,4]]) {
    const v = JSON.parse(run(["evaluate", "-", "--sheet", "Ledger", "--json"], source).stdout).result.data.selection.values;
    assert.deepEqual(v[1][column], { kind: "number", value: "30" });
    assert.deepEqual(v[2][column], { kind: "number", value: "60" });
  }
});
test("named ranges change membership on direct insertion while explicit named sets do not", () => {
  const source = `# Plan
| Item || Value |
| --- || --- |
| First || 10 |
| Last || 20 |
| Range total || = sum(@[First:Last,Value]) |
| Exact total || = sum([@[First,Value], @[Last,Value]]) |
`;
  const values = s => JSON.parse(run(["evaluate", "-", "--sheet", "Plan", "--json"], s).stdout).result.data.selection.values;
  const before = values(source);
  assert.deepEqual(before[3][1], { kind: "number", value: "30" });
  assert.deepEqual(before[4][1], { kind: "number", value: "30" });
  const after = values(source.replace("| Last ||", "| Added || 7 |\n| Last ||"));
  assert.deepEqual(after[4][1], { kind: "number", value: "37" });
  assert.deepEqual(after[5][1], { kind: "number", value: "30" });
});
test("direct label renaming without updating named references fails evaluation", () => {
  const source = `# Plan
| Item || Value |
| --- || --- |
| Revenue || 100 |
| Result || = @[Revenue,Value] |
`;
  const renamed = source.replace("| Revenue ||", "| Sales ||");
  const valid = JSON.parse(run(["validate", "-", "--json"], renamed).stdout);
  assert.equal(valid.ok, true);
  const evaluated = JSON.parse(run(["evaluate", "-", "--sheet", "Plan", "--json"], renamed, 4).stdout);
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.result.data.summary.errorCount, 1);
});
test("format example uses a nonsemantic frame and preserves each metadata scope", () => {
  const example = reference("formats").examples[0];
  const view = JSON.parse(run(["inspect", "-", "--sheet", example.sheet, "--json"], example.source).stdout).result.data.selection;
  assert.equal(view.cells[0][0].input, "Item");
  assert.equal(view.cells[0][1].input, "Value");
  assert.equal(view.columnDefaults[1].format.kind, "numeric");
  assert.equal(view.columnDefaults[1].format.precision, 2);
  assert.equal(view.rowDefaults[2].style.weight, "bold");
  assert.equal(view.cells[2][1].localDisplay.format.type, "%");
  assert.equal(view.cells[3][1].localDisplay.format.pattern, "%Y-%m-%d");
});
test("authoring skill and release inclusion are explicit, without automatic installation", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.ok(pkg.files.includes("skills"));
  const skill = await readFile("skills/ordinate-authoring/SKILL.md", "utf8");
  assert.match(skill, /^---\nname: ordinate-authoring\ndescription:/);
  for (const topic of [...skill.matchAll(/`help (syntax|notes|formulas|references|functions|formats)`/g)].map(m => m[1])) reference(topic);
  assert.equal(pkg.scripts.postinstall, undefined);
});
