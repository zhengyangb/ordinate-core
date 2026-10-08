import { app, BrowserWindow, dialog, net, protocol } from 'electron';
import { mkdtemp, mkdir, writeFile, readFile, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ExcelJS from '../../../packages/core-ts/node_modules/exceljs/excel.js';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../../../packages/core-ts/node_modules/fflate/esm/index.mjs';
import { createDocumentWindow } from '../desktop-out/desktop/documentWindow.js';
import { appKit } from '../desktop-out/desktop/nativeChrome.js';
import { checkNotes } from './notes-smoke.mjs';
import { checkFormattedText } from './formatted-text-smoke.mjs';
import { checkRowFormatting } from './row-format-smoke.mjs';
import { checkFileDrop } from './file-drop-smoke.mjs';
import { checkPrint } from './print-smoke.mjs';
import { checkBrowserPrint } from './browser-print-smoke.mjs';
import { checkFormulaAssistant } from './formula-assistant-smoke.mjs';
import { checkExamples } from './examples-smoke.mjs';
import { checkOnline, checkStaticOnline } from './online-smoke.mjs';
import { checkRemoteWorkbooks } from './remote-workbook-smoke.mjs';
import { checkClose } from './close-smoke.mjs';
import { checkRailMotion } from './rail-motion-smoke.mjs';
import { checkQuit } from './quit-smoke.mjs';
import { checkDoubleClick } from './double-click-smoke.mjs';
import { checkSheetTooltip } from './sheet-tooltip-smoke.mjs';

// Application integration test, not control of the user's running browser/app.
// Test-owned profile/windows/files; real production assets, preload and core.
const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'ordinate-interchange-smoke-')));
await mkdir(path.join(directory, 'profile'));
app.setPath('userData', path.join(directory, 'profile'));
if (process.argv.includes('--remote-only')) {
  // Test fixture TLS and DNS only, never the production application/profile.
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP models.example 127.0.0.1');
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('no-proxy-server');
}
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'ordinate-test', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
appKit?.setDocumentOpenHandler(id => appKit.completeDocumentOpen(id, 0, 'Not part of this test'));
const windows = [], imported = [], opened = [];
let inputPath = null, outputPath = null;
let saveRequests = 0;
let saveSuggestion;
let closing = false;
const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
dialog.showOpenDialog = async () => ({ canceled: inputPath === null, filePaths: inputPath ? [inputPath] : [] });
dialog.showSaveDialog = async (_window, options) => { saveSuggestion = options.defaultPath; saveRequests++; return { canceled: outputPath === null, filePath: outputPath }; };

