import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import { checkPrintOptions } from './print-options-smoke.mjs';
import { checkMenuIconAlignment } from './menu-alignment-smoke.mjs';

/** Test-owned browser windows only. Stub the system dialog, but paginate the
 * actual shared HTML through Chromium's PDF engine; never send a printer job. */
export async function checkBrowserPrint(win, {query,wait,capture,directory}, online = false) {
  if (online) {
    await win.loadURL('ordinate-test://web/online.html');
    await wait(win,"document.querySelector('.online-example-dialog')");
    await query(win,"document.querySelector('[aria-label=\"Close examples\"]').click()");
  }
  win.setSize(1060,820); win.show(); win.focus();
  const host = online ? 'online' : 'web';
  const setText = (selector, text) => query(win,`(() => {
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const shortcut = () => query(win,`(() => {
    const event=new KeyboardEvent('keydown',{key:'p',ctrlKey:true,bubbles:true,cancelable:true});
    document.activeElement.dispatchEvent(event); return event.defaultPrevented;
  })()`);
  const closePrint = async () => {
    await query(win,"window.dispatchEvent(new Event('afterprint'))");
    await wait(win,"!document.querySelector('#ordinate-print-root')");
  };
  const source = '# Quarterly report\n**All figures in millions**\n\n| Line item || Amount | Double |\n| --- || --- | --- |\n'+
    Array.from({length:260},(_,i)=>`| Item ${i+1} || ${i+1} {:.2f} {::>,bold} | = B${i+2} * 2 |`).join('\n')+
    '\n\nEnd of report.\n\n# Other\n| MUST NOT PRINT |';
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.source-shell textarea')");
  await setText('.source-shell textarea',source);
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.table-stage[data-layout-ready=\"true\"]')");
  await query(win,"window.__originalPrint=window.print;window.__printCalls=0;window.print=()=>{window.__printCalls++;window.dispatchEvent(new Event('beforeprint'));};void 0");
  try {
    await query(win,"document.querySelector('[aria-label=\"Ordinate menu\"]').click()");
    await wait(win,"[...document.querySelectorAll('[data-command]')].some(b=>b.textContent==='Print…'&&!b.disabled)");
    await checkMenuIconAlignment(win, {query,wait,capture}, host);
    await capture(win,`${host}-print-menu`);
    await query(win,"[...document.querySelectorAll('[data-command]')].find(b=>b.textContent==='Print…').click()");
    await wait(win,"document.querySelector('.print-options-dialog')");
    await query(win,"document.querySelector('.print-options-dialog .primary').click()");
    await wait(win,"window.__printCalls===1&&document.querySelector('#ordinate-print-root table')");
    assert.equal(await query(win,"document.querySelectorAll('#ordinate-print-root tbody tr').length"),260,'Not just virtualized visible rows');
    const text = await query(win,"document.querySelector('#ordinate-print-root').textContent");
    assert.ok(text.includes('All figures in millions')&&text.includes('End of report.')&&text.includes('520'));
    assert.ok(!text.includes('MUST NOT PRINT'));
    assert.equal(await query(win,"getComputedStyle(document.querySelector('#ordinate-print-root')).display"),'none','Screen UI stays unchanged');
    assert.equal(await shortcut(),true);
    assert.equal(await query(win,"window.__printCalls"),1,'Pending preview blocks repeated commands');
    win.webContents.debugger.attach('1.3');
    for (const theme of ['light','dark']) {
      await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:'print'});
      assert.equal(await query(win,"getComputedStyle(document.getElementById('root')).display"),'none');
      assert.equal(await query(win,"getComputedStyle(document.querySelector('#ordinate-print-root thead')).display"),'table-header-group');
      assert.equal(await query(win,"getComputedStyle(document.body).backgroundColor"),'rgb(255, 255, 255)');
      await capture(win,`${host}-print-${theme}`);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:''});
    }
    const pdf = await win.webContents.printToPDF({printBackground:true});
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    await writeFile(path.join(directory,`${host}-print-complete.pdf`),pdf);
    await closePrint();
    assert.equal(await query(win,"!!document.querySelector('[role=dialog]')"),false,'Cancel/close is not an error');
    // Keyboard printing commits the active cell before making its snapshot.
    await query(win,"[...document.querySelectorAll('[role=gridcell]')].find(c=>c.textContent==='1.00').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    await wait(win,"document.querySelector('textarea[aria-label=\"Edit selected cell input\"]')");
    await setText('textarea[aria-label="Edit selected cell input"]','17');
    assert.equal(await shortcut(),true);
    await wait(win,"document.querySelector('.print-options-dialog')");
    await query(win,"document.querySelector('.print-options-dialog .primary').click()");
    await wait(win,"window.__printCalls===2");
    assert.ok(await query(win,"document.querySelector('#ordinate-print-root tbody tr').textContent.endsWith('17.0034')"));
    await closePrint();
    await query(win,"document.querySelector('.source-button').click()");
    await wait(win,"document.querySelector('.source-shell textarea')");
    await setText('.source-shell textarea','# Quarterly report\n| 246810 |');
    await shortcut();
    await wait(win,"document.querySelector('.print-options-dialog')");
    await query(win,"document.querySelector('.print-options-dialog .primary').click()");
    await wait(win,"window.__printCalls===3");
    assert.equal(await query(win,"document.querySelector('#ordinate-print-root tbody').textContent"),'246810','Print current source, not the last table');
    await closePrint();
    await setText('.source-shell textarea','# Quarterly report\n| 1 | 2 |\n| 3 |');
    await shortcut();
    await wait(win,"document.querySelector('[role=dialog]')?.textContent.includes('Unable to print')");
    assert.equal(await query(win,"window.__printCalls"),3,'Invalid source never prints a stale snapshot');
    assert.equal(await query(win,"!!document.querySelector('#ordinate-print-root')"),false);
    await shortcut();
    assert.equal(await query(win,"window.__printCalls"),3,'Modal blocks keyboard printing');
    await query(win,"[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='OK').click()");
    await checkPrintOptions(win, {query,wait,capture,directory}, {
      open: shortcut,
      jobCount: () => query(win,"window.__printCalls"),
      finish: closePrint,
      host,
    });
    console.log(`${host}: File print, keyboard commit, complete 260-row PDF, both notes, active sheet, source edits, light/dark, cancellation, duplicates and invalid-source guards passed.`);
  } finally {
    await query(win,"window.print=window.__originalPrint;window.dispatchEvent(new Event('afterprint'))");
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
  }
}
