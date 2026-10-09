import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { createHash } from "node:crypto";

let bundleDirectory, directory, sourcePath, FileAdapter, CliError;
const source = "# Plan\n| 1 |";
const candidate = {source:"# Plan\n| 2 |",revision:"sha256:"+createHash("sha256").update("# Plan\n| 2 |").digest("hex")};
before(async () => {
  bundleDirectory = await fs.mkdtemp(join(tmpdir(),"ordinate-adapter-module-"));
  const output = join(bundleDirectory,"adapter.mjs");
  await build({entryPoints:[resolve("src/file_adapter.ts")],outfile:output,bundle:true,platform:"node",target:"node20",format:"esm"});
  ({FileAdapter,CliError} = await import(pathToFileURL(output).href));
});
after(async () => { await fs.rm(bundleDirectory,{recursive:true,force:true}); });
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(),"ordinate-adapter-test-")); sourcePath = join(directory,"plan.ord"); await fs.writeFile(sourcePath,source); });
afterEach(async () => { await fs.rm(directory,{recursive:true,force:true}); });
const stdin = () => Readable.from([]);
const isConflict = e => e instanceof CliError && e.kind === "conflict" && e.code === "write_conflict";
async function leftovers() { return (await fs.readdir(directory)).filter(p=>p.endsWith(".tmp") || p.endsWith(".lock")); }

