import assert from 'node:assert/strict';

/** Inspect real command text geometry, not just the presence of a CSS class. */
export async function checkMenuIconAlignment(win, {query,wait,capture}, host) {
  const size = win.getSize();
  const theme = await query(win,'document.documentElement.dataset.theme');
  const categories = await query(win,"[...document.querySelectorAll('[data-category]')].map(b=>b.querySelector('.menu-surface-option-label').textContent)");
  for (const width of [1060,320]) for (const appearance of ['light','dark']) {
    win.setSize(width,820);
    // Resizing can leave the real pointer over a category; keep hover from
    // competing with explicit category choices as the menu moves underneath it.
    win.webContents.sendInputEvent({type:'mouseMove',x:width-8,y:700});
    await query(win,`document.documentElement.dataset.theme=${JSON.stringify(appearance)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await query(win,"Promise.all(document.querySelector('.application-menu').getAnimations().map(a=>a.finished))");
    let origin;
    for (const category of categories) {
      await query(win,`[...document.querySelectorAll('[data-category]')].find(b=>b.querySelector('.menu-surface-option-label').textContent===${JSON.stringify(category)}).click()`);
      await wait(win,`document.querySelector('.application-menu-commands').getAttribute('aria-label')===${JSON.stringify(category)}`);
      const geometry = await query(win,`(() => {
        const menu=document.querySelector('.application-menu'),r=menu.getBoundingClientRect();
        const rows=[...menu.querySelectorAll('[data-command]')].map(b=>{
          const label=b.querySelector('.menu-surface-option-label').getBoundingClientRect();
          const icon=b.querySelector('.menu-surface-option-icon');
          return {label:b.textContent,x:label.x,right:label.right,icon:!!icon,
            spacer:getComputedStyle(b,'::before').content,spacerWidth:getComputedStyle(b,'::before').width};
        });
        return {left:r.left,right:r.right,width:innerWidth,rows,
          categorySpacer:getComputedStyle(menu.querySelector('[data-category]'),'::before').content};
      })()`);
      assert.ok(geometry.left>=0&&geometry.right<=geometry.width,`${host}/${width}: menu fits`);
      origin ??= geometry.rows[0].x;
      for (const row of geometry.rows) {
        assert.ok(Math.abs(row.x-origin)<.5,`${host}/${width}/${category}: text aligned: ${JSON.stringify(row)}`);
        assert.ok(row.right<=geometry.right,`${row.label}: label fits menu`);
        if (!row.icon) {
          assert.equal(row.spacer,'""','Iconless commands reserve an empty, non-text slot');
          assert.ok(parseFloat(row.spacerWidth)>0);
        }
      }
      assert.equal(geometry.categorySpacer,'none','Category navigation does not gain an icon gutter');
      if (category==='File'||category==='Help') await capture(win,`${host}-menu-alignment-${category.toLowerCase()}-${width}-${appearance}`);
    }
  }
  win.setSize(...size);
  await query(win,`document.documentElement.dataset.theme=${JSON.stringify(theme)};[...document.querySelectorAll('[data-category]')].find(b=>b.querySelector('.menu-surface-option-label').textContent==='File').click()`);
  await wait(win,"document.querySelector('.application-menu-commands').getAttribute('aria-label')==='File'");
  console.log(`${host}: menu label/icon gutters aligned across File/Edit/View/Help, light/dark and 320/1060px; category navigation unchanged.`);
}
