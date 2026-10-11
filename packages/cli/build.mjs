import { build } from 'esbuild';
import { chmod, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {stdio: 'inherit'});
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const entries = [['ordinate-cli', 'src/main.ts'], ['ordinate-mcp', 'src/mcp.ts']];
for (const [name, entry] of entries) {
  const outfile = manifest.bin[name];
  if (typeof outfile !== 'string') throw new Error(`Missing executable for ${name}.`);
  await build({entryPoints:[entry], outfile, bundle:true, platform:'node', target:'node20', format:'esm', banner:{js:'#!/usr/bin/env node'}, sourcemap:true});
  await chmod(outfile, 0o755);
}
