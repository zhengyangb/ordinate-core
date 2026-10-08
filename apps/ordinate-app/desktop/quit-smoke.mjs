import assert from 'node:assert/strict';
import { app, dialog } from 'electron';
import { readFile } from 'node:fs/promises';
import { createQuitCoordinator } from '../desktop-out/desktop/quitCoordinator.js';

// The real Electron before-quit event and production close policy. Test-owned
// windows/profile only; the final process-exit call is spied so assertions run.
export async function checkQuit({nativeWindow, query, wait, saveTo}) {
  const originalMessageBox = dialog.showMessageBox;
  const prompts = [];
  let choices = [];
  dialog.showMessageBox = async (win, options) => {
    assert.equal(options.message,'Save this document before quitting?');
    assert.deepEqual(options.buttons,['Save…','Cancel',"Don't Save"]);
    assert.ok(choices.length,'Unexpected save confirmation');
    prompts.push({window:win.id,options});
    return {response:await choices.shift(),checkboxChecked:false};
  };
  const until = async condition => {
    const deadline = Date.now()+15000;
    while(!condition()) {
      if(Date.now()>deadline) throw new Error('Quit did not settle');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
  };
  const fixture = () => {
    const documents=[], writes=[], errors=[];
    let exits=0;
    const coordinator=createQuitCoordinator({documents:()=>documents,
      persist:async records=>writes.push(structuredClone(records)),
      flushStorage:()=>documents[0].win.webContents.session.flushStorageData(),
      quit:()=>{exits++;},reportError:error=>errors.push(error)});
    app.on('before-quit',coordinator.beforeQuit);
    return {documents,writes,errors,coordinator,get exits(){return exits;},
      async create(id,text=null) {
        const entry=await nativeWindow({id,filename:null,text},()=>coordinator.phase);
        documents.push(entry);
        await wait(entry.win,'document.querySelector(\'.table-stage[data-layout-ready="true"]\')');
        return entry;
      },
      dispose(){app.removeListener('before-quit',coordinator.beforeQuit);for(const entry of documents)if(!entry.win.isDestroyed())entry.win.destroy();},
    };
  };
  try {
    const clean=fixture();
    try {
      await clean.create('quit-untouched');
      const saved=await clean.create('quit-saved');
      const filename=saveTo('quit-saved.ord');await saved.host.request('saveAs');
      const before=prompts.length;app.quit();await until(()=>clean.coordinator.phase==='approved');
      assert.equal(prompts.length,before,'Untouched and already-saved documents quit silently');
      assert.equal(clean.exits,1);assert.deepEqual(clean.writes[0].map(record=>record.filename),[filename]);
      for(const entry of clean.documents)entry.win.close();
      await until(()=>clean.documents.every(entry=>entry.win.isDestroyed()));
      assert.equal(prompts.length,before,'Approved quit bypasses duplicate close confirmations');
    } finally {clean.dispose();}

    const edited=fixture();
    try {
      const first=await edited.create('quit-pending-edit');
      const second=await edited.create('quit-other-edit','# Other work\n| Content to keep |');
      first.win.show();
      await query(first.win,"document.querySelector('.ag-center-cols-container .ag-cell').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))");
      await wait(first.win,'document.querySelector(\'textarea[aria-label="Edit selected cell input"]\')');
      await query(first.win,`(()=>{const input=document.querySelector('textarea[aria-label="Edit selected cell input"]');input.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Pending quit edit');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      let respond;
      choices=[new Promise(resolve=>{respond=resolve;})];
      let before=prompts.length;app.quit();await until(()=>prompts.length===before+1);
      assert.equal(edited.coordinator.phase,'checking');
      app.quit();first.win.close();second.win.close();
      assert.equal(prompts.length,before+1,'Repeated Quit / Close shares one confirmation');
      assert.ok(edited.documents.every(entry=>!entry.win.isDestroyed()));
      respond(1);await until(()=>edited.coordinator.phase==='idle');
      await wait(first.win,"[...document.querySelectorAll('.ag-cell')].some(cell=>cell.textContent.includes('Pending quit edit'))");
      assert.equal(edited.writes.length,0,'Cancel leaves the workspace unchanged');

      // Earlier Don't Save must not dismiss a window when a later sheet cancels.
      choices=[2,1];app.quit();await until(()=>edited.coordinator.phase==='idle');
      assert.ok(edited.documents.every(entry=>!entry.win.isDestroyed()));
      assert.equal(edited.writes.length,0);assert.equal(edited.exits,0);

      // Canceling Save As stops Quit too, with no discarded documents.
      saveTo(null);choices=[0];app.quit();await until(()=>edited.errors.length===1);
      assert.equal(edited.coordinator.phase,'idle');assert.equal(edited.exits,0);
      assert.equal(first.record.filename,null);assert.ok(!second.win.isDestroyed());

      const filename=saveTo('quit-user-edits.ord');choices=[0,1];
      app.quit();await until(()=>edited.coordinator.phase==='idle');
      assert.equal(first.record.filename,filename);
      assert.match(await readFile(filename,'utf8'),/Pending quit edit/,'Save writes the pending editor content');
      assert.ok(edited.documents.every(entry=>!entry.win.isDestroyed()));
      assert.equal(edited.exits,0,'A later Cancel still keeps all windows open after an earlier Save');

      choices=[2];before=prompts.length;app.quit();await until(()=>edited.coordinator.phase==='approved');
      assert.equal(prompts.length,before+1,'Already-saved first document needs no further prompt');
      assert.equal(edited.exits,1);
      assert.deepEqual(edited.writes[0].map(record=>record.filename),[filename],'Discarded unnamed work does not resume after quit');
      for(const entry of edited.documents)entry.win.close();
      await until(()=>edited.documents.every(entry=>entry.win.isDestroyed()));
      assert.equal(prompts.length,before+1);
    } finally {edited.dispose();}

    const failed=fixture();
    try {
      await failed.create('quit-discard-before-error','# First\n| Kept until quit succeeds |');
      const unavailable=await failed.create('quit-unavailable','# Second\n| Another edit |');
      unavailable.host.unavailable('The editor stopped before saving completed.');
      choices=[2];app.quit();await until(()=>failed.errors.length===1);
      assert.equal(failed.coordinator.phase,'idle');assert.equal(failed.exits,0);
      assert.equal(failed.writes.length,0);assert.ok(failed.documents.every(entry=>!entry.win.isDestroyed()));
    } finally {failed.dispose();}
    console.log('Quit passed: real before-quit, untouched/saved windows, pending editor, Save/Cancel/Don\'t Save, multi-window cancellation, repeated Quit/Close, canceled Save As, unavailable renderer and saved-only workspace restoration.');
  } finally {dialog.showMessageBox=originalMessageBox;}
}
