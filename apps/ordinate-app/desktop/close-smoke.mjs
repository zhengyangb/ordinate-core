import assert from 'node:assert/strict';
import { dialog } from 'electron';
import { readFile } from 'node:fs/promises';

// Real production close handling in isolated test-owned windows and profile.
export async function checkClose({ nativeWindow, query, wait, saveTo }) {
  const originalMessageBox = dialog.showMessageBox;
  const prompts = [];
  let response = 1;
  dialog.showMessageBox = async (_win, options) => {
    assert.equal(options.message, 'Save this document before closing?', options.detail);
    prompts.push(options);
    return { response, checkboxChecked: false };
  };
  const until = async condition => {
    const deadline = Date.now() + 15000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Native close did not complete');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const fresh = async id => {
    const entry = await nativeWindow({ id, filename: null, text: null });
    await wait(entry.win, `document.querySelector('.table-stage[data-layout-ready="true"]')`);
    return entry;
  };
  const closeSilently = async entry => {
    const count = prompts.length;
    entry.win.close();
    await until(() => entry.win.isDestroyed());
    assert.equal(prompts.length, count, 'An unchanged initial table closes without a save prompt');
  };
  const discard = async entry => {
    response = 2;
    entry.win.close();
    await until(() => entry.win.isDestroyed());
  };
  try {
    const untouched = await fresh('close-untouched');
    assert.ok(await query(untouched.win, `document.querySelectorAll('.ag-center-cols-container .ag-cell').length > 0`));
    assert.deepEqual(await untouched.host.flush(), { needsSave: false });
    await closeSilently(untouched);

    const viewed = await fresh('close-viewed');
    await query(viewed.win, `document.querySelector('.ag-center-cols-container .ag-cell').click()`);
    await query(viewed.win, `document.querySelector('.source-button').click()`);
    await wait(viewed.win, `document.querySelector('.source-shell textarea')`);
    await query(viewed.win, `document.querySelector('.source-button').click()`);
    await wait(viewed.win, `document.querySelector('.table-stage[data-layout-ready="true"]')`);
    await closeSilently(viewed);

    const edited = await fresh('close-edited');
    edited.win.show();
    await query(edited.win, `document.querySelector('.ag-center-cols-container .ag-cell').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
    await wait(edited.win, `document.querySelector('textarea[aria-label="Edit selected cell input"]')`);
    await query(edited.win, `(() => {
      const input = document.querySelector('textarea[aria-label="Edit selected cell input"]');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'User edit');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    // No Apply click or autosave wait: closing must commit pending editor input.
    response = 1;
    const beforeEditClose = prompts.length;
    edited.win.close();
    await until(() => prompts.length === beforeEditClose + 1);
    assert.equal(edited.win.isDestroyed(), false, 'Cancel keeps edited content open');
    assert.deepEqual(await edited.host.flush(), { needsSave: true });
    await wait(edited.win, `[...document.querySelectorAll('.ag-cell')].some(cell=>cell.textContent.includes('User edit'))`);

    edited.win.webContents.reload();
    await wait(edited.win, `document.documentElement.dataset.startup === 'ready'`);
    await wait(edited.win, `[...document.querySelectorAll('.ag-cell')].some(cell=>cell.textContent.includes('User edit'))`);
    assert.deepEqual(await edited.host.flush(), { needsSave: true }, 'Recovered edits remain protected');
    await discard(edited);

    const imported = await nativeWindow({ id: 'close-imported', filename: null, text: '# Imported\n| Preserved content |' });
    assert.deepEqual(await imported.host.flush(), { needsSave: true }, 'Imported/duplicated content requires saving before dismissal');
    const beforeImportClose = prompts.length;
    await discard(imported);
    assert.equal(prompts.length, beforeImportClose + 1);

    const saved = await fresh('close-explicit-save');
    const filename = saveTo();
    await saved.host.request('saveAs');
    assert.equal(saved.record.filename, filename, 'Explicit Save assigns the backing file');
    assert.deepEqual(await saved.host.flush(), { needsSave: false });
    await closeSilently(saved);
    assert.match(await readFile(filename, 'utf8'), /Sheet 1/, 'Closing retains the explicitly saved document');
    console.log('Close passed: untouched/default table, selection/view changes, pending cell edit, Cancel, recovered edits, imported content and explicit Save.');
  } finally {
    dialog.showMessageBox = originalMessageBox;
  }
}
