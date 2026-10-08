import assert from 'node:assert/strict';

// Real pointer events and rendered opacity in test-owned native/web windows.
export async function checkRailMotion(win, {query, wait, capture}) {
  win.setSize(1060,800); win.show(); win.focus();
  const host = await query(win, "window.ordinateDesktop ? 'native' : 'web'");
  await query(win, "document.querySelector('.source-button').click()");
  await wait(win, "document.querySelector('.source-shell textarea')");
  const source = '# Rail motion\n| Item | 2025 | 2026 |\n| --- | --- | --- |\n| Revenue | 120 | 140 |\n| Costs | 80 | 90 |\n| Profit | = B2 - B3 | = C2 - C3 |';
  await query(win, `(() => {const el=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(source)});
    el.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('.source-button').click();})()`);
  await wait(win, "document.querySelector('.table-stage[data-layout-ready=\"true\"]') && document.querySelector('.column-index-cell')");
  const read = `['.column-index-strip','.row-index-strip'].map(selector=>{
    const el=document.querySelector(selector),s=getComputedStyle(el),r=el.getBoundingClientRect();
    return {opacity:Number(s.opacity),box:[r.x,r.y,r.width,r.height],duration:s.transitionDuration,delay:s.transitionDelay};
  })`;
  const visible = `(${read}).every(rail=>rail.opacity===1)`;
  const hidden = `(${read}).every(rail=>rail.opacity===0)`;
  const point = await query(win, `(() => {const r=document.querySelector('.column-index-cell').getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  const outside = await query(win, "({x:innerWidth-30,y:innerHeight-30})");
  const move = p => win.webContents.sendInputEvent({type:'mouseMove',...p});
  const pause = ms => query(win, `new Promise(resolve=>setTimeout(resolve,${ms}))`);
  move(outside); await wait(win, hidden);
  for (const theme of ['light','dark']) {
    await query(win, `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    move(point); await wait(win, visible);
    const before = await query(win, read);
    assert.ok(before.every(rail=>rail.duration==='0.18s'&&rail.delay==='0s'),'Reveal is gentler but remains faster than exit, with no delay');
    await capture(win, host+'-rail-motion-'+theme);
    move(outside);
    const samples = await query(win, `(async () => {const sample=()=>(${read}),frames=[sample()];
      for (const ms of [50,140,250]) {await new Promise(resolve=>setTimeout(resolve,ms));frames.push(sample());} return frames;})()`);
    assert.ok(samples[1].every(rail=>rail.opacity===1),'Rails briefly remain readable during the exit delay');
    assert.ok(samples[2].every(rail=>rail.opacity>0&&rail.opacity<1&&rail.duration==='0.26s'&&rail.delay==='0.12s'),'Exit fades at the shorter duration rather than abruptly disappearing');
    assert.ok(samples[3].every(rail=>rail.opacity===0),'Rails finish fading');
    samples.forEach(frame=>frame.forEach((rail,index)=>assert.deepEqual(rail.box,before[index].box,'No geometry change during fade')));

    move(point); await wait(win, visible); move(outside); await pause(60);
    move(point); await wait(win, visible); await pause(500);
    assert.ok(await query(win, visible),'Re-entry cancels pending disappearance');
    move(outside); await pause(200);
    assert.ok((await query(win,read)).every(rail=>rail.opacity>0&&rail.opacity<1));
    move(point); await wait(win, visible); await pause(500);
    assert.ok(await query(win,visible),'Re-entry reverses an in-progress fade');
    move(outside); await wait(win,hidden);
    await query(win,"document.querySelector('.row-index-main').focus()");
    await pause(500);
    assert.equal(await query(win,"Number(getComputedStyle(document.querySelector('.row-index-strip')).opacity)"),1,'Keyboard focus keeps the rail visible');
    await query(win,"document.activeElement.blur()"); await wait(win,hidden);
  }
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    move(point); await wait(win,visible);
    assert.ok((await query(win,read)).every(rail=>parseFloat(rail.duration)<.001),'Reduced motion removes the animated fade');
    move(outside); await pause(60);
    assert.ok(await query(win,visible),'Reduced motion retains the reading delay');
    await wait(win,hidden);
  } finally {win.webContents.debugger.detach();}
  console.log(host+': rail motion passed: delayed fade, rapid re-entry, focus retention, fixed geometry, light/dark and reduced motion.');
}
