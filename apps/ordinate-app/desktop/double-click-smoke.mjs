import assert from 'node:assert/strict';

/** Exercise real down/up pairs. dispatchEvent('dblclick') bypasses the bug:
 * a selection-driven renderer replacement can cancel click before it exists.
 */
export async function checkCellDoubleClick(win, {query:read, wait}, cases, repetitions = 5) {
  const query=expression=>read(win,expression);
  const editor='textarea[aria-label="Edit selected cell input"]';
  win.show(); win.focus();
  await query(`window.__testCellClicks=[];
    window.__testRecordCellClick=event=>{
      if(event.target.closest('.ag-cell')) window.__testCellClicks.push(event.type);
    };
    for(const type of ['click','dblclick']) document.addEventListener(type,window.__testRecordCellClick,true);`);
  try {
    for (const test of cases) {
      if (test.scroll) await query(`document.querySelector(${JSON.stringify(test.selector)}).scrollIntoView({block:'center',inline:'nearest'})`);
      for (let i=0;i<repetitions;i++) {
        await query(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
        await wait(win,`!document.querySelector(${JSON.stringify(editor)})`);
        await query(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        if(test.scroll) {
          const scrollPosition = `['.note-workspace','.ag-body-viewport'].map(selector=>document.querySelector(selector).scrollTop)`;
          const before = await query(scrollPosition);
          // Scroll the real viewport (and let its native scroll event fire), then
          // press immediately. OS wheel routing is not the behavior under test.
          await query(`(() => {
            const viewport=document.querySelector('.ag-body-viewport');
            viewport.scrollTop += viewport.scrollTop>60 ? -60 : 60;
            return new Promise(resolve=>requestAnimationFrame(resolve));
          })()`);
          const after = await query(scrollPosition);
          assert.notDeepEqual(after,before,`${test.name}: test must actually scroll before double-clicking: ${JSON.stringify({before,after})}`);
        }
        const point=await query(`(() => {
          const node=document.querySelector(${JSON.stringify(test.selector)}),r=node.getBoundingClientRect();
          const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
          window.__testDownTarget=document.elementFromPoint(x,y); window.__testCellClicks=[];
          return {x,y,onCell:!!window.__testDownTarget?.closest('.ag-cell'),hit:window.__testDownTarget?.className};
        })()`);
        assert.ok(point.onCell,`${test.name}: pointer must hit the cell, not an overlay: ${JSON.stringify(point)}`);
        for(const clickCount of [1,2]) {
          win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount,x:point.x,y:point.y});
          // A human press crosses rendering frames; an instant automated down/up
          // conceals replacement of the target between these two events.
          await new Promise(resolve=>setTimeout(resolve,[35,65,100][i%3]));
          assert.equal(await query(`window.__testDownTarget.isConnected`),true,
            `${test.name} / ${i}: selection must preserve the pointer target`);
          win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount,x:point.x,y:point.y});
          if(clickCount===1) await new Promise(resolve=>setTimeout(resolve,90));
        }
        await wait(win,`!!document.querySelector(${JSON.stringify(editor)})`);
        assert.deepEqual(await query(`window.__testCellClicks`),['click','click','dblclick'],`${test.name} / ${i}: complete native click sequence`);
        assert.equal(await query(`document.querySelector(${JSON.stringify(editor)}).value`),test.input,`${test.name}: edit the original input, not its formatted display`);
      }
    }
  } finally {
    await query(`for(const type of ['click','dblclick']) document.removeEventListener(type,window.__testRecordCellClick,true);
      delete window.__testRecordCellClick; delete window.__testDownTarget; delete window.__testCellClicks;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  }
  console.log(`Real cell double-click passed: ${cases.map(test=>test.name).join(', ')} (${repetitions} repetitions each).`);
}

export async function checkDoubleClick(win, helpers) {
  const {query:read,wait}=helpers;
  const query=expression=>read(win,expression);
  const fixture = '# Pointer editing\n| Item || Amount | Text | When | Flag |\n| --- || --- | --- | --- | --- |\n| First || 12000000 | Ready | 2026-01-01 | false |\n| Second || = B2 * 1.08 | Waiting | 2026-02-01 | true |';
  win.setSize(1094,1088);
  await query(`document.querySelector('.source-button').click()`);
  await wait(win,`document.querySelector('.source-shell textarea')`);
  await query(`(() => {
    const input=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(fixture)});
    input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('.source-button').click();
  })()`);
  await wait(win,`!document.querySelector('.view-handoff[data-handoff]') && document.querySelector('.table-stage[data-layout-ready="true"]')`);
  const cell=(row,col)=>`.ag-row[row-index="${row}"] .ag-cell[col-id="col_${col}"]`;
  await checkCellDoubleClick(win,helpers,[
    {name:'number',selector:cell(0,1),input:'12000000'},
    {name:'formula',selector:cell(1,1),input:'= B2 * 1.08'},
    {name:'text',selector:cell(0,2),input:'Ready'},
    {name:'date',selector:cell(0,3),input:'2026-01-01'},
    {name:'Boolean label',selector:cell(0,4)+' .boolean-cell-capsule-label',input:'false'},
    {name:'row label',selector:cell(0,0)+' .tree-label',input:'First'},
  ]);
  const editor = 'textarea[aria-label="Edit selected cell input"]';
  const flag = cell(0,4);
  await wait(win,`!document.querySelector(${JSON.stringify(editor)})`);
  await query(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  // Stable column commands must still use the latest selection, and switching
  // into formula point-picking must actually change Boolean presentation.
  await query(`document.querySelector(${JSON.stringify(cell(0,1))}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  await wait(win,`document.querySelector(${JSON.stringify(editor)})?.value==='12000000'`);
  await query(`(() => {
    const input=document.querySelector(${JSON.stringify(editor)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'= ');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await wait(win,`document.querySelector(${JSON.stringify(flag + ' .boolean-cell-capsule.is-passive')})`);
  await wait(win,`document.querySelector('.formula-source-textarea')?.value==='= '`);
  await query(`(() => {
    const input=document.querySelector('.formula-source-textarea');
    input.focus(); input.setSelectionRange(input.value.length,input.value.length);
    input.dispatchEvent(new Event('select',{bubbles:true}));
  })()`);
  const point=await query(`(() => {const r=document.querySelector(${JSON.stringify(flag)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
  await new Promise(resolve=>setTimeout(resolve,35));
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  await wait(win,`document.querySelector('.formula-source-textarea')?.value.includes('Flag')`);
  assert.equal(await query(`document.querySelector(${JSON.stringify(flag)}).textContent`),'false','Point-picking references the Boolean without toggling it');
  // First Escape clears the active reference; second cancels the draft.
  await query(`document.querySelector('.formula-source-textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await query(`document.querySelector('.formula-source-textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await wait(win,`document.querySelector(${JSON.stringify(flag + ' .boolean-cell-control')})`);
  await wait(win,`!document.querySelector(${JSON.stringify(editor)})`);
  await query(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  // The existing point-pick gesture suppresses its trailing click for 320ms.
  // A separate Boolean activation starts after that gesture window.
  await new Promise(resolve=>setTimeout(resolve,350));
  for (const value of ['true','false']) {
    const control=await query(`(() => {const r=document.querySelector(${JSON.stringify(flag + ' .boolean-cell-control')}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...control});
    await new Promise(resolve=>setTimeout(resolve,35));
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...control});
    await wait(win,`document.querySelector(${JSON.stringify(flag)}).textContent===${JSON.stringify(value)}`);
  }
  console.log('Boolean commands and formula point-picking passed after repeated cell selections.');
}
