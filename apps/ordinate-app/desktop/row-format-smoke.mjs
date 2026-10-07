import assert from 'node:assert/strict';

// Synthetic document in the shared test-owned native/web hosts.
export async function checkRowFormatting(win,{query,wait,capture}) {
  win.setSize(1060,800);win.show();win.focus();
  const host=await query(win,"window.ordinateDesktop ? 'native' : 'web'");
  const source='# Row formatting\n| @display | | {::>} | |\n| {::bold} | Total | 120 | 140 {::normal} |\n| | Detail | 30 | 40 |';
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.source-shell textarea')");
  await query(win,`(()=>{const el=document.querySelector('.source-shell textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(source)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.table-stage[data-layout-ready=\"true\"]') && document.querySelectorAll('.row-index-main').length===2");
  assert.equal(await query(win,"document.querySelectorAll('.row-index-main [data-formatted]').length"),1);
  assert.equal(await query(win,"document.querySelectorAll('.column-index-label[data-formatted]').length"),1);
  assert.equal(await query(win,"!!document.querySelector('.column-index-config-badge')"),false);
  assert.equal(await query(win,"document.querySelectorAll('.row-index-main')[1].querySelector('[data-formatted]')===null"),true,'Inherited column formatting does not mark a row');
  await query(win,"document.querySelectorAll('.row-index-main')[1].parentElement.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
  await wait(win,"document.querySelector('[aria-label=\"Row metadata tools\"]')");
  await query(win,"[...document.querySelectorAll('[aria-label=\"Row metadata tools\"] button')].find(b=>b.textContent.trim()==='Style').click()");
  await wait(win,"document.querySelector('.rail-menu-detail')");
  await query(win,"[...document.querySelectorAll('.rail-menu-detail button')].find(b=>b.textContent.trim()==='Bold').click()");
  await wait(win,"document.querySelectorAll('.row-index-main [data-formatted]').length===2");
  for(const theme of ['light','dark']){
    await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    const marks=await query(win,`[...document.querySelectorAll('.axis-format-label[data-formatted]')].map(el=>{const s=getComputedStyle(el,'::after');return {height:s.height,pointerEvents:s.pointerEvents,background:s.backgroundColor};})`);
    assert.ok(marks.length===3&&marks.every(m=>m.height==='2px'&&m.pointerEvents==='none'&&m.background!=='rgba(0, 0, 0, 0)'));
    const accent=await query(win,`(()=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--accent)';document.querySelector('.workspace-shell').append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color;})()`);
    assert.ok(marks.every(mark=>mark.background===accent),'Row and column underlines reuse the existing primary green in both themes');
    await capture(win,host+'-row-format-'+theme);
  }
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.source-shell textarea')");
  const saved=await query(win,"document.querySelector('.source-shell textarea').value");
  assert.ok(saved.includes('@display')&&saved.match(/\{::bold\}/g).length===2);
  assert.ok(saved.includes('{::normal}'),'Cell exception survives row edits');
  await query(win,"document.querySelector('.source-button').click()");
  console.log(host+': row formatting works without header columns; explicit row/column indicators, style edit, both themes and canonical source passed.');
}
