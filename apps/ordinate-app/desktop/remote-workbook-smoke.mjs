import assert from 'node:assert/strict';
import { session } from 'electron';
import { currentOnlineDrafts, waitForOnlineDraft } from './online-draft-test.mjs';
import { checkOnlineSessions } from './online-session-smoke.mjs';
import { createServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

/** Test-owned HTTPS responses; no requests to an external server or user files. */
export async function checkRemoteWorkbooks(win, {query, wait, capture, directory}) {
  const keyFile=path.join(directory,'fixture-key.pem'), certFile=path.join(directory,'fixture-cert.pem');
  await promisify(execFile)('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-keyout',keyFile,'-out',certFile,'-subj','/CN=models.example']);
  const requests = [];
  let releaseSlow;
  let latest = '# Remote A\n| Input | Result |\n| 21 | = A2 * 2 |';
  const headers = {'Access-Control-Allow-Origin':'*','Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'};
  const server=createServer({key:await readFile(keyFile),cert:await readFile(certFile)},(request,response)=>{
    void (async()=>{
      requests.push({url:origin+request.url,cookie:request.headers.cookie??null,referer:request.headers.referer??null});
      const pathname=new URL(request.url,origin).pathname;
      if(pathname==='/Slow.ord')await new Promise(resolve=>{releaseSlow=resolve;});
      if(pathname==='/Missing.ord'){response.writeHead(404,headers);response.end('Not found');return;}
      if(pathname==='/Page.ord'||pathname==='/Page'){response.writeHead(200,headers);response.end('<html><script>window.__remoteExecuted=true</script></html>');return;}
      if(pathname==='/Blocked.ord'){response.writeHead(200,{'Content-Type':'text/plain'});response.end(latest);return;}
      if(pathname==='/Redirect.ord'){response.writeHead(302,{...headers,Location:a});response.end();return;}
      response.writeHead(200,headers);response.end(pathname==='/B.ord'?'# Remote B\n| 123 |':latest);
    })().catch(cause=>{console.error(cause);response.destroy(cause);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='https://models.example:'+server.address().port;
  const a=origin+'/A.ord?version=1&download=1',b=origin+'/B.ord';
  await session.defaultSession.cookies.set({url:origin,name:'remote-secret',value:'must-not-send',secure:true});
  const ready = `!document.querySelector('[role="dialog"]')&&document.documentElement.dataset.startup==='ready'&&document.querySelector('.view-handoff-live .table-stage[data-layout-ready="true"]')`;
  const title = `document.querySelector('.app-title-name')?.textContent`;
  const activeSheet = `document.querySelector('.sheet-tab.active .sheet-tab-label')?.textContent`;
  const button = text => `[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = async text => {await wait(win,`${button(text)}&&!${button(text)}.disabled`); await query(win,`${button(text)}.click()`);};
  const menu = async label => {
    await query(win,`document.querySelector('[aria-label="Ordinate menu"]').click()`);
    await wait(win,`document.querySelector('.application-menu')`);
    await query(win,`[...document.querySelectorAll('[data-category]')].find(b=>b.textContent.startsWith('File')).click()`);
    await wait(win,`[...document.querySelectorAll('[data-command]')].some(b=>b.textContent===${JSON.stringify(label)})`);
    assert.equal(await query(win,`[...document.querySelectorAll('[data-command]')].some(b=>b.textContent==='Reload from source…')`),false,'Imported copies have no source reload command');
    await query(win,`[...document.querySelectorAll('[data-command]')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  };
  const input = async value => query(win,`(() => { const input=document.querySelector('.remote-workbook-field input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const contrast = async selector => query(win,`(() => {
    const node=document.querySelector(${JSON.stringify(selector)}),style=getComputedStyle(node);
    const background=getComputedStyle(node.closest('.app-modal-content')).backgroundColor;
    const ctx=document.createElement('canvas').getContext('2d');
    const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
      const v=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
      return .2126*v[0]+.7152*v[1]+.0722*v[2];};
    const a=lum(style.color),b=lum(node.tagName==='BUTTON'?style.backgroundColor:background);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  })()`);
  const launch = async url => {await win.loadURL('ordinate-test://web/online.html#url='+encodeURIComponent(url));};
  // Capture inserted nodes even if they disappear between rendered frames.
  const observeConsent = () => query(win,`window.__consentMounts=0;window.__consentObserver=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)
      if(node instanceof Element&&(node.matches('.remote-workbook-dialog')||node.querySelector('.remote-workbook-dialog')))window.__consentMounts++;
  });window.__consentObserver.observe(document.body,{childList:true,subtree:true});`);
  const consentMounts = () => query(win,`window.__consentObserver.disconnect();window.__consentMounts`);
  const navigateFragment = url => query(win,`location.hash='url='+${JSON.stringify(encodeURIComponent(url))};`);
  win.setMinimumSize(320,400); win.setSize(1100,900); win.show(); win.focus();
  await win.loadURL('ordinate-test://web/online.html'); await wait(win,`document.documentElement.dataset.startup==='ready'`);
  await query(win,`Object.keys(localStorage).filter(key=>key.startsWith('ordinate:online:')).forEach(key=>localStorage.removeItem(key))`);
  await launch(a); await wait(win,`document.querySelector('.remote-workbook-dialog')`);
  assert.equal(requests.length,0,'Consent before any network request');
  assert.equal(await query(win,`document.querySelector('.remote-workbook-address').textContent`),a);
  assert.equal(await query(win,`!!document.querySelector('.remote-workbook-field input')`),false,'Fragment confirmation has no input');
  assert.equal(await query(win,`location.hash`),'','Consumed fragment');
  await click('Cancel'); await wait(win,ready);
  assert.equal(requests.length,0);
  assert.equal(await query(win,`Object.keys(localStorage).some(key=>key.includes('url-approval:'))`),false,'Cancel does not grant consent');

  await launch(a); await wait(win,`document.querySelector('.remote-workbook-dialog')`);
  for (const width of [1100,320]) {
    win.setSize(width,780); await wait(win,`innerWidth===${width}`);
    for (const theme of ['dark','light']) {
      await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await wait(win,`document.getAnimations().every(a=>a.playState==='finished')`);
      const bounds=await query(win,`(() => {const dialog=document.querySelector('.remote-workbook-dialog'),r=dialog.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:dialog.scrollWidth,client:dialog.clientWidth}})()`);
      assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height,JSON.stringify(bounds));
      assert.ok(bounds.scroll<=bounds.client+1,'No horizontal overflow');
      assert.ok(await contrast('.remote-workbook-content .primary')>=4.5,'Open text contrast in '+theme);
      assert.ok(await contrast('.remote-workbook-address')>=4.5,'Full URL remains readable in '+theme);
      assert.ok(await contrast('.remote-workbook-trust')>=4.5,'Trust reminder remains readable in '+theme);
      await capture(win,`remote-open-${width}-${theme}`);
    }
  }
  win.setSize(1100,900);
  await query(win,`${button('Open')}.click();${button('Open')}.click()`);
  await wait(win,`${ready}&&${title}==='A.ord'`);
  assert.equal(requests.length,1,'Double submit sends one fetch');
  assert.equal(requests[0].url,a,'Query separators survived fragment decoding');
  assert.equal(requests[0].cookie,null,'Omit cookies');
  assert.equal(requests[0].referer,null,'Omit referrer');
  await wait(win,`document.querySelector('[aria-label="Current file"]').title.includes('Draft')`);
  assert.equal(await query(win,`document.querySelector('[aria-label="Current file"]').title.includes('Draft')`),true,'A local draft, not a remotely saved file');
  await capture(win,'remote-opened-copy');

  // A URL import is a local copy; replacing it does not create a URL archive.
  await query(win,`document.querySelector('.source-button').click()`); await wait(win,`document.querySelector('.source-shell textarea')`);
  await query(win,`(() => {const input=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'# Edited A\\n| 777 |');
    input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.source-button').click();})()`);
  await wait(win,ready);
  await menu('Open from link…'); await input('http://models.example/Bad.ord');
  await wait(win,`document.getAnimations().every(a=>a.playState==='finished')`);
  const before = await query(win,`document.querySelector('.remote-workbook-dialog').getBoundingClientRect().height`);
  await click('Open'); await wait(win,`document.querySelector('.remote-workbook-error').textContent.includes('HTTPS')`);
  assert.equal(requests.length,1,'Validation before fetch');
  assert.equal(await query(win,`document.querySelector('.remote-workbook-dialog').getBoundingClientRect().height`),before,'Error region does not shift the dialog');
  await input(b); await click('Open'); await click('Keep editing'); await wait(win,ready);
  assert.equal(await query(win,activeSheet),'Edited A','Cancel replacement preserves edits');
  await menu('Open from link…'); await input(b); await click('Open'); await click('Replace document'); await wait(win,`${ready}&&${title}==='B.ord'`);
  assert.ok((await query(win,currentOnlineDrafts)).every(record=>!record.key.startsWith('source:')&&!('sourceUrl' in record)),'No URL identity or source archive is persisted');
  const count = requests.length;
  await observeConsent(); await navigateFragment(a);
  await click('Replace document'); await wait(win,`${ready}&&${activeSheet}==='Remote A'`);
  const mounts=await consentMounts();
  console.log('Remembered fragment consent dialog mounts:',mounts);
  assert.equal(mounts,0,'Remembered fragments must never mount a consent dialog, even while downloading');
  assert.equal(requests.length,count+1,'Returning to a link fetches original input, never the earlier edited copy');
  await query(win,`document.querySelector('.source-button').click()`); await wait(win,`document.querySelector('.source-shell textarea')`);
  await query(win,`(() => {const input=document.querySelector('.source-shell textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'# Edited again\\n| 888 |');
    input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.source-button').click();})()`);
  await wait(win,`${ready}&&${activeSheet}==='Edited again'`);
  await waitForOnlineDraft(win,query,'# Edited again\n');
  win.reload(); await wait(win,`${ready}&&${activeSheet}==='Edited again'`);
  assert.equal(requests.length,count+1,'Ordinary refresh recovers this tab’s edits without downloading');
  latest = '# Updated remote A\n| 999 |';
  await observeConsent(); await navigateFragment(a);
  await click('Keep editing'); await wait(win,ready);
  assert.equal(await consentMounts(),0,'Reopening the same link skips consent without flashing');
  assert.equal(await query(win,activeSheet),'Edited again','Declining a fresh import preserves the edited copy');
  assert.equal(requests.length,count+2,'Same URL downloads fresh input even when its earlier copy is active');
  await observeConsent(); await navigateFragment(a); await click('Replace document');
  await wait(win,`${ready}&&${activeSheet}==='Updated remote A'`);
  assert.equal(await consentMounts(),0);
  assert.equal(requests.length,count+3,'Accepting repeated link opens imports the current remote version');

  for (const [path,message] of [['Missing.ord','The file could not be found.'],['Page.ord','This file is not a valid Ordinate workbook.'],['Blocked.ord','The file could not be opened.'],['Redirect.ord','The file could not be opened.']]) {
    await menu('Open from link…'); await input(origin+'/'+path); await click('Open');
    await wait(win,`document.querySelector('.remote-workbook-error').textContent.length>0`);
    for (const theme of ['dark','light']) {
      await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.ok(await contrast('.remote-workbook-error')>=4.5,'Error text contrast in '+theme);
    }
    if(message) assert.ok(await query(win,`document.querySelector('.remote-workbook-error').textContent.includes(${JSON.stringify(message)})`),path);
    assert.equal(await query(win,`window.__remoteExecuted`),undefined,'Remote HTML is never executed');
    assert.equal(await query(win,activeSheet),'Updated remote A','Failure leaves current document intact');
    await capture(win,'remote-error-'+path); await click('Cancel'); await wait(win,ready);
  }
  // A remembered launch that fails has no consent UI to display its error in.
  // It must still report the failure without replacing the current document.
  await observeConsent(); await navigateFragment(origin+'/Missing.ord');
  await wait(win,`document.querySelector('[role="dialog"]')?.textContent.includes('The file could not be found.')`);
  assert.equal(await consentMounts(),0,'Remembered failed launches report an error, not a transient consent dialog');
  assert.equal(await query(win,activeSheet),'Updated remote A','Silent launch failure preserves current edits');
  await click('OK'); await wait(win,ready);
  await menu('Open from link…'); await input(origin+'/Slow.ord'); await click('Open');
  await wait(win,`document.querySelector('.remote-workbook-content').getAttribute('aria-busy')==='true'`);
  await click('Cancel'); await wait(win,ready); releaseSlow();
  assert.equal(await query(win,activeSheet),'Updated remote A','Cancelled fetch never replaces the document');
  await launch('https://models.example/Another.ord'); await wait(win,`document.querySelector('.remote-workbook-dialog')`);
  assert.equal(await query(win,`document.querySelector('.remote-workbook-address').textContent`),'https://models.example/Another.ord','Another URL requires its own consent');
  await click('Cancel'); await wait(win,ready);

  const beforeUnknown=requests.length;
  await launch(origin+'/download?id=123'); await wait(win,`document.querySelector('.remote-workbook-format-warning')`);
  assert.equal(requests.length,beforeUnknown,'Unknown suffix warns before downloading');
  for(const width of [1100,320]) {
    win.setSize(width,780);await wait(win,`innerWidth===${width}`);
    for(const theme of ['light','dark']) {
      await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await wait(win,`document.getAnimations().every(a=>a.playState==='finished')`);
      assert.ok(await contrast('.remote-workbook-format-warning')>=4.5,'Format reminder contrast in '+theme);
      assert.ok(await query(win,`(() => {const node=document.querySelector('.remote-workbook-dialog'),r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&node.scrollWidth<=node.clientWidth+1})()`),'Unknown-format confirmation fits');
      await capture(win,`remote-unknown-${width}-${theme}`);
    }
  }
  await click('Open');await click('Replace document');await wait(win,`${ready}&&${title}==='download'`);
  assert.equal(await query(win,activeSheet),'Updated remote A','Valid content imports without a suffix');
  assert.equal(requests.length,beforeUnknown+1);
  await launch(origin+'/Page');await wait(win,`document.querySelector('.remote-workbook-format-warning')`);
  await click('Open');await wait(win,`document.querySelector('.remote-workbook-error').textContent.length>0`);
  assert.equal(await query(win,title),'download','Invalid content cannot replace the working copy');
  assert.equal(await query(win,`window.__remoteExecuted`),undefined,'Extensionless HTML is never executed');
  await click('Cancel');await wait(win,ready);
  win.setSize(1100,900);
  const endCount=requests.length;
  await win.loadURL('ordinate-test://web/online.html#url=%ZZ'); await wait(win,`document.querySelector('[role="dialog"]')?.textContent.includes('This file link is invalid.')`);
  assert.equal(requests.length,endCount);
  await click('OK');
  await win.loadURL('ordinate-test://web/#url='+encodeURIComponent(a)); await wait(win,`document.documentElement.dataset.startup==='ready'`);
  assert.equal(requests.length,endCount,'Raw editor ignores Online launch parameters');
  await query(win,`document.querySelector('[aria-label="Ordinate menu"]').click()`);
  await wait(win,`document.querySelector('.application-menu')`);
  assert.equal(await query(win,`[...document.querySelectorAll('[data-command]')].some(b=>b.textContent==='Open from link…')`),false,'Remote open is Online-only');
  await query(win,`document.querySelector('[aria-label="Open file"]').click()`);
  await wait(win,`document.querySelector('.interchange-open-options')`);
  assert.equal(await query(win,`document.querySelectorAll('.interchange-open-options button').length`),2,'Raw keeps local Open and Import only');
  await click('Cancel');
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));

  // A real HTTP deployment, with the editor and shipped examples on one origin.
  // Never expose the user's workspace or depend on a running Vite server.
  const staticRoot=path.resolve(import.meta.dirname,'../dist-online');
  let workbookReads=0;
  const http=createHttpServer((request,response)=>{
    void (async()=>{
      const pathname=new URL(request.url,'http://fixture.example').pathname;
      const file=path.resolve(staticRoot,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(staticRoot+path.sep)){response.writeHead(403);response.end();return;}
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ord':'text/plain; charset=utf-8'};
      const bytes=await readFile(file);
      if(path.extname(file)==='.ord')workbookReads++;
      response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});
      response.end(bytes);
    })().catch(error=>{response.writeHead(error.code==='ENOENT'?404:500);response.end();});
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  try {
    const localOrigin='http://127.0.0.1:'+http.address().port;
    const localFile=localOrigin+'/examples/00-getting-started.ord';
    await win.loadURL(localOrigin+'/#url='+encodeURIComponent(localFile));
    await wait(win,`document.querySelector('.remote-workbook-dialog')`);
    assert.equal(workbookReads,0,'Same-origin launch still asks consent before fetching');
    await click('Open'); await wait(win,`${ready}&&${activeSheet}==='Start Here'`);
    assert.equal(workbookReads,1,'Same-origin HTTP example opens through the native workbook pipeline');
    for(const width of [1100,320]) {
      win.setSize(width,780);await wait(win,`innerWidth===${width}`);
      await query(win,`document.querySelector('[aria-label="Open file"]').click()`);
      await wait(win,`document.querySelector('.interchange-open-options')`);
      assert.equal(await query(win,`document.querySelectorAll('.interchange-open-options button').length`),3,'Online offers local Open, link Open and Import');
      for(const theme of ['dark','light']) {
        await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        await wait(win,`document.getAnimations().every(a=>a.playState==='finished')`);
        assert.ok(await query(win,`(() => {const node=document.querySelector('[role="dialog"]'),r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&node.scrollWidth<=node.clientWidth+1})()`),'Open choices fit the viewport');
        assert.ok(await contrast('.interchange-open-options button')>=4.5,'Open choice contrast in '+theme);
        await capture(win,`open-choices-${width}-${theme}`);
      }
      await query(win,`[...document.querySelectorAll('.interchange-open-options button')].find(b=>b.textContent.startsWith('Open from link')).click()`);
      await wait(win,`document.activeElement===document.querySelector('.remote-workbook-field input')`);
      assert.equal(await query(win,`document.querySelectorAll('[role="dialog"]').length`),1,'One focus trap after switching dialogs');
      assert.equal(await query(win,`!!document.querySelector('.interchange-open-options')`),false,'Open choices close before showing link form');
      await input(localFile);await click('Open');await click('Replace document');await wait(win,ready);
      assert.equal(workbookReads,width===1100?2:3,'Manual link entry also fetches anew instead of reusing the active copy');
    }
    await win.loadURL(localOrigin+'/#url='+encodeURIComponent('http://127.0.0.1:1/Other.ord'));
    await wait(win,`document.querySelector('[role="dialog"]')?.textContent.includes('HTTPS')`);
    assert.equal(workbookReads,3,'A different local port is not allowed by the same-origin exception');
    await click('OK');
    await checkOnlineSessions(win,{origin:localOrigin,file:localFile,query,capture});
  } finally {http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
  console.log('Remote workbook passed: one-shot imports, repeated-URL fresh reads, no consent flash, refresh-only draft recovery, exact URL approvals, credential/referrer omission, cancel/replace, CORS/HTTP/HTML/redirect errors, narrow/light/dark layout, malformed fragments and Raw isolation.');
}
