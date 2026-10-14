import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--declaration', '--emitDeclarationOnly'], { stdio: 'inherit' });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  packages: 'external',
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
});
