import assert from 'node:assert/strict';

/** Responsive checks on test-owned native/web windows and synthetic input. */
export async function checkFormulaAssistant(win, {query, wait, capture}) {
  win.setMinimumSize(320, 400);
  win.show(); win.focus();
  const click = async selector => {
    await wait(win, `document.querySelector(${JSON.stringify(selector)})`);
    await query(win, `document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const setText = async (selector, text) => query(win, `(() => {
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const key = async key => query(win, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`);
  const editor = 'textarea[aria-label="Edit selected cell input"]';
  const popover = '.formula-assistant-popover';
  const host = await query(win, `window.ordinateDesktop ? 'native' : 'web'`);
  await click('.source-button');
  await wait(win, `document.querySelector('.source-shell textarea')`);
  await setText('.source-shell textarea', '# Assistant\n| Item || Value |\n| --- || --- |\n| Sample || 2 |');
  await click('.source-button');
  await wait(win, `document.querySelector('.ag-center-cols-container .ag-cell')`);
  await query(win, `document.querySelector('.ag-center-cols-container .ag-cell').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
  await wait(win, `document.querySelector('[aria-label="Function assistant"]')`);
  await click('[aria-label="Function assistant"]');
  await wait(win, `document.querySelector('${popover}[data-mode="list"]')`);

  const checkBounds = async (width, mode) => {
    await wait(win, `document.querySelector('${popover}[data-mode="${mode}"]')`);
    // ResizeObserver starts backdrop motion after layout; let it run before
    // checking settled geometry or taking screenshots of a changed mode.
    await query(win, `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await wait(win, `document.getAnimations().every(a=>a.playState==='finished')`);
    const bounds = await query(win, `(() => {
      const panel=document.querySelector('${popover}'),shell=document.querySelector('.formula-bar-shell'),owner=shell.parentElement;
      const r=panel.getBoundingClientRect(),s=shell.getBoundingClientRect(),o=owner.getBoundingClientRect();
      return {panel:r.toJSON(),shell:s.toJSON(),owner:o.toJSON(),viewport:{width:innerWidth,height:innerHeight},scroll:owner.scrollLeft,
        surface:panel.querySelector('.editor-popover-surface').getBoundingClientRect().toJSON(),
        horizontalOverflow:panel.scrollWidth-panel.clientWidth};
    })()`);
    assert.ok(bounds.panel.left>=bounds.owner.left && bounds.panel.right<=bounds.owner.right,
      `${host} ${width}px ${mode} stays in the app: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.panel.top>=0 && bounds.panel.bottom<=bounds.viewport.height, 'Assistant fits vertically');
    assert.equal(bounds.scroll, 0, 'Focusing suggestions must not scroll the app chrome horizontally');
    assert.ok(bounds.horizontalOverflow<=1, 'Assistant content has no horizontal overflow');
    assert.ok(Math.abs(bounds.surface.top-bounds.panel.top)<=1 && Math.abs(bounds.surface.bottom-bounds.panel.bottom)<=1,
      'The settled backdrop covers all help content');
    return bounds;
  };

  for (const width of [320, 420, 640, 654, 800, 1060, 1440]) {
    win.setSize(width, 780);
    await wait(win, `innerWidth===${width}`);
    await checkBounds(width, 'list');
    const rows = await query(win, `(() => {
      const panel=document.querySelector('${popover}'),list=document.querySelector('.formula-assistant-list');
      const first=list.querySelector('.formula-assistant-option'),name=first.querySelector('.formula-assistant-option-main').getBoundingClientRect(),summary=first.querySelector('.formula-assistant-option-summary').getBoundingClientRect();
      return {narrow:panel.clientWidth<=480,summaryBelow:summary.top>=name.bottom+1,
        rowContainsSummary:summary.bottom<=first.getBoundingClientRect().bottom,scrolls:list.scrollHeight>list.clientHeight};
    })()`);
    assert.ok(rows.scrolls, 'Long function lists scroll inside their own region');
    assert.ok(rows.rowContainsSummary, 'Option text stays inside its row');
    if(rows.narrow) assert.ok(rows.summaryBelow, 'Narrow suggestions put descriptions below names without overlap');
    await key('ArrowDown');
    await wait(win, `document.querySelectorAll('.formula-assistant-option')[1].getAttribute('aria-selected')==='true'`);
    await key('ArrowUp');
    await wait(win, `document.querySelector('.formula-assistant-option').getAttribute('aria-selected')==='true'`);
    if(width===654) await capture(win, `${host}-formula-assistant-narrow`);
  }

  await key('Escape');
  await wait(win, `!document.querySelector('${popover}')`);
  for (const width of [320, 654, 1440]) {
    win.setSize(width, 650);
    await wait(win, `innerWidth===${width}`);
    await setText(editor, '= normalC');
    await checkBounds(width, 'compact');
    await setText(editor, '= normalCdf(');
    await checkBounds(width, 'signature');
    await click('[aria-label="Expand function help"]');
    await checkBounds(width, 'signature-expanded');
    assert.ok(await query(win, `(() => {const e=document.querySelector('.formula-assistant-signature-grid');return e.scrollWidth<=e.clientWidth+1;})()`), 'Expanded help reflows without overflowing');
    if(width===654) await capture(win, `${host}-formula-assistant-expanded`);
    await click('[aria-label="Collapse function help"]');
  }
  // Actual editing and insertion remain intact after responsive reflow.
  await setText(editor, '= ex');
  await checkBounds(1440, 'compact');
  await key('Tab');
  await wait(win, `document.querySelector('${editor}').value.includes('exp(')`);
  await setText(editor, '= exp(0)');
  await click('[aria-label="Apply cell input"]');
  await wait(win, `document.querySelector('.ag-center-cols-container .ag-cell').textContent==='1'`);
  console.log(`${host}: formula assistant passed at 320/420/640/654/800/1060/1440px; list, compact and expanded help, keyboard insertion and calculation.`);
}
