import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Same interaction checks on native, ordinary web and Online, without physical jobs. */
export async function checkPrintOptions(win, {query,wait,capture,directory}, {open,jobCount,finish,host}) {
  const setSource = text => query(win, `(() => {
    const input=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const load = async text => {
    if (!await query(win,"!!document.querySelector('.source-shell textarea')")) await query(win,"document.querySelector('.source-button').click()");
    await wait(win,"document.querySelector('.source-shell textarea')");
    await setSource(text);
    await query(win,"document.querySelector('.source-button').click()");
    await wait(win,"document.querySelector('.table-stage[data-layout-ready=\"true\"]')");
  };
  const dialog = '.print-options-dialog';
  const click = label => query(win,`[...document.querySelectorAll('${dialog} button')].find(b=>b.textContent===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);
  const begin = async () => { await open(); await wait(win,`document.querySelector('${dialog}')`); };
  const bounds = () => query(win,`(() => {const r=document.querySelector('${dialog}').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})()`);
  const print = async () => {
    const previous = await jobCount();
    await query(win,`(() => {const button=document.querySelector('${dialog} .primary');button.click();button.click();})()`);
    await wait(win,"document.querySelector('#ordinate-print-root table')");
    const deadline=Date.now()+15000;
    while (await jobCount() === previous && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(await jobCount(),previous+1);
    assert.equal(await query(win,`!!document.querySelector('${dialog}')`),false);
  };
  const source = '# Input\nInput intro\n\n| Label || Value |\n| --- || --- |\n| Revenue || 21 |\n\nInput closing\n\n# Summary\nSummary intro\n\n| Label || Result |\n| --- || --- |\n| Total || = @["Input"::B2] * 2 |\n\nSummary closing\n\n# Bare\n| 123456 |';
  await load(source);
  await query(win,"[...document.querySelectorAll('.sheet-tabs button')].find(b=>b.textContent==='Summary').click()");
  await wait(win,"document.querySelector('.table-stage[data-layout-ready=\"true\"]')&&document.querySelector('.sheet-tab.active')?.textContent==='Summary'");
  const before = await jobCount();
  await begin();
  assert.equal(await query(win,`document.querySelector('${dialog} [role=radio][aria-checked=true]').textContent`),'Current sheet');
  assert.equal(await query(win,`document.querySelectorAll('${dialog} .selection-row[aria-pressed=true]').length`),2);
  assert.equal(await jobCount(),before,'Opening choices does not start a job');
  await open();
  assert.equal(await query(win,`document.querySelectorAll('${dialog}').length`),1,'Repeated commands do not create overlapping choices');
  // Let the existing shell entrance finish before measuring stable geometry.
  await query(win,`Promise.all(document.querySelector('${dialog}').getAnimations().map(a=>a.finished))`);
  const initial = await bounds();
  await click('All sheets');
  await click('Notes above table');
  await click('Notes below table');
  assert.deepEqual(await bounds(),initial,'Scope and note toggles must not move or resize the dialog');
  await click('Current sheet');
  assert.deepEqual(await bounds(),initial);
  for (const theme of ['light','dark']) {
    await query(win,`document.documentElement.dataset.theme='${theme}'`);
    await capture(win,`${host}-print-options-${theme}`);
  }
  win.setSize(420,720);
  await query(win,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.ok(await query(win,`(() => {const r=document.querySelector('${dialog}').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`),'Narrow dialog fits');
  await capture(win,`${host}-print-options-narrow`);
  await query(win,`document.querySelector('${dialog} [role=radio][aria-checked=true]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))`);
  assert.equal(await query(win,`document.activeElement.textContent`),'All sheets','Shared segmented keyboard navigation');
  await query(win,`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
  await wait(win,`!document.querySelector('${dialog}')`);
  assert.equal(await jobCount(),before,'Escape cancels without entering the system dialog');
  win.setSize(1060,820);
  await begin();
  // New requests reset to the agreed defaults, not the canceled choices.
  assert.equal(await query(win,`document.querySelectorAll('${dialog} .selection-row[aria-pressed=true]').length`),2);
  await capture(win,`${host}-print-options-default`);
  await click('Notes above table'); await print();
  let content = await query(win,"document.querySelector('#ordinate-print-root').textContent");
  assert.ok(!content.includes('intro')&&content.includes('Summary closing')&&content.includes('42'));
  assert.equal(await query(win,"document.querySelectorAll('#ordinate-print-root .print-sheet').length"),1);
  await finish();
  await begin(); await click('All sheets'); await click('Notes below table'); await print();
  assert.deepEqual(await query(win,"[...document.querySelectorAll('#ordinate-print-root h1')].map(h=>h.textContent)"),['Input','Summary','Bare']);
  content = await query(win,"document.querySelector('#ordinate-print-root').textContent");
  assert.ok(content.includes('Input intro')&&content.includes('Summary intro')&&!content.includes('closing')&&content.includes('42'));
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:'print'});
  assert.deepEqual(await query(win,"[...document.querySelectorAll('#ordinate-print-root .print-sheet')].map(s=>getComputedStyle(s).breakBefore)"),['auto','page','page']);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:''});
  const pdf = await win.webContents.printToPDF({printBackground:true});
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,3,'One short sheet per page, no blank lead/trailing pages');
  await writeFile(path.join(directory,`${host}-print-all-sheets.pdf`),pdf);
  await finish();
  await query(win,"[...document.querySelectorAll('.sheet-tabs button')].find(b=>b.textContent==='Bare').click()");
  await begin();
  await query(win,`Promise.all(document.querySelector('${dialog}').getAnimations().map(a=>a.finished))`);
  const currentBounds = await bounds();
  assert.equal(await query(win,`document.querySelectorAll('${dialog} .selection-row:disabled').length`),2,'Choices remain in place when only other sheets have notes');
  await click('All sheets');
  assert.equal(await query(win,`document.querySelectorAll('${dialog} .selection-row:disabled').length`),0);
  assert.deepEqual(await bounds(),currentBounds);
  await click('Cancel');
  await load('# Plain\n| 17 |'); await begin();
  assert.equal(await query(win,`document.querySelectorAll('${dialog} .selection-row').length`),0,'A workbook with no notes has no note toggles');
  await print(); await finish();
  // Reject invalid sheets included by All, never silently omit a sheet or notes.
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.source-shell textarea')");
  await setSource('# Plain\n| 17 |\n\n# Invalid\n| 1 | 2 |\n| 3 |');
  await begin(); await click('All sheets');
  const jobBeforeError = await jobCount();
  await click('Print…');
  await wait(win,"document.querySelector('[role=dialog]')?.textContent.includes('Unable to print')");
  assert.equal(await jobCount(),jobBeforeError);
  assert.equal(await query(win,"!!document.querySelector('#ordinate-print-root')"),false);
  await query(win,"[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='OK').click()");
  await begin(); await print(); await finish();
  console.log(`${host}: print choices passed: shared components, keyboard/cancel, defaults, stable geometry, narrow/light/dark, current/all, independent notes, cross-sheet values, three-page PDF and invalid-sheet rejection/retry.`);
}