async function wait(win, expression) {
  return win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 15000;
    function check() {
      const value = (${expression});
      if (value) resolve(true);
      else if (performance.now() > deadline) reject(new Error('Timed out: ' + ${JSON.stringify(expression)} + '\\n' + document.querySelector('[role="dialog"]')?.textContent + '\\nFocus: ' + document.activeElement?.outerHTML));
      else requestAnimationFrame(check);
    } check();
  })`);
}
const query = (win, expression) => win.webContents.executeJavaScript(expression).catch(error => {
  throw new Error(`Renderer query failed: ${expression}`, {cause:error});
});
const buttonExpression = text => `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})`;
async function click(win, text) { await wait(win, `${buttonExpression(text)} && !${buttonExpression(text)}.disabled`); await query(win, `${buttonExpression(text)}.click()`); }
async function nativeWindow(record, quitPhase = () => closing ? 'approved' : 'idle') {
  const entry = createDocumentWindow({ record, rendererUrl: 'ordinate-test://app/', persist: async () => {},
    open: async (parent, filename) => {
      assert.equal(parent, entry.win);
      assert.ok(filename, 'A dropped ORD opens directly without a picker');
      const created = await nativeWindow({id: `opened-${opened.length}`, filename, text: null});
      if (process.platform === 'darwin') parent.addTabbedWindow(created.win);
      opened.push(created);
    }, newDocument: async () => { throw new Error('Unexpected New'); },
    checkDestination: async () => {}, quitPhase, closed: () => {},
    createUntitled: async (text, parent, draftName) => {
      assert.equal(parent, entry.win);
      const created = await nativeWindow({ id: `import-${imported.length}`, filename: null, text, draftName });
      if (process.platform === 'darwin') parent.addTabbedWindow(created.win);
      imported.push(created);
    },
  });
  windows.push(entry.win); entry.win.webContents.setBackgroundThrottling(false);
  await entry.load(); await wait(entry.win, `document.documentElement.dataset.startup === 'ready'`);
  return entry;
}
async function exportReview(win, format) {
  await query(win, `document.querySelector('[aria-label="Export a copy"]').click()`);
  await wait(win, `document.querySelector('.choice-menu [role="menuitem"]')`);
  assert.equal(await query(win, `!!document.querySelector('[role="dialog"]')`), false, 'Format choice belongs to the toolbar menu');
  await query(win, `[...document.querySelectorAll('.choice-menu [role="menuitem"]')].find(b => b.textContent.endsWith('.${format}')).click()`);
  if (format === 'xlsx' || format === 'ord') return;
  await wait(win, `${buttonExpression('Export')} && !${buttonExpression('Export')}.disabled`);
  await wait(win, `document.getAnimations().every(a => a.playState === 'finished')`);
  assert.equal(await query(win, `!!document.querySelector('[role="dialog"] select')`), false, 'Sheet picker uses the shared menu');
  assert.doesNotMatch(await query(win, `document.querySelector('[role="dialog"]').textContent`), /Calculated values from one sheet/);
  const height = await query(win, `document.querySelector('[role="dialog"]').getBoundingClientRect().height`);
  await query(win, `document.querySelector('[aria-label="Sheet"]').click()`);
  await wait(win, `document.querySelector('[role="menuitemradio"]')`);
  assert.equal(await query(win, `document.querySelector('[role="dialog"]').getBoundingClientRect().height`), height, 'Opening the sheet menu must not resize the dialog');
  assert.ok(await query(win, `document.querySelector('[role="dialog"]').contains(document.querySelector('[role="menuitemradio"]'))`), 'Popup remains inside its accessible modal');
  const popupBounds = await query(win, `(() => { const r=document.querySelector('.choice-menu').getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}; })()`);
  assert.ok(popupBounds.left >= 0 && popupBounds.right <= popupBounds.width && popupBounds.top >= 0 && popupBounds.bottom <= popupBounds.height, 'Popup fits viewport');
  await query(win, `document.querySelector('[role="menuitemradio"][aria-checked="true"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
  await wait(win, `!document.querySelector('[role="menuitemradio"]')`);
  assert.ok(await query(win, `!!document.querySelector('[role="dialog"]')`), 'Escape closes the picker, not the export dialog');
  await query(win, `document.querySelector('[aria-label="Sheet"]').click()`);
  await wait(win, `document.activeElement?.getAttribute('role') === 'menuitemradio'`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await wait(win, `document.activeElement === document.querySelector('[aria-label="Allow formula-like text"]')`);
  await query(win, `document.querySelector('[aria-label="Sheet"]').click()`);
  await wait(win, `document.activeElement?.getAttribute('role') === 'menuitemradio'`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['shift']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['shift']});
  await wait(win, `document.activeElement?.textContent.trim() === 'Export' && !document.querySelector('[role="menuitemradio"]')`);
}
async function importReview(win) {
  win.webContents.send('editor:command', 'import');
  await click(win, 'Choose file…');
  await wait(win, `document.querySelector('.interchange-filename')`);
  await wait(win, `document.querySelector('[aria-label="Conversion review"]')`);
}
async function assertStableExportToggle(win, label, selected, sameWarnings = true) {
  await wait(win, `document.getAnimations().every(animation=>animation.playState==='finished')`);
  const trace = await query(win, `(async () => {
    const dialog=document.querySelector('[role="dialog"]'), option=document.querySelector('[aria-label=${JSON.stringify(label)}]');
    const list=document.querySelector('.interchange-export-notes'), footer=dialog.querySelector('footer');
    const measure=()=>[dialog,option,list,footer].map(node=>{const r=node.getBoundingClientRect();return [r.y,r.height];});
    const baseline=measure(), text=list.textContent, scroll=list.scrollTop, frames=[];
    const record=()=>frames.push({bounds:measure(), warnings:list.textContent, connected:list.isConnected, scroll:list.scrollTop,
      status:dialog.querySelector('.interchange-export-status').textContent,
      preparing:document.querySelector('.interchange-body').getAttribute('aria-busy')==='true',
      exportDisabled:[...footer.querySelectorAll('button')].find(button=>button.textContent==='Export').disabled});
    const observer=new MutationObserver(record); observer.observe(dialog,{subtree:true,childList:true,attributes:true});
    option.click();
    do { await new Promise(resolve=>requestAnimationFrame(resolve)); record(); }
    while(document.querySelector('.interchange-body').getAttribute('aria-busy')==='true');
    observer.disconnect();
    return {baseline,text,scroll,frames,selected:option.getAttribute('aria-pressed')};
  })()`);
  assert.equal(trace.selected, String(selected));
  for (const frame of trace.frames) {
    assert.equal(frame.connected, true, 'Preparing never removes the warning region');
    if (sameWarnings || frame.preparing) {
      assert.equal(frame.warnings, trace.text, 'Preparing retains the visible review');
      assert.equal(frame.scroll, trace.scroll, 'Preparing retains the warning scroll position');
    }
    assert.equal(frame.status, '', 'Toggling never flashes preparation text');
    if (frame.preparing) assert.equal(frame.exportDisabled, true, 'Export stays disabled until the current bytes are ready');
    frame.bounds.forEach((bounds,i)=>bounds.forEach((value,j)=>assert.ok(Math.abs(value-trace.baseline[i][j])<.5,
      'Dialog, settings, warning region and actions keep their positions and heights throughout preparation')));
  }
  assert.equal(await query(win, `${buttonExpression('Export')}.disabled`), false, 'Export resumes immediately after preparation');
}
const assertStableFreezeToggle = (win, selected) => assertStableExportToggle(win, 'Freeze headers', selected);
async function checkImportFocus(win) {
  win.show();
  // A background test process cannot establish keyboard modality merely by
  // focusing its BrowserWindow. Activate the test application/renderer first.
  app.focus({ steal: true });
  win.focus();
  win.webContents.focus();
  await wait(win, `document.hasFocus()`);
  for (const theme of ['dark', 'light']) {
    await query(win, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    // Initial opening and reopening must both retain usable, unclipped keyboard focus.
    for (let opening = 0; opening < 2; opening++) {
      win.webContents.send('editor:command', 'import');
      await wait(win, `document.activeElement === ${buttonExpression('Choose file…')}`);
      win.webContents.sendInputEvent({type:'keyDown', keyCode:'Tab'});
      win.webContents.sendInputEvent({type:'keyUp', keyCode:'Tab'});
      await wait(win, `document.activeElement === ${buttonExpression('Cancel')}`);
      win.webContents.sendInputEvent({type:'keyDown', keyCode:'Tab', modifiers:['shift']});
      win.webContents.sendInputEvent({type:'keyUp', keyCode:'Tab', modifiers:['shift']});
      await wait(win, `document.activeElement === ${buttonExpression('Choose file…')}`);
      const focus = await query(win, `(() => {
        const button = document.activeElement, style = getComputedStyle(button);
        const bounds = button.getBoundingClientRect();
        const body = button.closest('.app-modal-body').getBoundingClientRect();
        return { visible: button.matches(':focus-visible'), width: parseFloat(style.outlineWidth),
          offset: parseFloat(style.outlineOffset),
          contained: bounds.left >= body.left && bounds.right <= body.right && bounds.top >= body.top && bounds.bottom <= body.bottom };
      })()`);
      assert.ok(focus.visible && focus.width >= 2, `Keyboard focus stays visible: ${JSON.stringify(focus)}`);
      assert.ok(focus.offset + focus.width <= 0 && focus.contained, 'Focus ring fits inside the scrollable body');
      if (opening === 0) await capture(win, `desktop-import-focus-${theme}`);
      await click(win, 'Cancel');
      await wait(win, `!document.querySelector('[role="dialog"]')`);
    }
  }
}
async function capture(win, label) {
  await wait(win, `document.getAnimations().every(a => a.playState === 'finished')`);
  await query(win, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await writeFile(path.join(directory, `${label}.png`), (await win.webContents.capturePage()).toPNG());
}

async function dropFiles(win, files) {
  return query(win, `(() => {
    const transfer = new DataTransfer();
    for (const file of ${JSON.stringify(files)}) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name));
    const event = new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:transfer});
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
}
const textFile = (name, text) => ({name, bytes: Array.from(new TextEncoder().encode(text))});

async function checkDroppedImports(win, excelPath) {
  const files = [textFile('拖入.CSV', '0012,hello'), textFile('drop.tsv', '12\thello'),
    {name:'drop.xlsx', bytes:Array.from(await readFile(excelPath))}];
  for (const file of files) {
    assert.equal(await dropFiles(win, [file]), true, 'File drop never navigates away');
    await wait(win, `document.querySelector('.interchange-filename')?.textContent === ${JSON.stringify(file.name)}`);
    assert.ok(await query(win, `${buttonExpression('Change file…')}`));
    await dropFiles(win, [textFile('ignored.csv', 'unwanted')]);
    assert.equal(await query(win, `document.querySelector('.interchange-filename').textContent`), file.name, 'A drop cannot replace an active modal');
    await wait(win, `document.querySelector('[aria-label="Conversion review"]')`);
    assert.equal(await query(win, `!!${buttonExpression('Continue')}`), false, 'Selected files go straight to preview');
    await click(win, 'Cancel');
    await wait(win, `!document.querySelector('[role="dialog"]')`);
  }
}

async function checkAutomaticImportPreview(native, web) {
  for (const [host, win] of [['native',native],['web',web]]) {
    const title = await query(win, `document.querySelector('[role="tab"][aria-selected="true"]').textContent`);
    const before = imported.length;
    await dropFiles(win,[textFile('preview.csv','Name,Value\n0012,5\n0042,7')]);
    await wait(win, `document.querySelector('[aria-label="Conversion review"]') && !document.querySelector('[aria-busy="true"]')`);
    assert.equal(await query(win, `!!${buttonExpression('Continue')}`),false);
    assert.equal(await query(win, `document.querySelector('.interchange-filename').textContent`),'preview.csv');
    await query(win, `document.querySelector('[aria-label="Increase header rows"]').click()`);
    await wait(win, `!document.querySelector('[aria-busy="true"]')`);
    assert.equal(await query(win, `document.querySelector('.import-preview-controls input').value`),'1');
    await query(win, `document.querySelector('[aria-label="Read values as"]').click()`);
    await wait(win, `document.querySelector('[role="menuitemradio"]')`);
    await query(win, `[...document.querySelectorAll('[role="menuitemradio"]')].find(button=>button.textContent==='Detect numbers and booleans').click()`);
    await wait(win, `document.querySelector('[aria-label="Conversion review"]') && !document.querySelector('[aria-busy="true"]')`);
    assert.equal(await query(win, `document.querySelector('.import-preview-controls input').value`),'1','Changing CSV interpretation preserves headers');
    assert.equal(await query(win, `document.querySelectorAll('.import-preview-grid td[data-header="true"]').length`),2);
    if (host==='native') {
      inputPath=null;
      await click(win,'Change file…');
      await wait(win, `!document.querySelector('[aria-busy="true"]')`);
      assert.equal(await query(win, `document.querySelector('.import-preview-controls input').value`),'1','Cancelling the picker preserves preview');
      inputPath=path.join(directory,'replacement.csv');
      await writeFile(inputPath,'Key,Number\nReplacement,9');
      await click(win,'Change file…');
      await wait(win, `document.querySelector('.interchange-filename')?.textContent==='replacement.csv' && document.querySelector('[aria-label="Conversion review"]') && !document.querySelector('[aria-busy="true"]')`);
      assert.equal(await query(win, `document.querySelector('.import-preview-controls input').value`),'0','A replacement resets headers');
    }
    await capture(win,host+'-automatic-import-preview');
    await click(win,'Cancel');
    await wait(win, `!document.querySelector('[role="dialog"]')`);
    assert.equal(imported.length,before,'Preview never creates a document');
    assert.equal(await query(win, `document.querySelector('[role="tab"][aria-selected="true"]').textContent`),title,'Cancel preserves active sheet');
    await dropFiles(win,[textFile('broken.xlsx','invalid workbook')]);
    await wait(win, `document.querySelector('.interchange-error') && !document.querySelector('[aria-busy="true"]')`);
    assert.equal(await query(win, `!!document.querySelector('[aria-label="Conversion review"]')`),false,'Invalid files do not show stale preview');
    await click(win,'Cancel');
    await dropFiles(win,[textFile('cancel-reading.csv', 'A,B\n'+ '1,2\n'.repeat(20000))]);
    await click(win,'Cancel');
    await wait(win, `!document.querySelector('[role="dialog"]')`);
    assert.equal(imported.length,before,'Cancelling a pending preview never commits');
  }
  console.log('Automatic import preview passed on native/web: no redundant Continue, editable CSV interpretation, retained headers, replacement/reset, picker cancellation, malformed files and pending-work cancellation.');
}

async function webWindow(url = 'ordinate-test://web/', { background = false } = {}) {
  // No preload/desktop bridge; this origin/profile belongs only to the test.
  const web = new BrowserWindow({ show: false, paintWhenInitiallyHidden: !background, width: 420, height: 780,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: background } });
  windows.push(web);
  await web.loadURL(url);
  if (!background) await wait(web, `document.documentElement.dataset.startup === 'ready'`);
  return web;
}

async function run() {
  await app.whenReady();
  const standalone = process.argv.includes('--online-build-only');
  const base = process.argv.find(arg => arg.startsWith('--base='))?.slice('--base='.length) ?? '/';
  const assets = path.resolve(fileURLToPath(new URL(standalone ? '../dist-online/' : '../dist/', import.meta.url)));
  protocol.handle('ordinate-test', request => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(base)) throw new Error('Request outside static hosting base');
    const pathname = '/' + url.pathname.slice(base.length);
    const target = path.resolve(assets, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(`${assets}${path.sep}`)) throw new Error('Unexpected asset path');
    return net.fetch(pathToFileURL(target).href);
  });
  if (standalone) {
    await checkStaticOnline(await webWindow(`ordinate-test://web${base}`), base, {query,wait,capture});
    return;
  }
  const source = '# Data\n| 2 | 3 | = A1 * B1 |\n# Notes\n| hello |\n# Errors\n| = "x" * 2 | = len(trim(" word ")) | 42 |\n# Unsafe\n| "=1+1" |';
  if (process.argv.includes('--remote-only')) {
    await checkRemoteWorkbooks(await webWindow(), {query,wait,capture,directory});
    return;
  }
  const backing = path.join(directory, 'source.ord'); await writeFile(backing, source);
  const entry = await nativeWindow({ id: 'native', filename: backing, text: null }), win = entry.win;
  if (process.argv.includes('--close-only')) {
    await checkClose({nativeWindow,query,wait,saveTo:()=>outputPath=path.join(directory,'explicit-save.ord')});
    return;
  }
  if (process.argv.includes('--quit-only')) {
    await checkQuit({nativeWindow,query,wait,saveTo:name=>outputPath=name===null?null:path.join(directory,name)});
    return;
  }
  if (process.argv.includes('--online-only')) {
    assert.equal(await query(win,`!!document.querySelector('[aria-label="Ordinate menu"]')`),false,'Native menu is not duplicated');
    await checkOnline(await webWindow(undefined, {background:true}), {query,wait,capture});
    return;
  }
  if (process.argv.includes('--examples-only')) {
    for (const target of [win, await webWindow()]) await checkExamples(target,{query,wait,capture});
    return;
  }
  if (process.argv.includes('--import-preview-only')) {
    await checkAutomaticImportPreview(win, await webWindow());
    return;
  }
  if (process.argv.includes('--print-only')) {
    await checkPrint(win, {query,wait,capture,directory});
    return;
  }
  if (process.argv.includes('--browser-print-only')) {
    await checkBrowserPrint(await webWindow(), {query,wait,capture,directory});
    await checkBrowserPrint(await webWindow(), {query,wait,capture,directory}, true);
    return;
  }
  if (process.argv.includes('--file-drop-only')) {
    for (const target of [win, await webWindow()]) await checkFileDrop(target, {query,wait,capture});
    return;
  }
  if (process.argv.includes('--formatted-text-only')) {
    for (const target of [win, await webWindow()]) await checkFormattedText(target, {query,wait});
    console.log('Formatted text passed on native/web: evaluation, in-place formula edit, authored syntax and source save/reopen.');
    return;
  }
  if (process.argv.includes('--formula-assistant-only')) {
    for (const target of [win, await webWindow()]) await checkFormulaAssistant(target, {query,wait,capture});
    return;
  }
  if (process.argv.includes('--double-click-only')) {
    for(const target of [win,await webWindow()]) await checkDoubleClick(target,{query,wait,capture});
    return;
  }
  if (process.argv.includes('--rail-motion-only')) {
    for (const target of [win, await webWindow()]) await checkRailMotion(target, {query,wait,capture});
    return;
  }
  if (process.argv.includes('--sheet-tooltip-only')) {
    for (const target of [win, await webWindow()]) await checkSheetTooltip(target, {query,wait,capture});
    return;
  }
  if (process.argv.includes('--row-format-only')) {
    for (const target of [win, await webWindow()]) await checkRowFormatting(target,{query,wait,capture});
    return;
  }
  if (process.argv.includes('--notes-only')) {
    for (const target of [win, await webWindow()]) await checkNotes(target, {query,wait,capture});
    return;
  }
  if (process.argv.includes('--compatibility-only')) {
    await checkCompatibilityImport(win, await webWindow());
    return;
  }
  if (process.argv.includes('--readable-only')) {
    await checkReadableFormulaImport(win, await webWindow());
    return;
  }
  if (process.argv.includes('--headers-only')) {
    await checkHeaders(win, await webWindow());
    return;
  }
  if (process.argv.includes('--note-import-only')) {
    const web=await webWindow();
    await checkNoteImport(win, web);
    await checkNoteEligibility(win, web);
    return;
  }
  await checkImportFocus(win);
  assert.equal(await query(win, `document.querySelectorAll('[aria-label="Export a copy"]').length`), 1);
  assert.equal(await query(win, `!!document.querySelector('[aria-label="Import spreadsheet"]')`), false);
  await wait(win, `document.querySelector('.ag-center-cols-container .ag-cell')`);
  await query(win, `document.querySelector('.ag-center-cols-container .ag-cell').click()`);
  await exportReview(win, 'csv');
  const beforeCsv = saveRequests;
  await wait(win, `document.querySelector('[aria-label="Conversion notes"]')`);
  assert.equal(saveRequests, beforeCsv, 'Notes appear automatically, before the single Export confirmation');
  await click(win, 'Export'); // cancel save panel
  await wait(win, `!document.querySelector('[aria-busy="true"]')`);
  assert.equal(await query(win, `!!document.querySelector('[aria-label="Conversion review"]')`), false);
  outputPath = path.join(directory, 'export.csv'); await click(win, 'Export');
  await wait(win, `!document.querySelector('[role="dialog"]')`);
  assert.equal((await readFile(outputPath, 'utf8')).replace(/^\ufeff/, ''), '2,3,6\r\n');
  assert.equal(entry.record.filename, backing);
  assert.equal(await readFile(backing, 'utf8'), source);

  await exportReview(win, 'csv');
  await query(win, `document.querySelector('[aria-label="Sheet"]').click()`);
  await wait(win, `document.querySelector('[role="menuitemradio"]')`);
  await query(win, `[...document.querySelectorAll('[role="menuitemradio"]')].find(b => b.textContent.trim() === 'Unsafe').click()`);
  await wait(win, `document.querySelector('.interchange-diagnostics [data-severity="error"]') && !document.querySelector('[aria-busy="true"]')`);
  assert.equal(await query(win, `${buttonExpression('Export')}.disabled`), true, 'Blocking errors disable Export');
  assert.equal(await query(win, `document.querySelector('[aria-label="Allow formula-like text"]').tagName`),'BUTTON');
  assert.equal(await query(win, `document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length`),0);
  await assertStableExportToggle(win,'Allow formula-like text',true,false);
  await capture(win,'desktop-csv-risk-choice');
  await query(win, `document.querySelector('[aria-label="Allow formula-like text"]').click()`);
  await wait(win, `document.querySelector('.interchange-body').getAttribute('aria-busy')==='false'`);
  assert.equal(await query(win, `${buttonExpression('Export')}.disabled`),true);
  const beforeErrorCsv = saveRequests;
  await query(win, `document.querySelector('[aria-label="Sheet"]').click()`);
  await wait(win, `document.querySelector('[role="menuitemradio"]')`);
  await query(win, `[...document.querySelectorAll('[role="menuitemradio"]')].find(b => b.textContent.trim() === 'Errors').click()`);
  await wait(win, `!${buttonExpression('Export')}.disabled && document.querySelector('.interchange-diagnostics')?.textContent.includes('Cell errors are kept as text.')`);
  assert.equal(await query(win, `!!document.querySelector('.interchange-error')`), false, 'Changing sheet clears stale blocking errors');
  assert.equal(saveRequests, beforeErrorCsv, 'Analysis must never open a save panel');
  await capture(win, 'desktop-csv-errors-as-text');
  outputPath = path.join(directory, 'errors.csv'); await click(win, 'Export');
  await wait(win, `!document.querySelector('[role="dialog"]')`);
  assert.equal(saveRequests, beforeErrorCsv + 1, 'One Export click saves the prepared file');
  assert.equal((await readFile(outputPath, 'utf8')).replace(/^\ufeff/, ''), 'Type Error,4,42\r\n');
  outputPath = path.join(directory, 'export.xlsx');
  const beforeExcel = saveRequests;
  await exportReview(win, 'xlsx');
  await wait(win, `document.querySelector('[aria-label="Conversion notes"]')`);
  assert.equal(saveRequests, beforeExcel, 'Excel cannot start saving before confirmation');
  assert.equal(await query(win, `!!document.querySelector('[aria-label="Freeze headers"]')`), false, 'Headerless exports have no freezing choice');
  assert.notEqual(await query(win, `document.activeElement?.getAttribute('aria-label')`), 'Freeze headers', 'The option is not automatically focused');
  assert.equal(await query(win, `document.querySelector('[role="dialog"] h2').textContent`), 'Export Excel');
  assert.equal(await query(win, `document.querySelector('.excel-export-filename').textContent`), 'source.xlsx');
  assert.equal(await query(win, `document.querySelector('.excel-export-sheet-count').textContent`), '4 sheets');
  assert.equal(await query(win, `document.querySelector('[aria-label="Keep unsupported formula results"]').getAttribute('aria-pressed')`), 'true');
  assert.match(await query(win, `document.querySelector('[aria-label="Conversion notes"]').textContent`), /Formulas converted to values/);
  await assertStableExportToggle(win, 'Keep unsupported formula results', false, false);
  assert.doesNotMatch(await query(win, `document.querySelector('[aria-label="Conversion notes"]').textContent`), /Formulas converted to values/);
  await assertStableExportToggle(win, 'Keep unsupported formula results', true, false);
  assert.equal(await query(win, `document.querySelector('[role="dialog"]').textContent.includes('Export a copy')`), false);
  const warningScroll = await query(win, `(() => {
    const list=document.querySelector('.interchange-export-notes'), body=document.querySelector('.interchange-body');
    const before=body.getBoundingClientRect().y; list.scrollTop=list.scrollHeight;
    return { overflow:getComputedStyle(list).overflowY, scroll:list.scrollTop, bodyScroll:body.scrollTop,
      stationary:body.getBoundingClientRect().y===before, keyboardReachable:list.tabIndex===0 };
  })()`);
  assert.equal(warningScroll.overflow, 'auto');
  assert.equal(warningScroll.bodyScroll, 0);
  assert.equal(warningScroll.stationary, true);
  assert.equal(warningScroll.keyboardReachable, true);
  await assert.rejects(access(outputPath), {code:'ENOENT'});
  assert.match(await query(win, `document.querySelector('[aria-label="Conversion notes"]').textContent`), /Cell left blank/);
  assert.equal(await query(win, `document.querySelectorAll('.interchange-diagnostics details').length`), 0, 'Warnings use a simple list');
  assert.ok(await query(win, `!!document.querySelector('.interchange-diagnostic-label[data-loss="true"]')`), 'Omissions have a distinct label');
  await capture(win, 'desktop-export-warning-review');
  await click(win, 'Cancel');
  assert.equal(saveRequests, beforeExcel, 'Cancelling review never saves');
  await exportReview(win, 'xlsx');
  await wait(win, `document.querySelector('[aria-label="Conversion notes"]')`);
  await click(win, 'Export');
  await wait(win, `!document.querySelector('[role="dialog"]')`);
  assert.equal(saveRequests, beforeExcel + 1);
  assert.equal((await readFile(outputPath)).subarray(0, 2).toString(), 'PK');
  const savedWorkbook = new ExcelJS.Workbook();
  await savedWorkbook.xlsx.load(await readFile(outputPath));
  assert.equal(savedWorkbook.getWorksheet('Errors').getCell('A1').value, null, 'Actual errors remain blank, not substituted');
  assert.equal(savedWorkbook.getWorksheet('Errors').getCell('B1').value, 4, 'Valid unsupported formulas export fresh static values');
  assert.equal(savedWorkbook.getWorksheet('Data').getCell('C1').formula, 'A1*B1', 'Supported formulas remain editable');
  inputPath = outputPath; await importReview(win);
  await query(win, `document.querySelector('[aria-label="Preview sheet"]').click()`);
  await wait(win, `document.querySelector('[role="menuitemradio"]')`);
  assert.equal(await query(win, `document.querySelectorAll('[role="menuitemradio"]').length`), 4, 'Excel export preserves every sheet');
  await query(win, `document.querySelector('[role="menuitemradio"][aria-checked="true"]').click()`);
  await click(win, 'Open in new tab'); await wait(win, `!document.querySelector('[role="dialog"]')`);
  assert.equal(imported.length, 1); assert.equal(imported[0].record.filename, null);
  assert.equal(imported[0].record.draftName, 'export');
  await query(imported[0].win, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(imported[0].win.getTitle(), 'export', 'Native window title uses the import name');
  const importReloaded = new Promise(resolve => imported[0].win.webContents.once('did-finish-load', resolve));
  imported[0].win.reload();
  await importReloaded;
  await wait(imported[0].win, `document.documentElement.dataset.startup === 'ready'`);
  assert.equal((await query(imported[0].win, `window.ordinateDesktop.restoreDocument()`)).draftName, 'export');
  outputPath = null;
  const beforeFirstSave = saveRequests;
  imported[0].win.webContents.send('editor:command', 'save');
  const saveDeadline = Date.now() + 15000;
  while (saveRequests === beforeFirstSave && Date.now() < saveDeadline) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(saveSuggestion, 'export.ord', 'First native save suggests the imported filename');
  assert.equal(imported[0].record.filename, null, 'Cancelling first Save leaves the named import unbacked');
  assert.equal(await query(imported[0].win, `document.querySelectorAll('[role="tab"]').length`), 4);
  assert.equal(await readFile(backing, 'utf8'), source);

  // Error/cancel cannot replace either document or create another tab.
  inputPath = path.join(directory, 'broken.xlsx'); await writeFile(inputPath, 'Not a workbook');
  win.webContents.send('editor:command', 'import'); await click(win, 'Choose file…');
  await wait(win, `document.querySelector('.interchange-filename')`);
  await wait(win, `document.querySelector('[role="alert"]')`);
  assert.equal(await query(win, `!!document.querySelector('[aria-label="Conversion review"]')`), false);
  await click(win, 'Cancel'); assert.equal(imported.length, 1);
  outputPath = backing; await exportReview(win, 'ord');
  await wait(win, `document.querySelector('[role="alert"]')?.textContent.includes('cannot overwrite')`);
  assert.equal(await readFile(backing, 'utf8'), source); await click(win, 'Cancel');

  await checkDroppedImports(win, path.join(directory, 'export.xlsx'));
  const droppedOrd = path.join(directory, 'dropped.ord');
  await writeFile(droppedOrd, '# Dropped native\n| 123 |');
  // Real filesystem-backed Chromium File exercises webUtils + the isolated preload.
  win.webContents.debugger.attach('1.3');
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
        type, x:200, y:200, data:{items:[], files:[droppedOrd], dragOperationsMask:1},
      });
    }
    await wait(win, `!document.querySelector('[role="dialog"]')`);
    const deadline = Date.now() + 15000;
    while (!opened.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(opened.length, 1, 'ORD drop opens one new native document');
    assert.equal(opened[0].record.filename, droppedOrd);
    await wait(opened[0].win, `document.querySelector('[role="tab"]')?.textContent.trim() === 'Dropped native'`);
    assert.equal(entry.record.filename, backing, 'Original tab stays associated with its own file');
    assert.equal(await readFile(backing, 'utf8'), source);
  } finally { win.webContents.debugger.detach(); }

  // Web-host branch: no preload/desktop bridge. Own origin/profile prevents
  // these test imports and local drafts from touching the user's browser.
  const web = await webWindow();
  let webDownloads = 0;
  const recordDownload = (_event, item) => { webDownloads++; item.setSavePath(path.join(directory, 'web-confirmed.xlsx')); };
  web.webContents.session.on('will-download', recordDownload);
  await exportReview(web, 'xlsx');
  await wait(web, `document.querySelector('[aria-label="Conversion notes"]') && !document.querySelector('[aria-busy="true"]')`);
  assert.equal(webDownloads, 0, 'Web warning review must precede download');
  assert.equal(await query(web, `document.querySelector('[aria-label="Freeze headers"]')?.getAttribute('aria-pressed')`), 'false', 'Freezing starts off');
  assert.notEqual(await query(web, `document.activeElement?.getAttribute('aria-label')`), 'Freeze headers');
  assert.ok(await query(web, `(() => {
    const list=document.querySelector('.interchange-export-notes'), option=document.querySelector('[aria-label="Freeze headers"]');
    const before=option.getBoundingClientRect().y; list.scrollTop=list.scrollHeight;
    return list.scrollTop>0 && document.querySelector('.interchange-body').scrollTop===0 && option.getBoundingClientRect().y===before;
  })()`), 'Warnings scroll independently without moving the settings');
  await assertStableFreezeToggle(web, true);
  await assertStableFreezeToggle(web, false);
  await assertStableExportToggle(web, 'Keep unsupported formula results', false, false);
  await assertStableExportToggle(web, 'Keep unsupported formula results', true, false);
  await capture(web, 'web-warning-review-mobile');
  await click(web, 'Cancel');
  assert.equal(webDownloads, 0, 'Cancelling web warning review must not download');
  await exportReview(web, 'xlsx');
  await wait(web, `document.querySelector('[aria-label="Conversion notes"]') && !document.querySelector('[aria-busy="true"]')`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Confirmed web export did not download')), 15000);
    web.webContents.session.once('will-download', (_event, item) => item.once('done', (_event, state) => {
      clearTimeout(timer); if (state === 'completed') resolve(); else reject(new Error(state));
    }));
    void click(web, 'Export').catch(reject);
  });
  assert.equal(webDownloads, 1);
  await wait(web, `!document.querySelector('[role="dialog"]')`);
  await query(web, `document.querySelector('[aria-label="Open file"]').click()`);
  await click(web, 'Import spreadsheet….csv, .tsv, .xlsx · convert to a new document');
  // Provide a real File through the file input's standard change event.
  await query(web, `(() => {
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function() {
      if (this.type !== 'file') return click.call(this);
      HTMLInputElement.prototype.click = click;
      const transfer = new DataTransfer(); transfer.items.add(new File(['0012,hello\\n42,world'], 'web.csv', {type:'text/csv'}));
      this.files = transfer.files; this.dispatchEvent(new Event('change', {bubbles:true}));
    };
  })()`);
  await click(web, 'Choose file…'); await wait(web, `document.querySelector('.interchange-filename')`);
  await wait(web, `document.querySelector('[aria-label="Conversion review"]')`);
  await capture(web, 'web-import-mobile');
  const bounds = await query(web, `(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}; })()`);
  assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height, 'Mobile review fits the viewport');
  await click(web, 'Replace & import'); await wait(web, `!document.querySelector('[role="dialog"]')`);
  await wait(web, `document.querySelector('.app-title-name')?.textContent === 'web'`);
  await wait(web, `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() === 'Imported'`);
  assert.ok(await query(web, `[...document.querySelectorAll('[role="gridcell"]')].some(c=>c.textContent === '0012')`));
  // Headerless, warning-free Excel exports use the same explicit confirmation
  // as headed/lossy workbooks. Opening the dialog must never start a download.
  const beforePlainExcel = webDownloads;
  await exportReview(web, 'xlsx');
  await wait(web, `${buttonExpression('Export')} && !${buttonExpression('Export')}.disabled`);
  assert.equal(await query(web, `!!document.querySelector('[aria-label="Freeze headers"]')`), false);
  assert.equal(await query(web, `!!document.querySelector('[aria-label="Conversion notes"]')`), false);
  assert.equal(webDownloads, beforePlainExcel, 'Clean Excel exports also wait for Export');
  await capture(web, 'web-excel-clean-confirmation');
  await click(web, 'Cancel');
  assert.equal(webDownloads, beforePlainExcel, 'Cancelling a clean confirmation never downloads');
  web.webContents.session.removeListener('will-download', recordDownload);
  await exportReview(web, 'tsv'); await capture(web, 'web-export-mobile');
  // Observe Chromium's actual download, with a test-owned destination.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser download did not finish')), 15000);
    web.webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(path.join(directory, 'web.tsv'));
      item.once('done', (_event, state) => {
        clearTimeout(timer);
        if (state === 'completed') resolve(); else reject(new Error(state));
      });
    });
    void click(web, 'Export').catch(error => { clearTimeout(timer); reject(error); });
  });
  assert.match(await readFile(path.join(directory, 'web.tsv'), 'utf8'), /0012\thello/);
  await wait(web, `!document.querySelector('[role="dialog"]') || document.querySelector('[role="status"]')?.textContent.startsWith('Download started:')`);
  if (await query(web, `!!document.querySelector('[role="dialog"]')`)) await click(web, 'Done');
  await query(web, `document.documentElement.dataset.theme = 'light'`); await exportReview(web, 'csv'); await capture(web, 'web-export-light'); await click(web, 'Cancel');
  await checkDroppedImports(web, path.join(directory, 'export.xlsx'));
  await dropFiles(web, [textFile('bad.pdf', 'data')]);
  await wait(web, `document.querySelector('[role="dialog"]')?.textContent.includes('Could not open file')`);
  await click(web, 'OK');
  await dropFiles(web, [textFile('a.csv', '1'), textFile('b.csv', '2')]);
  await wait(web, `document.querySelector('[role="dialog"]')?.textContent.includes('Drop one file at a time')`);
  await click(web, 'OK');
  await dropFiles(web, [textFile('browser.ord', '# Dropped web\n| 987 |')]);
  await wait(web, `document.querySelector('[role="dialog"]')?.textContent.includes('Unsaved changes')`);
  await click(web, 'Cancel');
  assert.equal(await query(web, `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim()`), 'Imported');
  await dropFiles(web, [textFile('browser.ord', '# Dropped web\n| 987 |')]);
  await click(web, 'Open File');
  await wait(web, `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() === 'Dropped web'`);
  await capture(web, 'web-dropped-ord');
  assert.equal(web.webContents.getURL(), 'ordinate-test://web/', 'ORD drop preserves the application page');
  if (!process.argv.includes('--export-only')) {
    await checkHeaders(win, web);
    await checkNativeDateImport(win, web);
    await checkReadableFormulaImport(win, web);
  }
  console.log('File drop passed: native ORD file identity/new tab, web ORD unsaved confirmation, CSV/TSV/XLSX import reviews on both hosts, modal protection and invalid/multiple file errors.');
  console.log('Interchange smoke passed: production CSV/XLSX/ORD exports, cancel, current-file protection, XLSX import in new native tab, malformed import, web CSV import, text preservation, mobile layout, and real browser TSV download.');
}

