import { app, BrowserWindow, net, protocol } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real renderer/frame tests in an isolated, hidden window and fresh profile.
// No user's desktop windows, browser sessions or documents are accessed.
const profile = mkdtempSync(path.join(tmpdir(), 'ordinate-handoff-smoke-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'ordinate-handoff', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
let win;
const watchdog = setTimeout(() => { console.error('View handoff smoke exceeded 30 seconds'); app.exit(1); }, 30000);

async function waitReady() {
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 10000;
    function check() {
      const root = document.querySelector('.view-handoff');
      const stage = root?.querySelector('.view-handoff-live .table-stage');
      if (stage?.dataset.layoutReady === 'true' && !root.dataset.handoff) resolve();
      else if (performance.now() > deadline) reject(new Error('Layout did not become ready'));
      else requestAnimationFrame(check);
    } check();
  })`);
}

async function exercise(targets, slow = false) {
  await waitReady();
  const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const targets = ${JSON.stringify(targets)};
    const root = document.querySelector('.view-handoff');
    const live = root.querySelector('.view-handoff-live');
    const copy = root.querySelector('.view-handoff-snapshot');
    const started = performance.now();
    let blankFrames = 0, heldFrames = 0, loadingFrames = 0, pendingFrames = 0;
    let firstLoading = null;
    if (${slow}) {
      // Hold the existing font/layout gate, rather than modifying app readiness.
      Object.defineProperty(document.fonts, 'ready', { configurable: true,
        value: new Promise(done => setTimeout(() => { delete document.fonts.ready; done(); }, 650)) });
    }
    const originalGeometry = [...live.querySelectorAll('.ag-center-cols-container .ag-cell')]
      .map(cell => { const r = cell.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; });
    let copyGeometry = null;
    targets.forEach((name, index) => setTimeout(() => {
      const button = [...document.querySelectorAll('[role=tablist][aria-label="Sheets"] [role=tab]')]
        .find(button => button.getAttribute('aria-label') === name);
      if (!button) { reject(new Error('Missing sheet ' + name)); return; }
      button.click();
    }, index * 40));
    function sample() {
      const elapsed = performance.now() - started;
      const stage = live.querySelector('.table-stage');
      const ready = stage?.dataset.layoutReady === 'true';
      const held = copy.childElementCount > 0;
      const loading = root.dataset.handoff === 'loading';
      if (!ready) {
        pendingFrames++;
        if (held) heldFrames++;
        if (loading) { loadingFrames++; firstLoading ??= elapsed; }
        if (!held && !loading) blankFrames++;
      }
      if (held) {
        if (copy.querySelector('[id]')) { reject(new Error('Copy contains duplicate IDs')); return; }
        if (!live.hasAttribute('inert') || live.getAttribute('aria-hidden') !== 'true') {
          reject(new Error('Measuring view can receive focus or interaction')); return;
        }
        copyGeometry ??= [...copy.querySelectorAll('.ag-center-cols-container .ag-cell')]
          .map(cell => { const r = cell.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; });
      }
      if (elapsed > 350 && ready && !root.dataset.handoff) {
        resolve({ blankFrames, heldFrames, loadingFrames, pendingFrames, firstLoading,
          originalGeometry, copyGeometry, copyRemoved: copy.childElementCount === 0,
          interactive: !live.hasAttribute('inert') && !live.hasAttribute('aria-hidden'),
          selected: document.querySelector('[role=tablist][aria-label="Sheets"] [aria-selected=true]').getAttribute('aria-label') });
      } else if (elapsed > 10000) reject(new Error('Handoff did not finish'));
      else requestAnimationFrame(sample);
    } requestAnimationFrame(sample);
  })`);
  assert.equal(result.blankFrames, 0, 'No frame may expose the blank measuring workspace');
  assert.ok(result.heldFrames > 0, 'The previous view must cover unfinished layout frames');
  assert.deepEqual(result.copyGeometry, result.originalGeometry, 'The copy preserves displayed cell geometry');
  assert.ok(result.copyRemoved && result.interactive, 'Completed views release the copy and become interactive');
  assert.equal(result.selected, targets.at(-1));
  if (slow) {
    assert.ok(result.loadingFrames > 0, 'Slow layout shows a delayed cue');
    assert.ok(result.firstLoading >= 240, 'The loading cue must not flash immediately');
  } else assert.equal(result.loadingFrames, 0, 'Fast layout must not show a loading cue');
  const { originalGeometry, copyGeometry, ...summary } = result;
  console.log(JSON.stringify({ targets, slow, ...summary }));
}

async function installNoteFixture() {
  const rows = Array.from({ length: 60 }, (_, index) => `| Detail ${index + 1} || ${index + 1} |`).join('\n');
  const source = '# One\nAn introductory note with enough text to wrap naturally beside the table.\n\n'
    + '| Item || Value |\n| --- || --- |\n' + rows + '\n\nA note after the first table.\n\n'
    + '# Two\nAnother note before the table.\n\n| Item || Value |\n| --- || --- |\n| Beta || 9 |\n\nA note after the second table.\n';
  await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Open source mode"]').click()`);
  await win.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, ${JSON.stringify(source)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Return to table view"]').click()`);
  await waitReady();
  const notes = await win.webContents.executeJavaScript(`document.querySelector('.view-handoff-live .sheet-note-intro').textContent`);
  assert.ok(notes.includes('An introductory note'), 'The fixture must contain real notes');
  await win.webContents.executeJavaScript(`(() => {
    const live = document.querySelector('.view-handoff-live');
    live.querySelector('.note-workspace').scrollTop = 40;
    live.querySelector('.ag-body-viewport').scrollTop = 200;
  })()`);
  // Give the native virtual grid a frame to update the visible row window.
  await win.webContents.executeJavaScript(`new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))`);
}

async function run() {
  await app.whenReady();
  protocol.handle('ordinate-handoff', request => {
    const url = new URL(request.url);
    return net.fetch(pathToFileURL(path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname)).toString());
  });
  win = new BrowserWindow({ show: false, width: 995, height: 1101, webPreferences: { backgroundThrottling: false, offscreen: true } });
  await win.loadURL('ordinate-handoff://app/');
  await exercise(['Executive Notes']);
  await exercise(['Management Report']);
  await exercise(['Quarterly Cube'], true);
  await exercise(['Executive Notes', 'Planning Assumptions', 'Regional Breakdown'], true);
  await installNoteFixture();
  await exercise(['Two'], true);
  await exercise(['One']);
  console.log('View handoff frame checks passed, including scrolled notes and virtual rows.');
}
void run().then(async () => {
  clearTimeout(watchdog);
  win.destroy();
  await rm(profile, { recursive: true, force: true });
  app.exit(0);
}).catch(error => {
  console.error(error);
  clearTimeout(watchdog);
  app.exit(1);
});
