import assert from 'node:assert/strict';

/** Real hover, capture, focus and click ordering on the shared sheet chrome. */
export async function checkSheetTooltip(win, {query, wait, capture}) {
  const waitFor=async expression=>{
    try { await wait(win,expression); }
    catch(cause) {throw new Error(cause.message+'\nEvents: '+JSON.stringify(await query(win,'window.tabTrace')),{cause});}
  };
  win.setSize(820,780);win.show();win.focus();win.webContents.focus();
  await wait(win,'document.hasFocus()');
  const host=await query(win,"window.ordinateDesktop ? 'native' : 'web'");
  const names=['A very long operating report with quarterly forecasts and assumptions','A very long sales ledger with customer invoices and payment schedules'];
  const source=names.map(name=>'# '+name+'\n| 1 |').join('\n')+'\n# Short\n| 2 |';
  await query(win,"document.querySelector('.source-button').click()");
  await wait(win,"document.querySelector('.source-shell textarea')");
  await query(win,`(() => {const input=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(source)});
    input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.source-button').click();})()`);
  await wait(win,`document.querySelector('.table-stage[data-layout-ready="true"]')&&document.querySelectorAll('.sheet-tab').length===3`);
  await query(win,`(() => {window.tabTrace=[];for(const tab of document.querySelectorAll('.sheet-tab'))for(const type of ['mouseenter','mouseleave','focus','blur','pointerdown','click'])tab.addEventListener(type,event=>window.tabTrace.push([type,tab.textContent,event.clientX,event.clientY]))})()`);
  const target=index=>`document.querySelectorAll('.sheet-tab')[${index}]`;
  const point=async index=>query(win,`(() => {const r=${target(index)}.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const outside={x:790,y:740};
  const move=async p=>{
    win.webContents.sendInputEvent({type:'mouseMove',...p});
    await query(win,'new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const click=p=>{
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
  };
  const visible=`document.querySelector('.floating-tooltip.visible[aria-hidden="false"]')`;
  const settled=name=>`${visible}?.textContent===${JSON.stringify(name)}`;
  const steadyHidden=()=>query(win,`new Promise(resolve=>{
    let appeared=!!(${visible});const observer=new MutationObserver(()=>{appeared ||= !!(${visible})});
    observer.observe(document.querySelector('.floating-tooltip'),{attributes:true,childList:true,subtree:true});
    setTimeout(()=>{observer.disconnect();resolve(!appeared)},400);
  })`);
  for(const theme of ['light','dark']) {
    await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await move(outside);await query(win,'document.activeElement.blur()');await waitFor(`!(${visible})`);
    const p=await point(1);await move(p);await waitFor(settled(names[1]));
    click(p);await wait(win,`${target(1)}.getAttribute('aria-selected')==='true'&&!(${visible})`);
    assert.ok(await steadyHidden(),'Clicked tab must not reopen its tooltip while the pointer stays');
    // Focus can be restored after a view switch; that is not a fresh hover.
    await query(win,`${target(1)}.blur();${target(1)}.focus()`);
    assert.ok(await steadyHidden(),'Restored focus must not undo pointer dismissal: '+JSON.stringify(await query(win,'window.tabTrace')));
    await move(outside);await move(await point(1));await waitFor(settled(names[1]));
    click(await point(1));await wait(win,`!(${visible})`);
    assert.ok(await steadyHidden(),'Clicking the active tab also dismisses its hint');
    await move(outside);await query(win,`${target(1)}.blur()`);
    await move(await point(0));click(await point(0));await wait(win,`!(${visible})`);
    assert.ok(await steadyHidden(),'Clicking before the hover timer expires cancels the pending hint');
    await capture(win,host+'-sheet-tooltip-dismissed-'+theme);
  }
  win.focus();win.webContents.focus();await wait(win,'document.hasFocus()');
  await move(outside);await query(win,`${target(0)}.blur();${target(1)}.focus()`);
  await waitFor(settled(names[1]));
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await waitFor(`!(${visible})`);
  assert.ok(await steadyHidden(),'Keyboard activation dismisses the tooltip too');
  await query(win,`${target(1)}.blur();${target(1)}.focus()`);
  await waitFor(settled(names[1]));
  await query(win,`${target(1)}.blur()`);await move(await point(2));
  assert.ok(await steadyHidden(),'Untruncated names need no tooltip');
  console.log(host+': sheet tooltip passed: click dismissal, no reappearance, delayed-show cancellation, re-entry, restored focus, keyboard activation and light/dark.');
}
