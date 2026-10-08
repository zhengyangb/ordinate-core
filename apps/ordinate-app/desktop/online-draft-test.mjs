// Inspect the production IndexedDB in test-owned browser profiles only.
export const onlineDrafts = `(async () => {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ordinate-online-drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').getAll();let records;
    request.onsuccess=()=>{records=request.result};tx.oncomplete=()=>resolve(records);tx.onabort=()=>reject(tx.error);
  });} finally {db.close();}
})()`;
export const currentOnlineDrafts = `(async () => (await ${onlineDrafts}).filter(record=>record.sessionId===sessionStorage.getItem('ordinate:online:session')))()`;

export async function waitForOnlineDraft(win, query, text) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) {
    if((await query(win,currentOnlineDrafts)).some(record=>record.text?.includes(text)))return;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  throw new Error('Timed out waiting for Online draft: '+text);
}

export const corruptCurrentDrafts = `(async () => {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ordinate-online-drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try {await new Promise((resolve,reject)=>{
    const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),r=store.index('session').getAll(sessionStorage.getItem('ordinate:online:session'));
    r.onsuccess=()=>{for(const record of r.result)store.put({...record,text:null});};
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
  });} finally {db.close();}
})()`;
