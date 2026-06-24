# Starred → Restaurants migration (with Archived list support)

## Background

`console-script.js` was written against the `Want to go` list, sorting items
into `Food`/`Coffee`/`Bakery`/`Dessert`/`Tea` lists by category. The user's
actual Google Maps lists are different (`Want to go`, `Bodhi`, `Date Night`,
`Favorites`, `Forest`, `Going Out`, `Travel plans`, `Restaurants`, `NYC`,
`Ashrams`, `Date night UK`, `UK Coffee`, `Desks`, `Apt 2022`,
`Airbnb Scotland`, `Tattoo`, `UK Music`, `UK Studios`, `UK Sound`,
`London Move`, `Saved places`, `Starred places`).

First concrete task: move places out of `Starred places` into `Restaurants`
when they're actually restaurants, and separately archive anything
permanently closed so it isn't lost. The original script's DOM selectors
(`[aria-label="Add note"]`, `.fontHeadlineSmall`, `.fontBodyMedium ...`) were
written some time ago and Google Maps' DOM changes over time — they need to
be re-verified before any mutating script runs.

## Goals

- Verify current Google Maps DOM structure for list items (name, category,
  closed status, broken/no-thumbnail state) without modifying any data.
- Move permanently-closed places out of whichever list is being processed
  into a new `Archived` list, as a general rule usable by any future list
  run (not special-cased to this one).
- Move places from `Starred places` into `Restaurants` when their category
  indicates they're an actual restaurant.
- Leave everything else in `Starred places`, with a printed summary of what
  was skipped (name + category) for manual follow-up.

## Non-goals

- Re-sorting `Want to go` or any list other than `Starred places` in this
  pass.
- Automatically categorizing into the user's non-food lists (`Bodhi`,
  `Date Night`, `Forest`, etc.) — those are curated by hand, not by category.
- Handling temporarily-closed places — they're left untouched; only
  permanently-closed places are archived.

## Phase 1 — Probe script (read-only)

A console script that scans whatever rows are currently rendered in the
open list (e.g. `Starred places`) and prints a table with, per row:

- `name` — from `.fontHeadlineSmall` (or null if not found)
- `rawCategory` — full untrimmed text of the category/status element(s)
- `isPermanentlyClosed` / `isTemporarilyClosed` — derived by substring match
  on the raw text, case-insensitive
- `isBroken` — same no-thumbnail check as the original script

The script performs **no clicks and no dialog interaction** — it only reads
already-rendered DOM. Google Maps virtualizes/lazy-loads the list, so the
probe only sees what's currently scrolled into view; the user scrolls and
re-runs to sample further down the list.

Purpose: confirm selectors still resolve, and discover where/how closed
status is actually represented in today's DOM (it may or may not live in
the same element as the category text) before Phase 2 logic is written
against a guess.

## Phase 2 — Generalized move script

Single self-contained console script (matching the existing paste-into-console
pattern — no build step, no modules), parameterized by constants at the top:

```js
const SOURCE_LIST_LABEL = 'Starred'; // exact label as shown in the Save dialog checkbox list
const TARGET_LIST_LABEL = 'Restaurants';
const ARCHIVE_LIST_LABEL = 'Archived';
const isTargetMatch = (category) => /* restaurant matcher, finalized after Phase 1 data */;
```

Per-item processing order, run on whatever's currently rendered (mirrors the
original script's one-item-then-recurse pattern, since removing an item
shifts/reloads the virtualized list):

1. Read name + category from the row directly (no click needed for this,
   same as the original script).
2. If already in this run's in-memory `skipped` set, move to the next row
   (avoids re-logging/re-evaluating rows that don't get removed from the
   list).
3. If broken (no-thumbnail placeholder), skip — log once, add to `skipped`.
4. If permanently closed → open the row, save dialog, uncheck
   `SOURCE_LIST_LABEL`, check `ARCHIVE_LIST_LABEL`, save. This check runs
   regardless of category — closed places never go through restaurant
   matching.
5. Else if `isTargetMatch(category)` → open the row, save dialog, uncheck
   `SOURCE_LIST_LABEL`, check `TARGET_LIST_LABEL`, save.
6. Else → log `{ name, category }` to `skipped`, do not click into the row
   at all, continue to the next row in the same pass.

After processing one matched item (step 4 or 5), the function recurses (like
the original) to re-query the now-shifted DOM. If a full pass over the
currently-rendered rows finds nothing to process in steps 4/5 (everything
visible was already skipped or broken), the script stops and logs a message
telling the user to scroll down to load more rows, instead of recursing
forever — this fixes a latent infinite-recursion risk in the original script
when every remaining visible item is unprocessable.

At the end of each stopping point, `console.table(skipped)` prints the
running list of skipped (not-a-restaurant, not-closed) items for manual
review.

## Open items resolved during implementation, not left ambiguous

- **Restaurant matcher**: deferred intentionally — Phase 1 output (real
  category strings from the user's actual Starred list) determines the
  matcher, rather than guessing categories that may not even occur in this
  account's data.
- **`SOURCE_LIST_LABEL` exact text**: the Save dialog may label the list
  differently than the lists-overview page does (the original script found
  `'Want to go'` matched exactly; `Starred places` might render as just
  `'Starred'` in the dialog). Phase 2 implementation verifies this against
  a real opened item before finalizing the constant.
- **`Archived` list**: does not exist yet in the user's account. The user
  needs to create it in Google Maps (same manual step as the README's
  existing list-creation instructions) before running Phase 2.

## Testing / validation approach

No automated tests (this is a browser console script with no test runner in
this repo). Validation is manual and staged:

1. Run Phase 1 probe in the browser console against the live `Starred
   places` list — confirm it only reads, never mutates, and inspect output.
2. Use probe output to finalize the restaurant matcher and confirm
   `SOURCE_LIST_LABEL`.
3. Run Phase 2 against a small number of items first (the script already
   processes one item at a time and recurses, so it can be interrupted by
   closing the tab/refreshing between recursions) before letting it run to
   completion across the full list.
