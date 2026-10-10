import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { skillDirectory, syncSkillReferences } from "../skill_reference.mjs";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const cli = resolve(pkg.bin[pkg.name]);
const skill = await readFile(resolve(skillDirectory, "SKILL.md"), "utf8");
const blocks = (text, kind) => [...text.matchAll(new RegExp("```" + kind + "\\n([\\s\\S]*?)\\n```", "g"))].map(m => m[1] + "\n");
function run(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stderr, "");
  return result.stdout;
}
const report = (command, source, sheet) => JSON.parse(run([
  command, "-", ...(sheet ? ["--sheet", sheet] : []), "--json",
], source));
const value = (source, sheet, row, column) => report("evaluate", source, sheet).result.data.selection.values[row][column];

test("package, executable, version and command help share the ordinate-cli name", () => {
  assert.equal(pkg.name, "ordinate-cli");
  assert.deepEqual(Object.keys(pkg.bin), [pkg.name]);
  assert.equal(pkg.bin[pkg.name], "dist/ordinate-cli.mjs");
  assert.match(run(["--version"]), /^ordinate-cli /);
  assert.match(run(["--help"]), /Usage: ordinate-cli /);
  assert.doesNotMatch(run(["--help"]), /\bordinate (?:help|inspect|validate|evaluate|edit)/);
});

test("skill links resolve locally and generated language/function references stay in sync", async () => {
  const links = [...skill.matchAll(/\]\((references\/[^)]+)\)/g)].map(m => m[1]);
  assert.equal(new Set(links).size, 8);
  for (const link of links) await access(resolve(skillDirectory, link));
  await syncSkillReferences("--check");
});

test("every complete workbook in the skill and its references validates and calculates", async () => {
  const paths = [resolve(skillDirectory, "SKILL.md"),
    ...(await readdir(resolve(skillDirectory, "references"))).map(name => resolve(skillDirectory, "references", name))];
  let count = 0;
  for (const path of paths) {
    for (const source of blocks(await readFile(path, "utf8"), "ord")) {
      assert.equal(report("validate", source).ok, true, path);
      const evaluated = report("evaluate", source);
      assert.equal(evaluated.ok, true, path);
      assert.equal(evaluated.result.data.summary.errorCount, 0, path);
      count++;
    }
  }
  assert.ok(count >= 10);
});

test("quickstart results follow changed inputs across sheets and preserve formulas/formats", () => {
  const source = blocks(skill, "ord")[0];
  assert.deepEqual(value(source, "Plan", 2, 1), { kind: "number", value: "900" });
  assert.deepEqual(value(source, "Plan", 9, 1), { kind: "number", value: "730" });
  assert.deepEqual(value(source, "Plan", 16, 1), { kind: "number", value: "435" });
  assert.ok(Math.abs(Number(value(source, "Plan", 16, 3).value) - 551.8335) < 1e-9);
  assert.deepEqual(value(source, "Sales Ledger", 1, 3), { kind: "number", value: "30" });
  assert.deepEqual(value(source, "Sales Ledger", 4, 3), { kind: "number", value: "40" });
  assert.deepEqual(value(source, "Review", 4, 1), { kind: "number", value: "178" });
  assert.deepEqual(value(source, "Review", 5, 1), { kind: "string", value: "On track" });
  const changed = source.replace("| * Equipment || 900 |", "| * Equipment || 1000 |");
  assert.deepEqual(value(changed, "Plan", 9, 1), { kind: "number", value: "830" });
  assert.ok(Number(value(changed, "Plan", 16, 3).value) > Number(value(source, "Plan", 16, 3).value));
  assert.ok(Number(value(changed, "Review", 1, 1).value) > Number(value(source, "Review", 1, 1).value));
  assert.deepEqual(value(changed, "Review", 4, 1), { kind: "number", value: "178" });
  const ledgerChanged = source.replace("| AC-1 || 2 | 15 |", "| AC-1 || 4 | 15 |");
  assert.deepEqual(value(ledgerChanged, "Review", 4, 1), { kind: "number", value: "208" });
  const view = report("inspect", changed, "Plan").result.data.selection;
  assert.match(view.cells[2][2].input, /@\["Revenue"\."Equipment","2026"\]/);
  assert.match(view.cells[9][1].input, /@\["Total revenue",_\]/);
  assert.equal(view.cells[17][1].localDisplay.format.type, "%");
});

