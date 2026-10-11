import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const cli = resolve("dist/ordinate-cli.mjs");
const source = `# Plan\n| Item || Q1 | Q2 | Q3 | Q4 |\n| --- || --- | --- | --- | --- |\n| Revenue || 100 | 120 | | |\n| Costs || 40 | 50 | | |\n| Profit || = B2 - B3 | = C2 - C3 | | |\n`;
const revision = s => "sha256:" + createHash("sha256").update(s).digest("hex");
const target = (r,c) => ({sheet:"Plan",row:{kind:"index",index:r},column:{kind:"index",index:c}});
const region = (r0,r1,c0,c1) => ({sheet:"Plan",rows:{start:r0,end:r1},columns:{start:c0,end:c1}});
let directory, file;
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(),"ordinate-cli-test-")); file = join(directory,"plan.ord"); await fs.writeFile(file,source); });
afterEach(async () => { await fs.rm(directory,{recursive:true,force:true}); });
function run(args, input) {
  const result = spawnSync(process.execPath,[cli,...args],{input,encoding:"utf8",timeout:10000,maxBuffer:24*1024*1024,cwd:directory});
  assert.equal(result.error,undefined); assert.equal(result.signal,null); return result;
}
function json(args, input, status=0) {
  const result = run([...args,"--json"],input); assert.equal(result.status,status,result.stderr+result.stdout);
  assert.equal(result.stderr,""); const report = JSON.parse(result.stdout);
  assert.equal(report.ok,status===0); assert.equal(report.exitCode,status);
  assert.equal(report.contract,"ordinate-cli/1"); return report;
}
function request(operations, text=source) { return JSON.stringify({baseRevision:revision(text),operations}); }
function edit(operations, options=[], status=0, text=source) { return json(["edit",file,"--operations","-",...options],request(operations,text),status); }
async function leftovers() { return (await fs.readdir(directory)).filter(p=>p.endsWith(".lock") || p.endsWith(".tmp")); }