async function checkNoteImport(native, web) {
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Note import');
  sheet.addRows([['Project overview'],['Name','Value'],['One',5],['Two',{formula:'B3*2',result:10}],['Footnote with *literal* text\n\n'+Array.from({length:20},(_,i)=>`Disclosure ${i+1}: A longer explanation to check the compact import note picker and the scrolling full preview.`).join('\n\n')]]);
  sheet.mergeCells('A1:B1');sheet.getCell('A1').font={bold:true};
  const other=book.addWorksheet('Other notes');other.addRows([['Other introduction'],['Metric','Value'],['Total',7]]);other.mergeCells('A1:B1');
  const file={name:'note-confirmation.xlsx',bytes:Array.from(new Uint8Array(await book.xlsx.writeBuffer()))};
  for(const [host,parent] of [['native',native],['web',web]]) {
    parent.show();parent.focus();await dropFiles(parent,[file]);
    await wait(parent,`document.querySelectorAll('.import-note-choice').length===2`);
    await wait(parent,`document.getAnimations().every(animation=>animation.playState==='finished')`);
    assert.equal(await query(parent,`document.querySelectorAll('.import-note-select[aria-pressed="true"]').length`),2);
    const initialBounds=await query(parent,`(()=>{const r=document.querySelector('.import-preview-stage').getBoundingClientRect();return {y:r.y,height:r.height};})()`);
    await query(parent,`document.querySelector('[aria-label="Preview note after table"]').click()`);
    await wait(parent,`document.querySelector('.import-note-reader')`);
    assert.equal(await query(parent,`document.querySelectorAll('.import-note-select[aria-pressed="true"]').length`),2,'Reading a note does not change extraction');
    assert.equal(await query(parent,`document.querySelector('.import-note-reader-content').textContent.includes('Disclosure 20')`),true);
    const readerBounds=await query(parent,`(()=>{const r=document.querySelector('.import-preview-stage').getBoundingClientRect();return {y:r.y,height:r.height};})()`);
    assert.ok(Math.abs(readerBounds.y-initialBounds.y)<.5&&Math.abs(readerBounds.height-initialBounds.height)<.5,'Full note preview does not move or resize the table region');
    await capture(parent,host+'-note-full-preview');
    parent.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});parent.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await wait(parent,`!document.querySelector('.import-note-reader') && document.activeElement?.getAttribute('aria-label')==='Preview note after table'`);
    assert.ok(await query(parent,`!!document.querySelector('[role="dialog"]')`),'Escape only closes the note reader');
    await query(parent,`document.querySelector('[aria-label="Preview note before table"]').click()`);
    await wait(parent,`document.querySelector('.import-note-reader')`);
    await click(parent,'Back to table');
    await wait(parent,`!document.querySelector('.import-note-reader') && document.activeElement?.getAttribute('aria-label')==='Preview note before table'`);
    for(let i=0;i<2;i++){
      await query(parent,`document.querySelectorAll('.import-note-choice .import-note-select')[${i}].click()`);
      await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false'`);
    }
    assert.equal(await query(parent,`document.querySelectorAll('.import-preview-grid tbody tr').length`),5);
    assert.equal(await query(parent,`document.querySelectorAll('.import-note-select[aria-pressed="true"]').length`),0);
    for(let i=0;i<2;i++){
      await query(parent,`document.querySelectorAll('.import-note-select')[${i}].click()`);
      await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false'`);
    }
    await query(parent,`document.querySelector('[aria-label="Preview sheet"]').click()`);
    await query(parent,`[...document.querySelectorAll('[role="menuitemradio"]')].find(el=>el.textContent==='Other notes').click()`);
    assert.equal(await query(parent,`document.querySelectorAll('.import-note-select[aria-pressed="true"]').length`),1);
    await query(parent,`document.querySelector('[aria-label="Preview note before table"]').click()`);
    await wait(parent,`document.querySelector('.import-note-reader-content')?.textContent.includes('Other introduction')`);
    await query(parent,`document.querySelector('[aria-label="Preview sheet"]').click()`);
    await query(parent,`[...document.querySelectorAll('[role="menuitemradio"]')].find(el=>el.textContent==='Note import').click()`);
    await wait(parent,`!document.querySelector('.import-note-reader') && document.querySelectorAll('.import-note-select[aria-pressed="true"]').length===2`);
    await query(parent,`document.querySelector('.import-note-select').focus()`);
    parent.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});parent.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
    await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false' && document.querySelector('.import-note-select').getAttribute('aria-pressed')==='false'`);
    await query(parent,`document.querySelector('.import-note-select').click()`);
    await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false' && document.querySelectorAll('.import-preview-grid tbody tr').length===3`);
    await query(parent,`document.documentElement.dataset.theme='${host==='web'?'dark':'light'}';document.querySelector('.interchange-body').scrollTop=0`);
    assert.ok(await query(parent,`(()=>{const choices=document.querySelector('.import-note-choices').getBoundingClientRect(), table=document.querySelector('.import-preview-grid').getBoundingClientRect(), body=document.querySelector('.interchange-body').getBoundingClientRect();return choices.height<130&&Math.min(body.bottom,table.bottom)-Math.max(body.top,table.top)>80;})()`),'Long notes remain compact and leave table rows visible');
    for (const theme of ['light','dark']) {
      await query(parent,`document.documentElement.dataset.theme='${theme}'`);
      assert.ok(await query(parent,`[...document.querySelectorAll('.import-note-select')].every(button => {
        const box=button.getBoundingClientRect();
        return box.width>=44 && box.height>=44 && box.left>=0 && box.right<=innerWidth;
      })`),'Both note options remain large, visible click targets');
      await capture(parent,host+'-note-import-confirmation-'+theme);
    }
    await click(parent,host==='native'?'Open in new tab':'Replace & import');
    await wait(parent,`!document.querySelector('[role="dialog"]')`);
    const target=host==='native'?imported.at(-1).win:parent;
    await wait(target,`document.querySelector('.sheet-note-slot--beforeTable')?.textContent.includes('Project overview')`);
    assert.equal(await query(target,`getComputedStyle(document.querySelector('.sheet-note')).borderTopWidth`),'0px');
    await query(target,`document.querySelector('.source-button').click()`);
    await wait(target,`document.querySelector('.source-shell textarea')`);
    const source=await query(target,`document.querySelector('.source-shell textarea').value`);
    assert.match(source,/\*\*Project overview\*\*/);assert.match(source,/B2 \* 2/);
    assert.match(source,/Footnote with/);
    await query(target,`document.querySelector('.source-button').click()`);
    await capture(target,host+'-imported-borderless-notes');
  }
  console.log('Note import passed: default-selected source ranges on every sheet, click/keyboard deselection, worker reconfiguration, reference rebasing and escaped note text on native/web.');
}

