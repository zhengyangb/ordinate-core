import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeStorage } from '../desktop-out/desktop/fileStorage.js';

// Must precede even temporary-directory I/O: awaiting it can let AppKit finish
// launching and install its default controller before this test owns restoration.
const native = createRequire(import.meta.url)('../desktop-out/native/document-test.node');
let onNativeOpen;
native.setDocumentOpenHandler((id, kind, filename) => { void onNativeOpen(id, filename); });

// No real document, profile, visible window or GUI automation is used.
async function run() {
  if (process.platform !== 'darwin') throw new Error('AppKit smoke tests require macOS');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ordinate-nsdocument-'));
  app.setPath('userData', path.join(directory, 'profile'));
  await mkdir(path.join(directory, 'profile'), { recursive: true });
  await app.whenReady();
  console.log('Native smoke: app ready');
  const win = new BrowserWindow({ show: false });
  const storage = createNativeStorage({ open: async () => null, save: async () => null }, native.copyDocumentMetadata);
  let snapshot = null;
  let text = 'First snapshot';
  let blocked = false;
  const host = native.attachDocument(win.getNativeWindowHandle(), async (id, kind, destination) => {
    try {
      if (blocked) throw new Error('Conflicting external edit');
      if (kind !== 'flush') {
        const result = kind === 'save'
          ? await storage.saveTo(destination, text, snapshot?.file ?? null, snapshot?.version ?? null)
          : await storage.moveTo(destination, snapshot.file, snapshot.version, (from, to) => native.moveDocumentFile(host, from, to));
        assert.equal(result.ok, true, JSON.stringify(result));
        snapshot = result.value;
        native.updateDocument(host, storage.documentPath(snapshot.file), false);
      }
      native.completeDocumentRequest(host, id, '');
    } catch (error) { native.completeDocumentRequest(host, id, String(error)); }
  });
  onNativeOpen = async (id, filename) => {
    const result = await storage.readPath(filename);
    if (!result.ok) { native.completeDocumentOpen(id, 0, result.error.kind); return; }
    snapshot = result.value;
    text = snapshot.text;
    native.updateDocument(host, storage.documentPath(snapshot.file), false);
    native.completeDocumentOpen(id, host, '');
  };
  const operation = (kind, destination = directory) => new Promise((resolve, reject) => {
    console.log(`Native smoke: ${kind}`);
    native.testOperation(host, kind, destination, (_id, error) => error ? reject(new Error(error)) : resolve());
  });
  try {
    native.updateDocument(host, '', true);
    const original = path.join(directory, 'Original.ord');
    const renamed = path.join(directory, 'Renamed.ord');
    await operation('save', original);
    assert.equal(await readFile(original, 'utf8'), text);
    await operation('move', renamed);
    await assert.rejects(access(original));
    assert.equal(await readFile(renamed, 'utf8'), text);
    execFileSync('/usr/bin/xattr', ['-w', 'dev.ordinate.test', 'metadata-kept', renamed]);
    text = 'Edit after moving';
    const saved = await storage.save(snapshot.file, text, { expectedVersion: snapshot.version, reason: 'autosave' });
    assert.equal(saved.ok, true);
    snapshot = saved.value;
    assert.equal(await readFile(renamed, 'utf8'), text);
    assert.equal(execFileSync('/usr/bin/xattr', ['-p', 'dev.ordinate.test', renamed], { encoding: 'utf8' }).trim(), 'metadata-kept');
    await assert.rejects(access(original));
    const occupied = path.join(directory, 'Occupied.ord');
    await writeFile(occupied, 'Do not overwrite');
    await assert.rejects(operation('move', occupied));
    assert.equal(await readFile(occupied, 'utf8'), 'Do not overwrite');
    assert.equal(await readFile(renamed, 'utf8'), text);
    blocked = true;
    await assert.rejects(operation('flush'), /Conflicting external edit/);
    blocked = false;
    await operation('flush');
    await operation('reopen', renamed);
    assert.equal(text, 'Edit after moving');
    await operation('open', renamed);
    await assert.rejects(operation('reopen', path.join(directory, 'Missing.ord')), /not_found/);
    await operation('reopen', renamed);
    console.log('NSDocument smoke passed: native save, rename, autosave, conflicts, Resume/Finder open reuse the attached document, missing-file errors, lifecycle cleanup');
  } finally {
    native.detachDocument(host);
    win.destroy();
    await rm(directory, { recursive: true, force: true });
  }
  app.quit();
}
void run().catch(error => { console.error(error); app.exit(1); });