test("worked named, contextual, and A1 formulas agree at the stated cells", () => {
  const source = blocks(skill, "ord")[0];
  assert.deepEqual(value(source, "Plan", 4, 1), { kind: "number", value: "1200" });
  assert.deepEqual(value(source, "Plan", 8, 1), { kind: "number", value: "470" });
  const planFormula = '= @["Total revenue",_] - @["Total cost of sales",_]';
  assert.ok(source.includes(planFormula));
  for (const alternative of [
    planFormula,
    '= @["Total revenue","2026"] - @["Total cost of sales","2026"]',
    '= B5 - B9',
  ]) {
    assert.deepEqual(value(source.replace(planFormula, alternative), "Plan", 9, 1),
      { kind: "number", value: "730" }, alternative);
  }

  assert.deepEqual(value(source, "Sales Ledger", 1, 1), { kind: "number", value: "2" });
  assert.deepEqual(value(source, "Sales Ledger", 1, 2), { kind: "number", value: "15" });
  const ledgerFormula = '= @[_,"Quantity"] * @[_,"Unit price"]';
  assert.ok(source.includes(ledgerFormula));
  for (const alternative of [
    ledgerFormula,
    '= @["AC-1","Quantity"] * @["AC-1","Unit price"]',
    '= B2 * C2',
  ]) {
    assert.deepEqual(value(source.replace(ledgerFormula, alternative), "Sales Ledger", 1, 3),
      { kind: "number", value: "30" }, alternative);
  }
});

test("year labels, multiword labels, and hierarchy paths match the skill's contrasts", () => {
  const source = blocks(skill, "ord")[0];
  const quotedYear = '@["Revenue"."Equipment","2026"] * 1.08';
  assert.ok(source.includes(quotedYear));
  const bareYear = source.replace(quotedYear, '@["Revenue"."Equipment",2026] * 1.08');
  assert.deepEqual(value(bareYear, "Plan", 2, 2), value(source, "Plan", 2, 2));
  const bareCrossSheetYear = source.replace('@["Plan"::["Net income","2026"]]',
    '@["Plan"::["Net income",2026]]');
  assert.deepEqual(value(bareCrossSheetYear, "Review", 2, 1), value(source, "Review", 2, 1));

  const badMultiword = source.replace('@["Total revenue",_] - @["Total cost of sales",_]',
    '@[Total revenue,_] - @["Total cost of sales",_]');
  const multiwordResult = spawnSync(process.execPath, [cli, "validate", "-", "--json"], {
    input: badMultiword, encoding: "utf8", timeout: 10000,
  });
  assert.equal(multiwordResult.status, 3);
  assert.ok(JSON.parse(multiwordResult.stdout).result.diagnostics.some(diagnostic =>
    diagnostic.code === "invalid_reference_selector_syntax"));

  const badHierarchy = source.replace(quotedYear, '@["Equipment","2026"] * 1.08');
  const hierarchyResult = spawnSync(process.execPath, [cli, "evaluate", "-", "--json"], {
    input: badHierarchy, encoding: "utf8", timeout: 10000,
  });
  assert.equal(hierarchyResult.status, 4);
  assert.ok(JSON.parse(hierarchyResult.stdout).result.diagnostics.some(diagnostic =>
    diagnostic.code === "unresolved_reference_label_not_found"));

  const dottedLabel = source.replace(quotedYear, '@["Revenue.Equipment","2026"] * 1.08');
  const dottedResult = spawnSync(process.execPath, [cli, "evaluate", "-", "--json"], {
    input: dottedLabel, encoding: "utf8", timeout: 10000,
  });
  assert.equal(dottedResult.status, 4);
  assert.ok(JSON.parse(dottedResult.stdout).result.diagnostics.some(diagnostic =>
    diagnostic.code === "unresolved_reference_label_not_found"));
});

