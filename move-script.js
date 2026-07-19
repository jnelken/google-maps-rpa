// Moves places from SOURCE_LIST_LABEL into TARGET_LIST_LABEL when their
// category matches isTargetMatch(), and into ARCHIVE_LIST_LABEL when
// permanently closed (regardless of category). Everything else stays in
// SOURCE_LIST_LABEL; skipped items are logged for manual review.
//
// Usage: open the SOURCE_LIST_LABEL list in Google Maps, paste this whole
// file into the browser console, and run it (it calls processStarred() at
// the bottom). It processes whatever's currently rendered, then recurses;
// scroll and re-run processStarred() to reach further rows.
//
// KNOWN UNVERIFIED RISK: the row-reading selectors below (.BsJqK etc.) were
// confirmed live via probe-script.js, but the "open row -> Save dialog ->
// toggle list checkbox" flow is carried over from the original
// console-script.js and has NOT been fully re-verified against Google Maps'
// current DOM (fixed one confirmed issue: the checkbox toggle used to hang
// forever waiting on a "Saving…"/"Removing…" toast that can flash by faster
// than the poll interval - it now polls the checkbox's own aria-checked
// state instead, with an 8s timeout everywhere so nothing can hang silently
// again). Test on 1-2 items first (interrupt by refreshing the tab between
// recursions if something looks wrong) before letting this run to
// completion. Watch the "Checkbox labels found in Save dialog" log line on
// the first processed item and confirm SOURCE_LIST_LABEL below actually
// appears in that list before trusting the rest of the run.

const SOURCE_LIST_LABEL = 'Starred'; // exact label as shown in the Save dialog checkbox list
const TARGET_LIST_LABEL = 'Restaurants';
const ARCHIVE_LIST_LABEL = 'Archived';

// Derived from real category strings in data/starred-places.json via
// scripts/categorize.js's RESTAURANT_TYPES - kept in sync manually.
const RESTAURANT_TYPES = [
  'restaurant', 'italian', 'mexican', 'chicken', 'american', 'new american',
  'japanese', 'british', 'mediterranean', 'sri lankan', 'bistro', 'diner',
  'grill',
];

// "$20-70 · Italian" -> "italian"; "Medical clinic" -> "medical clinic"
function extractType(rawCategory) {
  if (!rawCategory) return null;
  const parts = rawCategory.split('·');
  return parts[parts.length - 1].trim().toLowerCase();
}

function isTargetMatch(rawCategory) {
  const type = extractType(rawCategory);
  return !!type && RESTAURANT_TYPES.includes(type);
}

const skipped = [];

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

// Every wait below is timeout-bounded and resolves to a boolean instead of
// hanging forever. The original console-script.js waited on transient toast
// text ("Saving…"/"Removing…") with no timeout, which can hang indefinitely
// if that text flashes by faster than the 100ms poll interval (a race, not
// just a stale selector) or never appears at all.
async function waitForTextToAppear(text, elementType = 'div', timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const element = Array.from(document.querySelectorAll(elementType))
        .find(el => el.textContent === text);
      if (element) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        console.log(`Timed out after ${timeoutMs}ms waiting for text to appear: "${text}"`);
        resolve(false);
      }
    }, 100);
  });
}

async function waitForTextToDisappear(text, elementType = 'div', timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const element = Array.from(document.querySelectorAll(elementType))
        .find(el => el.textContent === text);
      if (!element) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        console.log(`Timed out after ${timeoutMs}ms waiting for text to disappear: "${text}"`);
        resolve(false);
      }
    }, 100);
  });
}

// Polls the checkbox's own aria-checked attribute rather than relying on
// transient toast text - this is the authoritative signal that a save/remove
// actually completed, and doesn't race with a toast that appears and
// disappears between polls.
async function waitForCheckboxState(label, checkedState, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = Array.from(document.querySelectorAll(`[aria-checked="${checkedState}"] div`))
      .some(el => el.textContent === label);
    if (found) return true;
    await delay(100);
  }
  console.log(`Timed out after ${timeoutMs}ms waiting for "${label}" checkbox to reach aria-checked="${checkedState}"`);
  return false;
}

function clickSaveButton() {
  const saveButton = document.querySelector('[data-value*="Save"]');
  if (!saveButton) {
    console.log('Save button not found');
    return false;
  }
  saveButton.click();
  return true;
}

