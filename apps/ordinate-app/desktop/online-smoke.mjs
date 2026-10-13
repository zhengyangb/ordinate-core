import assert from 'node:assert/strict';
import { currentOnlineDrafts, corruptCurrentDrafts, waitForOnlineDraft } from './online-draft-test.mjs';
import {checkCellDoubleClick} from './double-click-smoke.mjs';

/** Real built static entry, no bridge, test-owned origin and profile. */
export async function checkOnline(win, {query, wait, capture}) {
  win.setSize(1200, 900);
  // Observe from before React mounts, not just after the final grid appears.
  // Catch an empty-state flash even if it lasts only a single DOM update.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {source:`(() => {
    const trace = window.__testStartup = {emptySheetRendered:false,reveal:null};
    const observer = new MutationObserver(() => {
      if (document.querySelector('.empty-state h3')?.textContent==='No sheet selected') trace.emptySheetRendered=true;
      if (document.documentElement?.dataset.startup==='ready') {
        trace.reveal={gridReady:!!document.querySelector('.view-handoff-live .table-stage[data-layout-ready="true"]'),
          screenPresent:!!document.getElementById('startup-screen'),rootLocked:document.getElementById('root').inert};
        observer.disconnect();
      }
    });
    observer.observe(document,{childList:true,subtree:true,attributes:true});
  })()`});
  const checkStartup = async label => {
    await wait(win,`window.__testStartup.reveal!==null`);
    assert.deepEqual(await query(win,`window.__testStartup`),{
      emptySheetRendered:false,reveal:{gridReady:true,screenPresent:false,rootLocked:false},
    },`${label}: reveal only a ready spreadsheet, with no transient empty sheet`);
  };
  const ready = `!document.querySelector('.online-example-dialog') && !document.querySelector('[role="dialog"]') && !document.querySelector('.view-handoff[data-handoff]') && document.querySelector('.view-handoff-live .table-stage[data-layout-ready="true"]')`;
  const menu = async (category, label) => {
    await query(win,`document.querySelector('[aria-label="Ordinate menu"]').click()`);
    await wait(win,`document.querySelector('.application-menu')`);
    await query(win,`[...document.querySelectorAll('[data-category]')].find(b=>b.textContent.startsWith(${JSON.stringify(category)})).focus()`);
    await wait(win,`[...document.querySelectorAll('[data-command]')].some(b=>b.textContent===${JSON.stringify(label)})`);
    await query(win,`[...document.querySelectorAll('[data-command]')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  };
  const confirm = async text => {
    await wait(win,`[...document.querySelectorAll('[role="dialog"] button')].some(b=>b.textContent===${JSON.stringify(text)})`);
    await query(win,`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  };
  // A hidden tab may prepare the invitation, but must keep the startup shell
  // until activation so the first visible view is already complete.
  await win.loadURL('ordinate-test://web/online.html');
  assert.equal(await query(win,`document.visibilityState`),'hidden');
  await wait(win,`document.querySelector('.online-example-dialog')`);
  assert.equal(await query(win,`document.documentElement.dataset.startup`),'loading','Prepared invitation stays behind the startup shell');
  win.show(); win.focus();
  await wait(win,`document.querySelector('.online-example:not(:disabled)')`);
  await checkStartup('Cold Online startup');
  assert.equal(await query(win,`!!document.querySelector('.online-example-dialog')`),true,'The invitation is part of the first visible view');
  assert.deepEqual(await query(win,`(() => {
    const backdrop=getComputedStyle(document.querySelector('.app-modal-backdrop'));
    const dialog=getComputedStyle(document.querySelector('.online-example-dialog'));
    return [backdrop.animationDuration,dialog.animationDuration,dialog.animationDelay];
  })()`),['0.24s','0.2s','0.04s'],'Backdrop and dialog settle together in 240ms');
  win.webContents.setBackgroundThrottling(false);
  await query(win,`document.documentElement.dataset.theme='light'`);
  assert.equal(await query(win,`document.querySelectorAll('.online-example').length`),8);
  assert.equal(await query(win,`document.querySelectorAll('.online-featured').length`),1);
  await wait(win,`document.activeElement?.textContent==='Start with an example'`);
  assert.ok(await query(win,`getComputedStyle(document.querySelector('.app-editor-host')).visibility==='visible'&&document.querySelector('.ag-cell')`),'Editor remains visible behind the dialog');
  assert.equal(await query(win,`!!document.querySelector('.online-brand')||!!document.querySelector('.online-continue')`),false);
  assert.equal(await query(win,`document.querySelector('.app-editor-host').inert`),true);
  await capture(win,'online-gallery-desktop');
  await query(win,`document.querySelector('[role="radio"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  await wait(win,`document.querySelectorAll('.online-example').length===4`);
  await query(win,`[...document.querySelectorAll('[role="radio"]')].find(b=>b.textContent==='All').click()`);
  await wait(win,`document.querySelectorAll('.online-example').length===8`);
  await query(win,`document.querySelector('[aria-label="Close examples"]').click()`);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await menu('File','Examples…');
  await wait(win,`document.querySelector('.online-example-dialog')`);
  assert.deepEqual(await query(win,`['.app-modal-backdrop','.online-example-dialog'].map(selector=>getComputedStyle(document.querySelector(selector)).animationName)`),['none','none'],'Reduced motion disables both entrance animations');
  await query(win,`document.querySelector('[aria-label="Close examples"]').click()`);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
  // The wordmark uses a quiet fill for pointer states, not a dropdown glyph or ring.
  const brand = `document.querySelector('[aria-label="Ordinate menu"]')`;
  const brandStyle = `(() => { const b=${brand},s=getComputedStyle(b),r=b.getBoundingClientRect();
    return {background:s.backgroundColor,cursor:s.cursor,border:s.borderTopColor,outline:s.outlineWidth,outlineStyle:s.outlineStyle,width:r.width,height:r.height}; })()`;
  for (const theme of ['light','dark']) {
    await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.activeElement.blur()`);
    win.webContents.sendInputEvent({type:'mouseMove',x:1100,y:500});
    await wait(win,`${brand}.getAnimations().length===0`);
    const idle = await query(win,brandStyle);
    assert.equal(idle.background,'rgba(0, 0, 0, 0)');
    assert.equal(idle.cursor,'default','The wordmark is a native-style command, not a link');
    assert.equal(await query(win,`${brand}.querySelector('svg')`),null,'Pure wordmark, no dropdown arrow');
    const point = await query(win,`(() => {const r=${brand}.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});
    await wait(win,`${brand}.matches(':hover')&&${brand}.getAnimations().length===0`);
    const hovered = await query(win,brandStyle);
    assert.equal(hovered.cursor,'default');
    assert.notEqual(hovered.background,idle.background,`${theme}: hover fills capsule`);
    assert.equal(hovered.border,'rgba(0, 0, 0, 0)',`${theme}: no hover border`);
    assert.equal(hovered.outlineStyle,'none',`${theme}: no pointer outline`);
    assert.deepEqual([hovered.width,hovered.height],[idle.width,idle.height],'Hover does not resize the wordmark');
    await capture(win,`online-brand-hover-${theme}`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await wait(win,`${brand}.getAttribute('aria-expanded')==='true'&&document.activeElement?.hasAttribute('data-category')`);
    win.webContents.sendInputEvent({type:'mouseMove',x:1100,y:500});
    await wait(win,`!${brand}.matches(':hover')&&${brand}.getAttribute('aria-expanded')==='true'&&${brand}.getAnimations().length===0`);
    assert.equal((await query(win,brandStyle)).background,hovered.background,'Open menu retains the same quiet fill');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await wait(win,`!document.querySelector('.application-menu')&&document.activeElement===${brand}`);
  }
  // Escape restores focus, but a pointer-opened menu can legitimately retain pointer
  // modality. Check that the keyboard-only focus treatment survives the production build.
  assert.match(await query(win,`[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules])
    .find(rule=>rule.selectorText==='.brand-menu-button:focus-visible')?.style.outline`),/^2px solid /);
  await query(win,`document.documentElement.dataset.theme='light';document.activeElement.blur()`);
  await query(win,`document.querySelector('[aria-label="Get Mac app"]').click()`);
  await wait(win,`document.querySelector('[role="dialog"]')?.textContent.includes('hasn’t been published')`);
  await capture(win,'online-download-placeholder'); await confirm('OK');
  await menu('File','Examples…');
  for (const width of [1094,918,390,320]) {
    win.setMinimumSize(320,400); win.setSize(width,780);
    await wait(win,`innerWidth===${width}`);
    for (const theme of ['dark','light']) {
      await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await wait(win,`document.querySelector('.online-dialog-footer .primary').getAnimations().length===0`);
      const bounds=await query(win,`(() => {
        const nodes=['.online-example-dialog','.online-gallery-content','.segmented-choice','.online-dialog-footer'];
        return nodes.map(selector=>{const node=document.querySelector(selector), r=node.getBoundingClientRect();return {selector,x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};});
      })()`);
      for (const r of bounds) {
        assert.ok(r.x>=0&&r.right<=r.width&&r.y>=0&&r.bottom<=r.height,`Dialog fits ${width}/${theme}: ${JSON.stringify(r)}`);
        assert.ok(r.scrollWidth<=r.clientWidth+1,`No overflow at ${width}/${theme}: ${JSON.stringify(r)}`);
      }
      const contrast=await query(win,`(() => {
        const style=getComputedStyle(document.querySelector('.online-dialog-footer .primary'));
        const ctx=document.createElement('canvas').getContext('2d');
        const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
          const v=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
          return .2126*v[0]+.7152*v[1]+.0722*v[2];};
        const a=lum(style.color),b=lum(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      })()`);
      assert.ok(contrast>=4.5,`Open file text is readable in ${theme}: ${contrast}`);
      await capture(win,`online-example-dialog-${width}-${theme}`);
    }
  }
  win.setSize(1200,900);
  await query(win,`document.querySelector('[aria-label="Open Getting started"]').click()`); await wait(win,ready);
  assert.equal(await query(win,`document.querySelectorAll('.sheet-tab').length`),6);
  assert.equal(await query(win,`document.querySelector('.app-title-name').textContent`),'Getting started');
  assert.ok(await query(win,`document.querySelector('.sheet-note-intro').textContent.includes('👋')`),'Welcome has a light personal touch');
  assert.ok(await query(win,`[...document.querySelectorAll('[role="gridcell"]')].some(cell=>cell.textContent==='12,960,000')`),'Live forecast is visible on the first sheet');
  assert.equal(await query(win,`document.querySelector('.sheet-tab.active .sheet-tab-alert')?.textContent??''`),'');
  await capture(win,'online-getting-started');
  await checkCellDoubleClick(win,{query,wait},[
    {name:'Getting started B2',selector:'.ag-row[row-index="0"] .ag-cell[col-id="col_1"]',input:'12000000'},
    {name:'Getting started D2',selector:'.ag-row[row-index="0"] .ag-cell[col-id="col_3"]',
      input:'= @["Annual revenue","Value"] * (1 + @["Revenue growth","Value"])'},
  ],10);
  for (const theme of ['dark','light']) {
    await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await capture(win,`online-getting-started-${theme}`);
  }
  for (const name of ['Operating Report','Sales Ledger','Loan Planner','Delivery Sessions','Review']) {
    await query(win,`[...document.querySelectorAll('.sheet-tab')].find(tab=>tab.querySelector('.sheet-tab-label')?.textContent===${JSON.stringify(name)}).click()`);
    await wait(win,`document.querySelector('.sheet-tab.active .sheet-tab-label')?.textContent===${JSON.stringify(name)}&&(${ready})`);
    assert.equal(await query(win,`document.querySelector('.sheet-tab.active .sheet-tab-alert')?.textContent??''`),'',`Getting started / ${name}: no formula or format errors`);
    if(name==='Operating Report') await checkCellDoubleClick(win,{query,wait},[
      {name:'Operating Report E12 after scroll',selector:'.ag-row[row-index="9"] .ag-cell[col-id="col_4"]',
        input:'= @["Cost of sales"."Materials",_] + @["Cost of sales"."Production labor",_] + @["Cost of sales"."Freight",_]',scroll:true},
    ],10);
    if (name==='Delivery Sessions') {
      assert.deepEqual(await query(win,`[5,7].map(col=>document.querySelector('.ag-row[row-index="0"] .ag-cell[col-id="col_'+col+'"]')?.getBoundingClientRect().width)`),
        [80,80],'Hours and Fee use compact numeric widths without inheriting timestamp widths');
      const capsule = `document.querySelector('.boolean-cell-capsule.is-interactive')`;
      for (const value of ['false','true']) {
        await wait(win,`${capsule}.querySelector('.boolean-cell-capsule-label').textContent===${JSON.stringify(value)}`);
        const spacing = await query(win,`(() => {
          const b=${capsule},r=b.getBoundingClientRect(),control=b.querySelector('.boolean-cell-control').getBoundingClientRect();
          const text=document.createRange();text.selectNodeContents(b.querySelector('.boolean-cell-capsule-label'));
          return {left:control.left-r.left,right:r.right-text.getBoundingClientRect().right};
        })()`);
        assert.ok(spacing.left>=3&&spacing.right>=6,`${value}: circle and text have breathing room: ${JSON.stringify(spacing)}`);
        await capture(win,`online-boolean-spacing-${value}`);
        await query(win,`${capsule}.querySelector('.boolean-cell-control').click()`);
      }
      await wait(win,`${capsule}.querySelector('.boolean-cell-capsule-label').textContent==='false'`);
    }
    await capture(win,'online-guide-'+name.toLowerCase().replaceAll(' ','-'));
  }
  await menu('File','Examples…');
  await query(win,`document.querySelector('[aria-label="Open Mortgage"]').click()`); await wait(win,ready);
  assert.equal(await query(win,`document.querySelector('.app-title-name').textContent`),'Mortgage');
  assert.equal(await query(win,`document.querySelectorAll('.sheet-tab').length`),5);
  await capture(win,'online-mortgage-editor');
  await query(win,`document.querySelector('[aria-label="Ordinate menu"]').click()`);
  await wait(win,`document.activeElement?.hasAttribute('data-category')`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
  await wait(win,`document.activeElement?.hasAttribute('data-command')`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Left'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Left'});
  await wait(win,`document.activeElement?.hasAttribute('data-category')`);
  await capture(win,'online-application-menu');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await wait(win,`!document.querySelector('.application-menu') && document.activeElement?.getAttribute('aria-label')==='Ordinate menu'`);
  await menu('File','Examples…');
  await wait(win,`document.querySelector('.online-example-dialog')`);
  await query(win,`document.querySelector('[aria-label="Open Company report"]').click()`);
  await wait(win,`${ready} && document.querySelector('.app-title-name')?.textContent==='Company report'`);
  assert.equal(await query(win,`!!document.querySelector('[role="dialog"]')`),false,'Untouched examples switch without replacement confirmation');
  await query(win,`document.querySelector('.source-button').click()`);
  await wait(win,`document.querySelector('.source-shell textarea')`);
  await query(win,`(() => { const input=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,input.value+'\\n\\nEdited example.');
    input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('.source-button').click(); })()`);
  await wait(win,ready);
  await menu('File','Examples…');
  await query(win,`document.querySelector('[aria-label="Open DCF valuation"]').click()`);
  await confirm('Keep editing'); await wait(win,ready);
  assert.equal(await query(win,`document.querySelector('.app-title-name').textContent`),'Company report','Cancel protects edited examples');
  await menu('File','Examples…');
  await query(win,`document.querySelector('[aria-label="Open DCF valuation"]').click()`);
  await confirm('Replace document'); await wait(win,ready);
  assert.equal(await query(win,`document.querySelector('.app-title-name').textContent`),'DCF valuation');
  for (const label of ['Project investment','Personal budget','Subscription business','Inventory replenishment','Time and invoices']) {
    await menu('File','Examples…');
    await query(win,`document.querySelector('[aria-label=${JSON.stringify('Open '+label)}]').click()`);
    await wait(win,ready);
    assert.equal(await query(win,`document.querySelector('.app-title-name').textContent`),label);
    assert.equal(await query(win,`!!document.querySelector('.error[role="alert"]')`),false,label);
  }
  await query(win,`document.querySelector('.source-button').click()`);
  await wait(win,`document.querySelector('.source-shell textarea')`);
  await query(win,`(() => { const input=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify('# Saved online work\n| 12345 |')});
    input.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('.source-button').click(); })()`);
  await wait(win,ready);
  await menu('File','Examples…'); // Commits pending editing before navigating.
  await waitForOnlineDraft(win,query,'12345');
  await win.loadURL('ordinate-test://web/online.html'); await wait(win,ready);
  await checkStartup('Online draft reload');
  await query(win,`new Promise(resolve=>setTimeout(resolve,1700))`);
  assert.equal(await query(win,`!!document.querySelector('.online-example-dialog')`),false,'Existing draft resumes without onboarding');
  assert.equal(await query(win,`document.querySelector('.sheet-tab.active .sheet-tab-label').textContent`),'Saved online work','Reload restores online draft');
  const saved = await query(win,currentOnlineDrafts);
  await win.loadURL('ordinate-test://web/'); await wait(win,`document.documentElement.dataset.startup==='ready'`);
  assert.equal(await query(win,`!!document.querySelector('.online-gallery')`),false);
  assert.equal(await query(win,`document.querySelector('.app-title-name').textContent`),'Untitled');
  assert.ok(await query(win,`!!document.querySelector('[aria-label="Ordinate menu"]')`));
  assert.deepEqual(await query(win,currentOnlineDrafts),saved,'Ordinary editor leaves online draft untouched');
  await query(win,`sessionStorage.removeItem('ordinate:online:session')`);
  const beginWorkScript=await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
    const observer=new MutationObserver(() => {
      if (document.documentElement?.dataset.startup==='ready') {
        document.querySelector('.online-editor-host').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
        observer.disconnect();
      }
    });
    observer.observe(document,{attributes:true,childList:true,subtree:true});
  })()`});
  await win.loadURL('ordinate-test://web/online.html'); await wait(win,ready);
  await win.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:beginWorkScript.identifier});
  await query(win,`new Promise(resolve=>setTimeout(resolve,700))`);
  assert.equal(await query(win,`!!document.querySelector('.online-example-dialog')`),false,'Starting work cancels the invitation');
  await menu('File','Examples…');
  await wait(win,`document.querySelector('.online-example-dialog')`);
  await query(win,`document.querySelector('[aria-label="Close examples"]').click()`);
  await win.loadURL('ordinate-test://web/online.html?example=mortgage');
  // The initial default grid can be ready before the linked asset finishes
  // loading. Await the requested document, not that intermediate first paint.
  await wait(win,`${ready} && document.querySelector('.app-title-name')?.textContent==='Mortgage'`);
  assert.equal(await query(win,`document.querySelector('.app-title-name').textContent`),'Mortgage','Known example deep link opens directly');
  assert.equal(await query(win,`new URL(location.href).searchParams.has('example')`),false);
  await win.loadURL('ordinate-test://web/online.html?example=project-investment');
  await wait(win,`${ready} && document.querySelector('.app-title-name')?.textContent==='Project investment'`);
  assert.equal(await query(win,`!!document.querySelector('[role="dialog"]')`),false,'Untouched deep-linked examples switch without confirmation');
  win.setSize(390,780); await wait(win,`innerWidth===390`);
  await query(win,`document.documentElement.dataset.theme='dark'`);
  await query(win,`document.querySelector('[aria-label="Ordinate menu"]').click()`); await wait(win,`document.querySelector('.application-menu')`);
  const bounds = await query(win,`(() => {const r=document.querySelector('.application-menu').getBoundingClientRect(); return [r.left,r.right,innerWidth]})()`);
  assert.ok(bounds[0]>=0&&bounds[1]<=bounds[2],'Menu fits narrow screen');
  await capture(win,'online-menu-mobile-dark');
  await query(win,`document.querySelector('[aria-label="Ordinate menu"]').click()`);
  await win.loadURL('ordinate-test://web/online.html?example=unknown');
  await wait(win,`document.querySelector('[role="dialog"]')?.textContent.includes('Unknown example')`);
  assert.equal(await query(win,`!!document.querySelector('.online-example-dialog')`),false);
  await query(win,corruptCurrentDrafts);
  await win.loadURL('ordinate-test://web/online.html');
  await wait(win,`document.querySelector('[role="dialog"]')?.textContent.includes('Could not open document')`);
  assert.equal(await query(win,`!!document.getElementById('startup-screen')`),false,'Failed recovery reveals its error, not an indefinite loading screen');
  await new Promise(resolve=>setTimeout(resolve,900));
  assert.ok((await query(win,currentOnlineDrafts)).every(record=>record.text===null),'Failed recovery must not overwrite a saved draft with an empty document');
  win.webContents.debugger.detach();
  console.log('Online passed: prepared first view without delayed invitation, reduced motion, command cursor + wordmark hover, guided workbook + 8 models, modal layout at 1094/918/390/320px, light/dark, keyboard navigation, cancel/replace, draft restoration, isolation and deep links.');
}

export async function checkStaticOnline(win, base, {query, wait, capture}) {
  win.setSize(1200,900); win.show(); win.focus();
  await wait(win,`document.querySelectorAll('.online-example:not(:disabled)').length===8`);
  assert.equal(await query(win,`document.title`),'Ordinate');
  assert.equal(await query(win,`document.documentElement.dataset.experience`),'online');
  await query(win,`document.querySelector('[aria-label="Close examples"]').click()`);
  await win.loadURL(`ordinate-test://web${base}?example=mortgage`);
  await wait(win,`!document.querySelector('.online-example-dialog')&&document.querySelector('.app-title-name')?.textContent==='Mortgage'&&document.querySelector('.table-stage[data-layout-ready="true"]')`);
  assert.equal(await query(win,`document.querySelectorAll('.sheet-tab').length`),5);
  await capture(win,'online-static-build');
  console.log(`Standalone static build passed at ${base}: online homepage, catalog, assets, example deep link and editor.`);
}
