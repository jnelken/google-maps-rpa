// Two-phase migration out of SOURCE_LIST_LABEL:
//
// Phase 1 - processStarred(): for each currently-rendered row, ADD matching
// places to TARGET_LIST_LABEL (restaurant-category matches) or
// ARCHIVE_LIST_LABEL (permanently closed). Does NOT touch SOURCE_LIST_LABEL
// membership. Everything else is left alone and logged to `skipped`.
//
// Phase 2 - sweepRemoveFromStarred(): run this separately once you're happy
// with what phase 1 added. It removes every place phase 1 successfully
// added (tracked in `moved`) from SOURCE_LIST_LABEL.
//
// Why split like this: confirmed live (2026-07) that the Save dialog's
// checkbox state for SOURCE_LIST_LABEL can read stale/wrong on first paint
// for a large (200+ item) list - a place visibly in the list can still show
// aria-checked="false" the instant the dialog opens. Reading that state to
// decide whether to uncheck it is unsafe. Phase 2 works around this by
// closing and reopening the Save dialog once before trusting the read (this
// was verified live to force a correct, fresh value).
//
// Usage: open SOURCE_LIST_LABEL in Google Maps, paste this whole file into
// the console, let processStarred() run (it's called automatically at the
// bottom), scroll and re-run processStarred() until it stops finding new
// matches, then run sweepRemoveFromStarred() (also scroll + re-run as
// needed - same currently-rendered-only constraint applies).
//
// VALIDATION STATUS (2026-07): phase 1 (processStarred/addToList) has been
// run live end-to-end multiple times with real, persisted results (verified
// via a fresh page reload's list counts, not just in-session state). Phase 2
// (sweepRemoveFromStarred/removeFromStarred) shares the same toggle/verify
// primitives already proven in phase 1, but a live end-to-end run of phase 2
// specifically was interrupted by a transient Google Maps loading/rate-limit
// issue and not independently confirmed. Test it on 1-2 items before
// trusting it against everything phase 1 added.
//
// Also confirmed live: Google Maps uses two different layouts depending on
// window width - one replaces the whole list panel with a place's page
// (needs "back" to return), the other shows the place as a floating card
// while the list stays open underneath (nothing to navigate back from).
// returnToList() detects which one is active by checking whether the list
// rows are still in the DOM, rather than assuming either layout.

const SOURCE_LIST_LABEL = 'Starred places'; // confirmed live via the Save dialog's checkbox list
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
const moved = []; // { name, rawCategory, targetLabel, removedFromStarred }

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

