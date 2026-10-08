import { app, dialog, net, protocol } from 'electron';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { appKit } from '../desktop-out/desktop/nativeChrome.js';
import { createDocumentWindow } from '../desktop-out/desktop/documentWindow.js';
import { presentDocumentWindow } from '../desktop-out/desktop/presentDocumentWindow.js';

// Exercise the real preload, production renderer and shared file session, using
// only test-owned windows/profile/files. No user's app or browser is controlled.
// The presentation regression briefly shows its own native tab group.
const directory = mkdtempSync(path.join(tmpdir(), 'ordinate-workspace-smoke-'));
mkdirSync(path.join(directory, 'profile'));
app.setPath('userData', path.join(directory, 'profile'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'ordinate-test', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
appKit?.setDocumentOpenHandler((id) => appKit.completeDocumentOpen(id, 0, 'System restoration is outside this test'));
const entries = [];
const copies = [];
const newDocuments = [];
let closing = false;
let destination;
let releaseEditor;
let editorRequested;
let gateFirstEditor = true;
const editorGate = new Promise(resolve => { releaseEditor = resolve; });
const editorRequest = new Promise(resolve => { editorRequested = resolve; });
const originalSaveDialog = dialog.showSaveDialog;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });

async function waitForTable(entry, sheetName) {
  await entry.win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 10000;
    const check = () => {
      const selected = document.querySelector('[role="tab"][aria-selected="true"]');
      const stage = document.querySelector('.table-stage');
      if (selected?.getAttribute('aria-label') === ${JSON.stringify(sheetName)} &&
          stage?.dataset.layoutReady === 'true') {
        resolve();
      } else if (performance.now() > deadline) {
        reject(new Error('Table layout did not become ready'));
      } else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  })`);
}

async function assertTableGeometry(entry, hasHeader, settle = false) {
  const geometry = await entry.win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 10000;
    const measure = () => {
    const stage = document.querySelector('.table-stage');
    const workspace = stage.closest('.workspace-shell');
    const columnRail = workspace.querySelector('.note-column-rail');
    const viewport = stage.querySelector('.ag-center-cols-viewport');
    const header = stage.querySelector('.header-matrix-overlay--center');
    const lastCell = stage.querySelector('.ag-center-cols-container .ag-row')?.lastElementChild;
    const mask = stage.querySelector('.table-trailing-canvas-mask');
    const geometry = {
      ready: stage.dataset.layoutReady,
      viewportWidth: viewport.clientWidth,
      headerWidth: header?.getBoundingClientRect().width ?? null,
      headerLeft: header?.getBoundingClientRect().left ?? null,
      viewportLeft: viewport.getBoundingClientRect().left,
      offsetX: workspace.style.getPropertyValue('--grid-center-track-offset-x'),
      offsetY: workspace.style.getPropertyValue('--grid-body-track-offset-y'),
      stageOffsetX: getComputedStyle(stage).getPropertyValue('--grid-center-track-offset-x'),
      railOffsetX: getComputedStyle(columnRail).getPropertyValue('--grid-center-track-offset-x'),
      maskGap: mask && lastCell ? mask.getBoundingClientRect().left - lastCell.getBoundingClientRect().right : null,
    };
    // Capture the successful measurement atomically. Native scrollbar changes
    // can occur between two separate renderer IPC calls during a sheet switch.
    const aligned = geometry.viewportWidth > 0 && geometry.offsetX !== '' && geometry.offsetY !== '' &&
      (!${hasHeader} || (geometry.headerWidth === geometry.viewportWidth &&
        Math.abs(geometry.headerLeft - geometry.viewportLeft) < 1)) &&
      geometry.maskGap !== null && Math.abs(geometry.maskGap) < 1;
    if (!${settle} || aligned) resolve(geometry);
    else if (performance.now() > deadline) reject(new Error('Grid geometry did not converge: ' + JSON.stringify(geometry)));
    else requestAnimationFrame(measure);
    };
    measure();
  })`);
  assert.equal(geometry.ready, 'true');
  assert.ok(geometry.viewportWidth > 0, 'The mounted grid must be measured');
  assert.notEqual(geometry.offsetX, '', 'Horizontal scroll binding must exist on first mount');
  assert.notEqual(geometry.offsetY, '', 'Vertical scroll binding must exist on first mount');
  assert.equal(geometry.stageOffsetX, geometry.offsetX, 'The grid inherits the shared scroll offset');
  assert.equal(geometry.railOffsetX, geometry.offsetX, 'The portalled column rail inherits the same scroll offset');
  if (hasHeader) {
    assert.equal(geometry.headerWidth, geometry.viewportWidth, 'Header must cover the live center viewport');
    assert.ok(Math.abs(geometry.headerLeft - geometry.viewportLeft) < 1, 'Header and body must align');
  } else assert.equal(geometry.headerWidth, null);
  assert.notEqual(geometry.maskGap, null, 'This short-table fixture needs a trailing mask');
  assert.ok(Math.abs(geometry.maskGap) < 1, 'Grid borders must end at the last data column, not the append slot');
}