test("cross-sheet selectors need one complete reference envelope", () => {
  const source = blocks(skill, "ord")[0];
  const valid = '@["Plan"::["Total revenue","2028"]]';
  assert.ok(source.includes(valid));
  for (const invalid of [
    '@"Plan"::["Total revenue","2028"]',
    '@[["Plan"::["Total revenue","2028"]]]',
    '@[@["Plan"::["Total revenue","2028"]]]',
  ]) {
    const changed = source.replace(valid, invalid);
    const result = spawnSync(process.execPath, [cli, "validate", "-", "--json"], {
      input: changed, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 3, invalid);
    assert.ok(JSON.parse(result.stdout).result.diagnostics.length > 0, invalid);
  }
});

test("documented percentage input stays numeric and bare percentage text fails evaluation", () => {
  const example = skill.match(/<percentage_input_example>\s*```ord\n([\s\S]*?)\n```\s*<\/percentage_input_example>/);
  assert.ok(example);
  const source = example[1] + "\n";
  assert.equal(report("validate", source).ok, true);
  assert.deepEqual(value(source, "Membership forecast", 2, 2), { kind: "number", value: "0.1" });
  assert.deepEqual(value(source, "Membership forecast", 1, 2), { kind: "number", value: "88" });
  const view = report("inspect", source, "Membership forecast").result.data.selection;
  assert.equal(view.rowDefaults[2].format.type, "%");

  const textRate = source.replace("Annual growth || 0.1 | 0.1 |", "Annual growth || 0.1 | 10% |");
  assert.notEqual(textRate, source);
  assert.equal(report("validate", textRate).ok, true);
  const failed = spawnSync(process.execPath, [cli, "evaluate", "-", "--json"], {
    input: textRate, encoding: "utf8", timeout: 10000,
  });
  assert.equal(failed.status, 4);
  assert.ok(JSON.parse(failed.stdout).result.diagnostics.some(diagnostic =>
    diagnostic.code === "invalid_arithmetic"));
});

test("separately quoted hierarchy labels calculate", () => {
  const source = `# Inputs
| Name || Value |
| --- || --- |
| Annual growth || 0.1 {:.0%} |

# Plan
| Item || 2026 | 2027 |
| --- || --- | --- |
| Portfolio || | |
| * Product A || 100 | = @["Portfolio"."Product A","2026"] * (1 + @["Inputs"::["Annual growth","Value"]]) |
`;
  assert.equal(report("validate", source).ok, true);
  assert.deepEqual(value(source, "Inputs", 1, 1), { kind: "number", value: "0.1" });
  assert.ok(Math.abs(Number(value(source, "Plan", 2, 2).value) - 110) < 1e-9);
});

test("display-frame example separates column, row and local metadata without shifting references", () => {
  const source = blocks(skill, "ord")[2];
  const view = report("inspect", source, "Summary").result.data.selection;
  assert.equal(view.cells[0][0].input, "Item");
  assert.equal(view.columnDefaults[1].format.precision, 2);
  assert.equal(view.rowDefaults[2].style.weight, "bold");
  assert.equal(view.cells[3][1].localDisplay.format.type, "%");
  assert.equal(value(source, "Summary", 3, 1).kind, "number");
});

test("entrypoint expression examples compute in their advertised workbook context", () => {
  const expressions = blocks(skill, "text")[0].trim().split("\n");
  const source = blocks(skill, "ord")[0].replace("\n\n# Sales Ledger", "\n" + expressions.map((e, i) => `| Example${i} || ${e} | | |\n`).join("") + "\n# Sales Ledger");
  const values = report("evaluate", source, "Plan").result.data.selection.values;
  assert.deepEqual(values.slice(18).map(row => row[1]), [
    { kind: "number", value: "6" }, { kind: "number", value: "100" },
    { kind: "number", value: "20" }, { kind: "number", value: "0" },
    { kind: "string", value: "Ord" },
    { kind: "string", value: "Gross profit: 730.00" },
  ]);
});

test("single-quoted sheet references in the canonical workbook are invalid", () => {
  const source = blocks(skill, "ord")[0];
  const valid = '@["Sales Ledger"::["AC-1":"AC-4","Line total"]]';
  const invalid = "@['Sales Ledger'::[\"AC-1\":\"AC-4\",\"Line total\"]]";
  assert.ok(source.includes(valid));
  const result = spawnSync(process.execPath, [cli, "validate", "-", "--json"], {
    input: source.replace(valid, invalid), encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 3);
  const validation = JSON.parse(result.stdout);
  assert.equal(validation.ok, false);
  assert.ok(validation.result.diagnostics.some(diagnostic =>
    diagnostic.code === "parse_cross_sheet_reference_invalid_sheet_selector"));
});

test("validation alone does not certify a formula free of self-reference", () => {
  const source = `# Model
| Item || Forecast |
| --- || --- |
| Revenue || 100 |
| Total || = @[_,Forecast] * 1.08 |
`;
  assert.equal(report("validate", source).ok, true);
  const result = spawnSync(process.execPath, [cli, "evaluate", "-", "--json"], {
    input: source, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 4);
  const evaluated = JSON.parse(result.stdout);
  assert.equal(evaluated.ok, false);
  assert.ok(evaluated.result.diagnostics.some(diagnostic => diagnostic.code === "cycle"));
  const corrected = source.replace("@[_,Forecast]", "@[Revenue,_]");
  assert.deepEqual(value(corrected, "Model", 2, 1), { kind: "number", value: "108" });
});

test("documented batch updates by name and evaluation explicitly materializes caches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ordinate-skill-test-"));
  try {
    const file = join(directory, "model.ord");
    const source = blocks(skill, "ord")[0];
    await writeFile(file, source);
    const inspected = JSON.parse(run(["inspect", file, "--sheet", "Plan", "--json"]));
    const batch = JSON.parse(blocks(skill, "json")[0]);
    batch.baseRevision = inspected.input.revision;
    const proposal = JSON.parse(run(["edit", file, "--operations", "-", "--json"], JSON.stringify(batch)));
    assert.equal(proposal.write.status, "not_requested");
    assert.equal(await readFile(file, "utf8"), source);
    const edited = JSON.parse(run(["edit", file, "--operations", "-", "--write", "--json"], JSON.stringify(batch)));
    assert.equal(edited.write.status, "written");
    const changed = await readFile(file, "utf8");
    assert.deepEqual(value(changed, "Plan", 9, 1), { kind: "number", value: "830" });
    assert.ok(Number(value(changed, "Review", 1, 1).value) > 1426.08);
    run(["evaluate", file, "--json"]);
    assert.equal(await readFile(file, "utf8"), changed);
    const calculated = JSON.parse(run(["evaluate", file, "--write", "--json"]));
    assert.equal(calculated.write.status, "written");
    const materialized = await readFile(file, "utf8");
    assert.match(materialized, /830 = @\["Total revenue",_\] - @\["Total cost of sales",_\]/);
    assert.match(materialized, /"On track" = if\(@\["Net income growth",_\] > 0, "On track", "Review"\)/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
