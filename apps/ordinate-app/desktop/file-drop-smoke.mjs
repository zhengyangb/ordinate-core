import assert from 'node:assert/strict';
import ExcelJS from '../../../packages/core-ts/node_modules/exceljs/excel.js';

// Test-owned native/web windows only; no user documents or browser state.
export async function checkFileDrop(win, {query, wait, capture}) {
  win.setSize(1000, 760); win.show(); win.focus();
  const host = await query(win, "window.ordinateDesktop ? 'native' : 'web'");
  const drag = async (type, name = 'report.ord', protectedMime = null) => query(win, `(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['a,b\\n1,2'], ${JSON.stringify(name)}));
    const event = new DragEvent(${JSON.stringify(type)}, {bubbles:true,cancelable:true,dataTransfer:transfer});
    if (${JSON.stringify(protectedMime)} !== null) Object.defineProperty(event, 'dataTransfer', {value:{types:['Files'],files:[],items:[{kind:'file',type:${JSON.stringify(protectedMime)}}],dropEffect:'none'}});
    document.querySelector('.workspace-shell, .source-shell').dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  const cancel = async () => { await query(win, "window.dispatchEvent(new Event('dragend'))"); await wait(win,"!document.querySelector('.file-drop-overlay')"); };
  for (const theme of ['light', 'dark']) {
    await query(win, `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    for (const [name, kind] of [['report.ord','document'], ['report.csv','import']]) {
      await drag('dragenter',name);
      await wait(win, `document.querySelector('.file-drop-overlay')?.dataset.kind === '${kind}'`);
      const layout = await query(win, `(() => {
        const cue=document.querySelector('.file-drop-overlay'), r=cue.getBoundingClientRect(), stage=cue.parentElement.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,stageTop:stage.top,stageBottom:stage.bottom,pointerEvents:getComputedStyle(cue).pointerEvents,blur:getComputedStyle(cue).backdropFilter};
      })()`);
      assert.ok(layout.top === layout.stageTop && layout.bottom === layout.stageBottom && layout.top > 0, 'Only the working area is covered');
      assert.equal(layout.pointerEvents,'none'); assert.equal(layout.blur,'blur(4px)');
      await capture(win, `${host}-file-drop-${kind}-${theme}`);
      await cancel();
    }
  }
  await drag('dragenter','hidden','text/plain');
  await wait(win,"document.querySelector('.file-drop-overlay')?.dataset.kind === 'unknown'");
  assert.equal(await query(win,"document.querySelectorAll('.file-drop-route').length"),2);
  await drag('dragenter','hidden','text/plain'); await drag('dragleave');
  assert.equal(await query(win,"!!document.querySelector('.file-drop-overlay')"),true,'Moving between descendants does not flash the overlay');
  await drag('dragleave'); await wait(win,"!document.querySelector('.file-drop-overlay')");
  win.setSize(420,760);
  await drag('dragenter','hidden','text/plain');
  assert.ok(await query(win,"(() => {const r=document.querySelector('.file-drop-message').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()"));
  await capture(win,`${host}-file-drop-narrow`); await cancel();
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.source-shell textarea')");
  const source = await query(win,"document.querySelector('.source-shell textarea').value");
  await query(win,"document.querySelector('.source-shell textarea').focus()");
  await drag('dragenter');
  await wait(win,"document.querySelector('.source-shell .file-drop-overlay')");
  assert.equal(await query(win,"document.activeElement === document.querySelector('.source-shell textarea')"),true,'Feedback does not steal editing focus');
  await query(win,"window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
  await wait(win,"!document.querySelector('.file-drop-overlay')");
  assert.equal(await query(win,"document.querySelector('.source-shell textarea').value"),source);
  await query(win,"document.querySelector('.source-button').click()");
  await drag('dragenter','preview.csv'); await drag('drop','preview.csv');
  await wait(win,"document.querySelector('.interchange-filename')?.textContent === 'preview.csv'");
  assert.equal(await query(win,"!!document.querySelector('.file-drop-overlay')"),false,'Clears before import dialog');
  await drag('dragenter');
  assert.equal(await query(win,"!!document.querySelector('.file-drop-overlay')"),false,'No drop invitation behind a modal');
  await query(win,"[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Cancel').click()");
  await wait(win,"!document.querySelector('[role=dialog]')");
  win.setSize(1000,760);
  if (host === 'native') win.webContents.send('editor:command', 'import');
  else {
    await query(win,"document.querySelector('[aria-label=\"Open file\"]').click()");
    await wait(win,"document.querySelector('.interchange-open-options')");
    await query(win,"[...document.querySelectorAll('.interchange-open-options button')].find(b=>b.textContent.startsWith('Import spreadsheet')).click()");
  }
  await wait(win,"document.querySelector('.interchange-import-drop-target button')?.textContent === 'Choose file…'");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Revenue').addRows([['Year','Revenue'], [2026,12000000], [2027,15000000]]);
  const bytes = Array.from(new Uint8Array(await workbook.xlsx.writeBuffer()));
  const modalDrag = (type, files, selector = '.interchange-import-drop-target') => query(win, `(() => {
    const transfer = new DataTransfer();
    for (const file of ${JSON.stringify(files)}) transfer.items.add(new File([file.bytes ? new Uint8Array(file.bytes) : file.text], file.name));
    const event = new DragEvent(${JSON.stringify(type)}, {bubbles:true,cancelable:true,dataTransfer:transfer});
    document.querySelector(${JSON.stringify(selector)}).dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  const spreadsheet = [{name:'dragged.xlsx',bytes}];
  const chooseButton = '.interchange-import-drop-target .interchange-fields button';
  for (const theme of ['light','dark']) {
    await query(win, `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    const focused = await query(win,"document.activeElement.textContent");
    assert.equal(await modalDrag('dragenter', spreadsheet, chooseButton),true);
    await wait(win,"document.querySelector('.interchange-import-drop-cue')?.dataset.kind === 'import'");
    assert.equal(await query(win,"!!document.querySelector('.file-drop-overlay')"),false,'Only the modal owns this drag');
    assert.equal(await query(win,"document.activeElement.textContent"),focused,'Local feedback does not steal focus');
    await capture(win,`${host}-import-drop-${theme}`);
    await query(win,"window.dispatchEvent(new Event('dragend'))");
    await wait(win,"!document.querySelector('.interchange-import-drop-cue')");
  }
  assert.equal(await modalDrag('drop',spreadsheet,chooseButton),true);
  await wait(win,"document.querySelector('.interchange-filename')?.textContent === 'dragged.xlsx' && document.querySelector('[aria-label=\"Conversion review\"]')");
  assert.ok(await query(win,"document.querySelector('.import-preview-grid').textContent.includes('12000000')"),'Real XLSX data reaches the normal preview');
  for (const files of [[{name:'report.ord',text:'# Report'}],[{name:'bad.pdf',text:''}],[{name:'a.csv',text:'a'},{name:'b.csv',text:'b'}]]) {
    assert.equal(await modalDrag('dragenter',files),true);
    await wait(win,"document.querySelector('.interchange-import-drop-cue')?.dataset.kind === 'blocked'");
    assert.equal(await modalDrag('drop',files),true);
    await wait(win,"document.querySelector('.interchange-error')");
    assert.equal(await query(win,"document.querySelector('.interchange-filename').textContent"),'dragged.xlsx','Invalid files do not replace the preview');
  }
  await modalDrag('drop',[{name:'replacement.csv',text:'Name,Amount\nParts,42\nServices,84'}],'.interchange-import-drop-target header');
  await wait(win,"document.querySelector('.interchange-filename')?.textContent === 'replacement.csv' && document.querySelector('.import-preview-grid')?.textContent.includes('Services')");
  assert.equal(await query(win,"!!document.querySelector('.interchange-error')"),false,'A valid retry clears the error');
  await query(win,"[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Cancel').click()");
  await wait(win,"!document.querySelector('[role=dialog]')");
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.source-shell textarea')");
  assert.equal(await query(win,"document.querySelector('.source-shell textarea').value"),source,'Dialog drops only prepare; cancellation leaves the document untouched');
  await query(win,"document.querySelector('.source-button').click()");
  console.log(`${host}: global/local drop ownership, real XLSX button drop, preview replacement, invalid/multiple files, cancellation, both themes and narrow layout passed.`);
}