async function assertFormulaBar(entry) {
  async function capture(name) {
    await entry.win.webContents.executeJavaScript(`(async () => {
      const shell = document.querySelector('.formula-bar-shell');
      await Promise.all(shell.getAnimations({ subtree: true }).map(animation => animation.finished));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    await writeFile('/tmp/ordinate-formula-compact-' + name + '.png', (await entry.win.webContents.capturePage()).toPNG());
  }
  await entry.win.webContents.executeJavaScript(`(() => {
    const cell = document.querySelector('.ag-center-cols-container .ag-cell');
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  })()`);
  await entry.win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const check = () => {
      if (document.querySelector('.formula-bar-shell--visible .formula-address')) resolve();
      else if (performance.now() > deadline) reject(new Error('Formula bar did not open'));
      else requestAnimationFrame(check);
    }; check();
  })`);
  const interactions = await entry.win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.formula-address');
    const root = button.closest('.formula-location');
    button.focus();
    root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return { expanded: button.getAttribute('aria-expanded'), popup: !!document.querySelector('.formula-location-popover') };
  })()`);
  assert.deepEqual(interactions, { expanded: 'false', popup: false }, 'Focus and hover must not open location details');
  async function expanded() {
    return entry.win.webContents.executeJavaScript(`document.querySelector('.formula-address').getAttribute('aria-expanded')`);
  }
  await entry.win.webContents.executeJavaScript(`document.querySelector('.formula-address').click()`);
  assert.equal(await expanded(), 'true');
  await entry.win.webContents.executeJavaScript(`document.querySelector('.formula-address').click()`);
  assert.equal(await expanded(), 'false', 'Second click closes details');
  await entry.win.webContents.executeJavaScript(`document.querySelector('.formula-address').click()`);
  await entry.win.webContents.executeJavaScript(`document.querySelector('.formula-address').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.equal(await expanded(), 'false', 'Escape closes details without dismissing the formula bar');
  await entry.win.webContents.executeJavaScript(`document.querySelector('.formula-address').click()`);
  await entry.win.webContents.executeJavaScript(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  assert.equal(await expanded(), 'false', 'Click outside closes details');
  const desktop = await entry.win.webContents.executeJavaScript(`(() => {
    const rect = s => document.querySelector(s).getBoundingClientRect();
    return { addressY: rect('.formula-address').y, chipY: rect('.formula-chip').y,
      toolsY: rect('.formula-display-meta').y, addressGap: parseFloat(getComputedStyle(document.querySelector('.formula-address')).gap),
      metaWidth: rect('.formula-meta-stack').width, columns: getComputedStyle(document.querySelector('.formula-bar')).gridTemplateColumns.split(' ').length };
  })()`);
  assert.ok(Math.abs(desktop.addressY - desktop.chipY) < 5, 'Address and type share the top line');
  assert.ok(desktop.toolsY > desktop.addressY, 'Tools sit on the second line');
  assert.ok(desktop.addressGap < 2, 'Column and row form a compact address');
  assert.ok(desktop.metaWidth <= 136, 'Metadata leaves more room for the editor');
  assert.equal(desktop.columns, 2);
  await capture('desktop');
  async function formulaGeometry() {
    return entry.win.webContents.executeJavaScript(`(() => {
      const rect = s => document.querySelector(s).getBoundingClientRect();
      const shell = rect('.formula-bar-shell'), top = rect('.formula-meta-top'), tools = rect('.formula-meta-lower');
      const input = rect('.formula-source'), button = rect('.formula-dismiss-button');
      const format = rect('.formula-format-button');
      return { topInset: top.top - shell.top, bottomInset: shell.bottom - tools.bottom,
        toolLeftInset: format.left - shell.left, toolBottomInset: shell.bottom - format.bottom,
        topY: top.top, toolsY: tools.bottom, buttonY: button.bottom,
        leftGap: button.left - input.right, rightGap: shell.right - button.right,
        radius: getComputedStyle(document.querySelector('.formula-source')).borderRadius,
        inputHeight: input.height,
        clipped: document.querySelector('.formula-source').getAnimations().some(a => a.effect.getKeyframes().some(f => f.clipPath)),
      };
    })()`);
  }
  const single = await formulaGeometry();
  assert.ok(Math.abs(single.topInset - single.bottomInset) < 1, 'Metadata has balanced vertical insets');
  assert.ok(Math.abs(single.leftGap - single.rightGap) < 1, 'Confirm button has equal horizontal spacing');
  assert.ok(Math.abs(single.toolLeftInset - single.toolBottomInset) < 1, 'Tool buttons have equal left and bottom shell insets');
  await entry.win.webContents.executeJavaScript(`document.querySelector('.ag-center-cols-container .ag-cell').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await entry.win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const check = () => {
      const editor = document.querySelector('textarea.formula-source-input');
      if (editor) { editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); resolve(); }
      else if (performance.now() > deadline) reject(new Error('Cell editor did not open'));
      else requestAnimationFrame(check);
    }; check();
  })`);
  for (let line = 0; line < 3; line += 1) {
    entry.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['shift'] });
    entry.win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] });
    entry.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['shift'] });
  }
  await entry.win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const multiline = await formulaGeometry();
  assert.ok(multiline.inputHeight > single.inputHeight, 'Shift Enter expands the editor');
  assert.equal(multiline.clipped, false, 'Editor focus edge and shadow must never be clipped by growth motion');
  assert.equal(multiline.radius, single.radius, 'Input corner radius stays constant');
  assert.ok(multiline.topY < single.topY && Math.abs(multiline.toolsY - single.toolsY) < 1,
    'Metadata rises with the editor while tools remain bottom anchored');
  assert.ok(Math.abs(multiline.buttonY - single.buttonY) < 1, 'Confirmation stays in place');
  assert.ok(Math.abs(multiline.leftGap - multiline.rightGap) < 1, 'Multiline confirmation spacing remains balanced');
  assert.ok(Math.abs(multiline.toolLeftInset - multiline.toolBottomInset) < 1, 'Multiline tools retain balanced left and bottom insets');
  assert.equal(multiline.toolLeftInset, single.toolLeftInset, 'Expanding the editor must not shift tools horizontally');
  await capture('multiline-light');
  await entry.win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'dark'`);
  await capture('multiline-dark');
  await entry.win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'light'`);
  // Visual wrapping is independent of whether the input grammar permits a
  // literal newline (e.g. quoted text). Both editors share hidden scrollbars.
  const wrapping = await entry.win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const wait = async check => {
      const deadline = performance.now() + 5000;
      while (!check()) { if (performance.now() > deadline) throw new Error('Wrapped editor did not update'); await frame(); }
    };
    await wait(() => document.querySelector('.formula-plain-textarea'));
    const setValue = async value => {
      const editor = document.querySelector('.formula-bar textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, value);
      editor.dispatchEvent(new Event('input', {bubbles:true}));
      await frame(); await frame();
    };
    const metrics = () => {
      const editor = document.querySelector('.formula-bar textarea');
      if (!editor) throw new Error('Missing editor after setting text: ' + document.querySelector('.formula-source')?.outerHTML);
      const style = getComputedStyle(editor);
      return {height:editor.clientHeight, width:editor.clientWidth, scrollWidth:editor.scrollWidth,
        scrollHeight:editor.scrollHeight, bars:style.scrollbarWidth,
        webkitBars:getComputedStyle(editor, '::-webkit-scrollbar').display, value:editor.value};
    };
    await setValue('Short text');
    const short = metrics();
    const text = 'In the fourth quarter of 2025, Nasdaq reclassified prior period revenues. '.repeat(4);
    const quoted = JSON.stringify(text);
    await setValue(quoted);
    const quotedMetrics = metrics();
    await setValue(text);
    const plain = metrics();
    const editor = document.querySelector('.formula-plain-textarea');
    editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length);
    return {short, quoted, quotedMetrics, plain};
  })()`);
  for (const wrapped of [wrapping.quotedMetrics, wrapping.plain]) {
    assert.ok(wrapped.height > wrapping.short.height, 'Text soft wraps and grows without a manual newline');
    assert.ok(wrapped.scrollWidth <= wrapped.width + 1, 'Wrapped text does not overflow horizontally');
    assert.equal(wrapped.bars, 'none');
    assert.equal(wrapped.webkitBars, 'none');
    assert.equal(wrapped.value.includes('\n'), false, 'Soft wrap never inserts newlines into the draft');
  }
  assert.equal(wrapping.quotedMetrics.value, wrapping.quoted, 'Quoted text retains its exact source');
  entry.win.webContents.sendInputEvent({type:'keyDown', keyCode:'Return', modifiers:['shift']});
  entry.win.webContents.sendInputEvent({type:'char', keyCode:'\r', modifiers:['shift']});
  entry.win.webContents.sendInputEvent({type:'keyUp', keyCode:'Return', modifiers:['shift']});
  await entry.win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.ok(await entry.win.webContents.executeJavaScript(`document.querySelector('.formula-plain-textarea').value.endsWith('\\n')`), 'Manual newline also works after soft wrapping');
  await capture('text-wrapped-light');
  const originalSize = entry.win.getSize();
  entry.win.setMinimumSize(0, 0); entry.win.setSize(480, 760);
  const overflow = await entry.win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const deadline = performance.now() + 5000;
    while (innerWidth > 640) { if (performance.now() > deadline) throw new Error('Window did not narrow'); await frame(); }
    await frame(); await frame();
    const editor = document.querySelector('.formula-plain-textarea');
    editor.scrollTop = editor.scrollHeight;
    return {top:editor.scrollTop, height:editor.clientHeight, width:editor.clientWidth, scrollWidth:editor.scrollWidth,
      scrollHeight:editor.scrollHeight, bars:getComputedStyle(editor).scrollbarWidth};
  })()`);
  assert.ok(overflow.scrollHeight > overflow.height && overflow.top > 0, 'Capped text remains scrollable without scrollbar chrome');
  assert.ok(overflow.scrollWidth <= overflow.width + 1, 'Text rewraps after narrowing the window');
  assert.equal(overflow.bars, 'none');
  await entry.win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'dark'`);
  await capture('text-wrapped-narrow-dark');
  entry.win.setSize(...originalSize);
  await entry.win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'light'`);
  entry.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  entry.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  const [width, height] = entry.win.getSize();
  entry.win.setMinimumSize(0, 0);
  entry.win.setSize(480, 760);
  const mobile = await entry.win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const check = () => {
      if (innerWidth > 640) {
        if (performance.now() > deadline) reject(new Error('Test window did not resize'));
        else requestAnimationFrame(check);
        return;
      }
      const shell = document.querySelector('.formula-bar-shell');
      const meta = document.querySelector('.formula-meta-stack').getBoundingClientRect();
      const input = document.querySelector('.formula-source-row').getBoundingClientRect();
      resolve({ columns: getComputedStyle(document.querySelector('.formula-bar')).gridTemplateColumns.split(' ').length,
        radius: parseFloat(getComputedStyle(shell).borderRadius), height: shell.offsetHeight,
        stacked: input.top >= meta.bottom, chipVisible: getComputedStyle(document.querySelector('.formula-chip-slot')).display !== 'none',
        fits: input.right <= shell.getBoundingClientRect().right });
    }; requestAnimationFrame(check);
  })`);
  assert.equal(mobile.columns, 1);
  assert.equal(mobile.radius, 20);
  assert.ok(mobile.height > 2 * mobile.radius && mobile.stacked && mobile.chipVisible && mobile.fits,
    'Narrow layout is a rounded rectangle with metadata above a full-width input');
  await capture('mobile');
  entry.win.setSize(width, height);
  await assertFormulaMetadataAndTooltips(entry);
}

async function assertFormulaMetadataAndTooltips(entry) {
  const result = await entry.win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const wait = async (check, label) => {
      const deadline = performance.now() + 5000;
      while (!check()) {
        if (performance.now() > deadline) throw new Error(label + ': ' + document.querySelector('.floating-tooltip')?.outerHTML);
        await frame();
      }
    };
    const select = (index, shiftKey = false) => {
      const cell = document.querySelectorAll('.ag-center-cols-container .ag-row .ag-cell')[index];
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, shiftKey }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    };
    await wait(() => innerWidth > 640, 'Desktop viewport did not return');
    await frame();
    await frame();
    select(0);
    await wait(() => document.querySelector('.formula-column-address sub'), 'Single-cell address missing');
    document.querySelector('.formula-address').click();
    await wait(() => document.querySelector('.formula-location-popover'), 'Single-cell details missing');
    // Sample the rendered ink over the glass surface composited with the sheet.
    const contrast = theme => {
      document.documentElement.dataset.theme = theme;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const paint = color => { context.fillStyle = color; context.fillRect(0, 0, 1, 1); };
      const luminance = () => {
        const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
          const s = channel / 255;
          return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
        });
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
      };
      paint(getComputedStyle(document.querySelector('.grid-wrap')).getPropertyValue('--sheet-surface'));
      paint(getComputedStyle(document.querySelector('.formula-bar-surface')).backgroundColor);
      const background = luminance();
      const subscript = getComputedStyle(document.querySelector('.formula-column-address sub'));
      paint(subscript.color);
      const ink = luminance();
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      const popover = document.querySelector('.formula-location-popover');
      const popoverStyle = getComputedStyle(popover);
      const details = [...popover.querySelectorAll('span')].map(element => {
        // EditorPopover composites its menu surface over the opaque page color.
        paint(popoverStyle.getPropertyValue('--bg-page'));
        paint(popoverStyle.getPropertyValue('--menu-surface-bg'));
        const background = luminance();
        paint(getComputedStyle(element).color);
        const ink = luminance();
        return { text: element.textContent, ink, ratio: (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05) };
      });
      return { ratio: (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05), opacity: subscript.opacity, rgb, details };
    };
    const contrastByTheme = { light: contrast('light'), dark: contrast('dark') };
    document.documentElement.dataset.theme = 'light';
    document.querySelector('.formula-address').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(() => !document.querySelector('.formula-location-popover'), 'Escape must close single-cell details');
    select(1, true);
    await wait(() => document.querySelector('.formula-address')?.textContent === '2 cells', 'Selection count missing');
    const top = document.querySelector('.formula-meta-top');
    const selection = { text: top.textContent.trim(), chip: !!top.querySelector('.formula-chip'), subscript: !!top.querySelector('sub') };
    document.querySelector('.formula-address').click();
    await wait(() => document.querySelector('.formula-location-popover'), 'Selection details missing');
    const details = document.querySelector('.formula-location-popover').textContent;
    document.querySelector('.formula-address').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(() => !document.querySelector('.formula-location-popover'), 'Escape must close selection details');
    select(0);
    await wait(() => document.querySelector('.formula-chip'), 'Single-cell type chip did not return');

    const tooltip = document.querySelector('.floating-tooltip[role="tooltip"]');
    const sample = () => ({ text: tooltip.textContent, width: tooltip.offsetWidth, height: tooltip.offsetHeight,
      opacity: Number(getComputedStyle(tooltip).opacity), hidden: tooltip.getAttribute('aria-hidden') === 'true' });
    const settled = text => tooltip.textContent === text && tooltip.classList.contains('visible') &&
      tooltip.getAnimations().every(animation => animation.playState === 'finished');
    const format = document.querySelector('[aria-label="Format options"]');
    // Hover and keyboard focus share the same tooltip lifecycle. Exercise both.
    format.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await wait(() => settled('Format options'), 'Format tooltip missing');
    const before = sample();
    const style = document.querySelector('[aria-label="Style options"]');
    format.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    style.focus({ preventScroll: true });
    style.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await frame();
    if (!style.isConnected || style.disabled || document.activeElement !== style) {
      throw new Error('Style focus failed: ' + JSON.stringify({ connected: style.isConnected, disabled: style.disabled,
        active: document.activeElement?.outerHTML, style: style.outerHTML }));
    }
    const handoff = [];
    await wait(() => { handoff.push(sample()); return settled('Style options'); }, 'Tooltip handoff did not settle');
    style.blur();
    style.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    const exit = [];
    await wait(() => { exit.push(sample()); return sample().hidden && sample().opacity === 0; }, 'Tooltip did not fade out');
    format.focus({ preventScroll: true });
    format.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await wait(() => settled('Format options'), 'Keyboard tooltip missing');
    format.blur();
    format.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await frame();
    format.focus({ preventScroll: true });
    format.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await wait(() => settled('Format options'), 'Reentry did not restore tooltip');
    format.blur();
    format.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await wait(() => sample().hidden && sample().opacity === 0, 'Reentered tooltip did not dismiss');
    return { contrastByTheme, selection, details, before, handoff, exit };
  })()`);
  for (const [theme, contrast] of Object.entries(result.contrastByTheme)) {
    assert.equal(contrast.opacity, '1', `${theme} subscript must not be faded`);
    assert.ok(contrast.ratio >= 4.5, `${theme} subscript contrast must reach 4.5:1, got ${contrast.ratio}`);
    assert.equal(contrast.details.length, 4, 'Both row/column names and their labels must be checked');
    for (const detail of contrast.details) {
      assert.ok(detail.ratio >= 4.5, `${theme} location detail ${detail.text} must reach 4.5:1, got ${detail.ratio}`);
      if (theme === 'dark') assert.ok(detail.ink > .6, 'Dark location details must use light text');
    }
  }
  const [red, green, blue] = result.contrastByTheme.dark.rgb;
  assert.ok(green > red + 10 && green > blue + 10, 'Dark subscript must stay visibly green, not grey or white');
  assert.deepEqual(result.selection, { text: '2 cells', chip: false, subscript: false }, 'Multi-selection shows only a count');
  assert.match(result.details, /SelectionB2:B3 · 2 cells/);
  assert.match(result.details, /Active cellB3 · Number/);
  for (const sample of result.handoff) {
    assert.ok(['Format options', 'Style options'].includes(sample.text), 'Handoff must never show an empty tooltip');
    if (sample.text === 'Format options') {
      assert.equal(sample.width, result.before.width, 'Exiting tooltip retains its width');
      assert.equal(sample.height, result.before.height, 'Exiting tooltip retains its height');
    }
  }
  assert.ok(result.handoff.some(sample => sample.hidden && sample.opacity > 0 && sample.opacity < 1), 'Test must observe the exit transition');
  for (const sample of result.exit) assert.equal(sample.text, 'Style options', 'Text stays present throughout exit');
  console.log('Formula chrome passed: single/multi-selection, click details, light/dark contrast, tooltip handoff/exit/reentry');
}

