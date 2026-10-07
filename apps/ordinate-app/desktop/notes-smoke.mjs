import assert from 'node:assert/strict';

// Synthetic notes only; shared test-owned web/native hosts, never a user's workbook.
export async function checkNotes(win, {query,wait,capture}) {
  // Exercise the responsive web surface even when the native shell has a larger minimum.
  win.setMinimumSize(360,400);
  win.setSize(1060, 920);
  win.show(); win.focus();
  const host = await query(win, `window.ordinateDesktop ? 'native' : 'web'`);
  const setValue = async (selector, value) => query(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,${JSON.stringify(value)});
    element.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const click = async selector => {await wait(win,`document.querySelector(${JSON.stringify(selector)})`);await query(win,`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const edit = async selector => {
    await query(win,`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
  };
  const key = async (key, modifiers={}) => query(win, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(modifiers)}}))`);
  const quietExit = async slot => {
    await wait(win,`document.activeElement===document.querySelector('${slot} .sheet-note-slot')`);
    assert.ok(await query(win,`(() => {const slot=document.activeElement;return getComputedStyle(slot).outlineStyle==='none'&&!slot.querySelector(':focus-visible');})()`),'Saving returns to a quiet slot, not the note or Add note action');
  };
  const load = async text => {
    await click('.source-button'); await wait(win,`document.querySelector('.source-shell textarea')`);
    await setValue('.source-shell textarea', text); await click('.source-button');
    await wait(win,`document.querySelector('.table-stage[data-layout-ready="true"]')`);
  };
  await load('# Quarterly report\n| Item || Value |\n| ---- || ----- |\n| Sales || 42 |\n| Cost || 12 |\n| Total || = B2 - B3 |\n\n# Other\n| 9 |');
  // Pin CSS interaction state in these timing checks so movement of the user's
  // real pointer over the test window cannot cancel a simulated dwell.
  win.webContents.debugger.attach('1.3');
  const {root:domRoot}=await win.webContents.debugger.sendCommand('DOM.getDocument');
  let stateNode=null;
  const setInteraction = async (selector, pseudoClasses) => {
    if(stateNode!==null) await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId:stateNode,forcedPseudoClasses:[]});
    const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:domRoot.nodeId,selector});
    assert.ok(nodeId,`Interaction target exists: ${selector}`);
    stateNode=nodeId;
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:pseudoClasses});
  };
  await win.webContents.debugger.sendCommand('DOM.enable');
  await win.webContents.debugger.sendCommand('CSS.enable');
  await setInteraction('.sheet-note-footer .sheet-note-add',['hover']);
  await wait(win,`document.querySelector('.sheet-note-footer .sheet-note-add:hover')`);
  await wait(win,`getComputedStyle(document.querySelector('.sheet-note-footer .sheet-note-leaf')).opacity==='1'`);
  const lowerHits = await query(win,`(() => {
    const leaf=document.querySelector('.sheet-note-footer .sheet-note-leaf'),r=leaf.getBoundingClientRect();
    const pinned=document.querySelector('.ag-pinned-left-cols-container').getBoundingClientRect();
    const x=Math.min(r.right-24,pinned.right-2),y=r.top+8;
    return {belowPinned:r.top>=pinned.bottom-1,uncovered:leaf.contains(document.elementFromPoint(x,y))};
  })()`);
  assert.ok(lowerHits.belowPinned,'The lower entrance grows below the table instead of covering its last row');
  assert.ok(lowerHits.uncovered,'The lower entrance is visible and clickable below the frozen header column');
  await capture(win,`${host}-sheet-note-footer-affordance`);
  const edge = await query(win, `(() => { const b=document.querySelector('[aria-label="Add note before table"]').getBoundingClientRect(); const g=document.querySelector('.grid-shell').getBoundingClientRect(); return {y:b.top+b.height/2, grid:g.top,x:b.left+b.width/2}; })()`);
  assert.ok(Math.abs(edge.y-edge.grid)<1,`Upper affordance sits on the actual table boundary: ${JSON.stringify(edge)}`);
  await setInteraction('.sheet-note-intro .sheet-note-add',['hover']);
  await wait(win,`document.querySelector('.sheet-note-intro .sheet-note-add:hover')`);
  await query(win,`new Promise(resolve=>setTimeout(resolve,150))`);
  assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note-intro .sheet-note-leaf')).opacity`),'0','Passing over the upper boundary does not immediately reveal the leaf');
  await setInteraction('.sheet-note-footer .sheet-note-add',['hover']);
  await wait(win,`!document.querySelector('.sheet-note-intro .sheet-note-add:hover')`);
  await query(win,`new Promise(resolve=>setTimeout(resolve,450))`);
  assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note-intro .sheet-note-leaf')).opacity`),'0','Leaving the boundary cancels the pending reveal');
  await setInteraction('.sheet-note-intro .sheet-note-add',['hover']);
  await wait(win,`document.querySelector('.sheet-note-intro .sheet-note-add:hover')`);
  await wait(win,`getComputedStyle(document.querySelector('.sheet-note-leaf')).opacity==='1'`);
  assert.ok(await query(win,`(() => {const leaf=document.querySelector('.sheet-note-leaf'),r=leaf.getBoundingClientRect();return leaf.contains(document.elementFromPoint(r.left+r.width/2,r.top+2));})()`),'The expanded leaf is not covered by the column rail');
  await capture(win,`${host}-sheet-note-add-affordance`);
  assert.ok(await query(win,`!!document.querySelector('.sheet-note-leaf-shape path')`),'The boundary entrance uses a tapered curve, not a rounded rectangle');
  const entrance=await query(win,`(() => {
    const leaf=document.querySelector('.sheet-note-intro .sheet-note-leaf');
    return {width:leaf.offsetWidth,height:leaf.offsetHeight,text:leaf.textContent.trim(),
      ink:getComputedStyle(leaf.querySelector('.sheet-note-leaf-label')).color,
      fill:getComputedStyle(leaf.querySelector('path')).fill};
  })()`);
  assert.ok(entrance.width===186&&entrance.height===23,'The single-sided entrance matches the selected lab dimensions');
  assert.equal(entrance.text,'+ Add note before table');
  assert.equal(entrance.ink,'rgb(255, 255, 255)');
  assert.equal(entrance.fill,'rgb(137, 104, 26)','Gold fill is solid rather than a tinted paper surface');
  assert.equal(await query(win,`document.querySelector('.sheet-note-footer .sheet-note-leaf-label').textContent`),'+ Add note after table');
  await query(win,`document.documentElement.dataset.theme='dark'`);
  await capture(win,`${host}-sheet-note-add-affordance-dark`);
  await query(win,`document.documentElement.dataset.theme='light'`);
  await setInteraction('.sheet-note-intro .sheet-note-add',[]);
  await wait(win,`getComputedStyle(document.querySelector('.sheet-note-intro .sheet-note-leaf')).opacity==='0'`);
  await setInteraction('.sheet-note-intro .sheet-note-add',['focus-visible']);
  assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note-intro .sheet-note-leaf')).opacity`),'1','Keyboard focus reveals the upper affordance immediately');
  for (const slot of ['.sheet-note-intro','.sheet-note-footer']) {
    await setInteraction(slot+' .sheet-note-add',['hover']);
    await wait(win,`getComputedStyle(document.querySelector('${slot} .sheet-note-leaf')).opacity==='1'`);
    assert.ok(await query(win,`(() => {
      const b=document.querySelector('${slot} .sheet-note-add').getBoundingClientRect();
      const leaf=document.querySelector('${slot} .sheet-note-leaf'),r=leaf.getBoundingClientRect(),s=getComputedStyle(leaf);
      const upper='${slot}'==='.sheet-note-intro';
      return Math.abs((upper?r.bottom:r.top)-(b.top+b.height/2))<1&&
        Math.abs(parseFloat(s.transformOrigin.split(' ')[1])-(upper?23:0))<1;
    })()`),'The single-sided lip keeps its scaling origin on the boundary and grows outward');
    for (const fraction of [0,.4,.6,1]) {
      const tracking=await query(win,`(() => {
        const button=document.querySelector('${slot} .sheet-note-add'),leaf=button.querySelector('.sheet-note-leaf');
        const b=button.getBoundingClientRect(),x=b.left+b.width*${fraction};
        button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:x,clientY:b.top+b.height/2}));
        const r=leaf.getBoundingClientRect();
        return {center:r.left+r.width/2,expected:Math.max(b.left+r.width/2,Math.min(b.right-r.width/2,x)),inside:r.left>=b.left-1&&r.right<=b.right+1};
      })()`);
      assert.ok(tracking.inside&&Math.abs(tracking.center-tracking.expected)<1,'Both entrances follow the pointer and clamp at the edges');
    }
    await capture(win,`${host}-${slot.slice(1)}-pointer-right`);
    await query(win,`document.querySelector('${slot} .sheet-note-add').style.width='80%'`);
    await wait(win,`(() => {const b=document.querySelector('${slot} .sheet-note-add').getBoundingClientRect(),r=document.querySelector('${slot} .sheet-note-leaf').getBoundingClientRect();return r.right<=b.right+1;})()`);
    await query(win,`document.querySelector('${slot} .sheet-note-add').style.removeProperty('width')`);
    await setInteraction(slot+' .sheet-note-add',['focus-visible']);
    assert.ok(await query(win,`(() => {const b=document.querySelector('${slot} .sheet-note-add').getBoundingClientRect(),r=document.querySelector('${slot} .sheet-note-leaf').getBoundingClientRect();return Math.abs(r.left+r.width/2-b.left-b.width/2)<1;})()`),'Keyboard focus centers an entrance after pointer tracking');
    await setInteraction(slot+' .sheet-note-add',[]);
    assert.ok(await query(win,`(() => {
      const button=document.querySelector('${slot} .sheet-note-add'),b=button.getBoundingClientRect();
      button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',clientX:b.right}));
      return parseFloat(button.style.getPropertyValue('--note-pointer-offset'))===0;
    })()`),'Touch recenters an entrance previously positioned with a mouse');
  }
  await setInteraction('.sheet-note-intro .sheet-note-add',[]);
  win.webContents.debugger.detach();
  const emptyTableTop=await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top`);
  for (const position of ['before','after']) {
    const slot = position==='before' ? '.sheet-note-intro' : '.sheet-note-footer';
    for (const exit of ['empty','delete']) {
      await click(`[aria-label="Add note ${position} table"]`);
      await wait(win,`document.activeElement?.className==='sheet-note-input'`);
      assert.ok(await query(win,`(() => {
        const slot=document.querySelector('${slot}'),body=slot.querySelector('.sheet-note-content');
        return slot.offsetHeight>0&&Math.abs(body.offsetHeight-parseFloat(getComputedStyle(body).lineHeight))<1;
      })()`),'An empty draft reserves one body line before typing');
      if(position==='before') assert.ok(await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top > ${emptyTableTop+30}`),'Adding an upper note immediately makes room above the table');
      if(exit==='empty') await key('Escape');
      else {
        await setValue('.sheet-note-input','Uncommitted draft');
        await setValue('.sheet-note-input','');
        assert.ok(await query(win,`!!document.querySelector('.sheet-note-input')`),'Clearing text does not interrupt editing');
        await key('Escape');
      }
      await wait(win,`!document.querySelector('.sheet-note-editor')`);
      await quietExit(slot);
      assert.equal(await query(win,`document.querySelector('${slot}').offsetHeight`),0,'Empty exit or draft deletion releases reserved space');
      assert.equal(await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top`),emptyTableTop);
    }
  }
  await click('[aria-label="Add note before table"]');
  await wait(win, `document.activeElement?.className === 'sheet-note-input'`);
  const tableTop=await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top`);
  assert.equal(await query(win, `document.querySelector('.sheet-note-title').textContent`), 'Quarterly report');
  assert.equal(await query(win, `document.querySelector('.sheet-note-title').isContentEditable`), false);
  assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note-editor-surface')).animationName`),'note-editor-unfold','Creation unfolds from the table boundary');
  assert.ok(await query(win,`(() => {
    const surface=document.querySelector('.sheet-note-editor-surface');
    const animation=surface.getAnimations().find(a=>a.animationName==='note-editor-unfold');
    return new DOMMatrix(animation.effect.getKeyframes()[0].transform).m22<=.03&&getComputedStyle(surface).transformOrigin.endsWith(' 0px');
  })()`),'Creation starts from a thin horizontal slit at the top edge');
  await wait(win,`document.querySelector('.sheet-note-editor').getAnimations({subtree:true}).every(a=>a.playState==='finished')`);
  await setValue('.sheet-note-input','One line');
  const compactEditor = await query(win,`(() => {
    const input=document.querySelector('.sheet-note-input'),surface=document.querySelector('.sheet-note-editor-surface');
    const r=input.getBoundingClientRect();
    return {inputHeight:r.height,lineHeight:parseFloat(getComputedStyle(input).lineHeight),height:surface.offsetHeight,
      radius:getComputedStyle(surface).borderRadius,border:getComputedStyle(surface).borderTopWidth,ripple:getComputedStyle(surface,'::after').content};
  })()`);
  assert.ok(compactEditor.inputHeight<=compactEditor.lineHeight+2,'A single line does not reserve a tall blank editor');
  assert.equal(compactEditor.radius,'0px');assert.equal(compactEditor.border,'0px');assert.equal(compactEditor.ripple,'none');
  assert.ok(await query(win,`(() => {const s=getComputedStyle(document.querySelector('.sheet-note-editor-surface'));return s.paddingLeft==='10px'&&s.paddingTop==='10px';})()`),'Editor uses the selected paper inset');
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-editor button').length`),1,'Done is the only editor action');
  assert.ok(await query(win,`(() => {const b=document.querySelector('.sheet-note-done'),r=b.getBoundingClientRect(),i=document.querySelector('.sheet-note-input').getBoundingClientRect();return b.matches('.app-modal-action.primary')&&getComputedStyle(b).borderRadius==='999px'&&r.bottom<=i.top&&Math.abs(r.right-i.right)<1;})()`),'Done reuses the modal capsule and sits at the top right');
  await capture(win,`${host}-sheet-note-editor-compact`);
  // Chrome can be dark, but the editor is still light paper. Exercise the
  // shared capsule's surface variant, including hover and keyboard focus.
  for (const theme of ['dark','light']) {
    await query(win,`document.documentElement.dataset.theme='${theme}'`);
    for (const state of ['normal','hover','focus']) {
      const point=await query(win,`(() => {const r=document.querySelector('.sheet-note-done').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
      win.webContents.sendInputEvent({type:'mouseMove',...(state==='hover'?point:{x:1,y:1})});
      await query(win,`document.querySelector('${state==='focus'?'.sheet-note-done':'.sheet-note-input'}').focus()`);
      const colors=await query(win,`(() => {
        const button=document.querySelector('.sheet-note-done'),style=getComputedStyle(button);
        const context=document.createElement('canvas').getContext('2d');
        const luminance=color=>{
          context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);
          const channels=[...context.getImageData(0,0,1,1).data].slice(0,3).map(v=>{
            const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;
          });
          return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
        };
        return {background:luminance(style.backgroundColor),ink:luminance(style.color),surface:button.dataset.surface};
      })()`);
      assert.equal(colors.surface,'sheet');
      assert.ok(colors.background>.7&&colors.ink<.25,`Done uses light paper colors in ${theme}/${state}: ${JSON.stringify(colors)}`);
      assert.ok((colors.background+.05)/(colors.ink+.05)>=3,'Done retains legible contrast against the light fill');
    }
    await query(win,`document.querySelector('.sheet-note-input').focus()`);
    await capture(win,`${host}-sheet-note-editor-${theme}`);
  }
  await click('.grid-shell');
  await wait(win,`!document.querySelector('.sheet-note-editor')`);
  assert.equal(await query(win,`document.querySelector('.sheet-note-content').textContent`),'One line','Clicking outside saves the draft');
  assert.equal(await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top`),tableTop,'Saving one line keeps the initially reserved footprint');
  // Real hit testing catches uncovered title/padding/blank areas, unlike a
  // dispatched dblclick on the existing text child alone.
  for (const area of ['title','title-blank','body-blank','padding']) {
    const point=await query(win,`(() => {const note=document.querySelector('.sheet-note-intro .sheet-note'),r=note.getBoundingClientRect(),title=note.querySelector('h2').getBoundingClientRect(),body=note.querySelector('.sheet-note-content').getBoundingClientRect();const area=${JSON.stringify(area)};return {x:Math.round(area==='title'?title.left+12:r.right-5),y:Math.round(area==='padding'?r.top+3:area==='body-blank'?body.top+body.height/2:title.top+title.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});
    for(const clickCount of [1,2]){
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount,...point});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount,...point});
    }
    await wait(win,`document.activeElement?.className==='sheet-note-input'`);
    assert.equal(await query(win,`document.querySelector('.sheet-note-editor .sheet-note-title').isContentEditable`),false,'The grouped title is still read-only');
    await key('Enter',{ctrlKey:true});await quietExit('.sheet-note-intro');
  }
  // Genuine Tab navigation reaches the entire group. Pin the visual pseudo-state
  // as above, independently of Chromium's modality heuristic in the test host.
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await wait(win,`document.activeElement===document.querySelector('.sheet-note-intro .sheet-note')`);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('DOM.enable');
  await win.webContents.debugger.sendCommand('CSS.enable');
  const {root:focusRoot}=await win.webContents.debugger.sendCommand('DOM.getDocument');
  const {nodeId:noteFocusId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:focusRoot.nodeId,selector:'.sheet-note-intro .sheet-note'});
  await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId:noteFocusId,forcedPseudoClasses:['focus-visible']});
  const noteFocus=await query(win,`({visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineStyle,title:!!document.activeElement.querySelector('.sheet-note-title')})`);
  assert.ok(noteFocus.visible&&noteFocus.outline==='solid'&&noteFocus.title,`Keyboard focus outlines the whole note group: ${JSON.stringify(noteFocus)}`);
  await win.webContents.debugger.sendCommand('CSS.forcePseudoState',{nodeId:noteFocusId,forcedPseudoClasses:[]});
  win.webContents.debugger.detach();
  await key('F2');await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await click('.sheet-note-done');await quietExit('.sheet-note-intro');
  await edit('.sheet-note-intro .sheet-note-title');await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','');await click('.sheet-note-done');await quietExit('.sheet-note-intro');
  assert.equal(await query(win,`document.activeElement.querySelector('.sheet-note-add')?.matches(':focus-visible')`),false,'Deleting a saved note never focuses Add note');
  await click('[aria-label^="Undo Delete sheet note"]');await wait(win,`document.querySelector('.sheet-note-content')?.textContent==='One line'`);
  await edit('.sheet-note-intro .sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  assert.equal(await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top`),tableTop,'Editing an existing note keeps its saved footprint');
  for(const text of ['Line one\nLine two\nLine three', 'Wrapping text '.repeat(35)]) {
    await setValue('.sheet-note-input',text);
    await wait(win,`document.querySelector('.sheet-note-input').offsetHeight > ${compactEditor.inputHeight+10}`);
    assert.equal(await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top`),tableTop,'Manual and automatic wrapping grow only the overlay');
    await setValue('.sheet-note-input','One line');
    await wait(win,`document.querySelector('.sheet-note-editor-surface').offsetHeight === ${compactEditor.height}`);
  }
  await setValue('.sheet-note-input','**Quarterly results**\n\nRevenue is stated in *millions*.\n\n- Unaudited figures\n- Constant currency');
  assert.equal(await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().top`),tableTop,'Draft growth never expands the reserved footprint');
  await key('Enter');
  assert.ok(await query(win, `!!document.querySelector('.sheet-note-input')`), 'Plain Enter keeps editing');
  assert.ok(await query(win, `document.querySelector('.sheet-note-input').value.endsWith('\\n- ')`), 'Enter continues a bullet list');
  await key('Enter');
  assert.ok(await query(win, `document.querySelector('.sheet-note-input').value.endsWith('\\n\\n')`), 'Enter exits an empty list item');
  await key('Escape');
  await wait(win, `!document.querySelector('.sheet-note-input')`);
  assert.equal(await query(win, `document.querySelector('.sheet-note-content strong').textContent`),'Quarterly results');
  assert.equal(await query(win, `document.querySelectorAll('.sheet-note-content li').length`),2);
  await click('[aria-label^="Undo Edit sheet note"]');
  await wait(win, `document.querySelector('.sheet-note-content')?.textContent==='One line'`);
  await click('[aria-label^="Undo Edit sheet note"]');
  await wait(win, `!document.querySelector('.sheet-note-title')`);
  await click('[aria-label^="Redo Edit sheet note"]');
  await wait(win, `document.querySelector('.sheet-note-title')`);
  await click('[aria-label^="Redo Edit sheet note"]');
  await wait(win, `document.querySelector('.sheet-note-content strong')`);
  for (const modifiers of [{ctrlKey:true},{metaKey:true}]) {
    await edit('.sheet-note-intro .sheet-note-content'); await wait(win,`document.activeElement?.className==='sheet-note-input'`);
    assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note-editor-surface')).animationName`),'note-editor-enter','Reopening does not replay the creation unfold');
    await key('Enter',{...modifiers,isComposing:true});
    assert.ok(await query(win,`!!document.querySelector('.sheet-note-input')`),'IME confirmation does not save');
    await key('Enter',modifiers); await wait(win,`!document.querySelector('.sheet-note-input')`);
    await quietExit('.sheet-note-intro');
  }
  await click('[aria-label="Add note after table"]');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note-editor-surface')).animationName`),'none','Reduced motion disables creation animation');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
  win.webContents.debugger.detach();
  await wait(win,`document.querySelector('.sheet-note-editor').getAnimations({subtree:true}).every(a=>a.playState==='finished')`);
  assert.ok(await query(win,`(() => {const b=document.querySelector('.sheet-note-done').getBoundingClientRect(),i=document.querySelector('.sheet-note-input').getBoundingClientRect();return b.bottom<=i.top&&Math.abs(b.right-i.right)<1;})()`),'Footer Done stays at the top right');
  await setValue('.sheet-note-input','<script>bad</script>'); await click('.sheet-note-done');
  await wait(win,`!document.querySelector('.sheet-note-input')`);
  assert.equal(await query(win,`document.querySelector('.sheet-note-footer .sheet-note-content').textContent`),'<script>bad</script>','Unsupported HTML saves as ordinary text');
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-footer script').length`),0,'Literal HTML never becomes executable DOM');
  await edit('.sheet-note-footer .sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','bad\u0000'); await click('.sheet-note-done');
  await wait(win,`document.querySelector('.sheet-note-error[role="alert"]')`);
  assert.ok(await query(win,`!!document.querySelector('.sheet-note-input')`),'Invalid data stays editable, unlike unsupported Markdown');
  await key('Escape');
  assert.equal(await query(win,`document.querySelector('.sheet-note-input')?.value`),'bad\u0000','Rejected saves never silently discard a draft, including Escape');
  await click('.source-button');
  assert.equal(await query(win,`!!document.querySelector('.source-shell')`),false,'Invalid drafts prevent navigation and stay repairable');
  await setValue('.sheet-note-input','*Source: internal reporting.*');await click('.sheet-note-done');
  await wait(win,`!document.querySelector('.sheet-note-input')`);
  for (const theme of ['light','dark']) {
    await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.note-workspace').scrollTop=0`);
    await capture(win,`${host}-sheet-notes-${theme}`);
    const geometry = await query(win,`(() => {
      const bounds=s=>document.querySelector(s).getBoundingClientRect().toJSON();
      return {intro:bounds('.sheet-note-intro'),grid:bounds('.grid-shell'),rail:bounds('.row-index-strip'),footer:bounds('.sheet-note-footer'),columns:bounds('.note-rail-host')};
    })()`);
    assert.ok(Math.abs(geometry.intro.left-geometry.grid.left)<1,'Note and table share left edge');
    assert.ok(Math.abs(geometry.intro.width-geometry.footer.width)<1,'Notes share table footprint');
    assert.ok(geometry.rail.top>=geometry.intro.bottom,'Row rail never includes note text');
    assert.ok(Math.abs(geometry.grid.top-geometry.intro.bottom)<1,'Note joins the table without a rail gap');
    assert.ok(geometry.columns.bottom<=geometry.intro.top+1,'Column rail is above the note');
    assert.ok(await query(win,`(() => {
      const note=document.querySelector('.sheet-note-intro .sheet-note'),title=note.querySelector('.sheet-note-title');
      const n=note.getBoundingClientRect(),t=title.getBoundingClientRect();
      return Math.abs(t.left-n.left-10)<1&&Math.abs(t.top-n.top-10)<1;
    })()`),'Title uses the selected 10px inset in both themes');
  }
  await click('.source-button');await wait(win,`document.querySelector('.source-shell textarea')`);
  const saved=await query(win,`document.querySelector('.source-shell textarea').value`);
  assert.match(saved,/\*\*Quarterly results\*\*/);assert.match(saved,/\*Source: internal reporting\.\*/);
  assert.match(saved,/B2 - B3/);assert.doesNotMatch(saved,/<script>/);
  await click('.source-button');
  await wait(win,`document.querySelector('.table-stage[data-layout-ready="true"]')`);
  win.setSize(480,840);
  await capture(win,`${host}-sheet-notes-narrow`);
  assert.ok(await query(win,`[...document.querySelectorAll('.sheet-note')].every(n=>{const s=getComputedStyle(n);return s.paddingLeft==='10px'&&s.paddingTop==='10px';})`),'Narrow layouts preserve the selected note insets');
  assert.ok(await query(win,`document.querySelector('.sheet-note-intro').getBoundingClientRect().right<=innerWidth`));
  win.setSize(1060,920);
  await load('# Long report\nOverview\n\n| Item || Value |\n| ---- || ----- |\n'+Array.from({length:70},(_,i)=>`| Row ${i+1} || ${i+1} |`).join('\n')+'\n\nEnd of report.');
  await edit('.sheet-note-intro .sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','Long draft paragraph\n\n'.repeat(80));
  await wait(win,`document.querySelector('.sheet-note-input').scrollHeight>document.querySelector('.sheet-note-input').clientHeight`);
  for (const theme of ['light','dark']) {
    await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.note-workspace').scrollTop=0`);
    await query(win,`document.querySelector('.grid-wrap').dispatchEvent(new WheelEvent('wheel',{deltaY:300,bubbles:true,cancelable:true}))`);
    await wait(win,`document.querySelector('.note-workspace').scrollTop>0`);
    await wait(win,`Math.abs(document.querySelector('.sheet-note-editor').getBoundingClientRect().top-document.querySelector('.workspace-shell').getBoundingClientRect().top-12)<1`);
    assert.ok(await query(win,`(() => {
      const chrome=document.querySelector('.app-chrome'),editor=document.querySelector('.sheet-note-editor');
      const button=document.querySelector('.settings-button'),r=button.getBoundingClientRect();
      return Number(getComputedStyle(editor).zIndex)<Number(getComputedStyle(chrome).zIndex)
        &&button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
    })()`),'Long notes never cover toolbar controls');
    assert.ok(await query(win,`(() => {
      const done=document.querySelector('.sheet-note-done'),r=done.getBoundingClientRect();
      const input=document.querySelector('.sheet-note-input'),t=input.getBoundingClientRect();
      return done.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))
        &&input===document.elementFromPoint(t.left+t.width/2,t.top+10)
        &&r.bottom<innerHeight&&t.bottom<=innerHeight-11;
    })()`),'Done and the scrollable note stay reachable above the table after outside scrolling');
    const outerScroll=await query(win,`document.querySelector('.note-workspace').scrollTop`);
    await query(win,`document.querySelector('.sheet-note-input').scrollTop=150`);
    assert.equal(await query(win,`document.querySelector('.note-workspace').scrollTop`),outerScroll,'Internal note scrolling does not move the sheet');
    await capture(win,`${host}-long-note-layer-${theme}`);
  }
  await query(win,`document.documentElement.dataset.theme='light'`);
  await setValue('.sheet-note-input','Overview');await key('Escape');
  await wait(win,`!document.querySelector('.sheet-note-editor')`);
  await query(win,`document.querySelector('.ag-body-viewport').scrollTop=0;document.querySelector('.note-workspace').scrollTop=0`);
  await query(win,`document.querySelector('.grid-wrap').dispatchEvent(new WheelEvent('wheel',{deltaY:300,bubbles:true,cancelable:true}))`);
  await wait(win,`document.querySelector('.note-workspace').scrollTop>0 && document.querySelector('.ag-body-viewport').scrollTop>0`);
  assert.ok(await query(win,`Math.abs(document.querySelector('.table-stage').getBoundingClientRect().top-document.querySelector('.note-rail-host').getBoundingClientRect().bottom)<1`),'Grid reaches the fixed column rail after intro scrolls away');
  await query(win,`const v=document.querySelector('.ag-body-viewport');v.scrollTop=v.scrollHeight`);
  await wait(win,`document.querySelector('.sheet-note-footer').getBoundingClientRect().top < document.querySelector('.grid-shell').getBoundingClientRect().bottom`);
  await capture(win,`${host}-sheet-notes-scroll-end`);
  const footer = await query(win,`(() => { const n=document.querySelector('.sheet-note-footer').getBoundingClientRect(), g=document.querySelector('.grid-shell').getBoundingClientRect();return {bottom:n.bottom,visibleBottom:g.bottom};})()`);
  assert.ok(footer.bottom<=footer.visibleBottom+1,`Footer is fully reachable: ${JSON.stringify(footer)}`);
  await query(win,`document.querySelector('.ag-body-viewport').scrollTop=0;document.querySelector('.note-workspace').scrollTop=0`);
  await click('[aria-label="Sheet setup"]');
  await wait(win,`document.querySelector('.sheet-setup-notes')`);
  await query(win,`[...document.querySelectorAll('.sheet-setup-notes button')].find(b=>b.textContent==='Note after table').click()`);
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await wait(win,`document.querySelector('.sheet-note-input').getBoundingClientRect().top < document.querySelector('.grid-shell').getBoundingClientRect().bottom`);
  await setValue('.sheet-note-input','**Revised source.**');await key('Escape');
  await wait(win,`document.querySelector('.sheet-note-footer strong')?.textContent==='Revised source.'`);
  await edit('.sheet-note-footer .sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','');
  assert.ok(await query(win,`!!document.querySelector('.sheet-note-input')`),'Select-all and clear keeps the editor available for replacement text');
  await setValue('.sheet-note-input','Replacement text');
  await click('.grid-shell');
  await wait(win,`document.querySelector('.sheet-note-footer .sheet-note-content')?.textContent==='Replacement text'`);
  await edit('.sheet-note-footer .sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input',' \n ');
  await click('.grid-shell');
  await wait(win,`document.querySelector('[aria-label="Add note after table"]')`);
  await click('[aria-label^="Undo Delete sheet note"]');
  await wait(win,`document.querySelector('.sheet-note-footer .sheet-note-content')?.textContent==='Replacement text'`);
  await click('[aria-label^="Undo Edit sheet note"]');
  await wait(win,`document.querySelector('.sheet-note-footer strong')?.textContent==='Revised source.'`);
  await load('# Columns\n**Basis**\n\nUnaudited financial results.\n\n---\n\n**Scope**\n\n- Local currency\n- Continuing operations\n\n| Metric || Q1 | Q2 | Q3 | Q4 | Year |\n| ------ || --- | --- | --- | --- | ---- |\n| Revenue || 123 | 456 | 789 | 112 | 1480 |');
  await capture(win,`${host}-sheet-notes-columns`);
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-column').length`),2);
  assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note-content hr')).display`),'none','Wide presentation uses the separator as a column boundary');
  win.setSize(480,840);
  await wait(win,`document.querySelector('.sheet-note-content').getBoundingClientRect().width<=420`);
  assert.ok(await query(win,`(() => {const c=[...document.querySelectorAll('.sheet-note-column')].map(e=>e.getBoundingClientRect());return c[1].top>=c[0].bottom && Math.abs(c[1].left-c[0].left)<1;})()`),'Narrow notes stack columns in reading order');
  assert.notEqual(await query(win,`getComputedStyle(document.querySelector('.sheet-note-content hr')).display`),'none','Narrow presentation shows the same separator as a horizontal rule');
  await capture(win,`${host}-sheet-notes-separator-narrow`);
  await query(win,`document.querySelector('.ag-body-horizontal-scroll-viewport').scrollLeft=100`);
  await wait(win,`parseFloat(getComputedStyle(document.querySelector('.note-column-rail')).getPropertyValue('--grid-center-track-offset-x'))<0`);
  assert.ok(await query(win,`(() => {const rail=document.querySelector('.column-index-center-scroll-layer'),v=document.querySelector('.ag-body-horizontal-scroll-viewport');return Math.abs(new DOMMatrix(getComputedStyle(rail).transform).m41+v.scrollLeft)<1;})()`),'Column rail follows the live horizontal scroll');
  win.setSize(1060,920);
  await wait(win,`document.querySelector('.sheet-note-content').getBoundingClientRect().width>420`);
  const stable=await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().toJSON()`);
  await click('.sheet-note-content');
  assert.equal(await query(win,`!!document.querySelector('.sheet-note-input')`),false,'Single click never enters note editing');
  await edit('.sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','A much longer draft\n'.repeat(20));
  await capture(win,`${host}-sheet-notes-overlay`);
  assert.deepEqual(await query(win,`document.querySelector('.grid-shell').getBoundingClientRect().toJSON()`),stable,'Overlay growth leaves table geometry unchanged');
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-edit').length`),0,'There is no Edit button');
  await key('Escape');
  await load('# Many columns\n'+Array.from({length:8},(_,i)=>`**Section ${i+1}**\n\n${'LongText'.repeat(18)}`).join('\n\n---\n\n')+'\n\n| A | B | C | D |\n| 1 | 2 | 3 | 4 |');
  for(const width of [1060,480]){
    win.setSize(width,840);
    await query(win,`new Promise(resolve=>setTimeout(resolve,150))`);
    assert.ok(await query(win,`(()=>{const parent=document.querySelector('.sheet-note-columns'),r=parent.getBoundingClientRect();return [...parent.children].every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1&&el.scrollWidth<=el.clientWidth+1;});})()`),'Every note column and long word stays inside its available width');
    assert.equal(await query(win,`getComputedStyle(document.querySelector('.sheet-note')).borderTopWidth`),'0px');
    await capture(win,host+'-many-note-columns-'+width);
  }
  win.setSize(1060,920);
  await load('# Narrow\nSmall note.\n\n| 1 |\n\n# Valuation as picture\nYou can modify this picture and bring in relevant details to back up your valuation.\n\n| Company | Industry | Revenue | Profit | Cash flow | Valuation |\n| Almarai | Food | 100 | 20 | 15 | 200 |\n\nNote after the valuation table.');
  const frames = await query(win, `new Promise(resolve => {
    const frames=[];
    const sample=()=>{
      const intro=document.querySelector('.sheet-note-intro'), stage=document.querySelector('.table-stage');
      const title=intro?.querySelector('.sheet-note-title');
      if(intro && stage) frames.push({ready:stage.dataset.layoutReady,
        visibility:getComputedStyle(intro).visibility,width:intro.getBoundingClientRect().width,
        title:title?.textContent,titleHeight:title?.getBoundingClientRect().height});
    };
    const target=[...document.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent.trim()==='Valuation as picture');
    if(!target) throw new Error('Missing synthetic wide-sheet tab');
    target.click();
    sample();
    let remaining=45;
    const tick=()=>{sample();if(--remaining)requestAnimationFrame(tick);else resolve(frames);};
    requestAnimationFrame(tick);
  })`);
  assert.ok(frames.some(frame=>frame.ready==='true' && frame.title==='Valuation as picture'),
    'The wide sheet and its note eventually render');
  for(const frame of frames){
    if(frame.ready!=='true') assert.equal(frame.visibility,'hidden','The note shares the grid readiness gate');
    if(frame.visibility==='visible' && frame.title==='Valuation as picture'){
      assert.ok(frame.width>420,'A visible wide-sheet note never uses the narrow or intermediate width');
      assert.ok(frame.titleHeight<60,'The sheet title does not flash as a vertical stack of characters');
    }
  }
  await capture(win,host+'-sheet-note-layout-ready');
  await load('# Markdown\n1. **First**\n2. Second\n\n-----\n\n+ Last\n\n| Item || Value |\n| --- || --- |\n| Sales || 42 |');
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-content ol li').length`),2);
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-content hr').length`),1);
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-column').length`),2,'Long hyphen rules create the same layout sections as ---');
  await edit('.sheet-note-content');await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','3) **Changed**\n4) Next\n\n-----\n\n* Final');
  await click('.sheet-note-done');
  await wait(win,`document.querySelector('.sheet-note-content ol')?.start===3`);
  assert.equal(await query(win,`!!document.querySelector('.sheet-note-editor')`),false,'Numbered lists and horizontal rules can be saved');
  await capture(win,host+'-sheet-note-ordered-list-and-rule');
  for (const commit of ['escape','shortcut','click-away']) {
    await edit('.sheet-note-intro .sheet-note-content');
    await wait(win,`document.activeElement?.className==='sheet-note-input'`);
    await setValue('.sheet-note-input','[literal '+commit+'](url)');
    if (commit==='escape') await key('Escape');
    else if (commit==='shortcut') await key('Enter',{ctrlKey:true});
    else await click('.grid-shell');
    await wait(win,`!document.querySelector('.sheet-note-editor')`);
    assert.equal(await query(win,`document.querySelector('.sheet-note-intro .sheet-note-content').textContent`),'[literal '+commit+'](url)','Every commit path saves unsupported Markdown as text');
    assert.equal(await query(win,`document.querySelectorAll('.sheet-note-intro a').length`),0);
  }
  await load('# Typing\n| A | B |\n| 1 | 2 |');
  await click('[aria-label="Add note before table"]');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','First');
  // Actual key events exercise Enter and Shift+Enter; synthetic events do not
  // perform Chromium's default text insertion.
  const nativeKey = (keyCode, modifiers=[]) => {
    win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
    if (keyCode==='Return') win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});
    win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
  };
  nativeKey('Return');
  await wait(win,`document.querySelector('.sheet-note-input')?.value==='First\\n\\n'`);
  assert.ok(await query(win,`document.queryCommandEnabled('undo')`),'Paragraph insertion participates in native undo');
  win.webContents.undo();
  await wait(win,`document.querySelector('.sheet-note-input')?.value==='First'`);
  win.webContents.redo();
  await wait(win,`document.querySelector('.sheet-note-input')?.value==='First\\n\\n'`);
  await setValue('.sheet-note-input','First');
  nativeKey('Return',['shift']);
  await wait(win,`document.querySelector('.sheet-note-input')?.value==='First\\n'`);
  assert.ok(await query(win,`!!document.querySelector('.sheet-note-editor')`),'Shift+Enter inserts one newline without saving');
  await key('Enter',{metaKey:true});
  await wait(win,`!document.querySelector('.sheet-note-editor')`);
  assert.equal(await query(win,`document.querySelector('.sheet-note-intro .sheet-note-content').textContent`),'First','Shift+Enter retains Markdown soft-wrap semantics');
  await edit('.sheet-note-intro .sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','3) First');
  await key('Enter');
  await wait(win,`document.querySelector('.sheet-note-input')?.value==='3) First\\n3) '`);
  await setValue('.sheet-note-input','3) First\n3) Second');
  await key('Enter',{ctrlKey:true});
  await wait(win,`document.querySelector('.sheet-note-content ol')?.start===3`);
  assert.equal(await query(win,`document.querySelectorAll('.sheet-note-content ol li').length`),2,'Enter continues a single ordered list');
  await edit('.sheet-note-intro .sheet-note-content');
  await wait(win,`document.activeElement?.className==='sheet-note-input'`);
  await setValue('.sheet-note-input','1. ');
  await key('Enter');
  await wait(win,`document.querySelector('.sheet-note-input')?.value===''`);
  await setValue('.sheet-note-input','First');await key('Enter');
  await setValue('.sheet-note-input','First\n\nSecond');
  await key('Enter',{metaKey:true});
  await wait(win,`document.querySelectorAll('.sheet-note-content p').length===2`);
  await capture(win,host+'-sheet-note-paragraph-editing');
  // A single temporal value below the 80th percentile must still fit inside
  // the live AG Grid column. Cover post-edit recalculation, not just mounting.
  const numbers=Array.from({length:20},()=> '| Item || 120 | 140 | 160 | 180 |').join('\n');
  const numericSource='# Dates\n| Item || H1 | H2 | H3 | H4 |\n| --- || --- | --- | --- | --- |\n'+numbers;
  await load(numericSource+'\n| When || | | | |');
  const numericWidths=await query(win,`[...document.querySelector('.ag-center-cols-container .ag-row').children].map(cell=>cell.getBoundingClientRect().width)`);
  for (const value of ['2026-01-01','2026-01-01T23:59:59']) {
    await query(win,`[...document.querySelectorAll('.ag-center-cols-container .ag-cell[col-id="col_1"]')].at(-1).dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
    await wait(win,`document.querySelector('textarea[aria-label="Edit selected cell input"]')`);
    await setValue('textarea[aria-label="Edit selected cell input"]',value);
    await click('[aria-label="Apply cell input"]');
    await wait(win,`!document.querySelector('textarea[aria-label="Edit selected cell input"]')&&[...document.querySelectorAll('.ag-center-cols-container .ag-cell[col-id="col_1"]')].at(-1).textContent.includes('2026')`);
    const dateColumn=await query(win,`(() => {
      const cells=[...document.querySelectorAll('.ag-center-cols-container .ag-cell[col-id="col_1"]')];
      const cell=cells.at(-1),range=document.createRange();range.selectNodeContents(cell);
      const style=getComputedStyle(cell),rect=cell.getBoundingClientRect();
      return {text:cell.textContent,width:rect.width,textWidth:range.getBoundingClientRect().width,
        padding:parseFloat(style.paddingLeft)+parseFloat(style.paddingRight),
        widths:[...cell.parentElement.children].map(c=>c.getBoundingClientRect().width)};
    })()`);
    assert.ok(dateColumn.text.includes('2026'),'The real date is rendered, not an empty cell');
    assert.ok(dateColumn.textWidth+dateColumn.padding+2<=dateColumn.width,`Complete temporal display fits: ${JSON.stringify(dateColumn)}`);
    assert.deepEqual(dateColumn.widths.slice(1),numericWidths.slice(1),'Adding a date does not widen unrelated numeric peers');
    await query(win,`[...document.querySelectorAll('.ag-center-cols-container .ag-cell[col-id="col_1"]')].at(-1).scrollIntoView({block:'end',inline:'nearest'})`);
    await capture(win,host+'-temporal-column-'+(value.includes('T')?'datetime':'date'));
  }
  console.log(`${host}: notes edit/validation/IME/history/source/layout/scroll passed`);
}