test("help/version and operation schemas work without a source", () => {
  for (const args of [["-h"],["--version"],["edit","--help"],["edit","--help","--operation","fill_region"],["import","--help"]]) {
    const result = run(args); assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,""); assert.ok(result.stdout.length);
  }
  const help = run(["edit","--help"]).stdout;
  assert.ok(help.includes("duplicate_columns")); assert.ok(help.includes("--operation")); assert.ok(help.length<12000);
  const schema = JSON.parse(run(["edit","--help","--schema"]).stdout);
  assert.equal(schema.additionalProperties,false); assert.ok(schema.required.includes("baseRevision"));
});
test("import converts CSV to a new workbook without overwriting either file", async () => {
  const csv = join(directory,"data.csv"), output = join(directory,"data.ord"), options = join(directory,"import.json");
  await fs.writeFile(csv,"id,amount\n001,12\n002,7\n");
  await fs.writeFile(options,JSON.stringify({sheetName:"Data",headers:[{sheetName:"Data",headerRows:1,headerColumns:0}]}));
  const converted = json(["import",csv,"--format","csv","--options",options,"--output",output]);
  assert.equal(converted.result.data.sheetCount,1);
  assert.equal(converted.write.status,"written");
  assert.equal("candidate" in converted.result.data,false);
  assert.equal(await fs.readFile(csv,"utf8"),"id,amount\n001,12\n002,7\n");
  const imported = await fs.readFile(output,"utf8");
  assert.match(imported,/# Data/);
  assert.equal(json(["inspect",output,"--sheet","Data"]).result.data.sheets[0].headerColumnCount,0);
  assert.equal(json(["import",csv,"--format","csv","--options",options,"--output",output],undefined,7).error.code,"output_exists");
  assert.deepEqual(await leftovers(),[]);
});
test("import requires an explicit format and refuses invalid or lossy input", async () => {
  const csv = join(directory,"data.csv"), options = join(directory,"import.json");
  await fs.writeFile(csv,"a,b\n1,2\n");
  await fs.writeFile(options,JSON.stringify({sheetName:"Data"}));
  assert.equal(json(["import",csv,"--options",options],undefined,2).error.code,"invalid_arguments");
  assert.equal(json(["import",csv,"--format","xlsx"],undefined,5).result.status,"rejected");
  assert.equal(json(["import",csv,"--format","csv","--options",options]).result.status,"completed");
});
test("overview and selected inputs use public coordinates, not physical IDs", () => {
  const overview = json(["inspect",file]); assert.equal(overview.input.revision,revision(source)); assert.equal(overview.result.data.selection,undefined);
  const view = json(["inspect",file,"--sheet","Plan","--rows","1:3","--columns","1:3"]).result.data.selection;
  assert.equal(view.cells[0][0].input,"100"); assert.equal(view.cells.length,2); assert.equal(view.hasMoreRows,true);
  assert.doesNotMatch(JSON.stringify(view),/"(?:rowId|colId|sheetId)":/);
});
test("validation failure has nonzero status, visible stderr and a failed stdout summary", async () => {
  await fs.writeFile(file,source.replace("100","= ("));
  const result = run(["validate",file]); assert.equal(result.status,3); assert.match(result.stdout,/Validation failed/); assert.ok(result.stderr.length);
  const report = json(["validate",file],undefined,3); assert.equal(report.result.status,"completed"); assert.equal(report.result.data.valid,false);
});
test("evaluate includes structural diagnostics and keeps unselected JSON compact", async () => {
  const summary = json(["evaluate",file]);
  assert.equal(summary.result.data.summary.sheetCount,1);
  assert.equal(summary.result.data.selection,undefined);
  assert.equal(summary.result.data.candidate,null);
  const selected = json(["evaluate",file,"--sheet","Plan","--rows","3:4","--columns","1:2"]);
  assert.deepEqual(selected.result.data.selection.values,[[{kind:"number",value:"60"}]]);

  await fs.writeFile(file,source.replace("100","= ("));
  const validation = json(["validate",file],undefined,3);
  const evaluation = json(["evaluate",file],undefined,3);
  assert.equal(evaluation.result.status,"rejected");
  assert.equal(evaluation.result.failure.stage,"validation");
  assert.deepEqual(evaluation.result.diagnostics,validation.result.diagnostics);
});
test("piping does not silently switch human output to JSON", () => {
  const result = run(["validate",file]); assert.equal(result.status,0); assert.match(result.stdout,/Validation passed/); assert.throws(()=>JSON.parse(result.stdout));
});
test("evaluate ignores poisoned caches and never writes by default", async () => {
  const poisoned = source.replace("= B2 - B3","999 = B2 - B3"); await fs.writeFile(file,poisoned);
  const report = json(["evaluate",file,"--sheet","Plan"]);
  assert.deepEqual(report.result.data.selection.values[3][1],{kind:"number",value:"60"});
  assert.equal(report.result.data.candidate,null); assert.equal(await fs.readFile(file,"utf8"),poisoned);
});
test("file-writing JSON reports omit candidate source but retain results and write metadata", async () => {
  const evaluated = json(["evaluate",file,"--write"]);
  assert.equal(evaluated.result.data.summary.errorCount,0);
  assert.equal(evaluated.write.status,"written");
  assert.equal("candidate" in evaluated.result.data,false);
  assert.match(await fs.readFile(file,"utf8"),/60 = B2 - B3/);

  const output = join(directory,"copy.ord");
  const copied = json(["evaluate",file,"--output",output]);
  assert.equal(copied.write.status,"written");
  assert.equal("candidate" in copied.result.data,false);
  assert.equal(await fs.readFile(output,"utf8"),await fs.readFile(file,"utf8"));

  const operations = [{op:"set_cell_input",target:target(1,1),input:"200"}];
  const current = await fs.readFile(file,"utf8");
  assert.equal(typeof edit(operations,[],0,current).result.data.candidate.source,"string");
  const edited = edit(operations,["--write"],0,current);
  assert.equal(edited.write.status,"written");
  assert.equal(edited.result.data.operationCount,1);
  assert.equal("candidate" in edited.result.data,false);
  assert.equal(revision(await fs.readFile(file,"utf8")),edited.write.revision);
});
test("whole-workbook evaluation errors prevent writes, even outside selection", async () => {
  const bad = source.replace("= C2 - C3","= 1 / 0"); await fs.writeFile(file,bad);
  const report = json(["evaluate",file,"--sheet","Plan","--rows","1:2","--columns","1:2","--write"],undefined,4);
  assert.equal(report.result.data.summary.errorCount,1); assert.equal(report.write.status,"not_written");
  assert.equal(await fs.readFile(file,"utf8"),bad); assert.deepEqual(await leftovers(),[]);
});
test("edit proposes without writing; --write commits and preserves permissions", async () => {
  await fs.chmod(file,0o640);
  const operations = [{op:"set_cell_input",target:target(1,1),input:"200"}];
  const proposal = edit(operations); assert.equal(proposal.write.status,"not_requested"); assert.equal(await fs.readFile(file,"utf8"),source);
  const applied = edit(operations,["--write"]); assert.equal(applied.write.status,"written");
  const written = await fs.readFile(file,"utf8"); assert.equal(revision(written),applied.write.revision);
  assert.equal((await fs.stat(file)).mode & 0o777,0o640); assert.deepEqual(await leftovers(),[]);
  assert.equal(json(["evaluate",file,"--sheet","Plan"]).result.data.selection.values[3][1].value,"160");
});
test("ordered batch can duplicate, rename, fill and format using staged indexes", () => {
  const format = {kind:"numeric",sign:"default",padWidth:null,grouping:true,precision:2,type:"f"};
  const report = edit([
    {op:"duplicate_columns",sheet:"Plan",columns:[{kind:"label",label:"Q2"}],targetGapIndex:3},
    {op:"set_cell_input",target:target(0,3),input:"Forecast"},
    {op:"fill_region",source:region(1,2,1,3),target:region(1,2,3,5),mode:"series"},
    {op:"set_column_default_format",sheet:"Plan",column:{kind:"label",label:"Forecast"},format},
  ],["--write"]);
  assert.equal(report.result.data.operationCount,4);
  const view = json(["inspect",file,"--sheet","Plan"]).result.data.selection;
  assert.equal(view.cells[1][3].input,"140"); assert.deepEqual(view.columnDefaults[3].format,format);
  assert.equal(view.cells[3][3].input,"= D2 - D3");
});
test("duplicate rows is exposed through the same operation protocol", () => {
  edit([{op:"duplicate_rows",sheet:"Plan",rows:[{kind:"path",path:["Profit"]}],targetGapIndex:4}],["--write"]);
  assert.equal(json(["inspect",file]).result.data.sheets[0].rowCount,5);
});
test("a failed later operation leaves exact source bytes and cleans owned files", async () => {
  const report = edit([{op:"set_cell_input",target:target(1,1),input:"200"},{op:"clear_cell",target:target(99,1)}],["--write"],5);
  assert.equal(report.result.failure.operationIndex,1); assert.equal(report.write.status,"not_written");
  assert.equal(await fs.readFile(file,"utf8"),source); assert.deepEqual(await leftovers(),[]);
});
test("stale source is conflict code 6, not successful validation", async () => {
  await fs.writeFile(file,source+"\n");
  const report = edit([{op:"clear_cell",target:target(1,1)}],["--write"],6);
  assert.equal(report.result.failure.code,"stale_source"); assert.equal(await fs.readFile(file,"utf8"),source+"\n");
  assert.deepEqual(await leftovers(),[]);
});
test("source or operation input can come from stdin, but not both", () => {
  assert.equal(json(["validate","-"],source).input.path,null);
  assert.equal(json(["edit","-","--operations","-"],request([]),2).error.kind,"usage");
  assert.equal(json(["evaluate","-","--write"],source,2).error.kind,"usage");
});
test("stdin source with external operation file and raw output works", async () => {
  const operationsFile = join(directory,"operations.json");
  await fs.writeFile(operationsFile,request([{op:"set_cell_input",target:target(1,1),input:"200"}]));
  const result = run(["edit","-","--operations",operationsFile,"--output","-"],source);
  assert.equal(result.status,0,result.stderr); assert.match(result.stdout,/200/); assert.doesNotMatch(result.stdout,/proposal|contract/);
  assert.equal(json(["validate","-"],result.stdout).result.data.valid,true);
});
test("--output is no-replace, including an existing symlink", async () => {
  const output = join(directory,"copy.ord");
  let report = json(["evaluate",file,"--output",output]); assert.equal(report.write.status,"written");
  const originalOutput = await fs.readFile(output,"utf8");
  report = json(["evaluate",file,"--output",output],undefined,7); assert.equal(report.error.code,"output_exists");
  assert.equal(await fs.readFile(output,"utf8"),originalOutput); assert.deepEqual(await leftovers(),[]);
  const link = join(directory,"link.ord"); await fs.symlink(file,link);
  assert.equal(json(["evaluate",file,"--output",link],undefined,7).error.code,"output_exists");
});
test("output named write is a file name, not an in-place sentinel", async () => {
  const report = json(["evaluate",file,"--output","write"]); assert.equal(report.write.path,join(await fs.realpath(directory),"write"));
  assert.equal(await fs.readFile(file,"utf8"),source); assert.ok((await fs.stat(join(directory,"write"))).isFile());
});
test("--output refuses the source path instead of silently overwriting it", () => {
  assert.equal(json(["evaluate",file,"--output",file],undefined,2).error.kind,"usage");
});
test("existing lock is not removed; failed commands only clean locks they own", async () => {
  const lock = join(directory,".plan.ord.ordinate.lock"); await fs.writeFile(lock,"another owner");
  const report = json(["evaluate",file,"--write"],undefined,6); assert.equal(report.error.code,"lock_conflict");
  assert.equal(await fs.readFile(lock,"utf8"),"another owner"); assert.equal(await fs.readFile(file,"utf8"),source);
});
test("in-place writes reject symlinks and multiple hard links; reads are allowed", async () => {
  const link = join(directory,"symlink.ord"); await fs.symlink(file,link);
  json(["validate",link]); assert.equal(json(["evaluate",link,"--write"],undefined,7).error.code,"unsupported_write_target");
  const hard = join(directory,"hard.ord"); await fs.link(file,hard);
  assert.equal(json(["evaluate",file,"--write"],undefined,7).error.code,"unsupported_write_target");
  assert.deepEqual(await leftovers(),[]);
});
test("identical candidate does not change source mtime", async () => {
  json(["evaluate",file,"--write"]);
  const old = new Date("2020-01-01T00:00:00Z"); await fs.utimes(file,old,old);
  const report = json(["evaluate",file,"--write"]); assert.equal(report.write.status,"unchanged");
  assert.equal((await fs.stat(file)).mtimeMs,old.getTime()); assert.deepEqual(await leftovers(),[]);
});
test("BOM is part of the source revision; invalid UTF-8 is an I/O failure", async () => {
  const text = "\ufeff"+source; await fs.writeFile(file,text);
  assert.equal(json(["validate",file]).input.revision,revision(text));
  await fs.writeFile(file,Buffer.from([0xc3,0x28]));
  assert.equal(json(["validate",file],undefined,7).error.code,"invalid_utf8");
});
test("source and operation size limits fail before parsing", async () => {
  await fs.writeFile(file,"x".repeat(16*1024*1024+1));
  assert.equal(json(["validate",file],undefined,2).error.code,"input_limit_exceeded");
  assert.equal(json(["edit",file,"--operations","-"],"x".repeat(4*1024*1024+1),2).error.code,"input_limit_exceeded");
});
test("invalid operation JSON/schema fail visibly and do not acquire a write lock", async () => {
  assert.equal(json(["edit",file,"--operations","-","--write"],"{",2).error.code,"invalid_operations_json");
  const report = json(["edit",file,"--operations","-","--write"],request([{op:"invented"}]),2);
  assert.equal(report.result.failure.code,"invalid_request"); assert.equal(report.error,null); assert.deepEqual(await leftovers(),[]);
});
test("missing files are I/O failures, not syntax errors", () => {
  assert.equal(json(["validate",join(directory,"missing.ord")],undefined,7).error.code,"read_failed");
});
test("selection/flag usage errors are distinct from edit errors", () => {
  for (const args of [
    ["unknown",file], ["inspect",file,"--wat"], ["validate",file,"--write"],
    ["inspect",file,"--json","--json"], ["inspect",file,"--rows","1:2"],
    ["inspect",file,"--sheet","Plan","--rows","2:1"], ["inspect",file,"--sheet","Plan","--rows","1:999"],
    ["edit",file], ["evaluate",file,"--write","--output","copy"], ["evaluate",file,"--output","-"],
    ["edit","--help","--operation","unknown"],
    ["inspect",file,"--sheet",""], ["inspect",file,"--sheet","Plan","--rows",""],
    ["evaluate",file,"--output",""], ["validate","https://example.com/model.ord"],
  ]) json(args,undefined,2);
});
test("JSON flags after -- are file names, not formatting instructions", async () => {
  await fs.writeFile(join(directory,"--json"),source);
  const result = run(["validate","--","--json"]); assert.equal(result.status,0); assert.match(result.stdout,/Validation passed/);
});
test("SIGINT while awaiting stdin reports 130 without a partial write", async () => {
  const child = spawn(process.execPath,[cli,"validate","-","--json"],{cwd:directory,stdio:["pipe","pipe","pipe"]});
  let stdout="",stderr=""; child.stdout.on("data",b=>stdout+=b); child.stderr.on("data",b=>stderr+=b);
  child.stdin.write("# Plan\n");
  const timer = setTimeout(()=>child.kill("SIGINT"),250);
  const timeout = setTimeout(()=>child.kill("SIGKILL"),10000);
  const status = await new Promise(resolve=>child.on("close",(code,signal)=>resolve({code,signal})));
  clearTimeout(timer); clearTimeout(timeout);
  assert.deepEqual(status,{code:130,signal:null}); assert.equal(stderr,"");
  assert.equal(JSON.parse(stdout).error.kind,"interrupted"); assert.deepEqual(await leftovers(),[]);
});
test("broken stdout reports delivery failure instead of a successful exit", async () => {
  const child = spawn(process.execPath,[cli,"inspect",file,"--json"],{cwd:directory,stdio:["ignore","pipe","pipe"]});
  let stderr=""; child.stderr.on("data",b=>stderr+=b); child.stdout.destroy();
  const status = await new Promise(resolve=>child.on("close",(code,signal)=>resolve({code,signal})));
  assert.deepEqual(status,{code:7,signal:null}); assert.match(stderr,/output_failed/);
});
test("file paths with spaces and no extension work for reads and explicit edits", async () => {
  const path = join(directory,"quarterly plan"); await fs.writeFile(path,source);
  json(["validate",path]);
  const report = json(["edit",path,"--operations","-","--write"],request([{op:"set_cell_input",target:target(1,1),input:"200"}]));
  assert.equal(report.write.status,"written"); assert.match(await fs.readFile(path,"utf8"),/200/);
});
test("edits with existing runtime errors succeed; evaluation then reports code 4", async () => {
  const text = source.replace("= C2 - C3","= 1 / 0"); await fs.writeFile(file,text);
  edit([{op:"set_cell_input",target:target(1,1),input:"200"}],["--write"],0,text);
  const report = json(["evaluate",file],undefined,4); assert.equal(report.result.data.summary.errorCount,1);
});
test("bundled CLI validates and evaluates every shared example without modifying it", async () => {
  const exampleDirectory = resolve("../../examples");
  for (const name of (await fs.readdir(exampleDirectory)).filter(n=>n.endsWith(".ord"))) {
    const path = join(exampleDirectory,name), original = await fs.readFile(path,"utf8");
    assert.equal(json(["validate",path]).result.data.valid,true);
    assert.equal(json(["evaluate",path]).result.data.summary.errorCount,0);
    assert.equal(await fs.readFile(path,"utf8"),original);
  }
});