async function windowFor(record) {
  const entry = createDocumentWindow({ record, rendererUrl: 'ordinate-test://app/', persist: async () => {},
    open: async () => { throw new Error('Unexpected Open dialog'); }, checkDestination: async () => {},
    newDocument: async parent => {
      assert.equal(parent, entry.win, 'New document must belong to the requesting window, not another focused window');
      const created = await windowFor({ id: `new-${newDocuments.length}`, filename: null, text: null });
      if (process.platform === 'darwin') parent.addTabbedWindow(created.win);
      newDocuments.push(created);
    },
    createUntitled: async text => { copies.push(await windowFor({ id: `copy-${copies.length}`, filename: null, text })); },
    quitPhase: () => closing ? 'approved' : 'idle', closed: () => {},
  });
  entries.push(entry);
  entry.win.webContents.setBackgroundThrottling(false);
  // Do not suppress ready-to-show listeners: loading must stay hidden in the
  // production implementation, not just because the test removed a listener.
  let prematureShows = 0;
  const countShow = () => { prematureShows += 1; };
  entry.win.on('show', countShow);
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Renderer did not initialize its document session')), 20000);
    entry.win.webContents.on('ipc-message', (_event, channel) => {
      if (channel === 'document:ready') { clearTimeout(timeout); resolve(); }
    });
  });
  const loaded = entry.load();
  if (entries.length === 1) {
    await editorRequest;
    const skeleton = await entry.win.webContents.executeJavaScript(`({
      state: document.documentElement.dataset.startup,
      visible: !!document.getElementById('startup-screen'),
      locked: document.getElementById('root').inert,
      rows: document.querySelectorAll('.startup-table-row').length
    })`);
    assert.deepEqual(skeleton, { state: 'loading', visible: true, locked: true, rows: 5 });
    await writeFile('/tmp/ordinate-startup-skeleton.png', (await entry.win.webContents.capturePage()).toPNG());
    releaseEditor();
  }
  await loaded;
  await ready;
  await entry.host.flush();
  await entry.win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const check = () => document.documentElement.dataset.startup === 'ready';
    if (check()) { resolve(); return; }
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Skeleton did not resolve')); }, 10000);
    const observer = new MutationObserver(() => {
      if (check()) { clearTimeout(timeout); observer.disconnect(); resolve(); }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-startup'] });
  })`);
  const revealed = await entry.win.webContents.executeJavaScript(`({
    skeleton: !!document.getElementById('startup-screen'),
    locked: document.getElementById('root').inert,
    gridReady: document.querySelector('.table-stage')?.dataset.layoutReady,
  })`);
  assert.deepEqual(revealed, { skeleton: false, locked: false, gridReady: 'true' });
  assert.equal(prematureShows, 0, 'Loading a document must not show it before tab placement');
  assert.equal(entry.win.isVisible(), false);
  entry.win.removeListener('show', countShow);
  return entry;
}
async function run() {
  await app.whenReady();
  const assets = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
  protocol.handle('ordinate-test', async request => {
    const url = new URL(request.url);
    const target = path.resolve(assets, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!target.startsWith(`${assets}${path.sep}`)) throw new Error('Unexpected asset path');
    if (gateFirstEditor && /\/main-[^/]+\.js$/.test(url.pathname)) {
      gateFirstEditor = false;
      editorRequested();
      await editorGate;
    }
    return net.fetch(pathToFileURL(target).href);
  });
  const backdropRows = Array.from({ length: 30 }, (_, i) => `| Detail ${i + 1} || ${120 + i} |\n`).join('');
  const source = '# Source\n| Name || Value |\n| --- || --- |\n| Alpha || 42 |\n' + backdropRows
    + '\n# Peer\n| Name || Other |\n| --- || --- |\n| Beta || 9 |\n' + backdropRows
    + '\n# Notes\n| Topic | Text |\n';
  const first = await windowFor({ id: 'first', filename: null, text: source });
  // Cold startup defers TableStage until the document has loaded. Geometry must
  // already be valid when the skeleton disappears, without a click or resize.
  await assertTableGeometry(first, true);
  // Focus opens the same tooltip as hover, without interacting with user windows.
  const tooltipGeometry = await first.win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const button = document.querySelector('[aria-label="Open file"]');
    button.focus({ preventScroll: true });
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const deadline = performance.now() + 3000;
    const check = () => {
      const tooltip = document.querySelector('.floating-tooltip.visible');
      if (tooltip?.textContent === 'Open file' && tooltip.getAnimations().every(a => a.playState === 'finished')) {
        const b = button.getBoundingClientRect(), t = tooltip.getBoundingClientRect();
        resolve({ buttonCenter: b.left + b.width / 2, tooltipCenter: t.left + t.width / 2, gap: t.top - b.bottom });
      } else if (performance.now() > deadline) reject(new Error('Open tooltip did not appear: ' + document.querySelector('.floating-tooltip')?.outerHTML));
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  })`);
  assert.ok(Math.abs(tooltipGeometry.buttonCenter - tooltipGeometry.tooltipCenter) < 1, 'Native Open tooltip must be centered on its actual button');
  assert.equal(tooltipGeometry.gap, 8);
  await writeFile('/tmp/ordinate-native-toolbar.png', (await first.win.webContents.capturePage({ x: 0, y: 0, width: 520, height: 120 })).toPNG());
  await first.win.webContents.executeJavaScript(`document.activeElement.blur(); document.querySelector('[aria-label="New document"]').click()`);
  const newDeadline = Date.now() + 10000;
  while (!newDocuments.length) {
    if (Date.now() > newDeadline) throw new Error('Toolbar did not create a new document');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(newDocuments[0].record.filename, null);
  assert.notEqual(newDocuments[0].record.id, first.record.id);
  assert.equal(await newDocuments[0].win.webContents.executeJavaScript(`document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim()`), 'Sheet 1');
  await waitForTable(first, 'Source');
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const name of ['Peer', 'Notes', 'Source']) {
      await first.win.webContents.executeJavaScript(`document.querySelector('[role="tab"][aria-label="${name}"]').click()`);
      await waitForTable(first, name);
      await assertTableGeometry(first, name !== 'Notes', true);
    }
    await first.win.webContents.executeJavaScript(`document.querySelector('[aria-label="Open source mode"]').click()`);
    await first.win.webContents.executeJavaScript(`new Promise(resolve => {
      const check = () => document.querySelector('[aria-label="Return to table view"]') ? resolve() : requestAnimationFrame(check);
      check();
    })`);
    await first.win.webContents.executeJavaScript(`document.querySelector('[aria-label="Return to table view"]').click()`);
    await waitForTable(first, 'Source');
    await assertTableGeometry(first, true, true);
  }
  const reloaded = new Promise(resolve => first.win.webContents.once('did-finish-load', resolve));
  first.win.webContents.reload();
  await reloaded;
  await waitForTable(first, 'Source');
  await assertTableGeometry(first, true, true);
  await assertFormulaBar(first);
  const second = await windowFor({ id: 'second', filename: null, text: '# Other\n| Beta || 9 |\n' });
  if (process.platform === 'darwin') first.win.addTabbedWindow(second.win);
  destination = path.join(directory, 'first.ord');
  await first.host.request('saveAs');
  assert.match(await readFile(destination, 'utf8'), /Alpha/);
  await first.host.request('duplicate');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].record.filename, null);
  destination = path.join(directory, 'copy.ord');
  await copies[0].host.request('saveAs');
  assert.match(await readFile(destination, 'utf8'), /Alpha/);
  assert.notEqual(copies[0].record.filename, first.record.filename);
  closing = true;
  first.win.close();
  destination = path.join(directory, 'second.ord');
  await second.host.request('saveAs');
  assert.match(await readFile(destination, 'utf8'), /Beta/);
  await Promise.all(entries.filter(e => !e.win.isDestroyed()).map(e => e.host.flush()));
  if (process.platform === 'darwin') {
    const tabWindows = [];
    for (let i = 0; i < 3; i += 1) {
      tabWindows.push(await windowFor({ id: `presentation-${i}`, filename: null, text: null }));
    }
    const [parent, secondTab, thirdTab] = tabWindows.map(entry => entry.win);
    parent.setBounds({ x: 100, y: 100, width: 960, height: 720 });
    presentDocumentWindow(parent);
    presentDocumentWindow(secondTab, parent);
    const groupBounds = secondTab.getBounds();
    const events = [];
    const originalAdd = secondTab.addTabbedWindow.bind(secondTab);
    secondTab.addTabbedWindow = win => {
      assert.equal(win.isVisible(), false, 'A tab must still be hidden when joining the native group');
      events.push('join');
      originalAdd(win);
    };
    thirdTab.on('show', () => {
      assert.equal(events[0], 'join', 'The native show event must not precede tab placement');
      events.push('show');
    });
    presentDocumentWindow(thirdTab, secondTab);
    assert.equal(events[0], 'join');
    assert.ok(thirdTab.isVisible(), 'New native tab is selected and visible');
    // Sample the existing group, not just the default new-window dimensions.
    for (let frame = 0; frame < 12; frame += 1) {
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.deepEqual(thirdTab.getBounds(), groupBounds, 'Adding a third tab must preserve the existing window frame');
    }
    await writeFile('/tmp/ordinate-native-three-tabs.png', (await thirdTab.webContents.capturePage()).toPNG());
    for (const entry of tabWindows) entry.win.destroy();
  }
  console.log('Workspace smoke passed: native toolbar New document, centered Open tooltip, cold-start header/border geometry, reload, repeated sheet/source remounts, skeleton, independent documents, native tabs, Save As, Duplicate and IPC after sibling close');
}
void run().then(async () => {
  closing = true;
  for (const entry of entries) if (!entry.win.isDestroyed()) entry.win.destroy();
  dialog.showSaveDialog = originalSaveDialog;
  await rm(directory, { recursive: true, force: true });
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