async function checkNoteEligibility(native, web) {
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Note eligibility');
  sheet.addRows([['Referenced heading'],['Metric','Value'],['Total',12],['Source: Example'],[''],['Notes:'],['  '],['Complete footer']]);
  book.addWorksheet('Contents').getCell('A1').value={formula:"'Note eligibility'!A1",result:'Referenced heading'};
  const file={name:'note-eligibility.xlsx',bytes:Array.from(new Uint8Array(await book.xlsx.writeBuffer()))};
  for(const [host,parent] of [['native',native],['web',web]]) {
    parent.show();parent.focus();await dropFiles(parent,[file]);
    await wait(parent,`document.querySelector('.import-note-reason')`);
    assert.equal(await query(parent,`document.querySelector('.import-note-select[aria-label="Note before table"]').disabled`),true);
    assert.equal(await query(parent,`document.querySelector('.import-note-select[aria-label="Note after table"]').disabled`),false);
    assert.match(await query(parent,`document.querySelector('.import-note-reason').textContent`),/'Contents'!A1/);
    await query(parent,`document.querySelector('.import-note-select[aria-label="Note before table"]').click()`);
    assert.equal(await query(parent,`document.querySelector('.import-note-select[aria-label="Note before table"]').getAttribute('aria-pressed')`),'false');
    await query(parent,`document.querySelector('[aria-label="Preview note before table"]').click()`);
    await wait(parent,`document.querySelector('.import-note-reader-content')?.textContent.includes('Referenced heading')`);
    await click(parent,'Back to table');
    await query(parent,`document.querySelector('[aria-label="Preview note after table"]').click()`);
    await wait(parent,`document.querySelector('.import-note-reader-content')?.textContent.includes('Complete footer')`);
    assert.match(await query(parent,`document.querySelector('.import-note-reader-content').textContent`),/Source: Example.*Notes:.*Complete footer/);
    await click(parent,'Back to table');
    assert.equal(await query(parent,`document.querySelector('.import-note-select[aria-label="Note after table"]').getAttribute('aria-pressed')`),'true');
    await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false' && document.querySelectorAll('.import-preview-grid tbody tr').length===3`);
    await capture(parent,host+'-note-import-restriction');
    await click(parent,host==='native'?'Open in new tab':'Replace & import');
    await wait(parent,`!document.querySelector('[role="dialog"]')`);
    const target=host==='native'?imported.at(-1).win:parent;
    await wait(target,`document.querySelector('.sheet-note-slot--afterTable')?.textContent.includes('Complete footer')`);
    assert.ok(await query(target,`document.querySelector('.sheet-note-slot--afterTable').textContent.includes('Source: Example')`));
  }
  console.log('Note eligibility passed: referenced heading disabled with explanation, preview retained, full footer selected and imported on native/web.');
}

