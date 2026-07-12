# Starred→Restaurants Move Script (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship the self-contained, paste-into-console `move-script.js` that
moves places out of `Starred places` into `Restaurants` (when the category
indicates a restaurant) or `Archived` (when permanently closed), per Phase 2
of `docs/superpowers/specs/2026-06-24-starred-to-restaurants-design.md`.

**Architecture:** Single script, no build step, no imports — matching
`console-script.js` and `probe-script.js`'s existing distribution pattern.
It reuses the confirmed-current row selectors from `probe-script.js`
(`.BsJqK`, `.fontHeadlineSmall`, `.yfRytc > .IIrLbb`, `result-no-thumbnail`)
for reading each row, and the save-dialog interaction helpers from
`console-script.js` (`waitForTextToAppear`/`waitForTextToDisappear`,
`clickSaveButton`, `[aria-checked] div` checkbox lookup) for the
click-into-row / toggle-list-membership flow, since Phase 1 only
re-verified the list-row DOM, not the save dialog. The restaurant matcher
(`RESTAURANT_TYPES` + `extractType`) is copied from `scripts/categorize.js`,
which was already tuned against real category strings pulled from the
user's live Starred list (`data/starred-places.json`, 200 rows).

**Tech Stack:** Plain browser JavaScript (ES2017+, runs directly in Chrome
DevTools console). No npm packages, no test runner — this repo has none;
validation is manual, in-browser (per spec's "Testing / validation
approach").

## Global Constraints

- No build step, no imports/modules — self-contained, copy-pasteable in one
  piece. (Spec: Phase 2 architecture note)
- Processes one item at a time, then recurses to re-query the shifted/
  virtualized list, mirroring `console-script.js`'s existing pattern. (Spec:
  Phase 2, "Per-item processing order")
- Must NOT infinite-loop when every currently-rendered row is unprocessable
  — stop and tell the user to scroll, instead of recursing forever. (Spec:
  Phase 2, explicitly fixes this latent bug in the original script)
- Permanently-closed rows are archived regardless of category; category
  matching only applies to non-closed rows. (Spec: Phase 2, step 4 vs 5)
- Broken rows (no-thumbnail placeholder) are skipped, not clicked into.
  (Spec: Phase 2, step 3)
- Already-skipped rows (this run's in-memory set) are not re-evaluated or
  re-logged. (Spec: Phase 2, step 2)
- `console.table(skipped)` prints at each stopping point. (Spec: Phase 2)
- `SOURCE_LIST_LABEL`'s exact text (`'Starred'` vs `'Starred places'`, etc.)
  is unverified against a live Save dialog — the script must surface the
  real checkbox labels the first time it opens one, so the user can
  confirm before trusting a full run. (Spec: "Open items resolved during
  implementation... Phase 2 implementation verifies this against a real
  opened item before finalizing the constant")
- The `Archived` list does not exist yet in the user's account — the user
  must create it manually before running. (Spec: same section)

---

### Task 1: Create `move-script.js`

**Files:**
- Create: `/Users/jake/Dropbox/code/google-maps-rpa/move-script.js`

**Interfaces:**
- Consumes: nothing from other files (self-contained, per architecture).
- Produces: a global `processStarred()` function that runs the migration
  pass; a global `skipped` array of `{ name, rawCategory }` for manual
  review.

- [x] **Step 1: Write `move-script.js`**

```js
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
// toggle list checkbox" flow is carried over unmodified from the original
// console-script.js and has NOT been re-verified against Google Maps'
// current DOM. Test on 1-2 items first (interrupt by refreshing the tab
// between recursions if something looks wrong) before letting this run to
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

async function waitForTextToAppear(text, elementType = 'div') {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const element = Array.from(document.querySelectorAll(elementType))
        .find(el => el.textContent === text);
      if (element) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

async function waitForTextToDisappear(text, elementType = 'div') {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const element = Array.from(document.querySelectorAll(elementType))
        .find(el => el.textContent === text);
      if (!element) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
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
  await delay(250);
  const waitingText = fromChecked ? 'Removing…' : 'Saving…';
  await waitForTextToAppear(waitingText);
  await waitForTextToDisappear(waitingText);
  return true;
}

async function moveItem(row, targetLabel) {
  const nameElement = row.querySelector('.fontHeadlineSmall');
  const name = nameElement ? nameElement.textContent.trim() : null;
  if (!name) {
    console.log('Name not found for row, skipping click-through');
    return false;
  }

  row.click();
  await waitForTextToAppear(name, 'h1');
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
```

- [x] **Step 2: Syntax-check the script (no browser available here)**

Run: `node --check move-script.js`
Expected: no output, exit code 0 (parse-only check; `document`/`window` are
never executed by `--check`, so the browser-only globals don't matter).

- [x] **Step 3: Commit**

```bash
git add move-script.js
git commit -m "Add Starred->Restaurants move script (Phase 2)"
```

---

### Task 2: Document Phase 2 usage in the README

**Files:**
- Modify: `/Users/jake/Dropbox/code/google-maps-rpa/README.md`

**Interfaces:**
- Consumes: `move-script.js` from Task 1 (referenced by filename only).

- [x] **Step 1: Add a "Moving Starred places into Restaurants / Archived"
  section to README.md**

Insert after the existing "Probing your list data (read-only)" section
(before the "Made by [@seifip]" line, which stays last):

```markdown
# Moving Starred places into Restaurants / Archived (Phase 2)

Once you've probed the list and are ready to actually move things:

1. In Google Maps, create an `Archived` list if you don't already have one
   (same manual step as creating `Restaurants`, `Food`, etc.).
2. Open the `Starred places` list.
3. Copy and paste `move-script.js` into the browser Console and run it.
4. On the first item it opens, it logs the real checkbox labels found in
   the Save dialog — confirm `SOURCE_LIST_LABEL` (`'Starred'` by default)
   actually appears in that list before trusting the rest of the run. If
   it doesn't match, stop, edit the constant at the top of the script to
   the label you actually see, and re-run.
5. It moves permanently-closed places to `Archived`, restaurants (by
   category) to `Restaurants`, and leaves everything else in `Starred
   places`, printing a table of skipped items (name + category) for manual
   follow-up.
6. It processes one item at a time and recurses; if it looks stuck or
   wrong, refresh the tab to stop it — it's safe to resume later since it
   only acts on whatever's currently rendered.
7. When it stops on its own ("No more matching rows..."), scroll the list
   to load more rows and run `processStarred()` again in the console.

The click-into-item / Save-dialog steps reuse the original script's DOM
selectors, which are older than the list-row selectors and haven't been
re-verified against Google Maps' current DOM — test on a couple of items
before running against the whole list.
```

- [x] **Step 2: Visually verify the markdown renders sensibly**

Run: `cat README.md`
Expected: the new section appears between the "Probing your list data"
section and the "Made by" credit line, with no broken markdown headers.

- [x] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the Starred->Restaurants move script in the README"
```

---

## Out of scope for this plan

- Categorizing into any list other than `Restaurants`/`Archived` (the
  broader bucket exploration in `scripts/categorize.js` is a separate,
  offline analysis tool over already-collected data, not part of this
  browser script). (Spec: Non-goals)
- Re-sorting `Want to go` or any other list. (Spec: Non-goals)
- Automated tests — this repo has no test runner and the spec's validation
  approach is manual, in-browser. (Spec: "Testing / validation approach")
