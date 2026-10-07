import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Node-API is ABI-stable: no Electron/V8-private headers or runtime FFI required.
if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const testing = process.argv.includes('--test');
  const output = path.join(root, `desktop-out/native/${testing ? 'document-test' : 'titlebar'}.node`);
  mkdirSync(path.dirname(output), { recursive: true });
  const result = spawnSync('xcrun', [
    'clang++', '-std=c++17', '-fobjc-arc', '-fblocks', '-bundle', '-undefined', 'dynamic_lookup',
    '-mmacosx-version-min=12.0', '-DNAPI_VERSION=8', '-framework', 'Cocoa', '-framework', 'PDFKit',
    ...(testing ? ['-DORDINATE_NATIVE_TEST=1'] : []),
    '-I', require('node-api-headers').include_dir,
    ...['titlebar.mm', 'document.mm', 'printing.mm'].map(file => path.join(root, 'desktop/native', file)), '-o', output,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native titlebar build failed (${result.status})`);
}