async function checkHeaders(native, web) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Possible headers');
  sheet.addRows([['Item', 'Amount', 'Year'], ['Sales', 12, 2025], ['Cost', 4, 2025], ['Net',8,2025]]);
  sheet.getCell('C2').value={formula:'B2*2'};
  for(const r of [2,3,4]) {sheet.getCell(`B${r}`).numFmt='0.00';sheet.getCell(`B${r}`).alignment={horizontal:'right'};}
  sheet.getRow(1).font = {bold:true};
  workbook.addWorksheet('Other').getCell('A1').value = 42;
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const file = {name:'headers.xlsx', bytes:Array.from(bytes)};
  for(const [host,parent] of [['native',native],['web',web]]) {
    parent.show();parent.focus();
    await dropFiles(parent,[file]);
    await wait(parent,`document.querySelector('[aria-label="Import preview"]')`);
    const setCount=async (axis,value)=>{
      await query(parent,`(()=>{const input=document.querySelectorAll('.import-preview-controls input')[${axis}];input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await query(parent,`document.querySelectorAll('.import-preview-controls input')[${axis}].blur()`);
      await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false'`);
    };
    assert.deepEqual(await query(parent,`[...document.querySelectorAll('.import-preview-controls input')].map(input=>input.value)`),['0','0']);
    assert.equal(await query(parent,`document.querySelector('[aria-label="Decrease header rows"]').disabled`),true);
    const step=async (direction,axis)=>{
      await query(parent,`document.querySelector('[aria-label="${direction} header ${axis}"]').click()`);
      await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false'`);
    };
    await step('Increase','rows');
    await wait(parent,`document.querySelectorAll('.import-preview-grid td[data-header="true"]').length===3`);
    await step('Decrease','rows');
    await wait(parent,`document.querySelectorAll('.import-preview-grid td[data-header="true"]').length===0`);
    assert.ok(await query(parent,`[...document.querySelectorAll('.import-preview-controls .integer-stepper-button')].every(button=>{const r=button.getBoundingClientRect();return r.width>=32&&r.height>=32;})`),'Stepper buttons have usable hit areas');
    await query(parent,`document.querySelector('.import-preview-controls input').focus()`);
    parent.webContents.sendInputEvent({type:'keyDown',keyCode:'Up'});
    parent.webContents.sendInputEvent({type:'keyUp',keyCode:'Up'});
    await wait(parent,`document.querySelector('.import-preview-controls input').value==='1'`);
    parent.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
    parent.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false' && document.querySelectorAll('.import-preview-grid td[data-header="true"]').length===3`);
    await setCount(0,1.5);
    assert.equal(await query(parent,`document.querySelector('.import-preview-controls input').value`),'1');
    assert.ok(await query(parent,`document.querySelector('.integer-stepper-error').textContent.includes('whole number')`));
    await query(parent,`(()=>{const input=document.querySelector('.import-preview-controls input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'12');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await query(parent,`document.querySelectorAll('.import-preview-grid td[data-header="true"]').length`),3,'Draft typing does not reconfigure before commit');
    parent.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    parent.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await wait(parent,`document.querySelector('.import-preview-controls input')?.value==='1' && !document.querySelector('.integer-stepper-error')`);
    await query(parent,`(()=>{const input=document.querySelector('.import-preview-controls input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const minusPoint=await query(parent,`(()=>{const r=document.querySelector('[aria-label="Decrease header rows"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    parent.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...minusPoint});
    parent.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...minusPoint});
    await wait(parent,`document.querySelector('.import-preview-controls input').value==='1'`);
    assert.equal(await query(parent,`!!document.querySelector('.interchange-error')`),false,'Pointer stepping commits the draft once, without first submitting the unstepped value');
    await setCount(0,2);
    await wait(parent,`document.querySelector('.interchange-error')?.textContent.includes('Headers cannot contain formulas')`);
    assert.equal(await query(parent,`document.querySelector('.app-modal-actions .primary').disabled`),true);
    await setCount(0,1);await setCount(1,1);
    await wait(parent,`!document.querySelector('.interchange-error') && document.querySelectorAll('.import-preview-grid td[data-header="true"]').length===6`);
    await step('Increase','columns');
    assert.equal(await query(parent,`document.querySelector('[aria-label="Increase header columns"]').disabled`),true);
    await step('Decrease','columns');
    await query(parent,`document.querySelector('[aria-label="Preview sheet"]').click()`);
    await query(parent,`[...document.querySelectorAll('[role="menuitemradio"]')].find(el=>el.textContent==='Other').click()`);
    await wait(parent,`document.querySelector('.import-preview-controls input').value==='0'`);
    assert.ok(await query(parent,`[...document.querySelectorAll('.integer-stepper-button')].every(button=>button.disabled)`),'Single-cell sheet allows no header rows or columns');
    await query(parent,`document.querySelector('[aria-label="Preview sheet"]').click()`);
    await query(parent,`[...document.querySelectorAll('[role="menuitemradio"]')].find(el=>el.textContent==='Possible headers').click()`);
    await wait(parent,`document.querySelector('.import-preview-controls input').value==='1'`);
    await query(parent,`document.documentElement.dataset.theme='${host==='web'?'dark':'light'}'`);
    await capture(parent,host+'-header-import-preview');
    const bounds=await query(parent,`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height,'Preview fits the viewport');
    await click(parent,host==='native'?'Open in new tab':'Replace & import');
    await wait(parent,`!document.querySelector('[role="dialog"]')`);
    const target=host==='native'?imported.at(-1).win:parent;
    target.show();target.focus();
    await query(target,`document.querySelector('.source-button').click()`);
    await wait(target,`document.querySelector('.source-shell textarea')`);
    const source=await query(target,`document.querySelector('.source-shell textarea').value`);
    assert.ok(source.includes('@display'));
    assert.equal((source.match(/\{:\.2f\}/g)||[]).length,1,'Repeated precision is a column default');
    assert.ok(source.includes('B2 * 2'),'Header choice preserves A1 formula coordinates');
    await query(target,`document.querySelector('.source-button').click()`);
    await query(target,`document.querySelector('[aria-label="Sheet setup"]').click()`);
    await wait(target,`document.querySelector('#sheet-setup-header-rows')?.value==='1' && document.querySelector('#sheet-setup-header-columns')?.value==='1'`);
    await query(target,`(()=>{const input=document.querySelector('#sheet-setup-header-rows');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'4');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await query(target,`document.querySelector('#sheet-setup-header-rows').blur()`);
    await wait(target,`document.querySelector('.integer-stepper-error')`);
    assert.equal(await query(target,`document.querySelector('#sheet-setup-header-rows').value`),'1','Rejected header conversion preserves the previous value');
    assert.equal(await query(target,`!!document.querySelector('.import-header-coach')`),false);
    await query(target,`document.querySelector('[aria-label="Sheet setup"]').click()`);
  }
  const explicit = new ExcelJS.Workbook();
  explicit.addWorksheet('Table').addTable({name:'Items',ref:'A1',headerRow:true,columns:[{name:'Item'},{name:'Amount'}],rows:[['Sales',12]]});
  await dropFiles(web, [{name:'table.xlsx',bytes:Array.from(new Uint8Array(await explicit.xlsx.writeBuffer()))}]);
  await wait(web, `document.querySelector('[aria-label="Conversion review"]')`);
  await click(web, 'Replace & import'); await wait(web, `!document.querySelector('[role="dialog"]')`);
  assert.equal(await query(web, `!!document.querySelector('.import-header-coach')`), false, 'Explicit header does not prompt');
  await query(web, `document.querySelector('[aria-label="Sheet setup"]').click()`);
  await wait(web, `document.querySelector('#sheet-setup-header-rows')?.value === '1'`);
  await query(web, `document.querySelector('[aria-label="Sheet setup"]').click()`);
  console.log('Header import passed: native/web preview, invalid header protection, per-sheet settings, explicit Table adoption, compact formats and narrow dark-mode layout.');
}

async function checkCompatibilityImport(native, web) {
  const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('Data');
  sheet.addRows([['Description','Value'],['Date',null],['Next date',null]]);
  sheet.getCell('B2').value={formula:'TODAY()',result:99999};
  sheet.getCell('B3').value={formula:'TODAY()+1',result:100000};
  const parts=unzipSync(new Uint8Array(await book.xlsx.writeBuffer()));
  parts['xl/vbaProject.bin']=new Uint8Array([1,2,3]);
  parts['[Content_Types].xml']=strToU8(strFromU8(parts['[Content_Types].xml']).replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml','application/vnd.ms-excel.sheet.macroEnabled.main+xml'));
  parts['xl/worksheets/_rels/sheet1.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="linked" Type="urn:example/linkedContent" Target="https://example.invalid/private" TargetMode="External"/></Relationships>');
  const file={name:'compatibility.xlsx',bytes:Array.from(zipSync(parts))};
  for(const [host,parent] of [['native',native],['web',web]]) {
    const action='Acknowledge and continue';
    await dropFiles(parent,[file]);
    await wait(parent,`document.querySelector('[aria-label="Conversion review"]')`);
    assert.equal(await query(parent,`${buttonExpression(action)}.disabled`),false);
    const initial=imported.length;
    assert.equal(await query(parent,`!!document.querySelector('.interchange-checkbox input')`),false);
    assert.equal(imported.length,initial);
    const notes=await query(parent,`[...document.querySelectorAll('.interchange-diagnostics > li')].map(li=>li.textContent)`);
    assert.equal(notes.length,3);
    assert.ok(notes.some(text=>text.includes('Macros, embedded objects')));
    assert.ok(notes.some(text=>text.includes('External connections and linked content')));
    // Revised settings still need an explicit final acknowledgement, not a
    // separate checkbox whose consent can accidentally survive reconfiguration.
    await query(parent,`document.querySelector('[aria-label="Increase header rows"]').click()`);
    await wait(parent,`document.querySelector('.interchange-body').getAttribute('aria-busy')==='false'`);
    assert.equal(await query(parent,`${buttonExpression(action)}.disabled`),false);
    await capture(parent,host+'-compatibility-import-confirmation');
    await click(parent,'Cancel');await wait(parent,`!document.querySelector('[role="dialog"]')`);
    assert.equal(imported.length,initial);
    await dropFiles(parent,[file]);
    await wait(parent,`${buttonExpression(action)} && !${buttonExpression(action)}.disabled`);
    assert.equal(await query(parent,`!!document.querySelector('.interchange-checkbox input')`),false);
    await click(parent,action);await wait(parent,`!document.querySelector('[role="dialog"]')`);
    const target=host==='native'?imported.at(-1).win:parent;
    await query(target,`document.querySelector('.source-button').click()`);
    await wait(target,`document.querySelector('.source-shell textarea')`);
    const source=await query(target,`document.querySelector('.source-shell textarea').value`);
    assert.ok(source.includes('"=TODAY()"'));assert.ok(source.includes('"=TODAY()+1"'));
    assert.ok(!source.includes('99999'));assert.ok(!source.includes('100000'));
  }
  console.log('Compatibility import passed on native/web: single acknowledgement action, no checkbox, settings reconfiguration, cancel/reopen, and exact inert formula text.');
}

async function checkReadableFormulaImport(native, web) {
  const book = new ExcelJS.Workbook(), input = book.addWorksheet('Inputs'), result = book.addWorksheet('Result');
  input.addRows([[2,3],[4,5]]);
  input.getCell('C1').value = {formula:'MIN($A1,B$1)',result:999};
  result.getCell('A1').value = {formula:'Inputs!$A$1+Inputs!B1',result:999};
  for (const sheet of book.worksheets) sheet.eachRow(row=>row.eachCell(cell=>{
    cell.font={name:'Arial',bold:true};cell.border={bottom:{style:'thin'}};
  }));
  const file={name:'readable-formulas.xlsx',bytes:Array.from(new Uint8Array(await book.xlsx.writeBuffer()))};
  for (const [host,parent] of [['native',native],['web',web]]) {
    await dropFiles(parent,[file]);
    await wait(parent,`document.querySelector('[aria-label="Conversion review"]')`);
    const notes=await query(parent,`[...document.querySelectorAll('.interchange-diagnostics > li')].map(li=>li.textContent)`);
    assert.equal(notes.length,2,'Repeated cell notes consolidate to Formatting and Formula results');
    assert.ok(notes.some(text=>text.startsWith('Formatting')));
    assert.ok(notes.some(text=>text.startsWith('Formula results') && text.includes('across 2 sheets')));
    assert.equal(await query(parent,`document.querySelectorAll('.interchange-diagnostics details,.interchange-diagnostics summary').length`),0);
    await capture(parent,host+'-consolidated-import-notes');
    await click(parent,host==='native'?'Open in new tab':'Replace & import');
    await wait(parent,`!document.querySelector('[role="dialog"]')`);
    const target=host==='native'?imported.at(-1).win:parent;
    target.show();target.focus();
    await query(target,`document.querySelector('.source-button').click()`);
    await wait(target,`document.querySelector('.source-shell textarea')`);
    const source=await query(target,`document.querySelector('.source-shell textarea').value`);
    assert.match(source,/min\(\[\$A1, B\$1\]\)/);
    assert.match(source,/@\[Inputs::\$A\$1\] \+ @\[Inputs::B1\]/);
    assert.doesNotMatch(source,/isBlank|isNumber|number\(|999/);
    await query(target,`document.querySelector('.source-button').click()`);
    await query(target,`[...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent.trim()==='Result').click()`);
    await wait(target,`document.querySelector('[role="gridcell"]')?.textContent==='5'`);
    await query(target,`(()=>{const el=document.querySelector('[role="gridcell"]');el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));el.click();})()`);
    await wait(target,`document.querySelector('[aria-label="Edit selected cell input"]')`);
    await query(target,`document.querySelector('[aria-label="Edit selected cell input"]').click()`);
    await wait(target,`document.querySelector('.formula-bar textarea')`);
    await capture(target,host+'-readable-cross-sheet-formula');
  }
  console.log('Readable import passed: consolidated flat review, A1 array/mixed locks, cross-sheet A1 and recalculation on native/web.');
}

async function checkNativeDateImport(native, web) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Dates');
  sheet.getCell('A1').value = 45837; sheet.getCell('A1').numFmt = 'mmm d, yyyy';
  const file = {name:'native-dates.xlsx',bytes:Array.from(new Uint8Array(await book.xlsx.writeBuffer()))};
  await dropFiles(native,[file]);
  await wait(native,`document.querySelector('[aria-label="Conversion review"]')`);
  await click(native,'Open in new tab'); await wait(native,`!document.querySelector('[role="dialog"]')`);
  const importedNative=imported.at(-1).win;
  await dropFiles(web,[file]);
  await wait(web,`document.querySelector('[aria-label="Conversion review"]')`);
  await click(web,'Replace & import'); await wait(web,`!document.querySelector('[role="dialog"]')`);
  for (const [host,win] of [['native',importedNative],['web',web]]) {
    win.show();win.focus();
    await wait(win,`document.querySelector('[role="gridcell"]')?.textContent==='2025-06-29'`);
    await query(win,`(() => {const el=document.querySelector('[role="gridcell"]');el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));el.click();})()`);
    await wait(win,`document.querySelector('.formula-chip')?.textContent.toLowerCase()==='date'`);
    assert.equal(await query(win,`document.querySelector('[aria-label="Edit selected cell input"]').textContent`),'2025-06-29');
    await capture(win,`${host}-native-date-value`);
    await query(win,`document.querySelector('.source-button').click()`);
    await wait(win,`document.querySelector('.source-shell textarea')`);
    const source=await query(win,`document.querySelector('.source-shell textarea').value`);
    assert.match(source,/\| 2025-06-29 \|/);
    assert.doesNotMatch(source,/45837|excel190|\{:/);
    await query(win,`document.querySelector('.source-button').click()`);
  }
  console.log('Native date import passed on both hosts: DATE chip, ISO input and plain ORD value without display metadata.');
}

async function checkInteractionPolicy(win) {
  win.show(); win.focus();
  const style = selector => query(win, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing interaction target: ' + ${JSON.stringify(selector)});
    const s = getComputedStyle(el); return {cursor:s.cursor, selection:s.userSelect};
  })()`);
  const point = selector => query(win, `(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
  })()`);
  const mouseClick = async selector => {
    const p = await point(selector);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
  };
  for (const theme of ['light', 'dark']) {
    await query(win, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    await mouseClick('[role="gridcell"]');
    await wait(win, `document.querySelector('.formula-chip')`);
    for (const selector of ['.formula-chip','.formula-address','.formula-format-button','.formula-style-button','.formula-dismiss-button','[role="tab"]','.tool-button']) {
      assert.deepEqual(await style(selector), {cursor:'default',selection:'none'}, selector);
    }
    // Real drag across chrome must not create browser text selection.
    await query(win, `getSelection().removeAllRanges()`);
    const p = await point('.formula-chip');
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:p.x-12,y:p.y});
    win.webContents.sendInputEvent({type:'mouseMove',button:'left',x:p.x+12,y:p.y});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:p.x+12,y:p.y});
    assert.equal(await query(win, `getSelection().toString()`), '', 'Chrome label cannot be drag-selected');
    await query(win, `document.querySelector('[aria-label="Edit selected cell input"]').click()`);
    await wait(win, `document.querySelector('.formula-bar textarea')`);
    assert.deepEqual(await style('.formula-bar textarea'), {cursor:'text',selection:'text'});
    await query(win, `(() => { const input=document.querySelector('.formula-bar textarea'); input.focus(); input.select(); })()`);
    assert.ok(await query(win, `document.activeElement.selectionEnd > document.activeElement.selectionStart`), 'Editor content remains selectable');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await query(win, `document.querySelector('[aria-label="Sheet setup"]').click()`);
    await wait(win, `document.querySelector('#sheet-setup-header-rows')`);
    assert.deepEqual(await style('.sheet-setup-label'), {cursor:'default',selection:'none'});
    assert.deepEqual(await style('.sheet-setup-stepper-button'), {cursor:'default',selection:'none'});
    assert.deepEqual(await style('#sheet-setup-header-rows'), {cursor:'text',selection:'text'});
    await query(win, `document.querySelector('[aria-label="Sheet setup"]').click()`);
    await mouseClick('[role="gridcell"]');
    const second = await query(win, `(() => {const r=document.querySelectorAll('[role="gridcell"]')[1].getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,modifiers:['shift'],...second});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,modifiers:['shift'],...second});
    await wait(win, `document.querySelector('.formula-address--selection')?.textContent.includes('2 cells')`);
    assert.equal((await style('.axis-quick-add--row')).cursor, 'ns-resize');
    assert.equal((await style('.axis-quick-add--column')).cursor, 'ew-resize');
  }
  await query(win, `document.querySelector('.source-button').click()`);
  await wait(win, `document.querySelector('.source-shell textarea')`);
  assert.deepEqual(await style('.source-shell textarea'), {cursor:'text',selection:'text'});
  await query(win, `document.querySelector('.source-button').click()`);
  await checkAddressIndices(win);
  console.log('Interaction policy passed: native/web chrome, portalled setup, light/dark, label drag, editable text and source selection.');
}

