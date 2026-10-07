import assert from 'node:assert/strict';

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
  console.log(`${host}: file drop cues, nested drag, cancellation, source focus, import routing, modal protection, both themes and narrow layout passed.`);
}