// Recovery for when a step fails partway through: if we've already
// navigated into a place's detail page and then hit a failure (checkbox not
// found, save button not found, etc.), we're stranded there with no way
// back to the list - every subsequent item's row.click() would then fail
// too, since those rows are no longer the visible/active panel. Confirmed
// live: a single failed item cascaded into every following item timing out
// in the same run. Click the back control to recover before moving on.
// Also called after every SUCCESSFUL step now, since (unlike the old
// remove-from-current-list flow) adding to an unrelated list gives Maps no
// reason to auto-navigate back on its own.
function returnToList() {
  // Confirmed live: Google Maps uses two different layouts depending on
  // window width. On wide/desktop layouts, opening a place shows it as a
  // floating card over the map while the list panel (.BsJqK rows) stays
  // fully present and interactive underneath - nothing to navigate back
  // from, and clicking "back" here would act on some other navigation
  // stack entirely and overshoot past the list into the Lists overview
  // page (confirmed live), breaking every item after it. On narrower
  // layouts, opening a place fully replaces the list panel, so "back" is
  // needed to return. Detect which situation we're in by checking whether
  // the list rows are still there, rather than assuming either layout.
  if (getRows().length > 0) {
    return true;
  }
  const backButton = document.querySelector('button[aria-label="Back"], button[jsaction*="back"]');
  if (backButton) {
    console.log(`Recovering: clicking back button (aria-label="${backButton.getAttribute('aria-label')}")`);
    backButton.click();
    return true;
  }
  console.log('Could not find a back button to recover to the list view - the next item may fail too.');
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

// Closes the Save dialog by clicking outside it. Used before a checkbox
// read we need to trust - see the file header for why a fresh open matters.
function closeDialog() {
  document.body.click();
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
  // Click the aria-checked element itself, not an arbitrary text-div
  // ancestor - Google Maps binds jsaction handlers at specific nesting
  // levels (confirmed from the row-button HTML: sibling divs carry their
  // own unrelated jsactions), so element.parentElement isn't reliably the
  // actual interactive target.
  const checkboxEl = element.closest(`[aria-checked="${fromChecked}"]`);
  checkboxEl.click();

  // Confirmed live: polling aria-checked right after the click can report a
  // false negative even though the click genuinely worked - Maps re-sorts
  // checked lists to the top of the dialog, and the polled node can be
  // stale/replaced during that reorder. Closing and reopening the dialog
  // forces a fresh, reliable read instead of trusting the live DOM node.
  await delay(500);
  closeDialog();
  await delay(500);
  if (!clickSaveButton()) return false;
  await delay(500);
  const confirmed = Array.from(document.querySelectorAll(`[aria-checked="${!fromChecked}"] div`))
    .some(el => el.textContent === label);
  if (!confirmed) {
    console.log(`After reopening, "${label}" still doesn't show aria-checked="${!fromChecked}" - treating as failed`);
  }
  return confirmed;
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

// Clicks into a row's detail page. Shared by phase 1 (addToList) and
// phase 2 (removeFromStarred).
async function openRow(row) {
  const nameElement = row.querySelector('.fontHeadlineSmall');
  const name = nameElement ? nameElement.textContent.trim() : null;
  if (!name) {
    console.log('Name not found for row, skipping click-through');
    return null;
  }

  // The row div itself is an inert wrapper with no jsaction - the actual
  // clickable element is the <button> that wraps the name (and image, and
  // rating). Click that, not the row.
  const clickTarget = nameElement.closest('button') || row;
  clickTarget.click();
  const opened = await waitForTextToAppear(name, 'h1');
  if (!opened) {
    console.log(`Detail panel for "${name}" never opened (h1 text didn't match) - skipping`);
    return null;
  }
  return name;
}

// Phase 1: adds the currently-open row to targetLabel. Does not touch
// SOURCE_LIST_LABEL.
async function addToList(row, targetLabel) {
  const name = await openRow(row);
  if (!name) return false;

  const fail = () => { returnToList(); return false; };

  await delay(250);
  if (!clickSaveButton()) return fail();
  await delay(250);
  logCheckboxLabelsOnce();

  const targetChecked = await toggleListCheckbox(targetLabel, false);
  if (!targetChecked) return fail();

  returnToList();
  return true;
}

async function processStarred() {
  const rows = getRows();

  for (const row of rows) {
    const { name, rawCategory, isPermanentlyClosed, isBroken } = readRow(row);
    const key = name || '(unnamed row)';

    if (skipped.some(s => s.name === key)) continue;
    if (moved.some(m => m.name === key)) continue;

    if (isBroken) {
      console.log(`Skipping (broken/no thumbnail): ${key}`);
      skipped.push({ name: key, rawCategory });
      continue;
    }

    if (isPermanentlyClosed) {
      console.log(`Adding to ${ARCHIVE_LIST_LABEL} (permanently closed): ${key}`);
      const added = await addToList(row, ARCHIVE_LIST_LABEL);
      if (added) {
        moved.push({ name: key, rawCategory, targetLabel: ARCHIVE_LIST_LABEL });
        return processStarred();
      }
      console.log(`Failed to add ${key} to ${ARCHIVE_LIST_LABEL}, leaving in place for manual review`);
      skipped.push({ name: key, rawCategory });
      continue;
    }

    if (isTargetMatch(rawCategory)) {
      console.log(`Adding to ${TARGET_LIST_LABEL}: ${key} [${rawCategory}]`);
      const added = await addToList(row, TARGET_LIST_LABEL);
      if (added) {
        moved.push({ name: key, rawCategory, targetLabel: TARGET_LIST_LABEL });
        return processStarred();
      }
      console.log(`Failed to add ${key} to ${TARGET_LIST_LABEL}, leaving in place for manual review`);
      skipped.push({ name: key, rawCategory });
      continue;
    }

    skipped.push({ name: key, rawCategory });
  }

  console.log('No more matching rows in the currently-rendered list. Scroll down to load more, then run processStarred() again.');
  console.table(skipped);
  console.log(`${moved.filter(m => !m.removedFromStarred).length} item(s) added to target lists and still in ${SOURCE_LIST_LABEL} - run sweepRemoveFromStarred() when ready to remove them.`);
  console.table(moved);
}

// Phase 2: removes a single already-added place from SOURCE_LIST_LABEL.
// Closes and reopens the Save dialog once before reading the checkbox -
// confirmed live that skipping this reopen can read a stale "unchecked"
// state for a place that is, in fact, still checked.
async function removeFromStarred(row) {
  const name = await openRow(row);
  if (!name) return false;

  const fail = () => { returnToList(); return false; };

  await delay(250);
  if (!clickSaveButton()) return fail();
  await delay(500);
  closeDialog();
  await delay(500);
  if (!clickSaveButton()) return fail();
  await delay(500);

  const isChecked = Array.from(document.querySelectorAll('[aria-checked="true"] div'))
    .some(el => el.textContent === SOURCE_LIST_LABEL);
  if (!isChecked) {
    console.log(`"${name}" is not currently checked in ${SOURCE_LIST_LABEL} - nothing to remove`);
    returnToList();
    return true;
  }

  const uncheckedSource = await toggleListCheckbox(SOURCE_LIST_LABEL, true);
  if (!uncheckedSource) return fail();

  returnToList();
  return true;
}

async function sweepRemoveFromStarred() {
  const pending = moved.filter(m => !m.removedFromStarred);
  if (pending.length === 0) {
    console.log('Nothing left to remove - moved list is empty or everything is already removed.');
    return;
  }

  const rows = getRows();

  for (const row of rows) {
    const { name } = readRow(row);
    const key = name || '(unnamed row)';
    const entry = pending.find(m => m.name === key);
    if (!entry) continue;

    console.log(`Removing from ${SOURCE_LIST_LABEL}: ${key}`);
    const removed = await removeFromStarred(row);
    if (removed) {
      entry.removedFromStarred = true;
      return sweepRemoveFromStarred();
    }
    console.log(`Failed to remove ${key} from ${SOURCE_LIST_LABEL}, leaving for manual review`);
  }

  const stillPending = moved.filter(m => !m.removedFromStarred);
  if (stillPending.length > 0) {
    console.log(`${stillPending.length} added item(s) not found in the currently-rendered list. Scroll down to load more, then run sweepRemoveFromStarred() again.`);
    console.table(stillPending);
  } else {
    console.log(`All added items have been removed from ${SOURCE_LIST_LABEL}.`);
  }
}

processStarred();
