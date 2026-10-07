import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createSheetPrinter } from '../desktop-out/desktop/printing.js';

// Load before AppKit's default document controller is created, as in production.
const native = createRequire(import.meta.url)('../desktop-out/native/document-test.node');
native.setDocumentOpenHandler(id => native.completeDocumentOpen(id, 0, 'Not part of this test'));
app.on('window-all-closed', () => {});
const directory = await mkdtemp(path.join(tmpdir(), 'ordinate-print-preview-'));
await mkdir(path.join(directory, 'profile'));
app.setPath('userData', path.join(directory, 'profile'));

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({show:false, width:820, height:720, title:'Ordinate print preview test'});
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<style>@page{margin:12mm}section{break-before:page}table{border-collapse:collapse}td{border:1px solid #bbb;padding:8px}</style>' +
      '<h1>Quarterly report</h1><p>Note before table</p><table><tr><td>Revenue</td><td>1234.50</td></tr></table>' +
      '<section><h1>Second page</h1><p>Note after table</p></section>'));
    const pdf = await win.webContents.printToPDF({printBackground:true, preferCSSPageSize:true});
    assert.deepEqual(native.testPrintConfiguration(pdf), {pages:2, preview:true});
    for (const invalid of [Buffer.alloc(0), Buffer.from('not a PDF')]) {
      assert.throws(() => native.printPDF(win.getNativeWindowHandle(), invalid, 'Invalid', () => {}), /PDF/);
    }
    win.show();
    const print = createSheetPrinter(win, native);
    // Open the real system preview twice, but never submit a physical print job.
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = print();
      await assert.rejects(print(), /already in progress/);
      if (attempt === 0 && process.argv.includes('--inspect-preview')) {
        console.log('Preview inspection: leaving the test-owned system panel open for 45 seconds, then cancelling.');
        await new Promise(resolve => setTimeout(resolve, 45000));
      }
      const deadline = Date.now() + 15000;
      let cancelled = false;
      while (!cancelled && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        try { native.testCancelPrint(win.getNativeWindowHandle()); cancelled = true; }
        catch (error) { if (!String(error).includes('has not opened')) throw error; }
      }
      assert.ok(cancelled, 'PDFKit must open a real window-modal print preview');
      await pending;
    }
    console.log('Native print preview passed: two-page PDF, preview enabled, real system sheet, cancellation, repeat, malformed PDF rejection. No physical print job submitted.');
  } finally {
    win.destroy();
    await rm(directory, {recursive:true, force:true});
  }
  app.quit();
}
void run().catch(error => { console.error(error); app.exit(1); });