test("a content change between read and publish is detected without overwriting it", async () => {
  const adapter = new FileAdapter(sourcePath,{kind:"inplace"});
  try {
    assert.equal(await adapter.read(stdin()),source);
    await fs.writeFile(sourcePath,"external edit");
    await assert.rejects(adapter.publish(candidate),isConflict);
    assert.equal(adapter.write.status,"not_written"); assert.equal(await fs.readFile(sourcePath,"utf8"),"external edit");
  } finally { await adapter.close(); }
  assert.deepEqual(await leftovers(),[]);
});
test("identical bytes in a replacement inode are still a conflict", async () => {
  const adapter = new FileAdapter(sourcePath,{kind:"inplace"});
  try {
    await adapter.read(stdin());
    const replacement = join(directory,"replacement"); await fs.writeFile(replacement,source); await fs.rename(replacement,sourcePath);
    await assert.rejects(adapter.publish(candidate),isConflict);
    assert.equal(await fs.readFile(sourcePath,"utf8"),source);
  } finally { await adapter.close(); }
  assert.deepEqual(await leftovers(),[]);
});
for (const scenario of ["disappearing","becoming a symlink"]) test(`source ${scenario} is a conflict`, async () => {
  const adapter = new FileAdapter(sourcePath,{kind:"inplace"});
  try {
    await adapter.read(stdin()); await fs.unlink(sourcePath);
    const other = join(directory,"other"); await fs.writeFile(other,source);
    if (scenario === "becoming a symlink") await fs.symlink(other,sourcePath);
    await assert.rejects(adapter.publish(candidate),isConflict);
    assert.equal(await fs.readFile(other,"utf8"),source);
  } finally { await adapter.close(); }
  assert.deepEqual(await leftovers(),[]);
});
test("adapter misuse fails early instead of overwriting ownership state", async () => {
  const adapter = new FileAdapter(sourcePath,{kind:"inplace"});
  try {
    await assert.rejects(adapter.publish(candidate),e=>e.code === "invalid_adapter_state");
    await adapter.read(stdin());
    await assert.rejects(adapter.read(stdin()),e=>e.code === "invalid_adapter_state");
    await fs.writeFile(sourcePath,"external edit");
    await assert.rejects(adapter.publish(candidate),isConflict);
    await assert.rejects(adapter.publish(candidate),e=>e.code === "invalid_adapter_state");
  } finally { await adapter.close(); }
  assert.deepEqual(await leftovers(),[]);
});
test("an unchanged candidate still rechecks the source", async () => {
  const adapter = new FileAdapter(sourcePath,{kind:"inplace"});
  try {
    await adapter.read(stdin()); await fs.writeFile(sourcePath,"external edit");
    await assert.rejects(adapter.publish({source,revision:"sha256:"+"0".repeat(64)}),isConflict);
  } finally { await adapter.close(); }
});
test("one writer cannot acquire or remove another writer's lock", async () => {
  const first = new FileAdapter(sourcePath,{kind:"inplace"}), second = new FileAdapter(sourcePath,{kind:"inplace"});
  try {
    await first.read(stdin());
    await assert.rejects(second.read(stdin()),e=>e instanceof CliError && e.code === "lock_conflict");
    await second.close(); assert.ok((await fs.stat(join(directory,".plan.ord.ordinate.lock"))).isFile());
    await first.publish(candidate); assert.equal(first.write.status,"written");
  } finally { await first.close(); }
  assert.deepEqual(await leftovers(),[]);
});
test("competing output publications are no-replace", async () => {
  const output = join(directory,"copy.ord");
  const first = new FileAdapter(sourcePath,{kind:"file",path:output}), second = new FileAdapter(sourcePath,{kind:"file",path:output});
  try {
    await Promise.all([first.read(stdin()),second.read(stdin())]);
    const results = await Promise.allSettled([first.publish(candidate),second.publish({source:"different",revision:"sha256:"+"0".repeat(64)})]);
    assert.equal(results.filter(r=>r.status === "fulfilled").length,1);
    const loser = results.find(r=>r.status === "rejected"); assert.equal(loser.reason.code,"output_exists");
    assert.ok([candidate.source,"different"].includes(await fs.readFile(output,"utf8")));
  } finally { await Promise.all([first.close(),second.close()]); }
  assert.deepEqual(await leftovers(),[]);
});
test("interruption before commit cleans the owned lock and does not write", async () => {
  const controller = new AbortController();
  const adapter = new FileAdapter(sourcePath,{kind:"inplace"},controller.signal);
  try {
    await adapter.read(stdin()); controller.abort();
    await assert.rejects(adapter.publish(candidate),e=>e instanceof CliError && e.kind === "interrupted");
    assert.equal(await fs.readFile(sourcePath,"utf8"),source); assert.equal(adapter.write.status,"not_written");
  } finally { await adapter.close(); }
  assert.deepEqual(await leftovers(),[]);
});
test("post-commit cleanup failure retains the known written state", {skip:process.platform === "win32"}, async () => {
  const output = join(directory,"copy.ord");
  const adapter = new FileAdapter(sourcePath,{kind:"file",path:output});
  await adapter.read(stdin()); await adapter.publish(candidate);
  try {
    await fs.chmod(directory,0o500);
    await assert.rejects(adapter.close(),e=>e instanceof CliError && e.code === "cleanup_failed");
    assert.equal(adapter.write.status,"written"); assert.equal(adapter.write.revision,candidate.revision);
    assert.equal(await fs.readFile(output,"utf8"),candidate.source);
  } finally { await fs.chmod(directory,0o700); }
});
test("uncertain publication reports unknown instead of claiming no write", async () => {
  const output = join(bundleDirectory,"uncertain.mjs");
  await build({entryPoints:[resolve("src/file_adapter.ts")],outfile:output,bundle:true,platform:"node",target:"node20",format:"esm",plugins:[{
    name:"publication-fault",
    setup(build) {
      build.onResolve({filter:/^node:fs\/promises$/,namespace:"file"},()=>({path:"fs",namespace:"publication-fault"}));
      build.onLoad({filter:/.*/,namespace:"publication-fault"},()=>({loader:"js",contents:`
        export * from "node:fs/promises";
        import * as real from "node:fs/promises";
        export async function link(...args) {
          await real.link(...args);
          throw Object.assign(new Error("uncertain publication"), {code:"EIO"});
        }
      `}));
    }
  }]});
  const {FileAdapter: FaultyAdapter} = await import(pathToFileURL(output).href);
  const destination = join(directory,"copy.ord");
  const adapter = new FaultyAdapter(sourcePath,{kind:"file",path:destination});
  try {
    await adapter.read(stdin());
    await assert.rejects(adapter.publish(candidate),e=>e.kind === "io" && e.code === "write_failed");
    assert.equal(adapter.write.status,"unknown"); assert.equal(adapter.write.revision,null);
    assert.equal(await fs.readFile(destination,"utf8"),candidate.source);
  } finally { await adapter.close(); }
  assert.deepEqual(await leftovers(),[]);
});
