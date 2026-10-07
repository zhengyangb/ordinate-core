import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appKit } from '../desktop-out/desktop/nativeChrome.js';

// The real renderer/preload/IPC path, but never send a job to a physical printer.
export async function checkPrint(win, { query, wait, capture, directory }) {
  win.setSize(1060, 820); win.show(); win.focus();
  let jobs = 0, complete;
  const originalPrint = appKit.printPDF;
  appKit.printPDF = (handle, pdf, title, callback) => {
    assert.deepEqual(handle, win.getNativeWindowHandle());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(title, win.getTitle());
    jobs++; complete = callback;
  };
  const setText = (selector, value) => query(win, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const load = async text => {
    if (!await query(win, `!!document.querySelector('.source-shell textarea')`)) await query(win, `document.querySelector('.source-button').click()`);
    await wait(win, `document.querySelector('.source-shell textarea')`);
    await setText('.source-shell textarea', text);
    await query(win, `document.querySelector('.source-button').click()`);
    await wait(win, `document.querySelector('.table-stage[data-layout-ready="true"]')`);
  };
  const begin = async () => {
    const previous = jobs;
    win.webContents.send('editor:command', 'print');
    await wait(win, `!!document.querySelector('#ordinate-print-root table')`);
    // IPC now waits for Chromium to paginate the actual PDF before opening PDFKit.
    const deadline = Date.now() + 15000;
    while (jobs === previous && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(jobs, previous + 1);
  };
  const finish = async (success = false, reason = 'Print job canceled') => {
    complete(reason === 'Print job canceled' ? '' : reason, success);
    await wait(win, `!document.querySelector('#ordinate-print-root')`);
  };
  try {
    const source = '# Quarterly report\n**All figures in millions**\n\n- Unaudited\n\n| Line item || Amount | Change |\n| --- || --- | --- |\n' +
      Array.from({length:180}, (_, i) => `| Item ${i + 1} || ${i + 1} {:.2f} {::>,bold} | = B${i + 2} * 2 |`).join('\n') +
      '\n\nEnd of report.\n\n---\n\n*Prepared for review.*\n\n# Other\n| MUST NOT PRINT |';
    await load(source);
    // A native menu command doesn't blur the note input. It still must commit it.
    await query(win, `document.querySelector('.sheet-note-intro .sheet-note').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
    await wait(win, `document.querySelector('.sheet-note-input')`);
    await setText('.sheet-note-input', '**Updated before printing**\n\n- Unaudited');
    await begin();
    assert.equal(await query(win, `document.querySelectorAll('#ordinate-print-root tbody tr').length`), 180);
    assert.ok(await query(win, `document.querySelector('#ordinate-print-root').textContent.includes('Updated before printing')`));
    assert.ok(!await query(win, `document.querySelector('#ordinate-print-root').textContent.includes('MUST NOT PRINT')`));
    assert.equal(await query(win, `getComputedStyle(document.querySelector('#ordinate-print-root')).display`), 'none');
    assert.ok(await query(win, `document.querySelector('#ordinate-print-root tbody tr:last-child').textContent.includes('360')`));
    win.webContents.send('editor:command', 'print');
    await query(win, `new Promise(resolve => setTimeout(resolve, 60))`);
    assert.equal(jobs, 1, 'Repeated commands do not create overlapping jobs');
    win.webContents.debugger.attach('1.3');
    for (const theme of ['light', 'dark']) {
      await query(win, `document.documentElement.dataset.theme='${theme}'`);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {media:'print'});
      assert.equal(await query(win, `getComputedStyle(document.getElementById('root')).display`), 'none');
      assert.equal(await query(win, `getComputedStyle(document.querySelector('#ordinate-print-root thead')).display`), 'table-header-group');
      assert.equal(await query(win, `getComputedStyle(document.body).backgroundColor`), 'rgb(255, 255, 255)');
      assert.equal(await query(win, `getComputedStyle(document.documentElement).colorScheme`), 'light', 'Dark chrome must not print dark page margins');
      assert.ok(await query(win, `document.querySelector('#ordinate-print-root tbody tr:last-child td:last-child').getBoundingClientRect().right <= innerWidth`));
      await capture(win, `print-${theme}`);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {media:''});
    }
    await writeFile(path.join(directory, 'print-long-table.pdf'), await win.webContents.printToPDF({printBackground:true}));
    await finish();
    assert.equal(await query(win, `!!document.querySelector('[role="dialog"]')`), false, 'Cancel is not an error');
    await begin(); await finish(false, 'Invalid printer settings');
    await wait(win, `document.querySelector('[role="dialog"]')?.textContent.includes('Invalid printer settings')`);
    const count = jobs;
    win.webContents.send('editor:command', 'print');
    await query(win, `new Promise(resolve => setTimeout(resolve, 60))`);
    assert.equal(jobs, count, 'Printing is blocked behind a modal');
    await query(win, `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === 'OK').click()`);
    await wait(win, `!document.querySelector('[role="dialog"]')`);
    // Printing must also commit the active cell editor before evaluating formulas.
    await load('# Cell editing\n| Item || Value | Double |\n| --- || --- | --- |\n| Entry || 1 {:.2f} {::>,bold} | = B2 * 2 |');
    const cell = `[...document.querySelectorAll('[role="gridcell"]')].find(c => c.textContent === '1.00')`;
    await wait(win, cell);
    await query(win, `(${cell}).dispatchEvent(new MouseEvent('dblclick', {bubbles:true,cancelable:true}))`);
    await wait(win, `document.querySelector('textarea[aria-label="Edit selected cell input"]')`);
    await setText('textarea[aria-label="Edit selected cell input"]', '17');
    await begin();
    assert.ok(await query(win, `document.querySelector('#ordinate-print-root tbody tr').textContent.endsWith('17.0034')`));
    await finish();
    // Wide tables retain every column and wrap, rather than clipping at viewport width.
    await load('# Wide\n| '+Array.from({length:12},(_,i)=>`Period ${i+1}`).join(' | ')+' |\n| '+Array(12).fill('---').join(' | ')+' |\n| '+Array.from({length:12},(_,i)=>i===11?'Final column retained':String(i)).join(' | ')+' |');
    await begin();
    await writeFile(path.join(directory, 'print-wide-table.pdf'), await win.webContents.printToPDF({printBackground:true,landscape:true}));
    await finish(true, '');
    // Source edits print as authored, not the previous table view.
    await query(win, `document.querySelector('.source-button').click()`);
    await wait(win, `document.querySelector('.source-shell textarea')`);
    await setText('.source-shell textarea', '# Wide\n| 246810 |');
    await begin();
    assert.equal(await query(win, `document.querySelector('#ordinate-print-root tbody').textContent`), '246810');
    await finish();
    await setText('.source-shell textarea', '# Wide\n| 1 | 2 |\n| 3 |');
    const previous = jobs;
    win.webContents.send('editor:command', 'print');
    await wait(win, `document.querySelector('[role="dialog"]')?.textContent.includes('Unable to print')`);
    assert.equal(jobs, previous, 'Invalid source never prints an old table');
    assert.equal(await query(win, `!!document.querySelector('#ordinate-print-root')`), false);
    console.log('Printing passed: complete rows, formulas, notes, active sheet, source edits, theme isolation, wide columns, cancellation/error cleanup, duplicate and modal guards.');
  } finally {
    appKit.printPDF = originalPrint;
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
  }
}
