import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const native = createRequire(import.meta.url)('../desktop-out/native/titlebar.node');
native.setDocumentOpenHandler(id => native.completeDocumentOpen(id, 0, 'Not part of this test'));
app.on('window-all-closed', () => {});

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<h1>Quarterly report</h1><p>Revenue 1234</p><div style="break-before:page">Cost 567</div>'));
    const pdf = await win.webContents.printToPDF({ printBackground: true });
    const extracted = native.extractAssistantPDF(pdf);
    assert.equal(extracted.pageCount, 2);
    assert.match(extracted.text, /Quarterly report/);
    assert.match(extracted.text, /Revenue 1234/);
    assert.match(extracted.text, /Cost 567/);
    assert.equal(extracted.images.length, 2);
    for (const png of extracted.images) assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.throws(() => native.extractAssistantPDF(Buffer.from('not a PDF')), /PDF/);
    console.log('Assistant PDF extraction passed: text, two page images, malformed input rejection.');
  } finally { win.destroy(); }
  app.quit();
}
void run().catch(error => { console.error(error); app.exit(1); });
