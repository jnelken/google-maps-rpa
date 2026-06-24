# Starred List Probe Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only browser console script that inventories the
currently-rendered rows of an open Google Maps list (name, raw
category/status text, permanently/temporarily-closed flags, broken-thumbnail
flag) without clicking or modifying anything, so we can see real category
strings and confirm DOM selectors before writing the Phase 2 move script.

**Architecture:** Single self-contained script, `probe-script.js`, following
the same paste-into-console pattern as the existing `console-script.js` — no
build step, no imports, no dependencies. It reuses the row-locating approach
from `console-script.js` (`[aria-label="Add note"]` → `parentElement.parentElement.previousSibling`
→ `.fontHeadlineSmall` / `.fontBodyMedium ...`) but never calls `.click()` on
anything.

**Tech Stack:** Plain browser JavaScript (ES2017+, runs directly in Chrome
DevTools console). No npm packages, no test runner — this repo has none and
the spec's validation approach is manual, in-browser.

## Global Constraints

- No mutation: this script must not click any element, open any dialog, or
  change any list membership. (Spec: "Phase 1 — Probe script (read-only)")
- Must work against whatever's currently rendered/virtualized in the list;
  no auto-scrolling. (Spec: Phase 1)
- Output must be a `console.table` of per-row data: `name`, `rawCategory`,
  `isPermanentlyClosed`, `isTemporarilyClosed`, `isBroken`. (Spec: Phase 1)
- Self-contained — copy-pasteable into the console in one piece, matching
  `console-script.js`'s existing distribution pattern. (Spec: Phase 2
  architecture note, same constraint applies to Phase 1)

---

### Task 1: Create the probe script

**Files:**
- Create: `/Users/jake/Dropbox/code/google-maps-rpa/probe-script.js`

**Interfaces:**
- Produces: a global function `probeList()` that, when called, returns an
  array of row objects `{ index: number, name: string|null, rawCategory:
  string|null, isPermanentlyClosed: boolean, isTemporarilyClosed: boolean,
  isBroken: boolean }` and also prints them via `console.table`.

- [ ] **Step 1: Write `probe-script.js`**

```js
function probeList() {
  const noteButtons = document.querySelectorAll('[aria-label="Add note"]');
  console.log('Found rows:', noteButtons.length);

  const results = Array.from(noteButtons).map((noteButton, index) => {
    const button = noteButton.parentElement.parentElement.previousSibling;
    if (!button) {
      return { index, name: null, rawCategory: null, isPermanentlyClosed: false, isTemporarilyClosed: false, isBroken: false };
    }

    const nameElement = button.querySelector('.fontHeadlineSmall');
    const categorySpan = button.querySelector('.fontBodyMedium > div:last-child > div:last-child span:last-child');
    const rawCategory = categorySpan ? categorySpan.textContent.trim() : null;
    const lowerCategory = (rawCategory || '').toLowerCase();

    const isBroken = Array.from(button.querySelectorAll('img'))
      .some(img => img.src === 'https://maps.gstatic.com/tactile/pane/result-no-thumbnail-2x.png');

    return {
      index,
      name: nameElement ? nameElement.textContent : null,
      rawCategory,
      isPermanentlyClosed: lowerCategory.includes('permanently closed'),
      isTemporarilyClosed: lowerCategory.includes('temporarily closed'),
      isBroken,
    };
  });

  console.table(results);
  return results;
}

probeList();
```

- [ ] **Step 2: Syntax-check the script (no browser available here)**

Run: `node --check probe-script.js`
Expected: no output, exit code 0 (parse-only check; `document`/`window` are
never executed by `--check`, so the browser-only globals don't matter).

- [ ] **Step 3: Commit**

```bash
git add probe-script.js
git commit -m "Add read-only probe script for inspecting Google Maps list DOM"
```

---

### Task 2: Document Phase 1 usage in the README

**Files:**
- Modify: `/Users/jake/Dropbox/code/google-maps-rpa/README.md`

**Interfaces:**
- Consumes: `probe-script.js` from Task 1 (referenced by filename only).

- [ ] **Step 1: Add a "Probing your list data" section to README.md**

Insert after the existing "How to use the script" section (after the line
`Made by [@seifip](https://twitter.com/seifip)` stays last; insert the new
section before it):

```markdown
# Probing your list data (read-only)

Google Maps' page structure changes over time, and your own lists may use
categories the existing script doesn't know about. Before running any
list-modifying script, you can check what's actually there:

1. Open the Google Maps list you want to inspect (e.g. `Starred places`).
2. Copy and paste `probe-script.js` into the browser Console and run it.
3. It prints a table of every currently-loaded row: name, raw
   category/status text, and whether it looks permanently closed,
   temporarily closed, or broken (no thumbnail). It does not click
   anything or change your saved places.
4. Google Maps only renders/loads part of a long list at a time. Scroll the
   list to load more rows, then run `probeList()` again in the console to
   sample further down.
```

- [ ] **Step 2: Visually verify the markdown renders sensibly**

Run: `cat README.md`
Expected: the new section appears between the existing usage steps and the
"Made by" credit line, with no broken markdown headers.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the read-only probe script in the README"
```

---

## Out of scope for this plan

Phase 2 (the generalized Starred→Restaurants move script with Archived-list
support) is intentionally **not** part of this plan. Per the spec
(`docs/superpowers/specs/2026-06-24-starred-to-restaurants-design.md`), its
restaurant-matching rule and the exact `SOURCE_LIST_LABEL` text are deferred
until real data comes back from running `probeList()` against the live
`Starred places` list. Once that data is shared, write a follow-up plan for
Phase 2 rather than guessing the matcher now.
