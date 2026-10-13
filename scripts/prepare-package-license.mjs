import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set(['apps/ordinate-app', 'packages/core-ts', 'packages/cli']);
const project = process.argv[2];
if (!allowed.has(project) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/prepare-package-license.mjs <package-directory>');
}
await copyFile(path.join(root, 'LICENSE'), path.join(root, project, 'LICENSE'));
console.log(`Copied Ordinate LICENSE into ${project} for packaging.`);