let loggedCheckboxLabels = false;
function logCheckboxLabelsOnce() {
  if (loggedCheckboxLabels) return;
  loggedCheckboxLabels = true;
  const labels = Array.from(document.querySelectorAll('[aria-checked] div'))
    .map(el => el.textContent)
    .filter(Boolean);
  console.log('Checkbox labels found in Save dialog (confirm SOURCE_LIST_LABEL matches one of these):', labels);
}

// Toggles a checkbox by its visible label text within the currently-open
// Save dialog. `fromChecked` is the state it's expected to be in before the
// click (true = currently checked, about to uncheck it; false = currently
// unchecked, about to check it).
async function toggleListCheckbox(label, fromChecked) {
  const element = Array.from(document.querySelectorAll(`[aria-checked="${fromChecked}"] div`))
    .find(el => el.textContent === label);
  if (!element) {
    console.log(`Checkbox "${label}" not found (expected aria-checked="${fromChecked}")`);
    return false;
  }
  element.parentElement.click();
  return waitForCheckboxState(label, !fromChecked);
}

async function moveItem(row, targetLabel) {
  const nameElement = row.querySelector('.fontHeadlineSmall');
  const name = nameElement ? nameElement.textContent.trim() : null;
  if (!name) {
    console.log('Name not found for row, skipping click-through');
    return false;
  }

  // The row div itself is an inert wrapper with no jsaction - the actual
  // clickable element is the <button> that wraps the name (and image, and
  // rating). Click that, not the row.
  const clickTarget = nameElement.closest('button') || row;
  clickTarget.click();
  const opened = await waitForTextToAppear(name, 'h1');
  if (!opened) {
    console.log(`Detail panel for "${name}" never opened (h1 text didn't match) - skipping`);
    return false;
  }
  await delay(250);

  if (!clickSaveButton()) return false;
  await delay(250);
  logCheckboxLabelsOnce();

  const uncheckedSource = await toggleListCheckbox(SOURCE_LIST_LABEL, true);
  if (!uncheckedSource) return false;

  if (!clickSaveButton()) return false;
  await delay(250);

  return toggleListCheckbox(targetLabel, false);
}

function getRows() {
  return Array.from(document.querySelectorAll('.BsJqK'));
}

function readRow(row) {
  const nameElement = row.querySelector('.fontHeadlineSmall');
  const name = nameElement ? nameElement.textContent.trim() : null;

  // .yfRytc holds up to two .IIrLbb blocks: [0] = rating (if present), [1] = category.
  const categoryBlocks = row.querySelectorAll('.yfRytc > .IIrLbb');
  let rawCategory = null;
  if (categoryBlocks.length >= 2) {
    rawCategory = categoryBlocks[1].textContent.trim();
  } else if (categoryBlocks.length === 1) {
    rawCategory = categoryBlocks[0].textContent.trim();
  }
  const lowerCategory = (rawCategory || '').toLowerCase();

  const isBroken = Array.from(row.querySelectorAll('img'))
    .some(img => (img.src || '').includes('result-no-thumbnail'));

  return {
    name,
    rawCategory,
    isPermanentlyClosed: lowerCategory.includes('permanently closed'),
    isBroken,
  };
}

async function processStarred() {
  const rows = getRows();

  for (const row of rows) {
    const { name, rawCategory, isPermanentlyClosed, isBroken } = readRow(row);
    const key = name || '(unnamed row)';

    if (skipped.some(s => s.name === key)) continue;

    if (isBroken) {
      console.log(`Skipping (broken/no thumbnail): ${key}`);
      skipped.push({ name: key, rawCategory });
      continue;
    }

    if (isPermanentlyClosed) {
      console.log(`Archiving (permanently closed): ${key}`);
      const moved = await moveItem(row, ARCHIVE_LIST_LABEL);
      if (moved) return processStarred();
      console.log(`Failed to archive ${key}, leaving in place for manual review`);
      skipped.push({ name: key, rawCategory });
      continue;
    }

    if (isTargetMatch(rawCategory)) {
      console.log(`Moving to ${TARGET_LIST_LABEL}: ${key} [${rawCategory}]`);
      const moved = await moveItem(row, TARGET_LIST_LABEL);
      if (moved) return processStarred();
      console.log(`Failed to move ${key}, leaving in place for manual review`);
      skipped.push({ name: key, rawCategory });
      continue;
    }

    skipped.push({ name: key, rawCategory });
  }

  console.log('No more matching rows in the currently-rendered list. Scroll down to load more, then run processStarred() again.');
  console.table(skipped);
}

processStarred();
