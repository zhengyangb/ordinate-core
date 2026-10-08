import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

/** Use the same root example files as core tests, in test-owned hosts only. */
export async function checkExamples(win, {query,wait,capture}) {
  const directory = new URL('../../../examples/', import.meta.url);
  const files = (await readdir(directory)).filter(file => file.endsWith('.ord')).sort();
  win.setSize(1120,900);win.show();win.focus();
  const host = await query(win, `window.ordinateDesktop?'native':'web'`);
  const ready = `!document.querySelector('.view-handoff[data-handoff]')&&document.querySelector('.view-handoff-live .table-stage[data-layout-ready="true"]')`;
  for (const file of files) {
    const text = await readFile(new URL(file,directory),'utf8');
    const names = [...text.matchAll(/^# (.+)$/gm)].map(match => match[1]);
    await query(win, `document.querySelector('.source-button').click()`);
    await wait(win, `document.querySelector('.source-shell textarea')`);
    await query(win, `(() => {
      const input=document.querySelector('.source-shell textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('.source-button').click();
    })()`);
    await wait(win, ready);
    assert.equal(await query(win,`!!document.querySelector('.error[role="alert"]')`),false,file);
    for (const name of names) {
      await query(win,`[...document.querySelectorAll('.sheet-tab')].find(tab=>tab.querySelector('.sheet-tab-label')?.textContent===${JSON.stringify(name)}).click()`);
      await wait(win,`document.querySelector('.sheet-tab.active .sheet-tab-label')?.textContent===${JSON.stringify(name)}&&(${ready})`);
      await wait(win,`document.querySelector('.view-handoff-live .sheet-note-intro .sheet-note-content')?.textContent.length>0&&getComputedStyle(document.querySelector('.view-handoff-live .sheet-note-intro')).visibility==='visible'`);
      assert.equal(await query(win,`document.querySelector('.sheet-tab.active .sheet-tab-alert')?.textContent??''`),'',`${file} / ${name}: no formula/format issues`);
      await capture(win,`${host}-example-${file.replace('.ord','')}-${name.toLowerCase().replaceAll(' ','-')}`);
    }
  }
  console.log(`${host}: all ${files.length} native examples and every sheet rendered without issues`);
}
