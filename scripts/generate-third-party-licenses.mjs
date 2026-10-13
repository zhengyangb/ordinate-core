import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projects = {
  web: ['apps/ordinate-app', 'packages/core-ts'],
  desktop: ['apps/ordinate-app', 'packages/core-ts', 'packages/cli'],
  cli: ['packages/core-ts', 'packages/cli'],
};
const [target, output] = process.argv.slice(2);
if (!Object.hasOwn(projects, target) || !output || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/generate-third-party-licenses.mjs <web|desktop|cli> <output-file>');
}

const overrides = JSON.parse(await readFile(path.join(root, 'scripts/license-text-overrides.json'), 'utf8'));
const ownLicense = await readFile(path.join(root, 'LICENSE'), 'utf8');
const ownCopyright = ownLicense.match(/^Copyright \(c\) .+$/m)?.[0];
if (!ownCopyright) throw new Error('Ordinate MIT license is missing a copyright line.');
const reviewedLicenseExpressions = new Set([
  'MIT', 'MIT/X11', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1',
  'Unlicense', '(MIT OR GPL-3.0-or-later)', '(MIT AND Zlib)',
]);

function standardText(license, copyright) {
  if (license === 'MIT' || license === 'MIT/X11') {
    return ownLicense.replace(ownCopyright, `Copyright (c) ${copyright}`);
  }
  if (license === 'ISC') {
    return `ISC License\n\nCopyright (c) ${copyright}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n`;
  }
  throw new Error(`No approved standard text for missing ${license} license file.`);
}

const entries = new Map();
for (const project of projects[target]) {
  const projectRoot = path.join(root, project);
  const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  for (const [location, locked] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/') || locked.dev === true || locked.link === true) continue;
    const packageRoot = path.join(projectRoot, location);
    let packageJson;
    try {
      packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    } catch (error) {
      if (locked.optional === true && error.code === 'ENOENT') continue;
      throw new Error(`Missing installed runtime dependency ${project}/${location}: ${error.message}`);
    }
    if (packageJson.name === 'ordinate-core') continue;
    if (locked.version !== packageJson.version) {
      throw new Error(`${project}/${location} is ${packageJson.version}, but the lockfile requires ${locked.version}. Run npm ci.`);
    }
    const key = `${packageJson.name}@${packageJson.version}`;
    if (entries.has(key)) continue;
    const override = overrides[key];
    const license = packageJson.license ?? override?.license;
    if (!license) throw new Error(`No license declaration for ${key}. Review it before shipping.`);
    if (!reviewedLicenseExpressions.has(license)) {
      throw new Error(`${key} declares unreviewed license ${license}. Review compatibility before shipping.`);
    }
    if (override && packageJson.license && packageJson.license !== override.license) {
      throw new Error(`${key} license changed from reviewed value ${override.license} to ${packageJson.license}.`);
    }
    const files = await readdir(packageRoot, { withFileTypes: true });
    const licenseFiles = files
      .filter((file) => file.isFile() && /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(file.name))
      .map((file) => file.name).sort();
    const noticeFiles = files
      .filter((file) => file.isFile() && /^NOTICE(\.|$)/i.test(file.name))
      .map((file) => file.name).sort();
    if (licenseFiles.length === 0 && !override) {
      throw new Error(`${key} has no bundled license text. Review it and add an exact-version override before shipping.`);
    }
    const content = [];
    for (const file of [...licenseFiles, ...noticeFiles]) {
      content.push(`--- ${file} ---\n${(await readFile(path.join(packageRoot, file), 'utf8')).trim()}`);
    }
    if (!licenseFiles.length) {
      content.unshift(`--- Reviewed missing-text exception ---\n${override.reason}${override.source ? `\nEvidence: ${override.source}` : ''}\n\n${standardText(license, override.copyright).trim()}`);
    }
    entries.set(key, { license, content: content.join('\n\n') });
  }
}

const sections = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) =>
  `================================================================================\n${key} — ${entry.license}\n================================================================================\n${entry.content}`,
);
const notice = `Third-party license notices for Ordinate (${target})\nGenerated from the installed runtime dependencies and package lockfiles.\nDo not edit this file; update dependencies and rebuild.\n\n${sections.join('\n\n')}\n`;
const outputPath = path.resolve(process.cwd(), output);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, notice);
await copyFile(path.join(root, 'LICENSE'), path.join(path.dirname(outputPath), 'Ordinate-LICENSE.txt'));
console.log(`Wrote ${entries.size} third-party license notices to ${outputPath}`);