async function checkAddressIndices(win) {
  const original = win.getSize();
  const host = await query(win, `window.ordinateDesktop ? 'native' : 'web'`);
  for (const width of [1024, 840, 640, 420]) {
    win.setSize(width, 900);
    for (const theme of ['light', 'dark']) {
      await query(win, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await wait(win, `document.querySelector('[role="gridcell"]')`);
      await query(win, `(() => {const el=document.querySelector('[role="gridcell"]'); el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); el.click();})()`);
      await wait(win, `document.querySelector('.formula-column-address sub')`);
      await wait(win, `document.getAnimations().every(a=>a.playState==='finished')`);
      const indices = await query(win, `(() => {
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=1; const ctx=canvas.getContext('2d');
        const rgb = color => {ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
        return [...document.querySelectorAll('.column-index-secondary,.formula-column-address sub')].map(el=>{
          const s=getComputedStyle(el), range=document.createRange(); range.selectNodeContents(el);
          const r=range.getBoundingClientRect(), container=el.closest('button').getBoundingClientRect();
          return {text:el.textContent.trim(),tag:el.tagName,display:s.display,opacity:s.opacity,rgb:rgb(s.color),bounds:r.toJSON(),container:container.toJSON(),
            visible:r.width>0&&r.height>0,contained:r.top>=container.top&&r.bottom<=container.bottom&&r.left>=container.left&&r.right<=container.right};
        });
      })()`);
      assert.ok(indices.length >= 3);
      for (const index of indices) {
        assert.equal(index.tag, 'SUB');
        assert.match(index.text, /^\d+$/);
        assert.notEqual(index.display, 'none');
        assert.equal(index.opacity, '1');
        assert.ok(index.visible && index.contained, `Subscript visible without clipping at ${width}/${theme}: ${JSON.stringify(index)}`);
        const [r,g,b]=index.rgb;
        assert.ok(g>r+20 && g>b+20, `Subscript stays green: ${JSON.stringify(index)}`);
      }
      if (width===640) await capture(win, `${host}-address-indices-${theme}`);
    }
  }
  win.setSize(...original);
  console.log('Address indices passed: green subscripts visible and unclipped at 1024/840/640/420px in light and dark themes.');
}
void run().then(async () => {
  closing = true; for (const win of windows) if (!win.isDestroyed()) win.destroy();
  dialog.showOpenDialog = originalOpen; dialog.showSaveDialog = originalSave;
  console.log(`Test screenshots: ${directory}`);
  // Keep screenshots for visual inspection; remove only the test profile/files
  // when the entire smoke directory is cleaned by the OS temporary-file policy.
  app.quit();
}).catch(error => { console.error(error); closing = true; app.exit(1); });
