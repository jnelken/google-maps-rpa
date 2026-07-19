// Read-only diagnostic: does NOT toggle any Save checkbox or change list
// membership. It only opens the first row's detail panel (same as clicking
// a place in the UI) and logs what happened, to debug why move-script.js's
// row.click() -> wait-for-h1 step times out.
(async () => {
  const delay = ms => new Promise(r => setTimeout(r, ms));

  const rows = document.querySelectorAll('.BsJqK');
  console.log('Row count:', rows.length);
  if (rows.length === 0) {
    console.log('No .BsJqK rows found - selector may be stale.');
    return;
  }

  const row = rows[0];
  const name = row.querySelector('.fontHeadlineSmall')?.textContent.trim();
  console.log('First row name:', JSON.stringify(name));
  console.log('Row tag/class:', row.tagName, row.className);
  console.log('Row has jsaction attr:', row.hasAttribute('jsaction'), row.getAttribute('jsaction'));
  console.log('Row has tabindex/role:', row.getAttribute('tabindex'), row.getAttribute('role'));

  const h1sBefore = Array.from(document.querySelectorAll('h1')).map(el => el.textContent);
  console.log('h1 texts BEFORE click:', h1sBefore);

  row.click();
  await delay(1500);

  const h1sAfter = Array.from(document.querySelectorAll('h1')).map(el => el.textContent);
  console.log('h1 texts AFTER click (1.5s later):', h1sAfter);

  if (JSON.stringify(h1sBefore) === JSON.stringify(h1sAfter)) {
    console.log('RESULT: row.click() had no visible effect - wrong click target.');
  } else {
    const matched = h1sAfter.some(t => t === name);
    console.log(matched
      ? 'RESULT: detail panel opened and h1 matches row name exactly.'
      : `RESULT: detail panel opened but h1 text does NOT exactly match row name. Compare closely (whitespace/hidden chars?).`);
  }
})();
