import assert from 'node:assert/strict';

/** Test-owned hosts only, using the production source and formula editors. */
export async function checkFormattedText(win, { query, wait }) {
  win.show(); win.focus();
  const click = async selector => {
    await wait(win, `document.querySelector(${JSON.stringify(selector)})`);
    await query(win, `document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const setText = async (selector, text) => query(win, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const formula = '= f"Total: {B2:,.2f}"';
  await click('.source-button');
  await wait(win, `document.querySelector('.source-shell textarea')`);
  await setText('.source-shell textarea', '# Formatted text\n| Item || Value | Text |\n| ---- || ----- | ---- |\n| Sales || 1234.5 | '+formula+' |');
  await click('.source-button');
  const resultCell = `[...document.querySelectorAll('[role="gridcell"]')].find(c => c.textContent === 'Total: 1,234.50')`;
  await wait(win, resultCell);
  await query(win, `(${resultCell}).dispatchEvent(new MouseEvent('dblclick', {bubbles:true,cancelable:true}))`);
  const editor = 'textarea[aria-label="Edit selected cell input"]';
  await wait(win, `document.querySelector(${JSON.stringify(editor)})?.value === ${JSON.stringify(formula)}`);
  assert.equal(await query(win, `document.querySelector(${JSON.stringify(editor)}).value`), formula);
  await setText(editor, '= f"Margin: {B2 / 10000:.1%}"');
  await click('[aria-label="Apply cell input"]');
  await wait(win, `[...document.querySelectorAll('[role="gridcell"]')].some(c => c.textContent === 'Margin: 12.3%')`);
  await click('.source-button');
  await wait(win, `document.querySelector('.source-shell textarea')`);
  const saved = await query(win, `document.querySelector('.source-shell textarea').value`);
  assert.match(saved, /f"Margin: \{B2 \/ 10000:\.1%\}"/);
  await setText('.source-shell textarea', saved);
  await click('.source-button');
  await wait(win, `[...document.querySelectorAll('[role="gridcell"]')].some(c => c.textContent === 'Margin: 12.3%')`);
}
