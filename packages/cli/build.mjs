import { build } from 'esbuild';
import { chmod, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {stdio: 'inherit'});
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const outfile = manifest.bin[manifest.name];
if (typeof outfile !== 'string') throw new Error('The CLI executable must use the package name.');
await build({entryPoints:['src/main.ts'], outfile, bundle:true, platform:'node', target:'node20', format:'esm', banner:{js:'#!/usr/bin/env node'}, sourcemap:true});
await chmod(outfile, 0o755);
