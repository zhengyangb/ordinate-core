import assert from 'node:assert/strict';
import { BrowserWindow } from 'electron';
import { currentOnlineDrafts, waitForOnlineDraft } from './online-draft-test.mjs';

/** Simultaneous browser contexts with the real shared IndexedDB and Web Locks. */
export async function checkOnlineSessions(first, { origin, file, query, capture }) {
  const windows=[];
  // A hidden/occluded test tab need not receive animation frames. Poll from the
  // test host so a failed assertion still has a real, bounded deadline.
  const wait=async(win,expression)=>{
    const deadline=Date.now()+15000;
    while(Date.now()<deadline) {
      if(await query(win,`!!(${expression})`))return;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    const state=await query(win,`({startup:document.documentElement.dataset.startup,session:sessionStorage.getItem('ordinate:online:session'),sheet:document.querySelector('.sheet-tab.active')?.textContent,dialog:document.querySelector('[role="dialog"]')?.textContent})`);
    throw new Error('Timed out: '+expression+'\n'+JSON.stringify(state));
  };
  const id=win=>query(win,`sessionStorage.getItem('ordinate:online:session')`);
  const sheet=`document.querySelector('.sheet-tab.active .sheet-tab-label')?.textContent`;
  const ready=`document.documentElement.dataset.startup==='ready'&&!document.querySelector('[role="dialog"]')&&document.querySelector('.view-handoff-live .table-stage[data-layout-ready="true"]')`;
  const edit=async(win,name,value)=>{
    await query(win,`document.querySelector('.source-button').click()`);await wait(win,`document.querySelector('.source-shell textarea')`);
    await query(win,`(() => {const input=document.querySelector('.source-shell textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify('# '+name+'\n| '+value+' |')});
      input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.source-button').click();})()`);
    await wait(win,`${ready}&&${sheet}===${JSON.stringify(name)}`);
    await waitForOnlineDraft(win,query,'# '+name+'\n');
  };
  const create=()=>{const win=new BrowserWindow({show:true,width:1000,height:780,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});windows.push(win);return win;};
  try {
    await edit(first,'Tab A',777);
    const firstId=await id(first);
    const second=create();await second.loadURL(origin+'/');await wait(second,`document.documentElement.dataset.startup==='ready'`);
    assert.notEqual(await id(second),firstId,'New base-URL tab has independent ownership');
    assert.equal(await query(second,`document.querySelector('.app-title-name').textContent`),'Untitled','New tab does not open another tab’s document');
    second.show();second.focus();await wait(second,`document.querySelector('.online-example-dialog')`);
    await query(second,`document.querySelector('[aria-label="Close examples"]').click()`);await wait(second,ready);
    await query(second,`location.hash='#url='+encodeURIComponent(${JSON.stringify(file)})`);
    await wait(second,`${ready}&&${sheet}==='Start Here'`);
    assert.equal(await query(second,`!!document.querySelector('.remote-workbook-dialog')`),false,'URL approval is shared, document edits are not');
    await edit(second,'Tab B',888);
    const secondId=await id(second);
    // Restore each tab in the foreground: an occluded native window may pause
    // layout frames even when background timer throttling is disabled.
    first.show();first.focus();first.reload();await wait(first,`${ready}&&${sheet}==='Tab A'`);
    second.show();second.focus();second.reload();await wait(second,`${ready}&&${sheet}==='Tab B'`);
    assert.equal(await id(first),firstId,'Reload keeps ownership');
    assert.equal(await id(second),secondId);
    for (const [win,text] of [[first,'# Tab A\n'],[second,'# Tab B\n']]) {
      const records=await query(win,currentOnlineDrafts);
      assert.ok(records.some(record=>record.text.includes(text)));
      assert.ok(records.every(record=>!record.key.startsWith('source:')&&!('sourceUrl' in record)),'Draft ownership is tab-scoped, never URL-scoped');
    }

    // Chrome's duplicate/opener path can clone sessionStorage. Seed that exact
    // boot state before reload, while the original lease is still held.
    const duplicate=create();
    await duplicate.loadURL(origin+'/');await wait(duplicate,`document.documentElement.dataset.startup==='ready'`);
    await query(duplicate,`sessionStorage.setItem('ordinate:online:session',${JSON.stringify(firstId)})`);
    duplicate.reload();await wait(duplicate,`${ready}&&${sheet}==='Tab A'`);
    const duplicateId=await id(duplicate);
    assert.notEqual(duplicateId,firstId,'Copied tab forks the inherited ID');
    assert.notEqual(duplicateId,secondId);
    await edit(duplicate,'Tab copy',999);
    duplicate.reload();await wait(duplicate,`${ready}&&${sheet}==='Tab copy'`);
    assert.equal(await id(duplicate),duplicateId,'Forked tab refreshes independently');
    assert.equal(await query(first,sheet),'Tab A');
    assert.equal(await query(second,sheet),'Tab B');
    assert.ok(!(await query(first,currentOnlineDrafts)).some(record=>record.text.includes('999')),'Clone writes never overwrite the original working copy');
    assert.ok(!(await query(second,currentOnlineDrafts)).some(record=>record.text.includes('999')));
    const reopened=create();await reopened.loadURL(origin+'/');await wait(reopened,`document.documentElement.dataset.startup==='ready'`);
    assert.equal(await query(reopened,`document.querySelector('.app-title-name').textContent`),'Untitled','Fresh tab never auto-resumes the global last file');
    first.show();first.focus();await capture(first,'online-session-independent-a');
    second.show();second.focus();await capture(second,'online-session-independent-b');
    console.log('Online sessions passed: fresh base URL, shared approvals, independent URL imports and tab drafts, refresh, cloned sessionStorage ownership and fresh reopen.');
  } finally {for(const win of windows)if(!win.isDestroyed())win.destroy();first.focus();}
}
