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
  assert.equal(new Set(links).size, 6);
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
  assert.deepEqual(value(source, "Plan", 3, 1), { kind: "number", value: "60" });
  assert.deepEqual(value(source, "Plan", 3, 2), { kind: "number", value: "70" });
  assert.deepEqual(value(source, "Plan", 4, 1), { kind: "number", value: "0.6" });
  assert.deepEqual(value(source, "Review", 1, 1), { kind: "number", value: "260" });
  assert.deepEqual(value(source, "Review", 2, 1), { kind: "string", value: "Proceed" });
  const changed = source.replace("| Revenue || 100 | 120 |", "| Revenue || 200 | 120 |");
  assert.deepEqual(value(changed, "Plan", 3, 1), { kind: "number", value: "160" });
  assert.deepEqual(value(changed, "Plan", 3, 2), { kind: "number", value: "70" });
  assert.deepEqual(value(changed, "Review", 1, 1), { kind: "number", value: "460" });
  const view = report("inspect", changed, "Plan").result.data.selection;
  assert.match(view.cells[3][1].input, /@\[Revenue,_\]/);
  assert.equal(view.cells[4][1].localDisplay.format.type, "%");
});

test("display-frame example separates column, row and local metadata without shifting references", () => {
  const source = blocks(skill, "ord")[1];
  const view = report("inspect", source, "Summary").result.data.selection;
  assert.equal(view.cells[0][0].input, "Item");
  assert.equal(view.columnDefaults[1].format.precision, 2);
  assert.equal(view.rowDefaults[2].style.weight, "bold");
  assert.equal(view.cells[3][1].localDisplay.format.type, "%");
  assert.equal(value(source, "Summary", 3, 1).kind, "number");
});

test("entrypoint expression examples compute in their advertised workbook context", () => {
  const expressions = blocks(skill, "text")[0].trim().split("\n");
  const source = blocks(skill, "ord")[0].replace("\n\n# Review", "\n" + expressions.map((e, i) => `| Example${i} || ${e} | |\n`).join("") + "\n# Review");
  const values = report("evaluate", source, "Plan").result.data.selection.values;
  assert.deepEqual(values.slice(5).map(row => row[1]), [
    { kind: "number", value: "6" }, { kind: "number", value: "100" },
    { kind: "number", value: "20" }, { kind: "number", value: "0" },
    { kind: "string", value: "Ord" },
    { kind: "string", value: "Profit: 60.00" },
  ]);
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
    assert.deepEqual(value(changed, "Plan", 3, 1), { kind: "number", value: "160" });
    assert.deepEqual(value(changed, "Review", 1, 1), { kind: "number", value: "460" });
    run(["evaluate", file, "--json"]);
    assert.equal(await readFile(file, "utf8"), changed);
    const calculated = JSON.parse(run(["evaluate", file, "--write", "--json"]));
    assert.equal(calculated.write.status, "written");
    assert.match(await readFile(file, "utf8"), /160 = @\[Revenue,_\] - @\[Costs,_\]/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
