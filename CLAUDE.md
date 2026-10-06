# google-maps-rpa

Browser-console scripts for reorganizing Jake's Google Maps saved places. Google caps
saved places and a single huge flat list (Starred places, Want to go) becomes unusable
for someone with hundreds of pins across many countries — these scripts split a big
list into topic lists (Restaurants, Coffee Shops, Health, etc.) by category, using
Google Maps' own DOM, driven either by the user pasting a script into DevTools or by
an agent driving a real logged-in browser tab via the `mcp__claude-in-chrome__*` MCP
tools.

There is no build step and no npm dependencies for the browser scripts. They are
meant to be copy-pasted whole into the Chrome DevTools console on a live
`google.com/maps` tab and run directly (ES2017+, top-level `await` not required —
scripts call their own `async function main() {...}; main();` at the bottom).

`package.json` exists only for dependency-free checks: `npm test` (Node's built-in
`node --test`, covering `place-search-script.js`'s pure logic) and `npm run check`
(`node --check` on every script). Keep it dependency-free.

## Files

- `probe-script.js` — read-only. Prints a table of currently-rendered rows in
  whatever list is open (name, raw category, closed/broken flags). Never clicks
  anything. Use this first whenever DOM selectors might have drifted, before trusting
  any list-modifying script.
- `move-script.js` — the list-page tool. Two-phase: `processStarred()` adds
  category-matched places from `Starred places` into topic lists (without touching
  Starred places membership), `sweepRemoveFromStarred()` removes confirmed adds from
  Starred places afterward. See its own header comment for the current category →
  list mapping and validation status — that comment is kept up to date by whoever
  last touched the file, trust it over this doc for the current state. It needs
  Google Maps' in-app (SPA) navigation to open rows, and its Save-dialog selectors
  (`.closest('[aria-checked]')`, `document.body.click()`) predate the 2026-08
  findings below — expect it to fail while SPA nav is broken.
- `place-search-script.js` — the per-place-search tool, for when SPA navigation is
  broken. Never touches the list page: it full-page-loads
  `google.com/maps/search/<name>` for each place queued from `data/plan.json` and
  toggles the Save menu there, one toggle per load. Same two-phase safety as
  `move-script.js` (phase 1 adds, phase 2 removes Starred only after a fresh load
  confirms the target). Resumable: state lives in `localStorage.__gmps`, and the
  script stores its own source in `localStorage.__gmpsSrc` so a one-liner reloads it
  after each navigation (or install it as a userscript). Pure logic is exported for
  `place-search-script.test.js`. Statically reviewed only — not yet run live.
- `console-script.js` — the original, older single-pass script (moves Want to go
  items into Food/Coffee/Bakery/Dessert). Its Save-dialog interaction selectors were
  the starting point for `move-script.js` but were largely re-verified/fixed since;
  treat this file as historical reference, not a maintained tool.
- `diagnose-click.js` — a read-only diagnostic used once to figure out why
  `row.click()` wasn't opening place detail panels (see gotchas below). Kept around
  as a debugging aid, not part of the normal workflow.
- `scripts/categorize.js` — offline Node tool (`node scripts/categorize.js`), no
  browser involved. Reads `data/starred-places.json` (gitignored — personal data)
  and buckets places into named categories by matching the last `·`-separated
  segment of their raw category string against curated arrays
  (`RESTAURANT_TYPES`, `CAFE_TYPES`, `HEALTH_TYPES`, etc.). This is the source of
  truth for "what real category strings exist in Jake's data and which bucket they
  belong to" — `move-script.js`'s category constants should be derived from here,
  not guessed or copied from generic Google Maps category lists.
- `scripts/plan.js` — offline Node tool (`node scripts/plan.js`), no browser
  involved. Applies `move-script.js`'s exact category constants (not
  `categorize.js`'s) to `data/starred-places.json` and writes the expected
  target list for every place to `data/plan.json` (gitignored). Pure
  derivation, never hand-edited — re-run any time `data/starred-places.json`
  or `move-script.js`'s category constants change. This is the offline
  preview of what a live `processStarred()` run would move where.
- `data/starred-places.json` — gitignored. Real scraped personal data (home/work
  addresses, medical providers, kids' school, etc.). Never commit it, never print
  its full contents into anything that gets committed or shared.

## Working with the live browser

This is Jake's real, logged-in Google account. Every click/toggle has a real effect
on his real saved places. That said, list-membership changes (add/remove from a
list, create a list) are within the sanctioned scope of this whole project — don't
ask permission for routine sweep actions, but do stop and report rather than
guessing when something looks systemically wrong (see gotchas below).

To drive it: `ToolSearch` for `mcp__claude-in-chrome__*` tools in one batched call
(`tabs_context_mcp`, `navigate`, `computer`, `read_page`, `javascript_tool`,
`tabs_create_mcp`, `browser_batch`, `find`), call `tabs_context_mcp` first. If it
errors about multiple connected Chrome browsers, use `AskUserQuestion` listing every
connected browser plus the "confirmation screen" option (per the error's own
instructions), then `switch_browser`.

Prefer `javascript_tool`'s `javascript_exec` for anything beyond a single click —
inject small `async () => {...}` IIFEs, stash results on `window.__foo` so you can
poll them across multiple tool calls without losing state, and only fall back to
`computer` (real mouse clicks/screenshots) when a raw `.click()` genuinely doesn't
trigger the underlying handler (see gotchas).

## Hard-won DOM/gotcha notes

- **Clicking a list row on the Lists-overview page to navigate into it
  (`Starred places`, or any other list) is inconsistent.** Confirmed multiple times
  across sessions: `document.querySelectorAll('*')` text-match + `.closest('button')`
  + `.click()`, ref-based clicks, and real coordinate clicks have all, on different
  occasions, either worked fine or silently done nothing (row just highlights, no
  navigation, `.BsJqK`/`h1` stay empty). Likely root cause (2026-08-09): Google
  Maps' whole SPA navigation breaks in some browser sessions — the tab *title*
  updates while the DOM, `location` and panel never change. Full page loads still
  work. Don't retry the same click: switch to `place-search-script.js`, which never
  needs the list page — this has been a fresh 30+ minute dead end more than once.

These cost real debugging time across multiple sessions. Read before touching the
Save-dialog or list-scrolling logic in `move-script.js`.

- **Row click target**: a Starred-list row's outer div (`.BsJqK`) is an inert
  wrapper with no `jsaction` — clicking it does nothing. The actual clickable
  element is `row.querySelector('.fontHeadlineSmall').closest('button')`. Confirmed
  live by inspecting the real row HTML the user pasted in — don't re-derive this
  from guesswork, it required seeing the real markup.
- **Save-menu click targets (confirmed live 2026-08-09, supersedes the older
  `.closest('[aria-checked]')` note that `move-script.js` still follows).** Open the
  menu by JS-clicking `[data-value*="Save"]`, then poll for
  `[role="menu"][aria-label="Save in your lists"]`. Each list is an `[aria-checked]`
  row. To **add**, JS-click the row's inner `.mLuXec` label div — clicking the
  `[aria-checked]` row itself does nothing. To **remove**, JS-click the checked
  row's `.r5q4Qd` check-icon span — `.mLuXec` on an already-checked row is a silent
  no-op. Never click "some nearby parent": Google's jsaction handlers bind at
  specific nesting depths and sibling divs carry unrelated jsactions.
- **Real mouse clicks and key presses don't activate Maps' jsaction handlers** (the
  `computer` tool only hovers/highlights). Everything has to be a JS `.click()`.
- **The Save menu is one-shot.** After any toggle it closes and the Save button goes
  inert until a full page reload — one toggle per page load, so add-then-unstar
  needs two loads. `document.body.click()` does **not** close the menu.
- **Wait ~5.5s after a toggle before navigating away**, or the save is cancelled in
  flight (observed: an add that reported success silently didn't persist).
- **The Save button label is a cheap state check:** `Saved` = 1 list, `Saved (2)` =
  2 lists, etc.
- **Checkbox state reads are unreliable close to a state change.** Confirmed live,
  repeatedly, against a 200+ item list: a place visibly already in a list can still
  show `aria-checked="false"` the instant the Save dialog opens, and polling
  `aria-checked` immediately after clicking a checkbox can report a false negative
  even though the click genuinely worked (Google re-sorts checked items to the top
  of the dialog, and the DOM node you're polling can be mid-reorder/replaced). Server
  sync also lags the UI: a fresh reload right after an add can still read unchecked,
  then read checked a load later. The reliable pattern is a fresh page load before
  any read you act on (the older "close with `document.body.click()` and reopen"
  advice doesn't work — that click doesn't close the menu). Never trust a same-paint
  read, and treat a single unconfirmed read as "retry later", not "failed".
- **`returnToList()` must detect layout, not assume it.** Google Maps renders place
  details two different ways depending on window width: one fully replaces the list
  panel with the place's own page (needs a "Back" click to return), the other shows
  the place as a floating card over a still-open, still-interactive list (nothing to
  navigate back from — clicking "Back" anyway overshoots into some other navigation
  stack entirely, observed landing on the Lists-overview page, which then breaks
  every subsequent item in the same run). Detect which situation you're in by
  checking whether list rows (`.BsJqK`) are still present in the DOM, not by
  checking URL or window size.
- **Both the Starred-places row list and the Lists-overview list are virtualized.**
  Don't conclude "reached the end" from `scrollHeight` alone — it can plateau while
  the actual set of rendered row *names* is still changing underneath. Compare row
  names/count after scrolling, and require several consecutive "no change" rounds
  (3 was reliable in testing) before concluding you've hit the real end.
- **The physical browser window can resize itself mid-session** (observed dropping
  to 135px wide with no clear trigger — possibly the user's own OS-level window
  management, not something the agent did). This can trigger a full page
  reload/reflow, wiping any `window.__foo` state injected via `javascript_exec`. If
  a poll suddenly returns `undefined` for state you know you set, don't chase a
  logic bug — just re-inject and continue. Re-running `processStarred()` from a
  reset `skipped`/`moved` is safe: already-added places just get correctly
  re-skipped (their checkbox is already checked, so the "add" step naturally fails
  closed and logs a skip, not a duplicate add). `resize_window` calls did not
  reliably fix this once it happened; not worth fighting.
- **No wait/poll in this codebase is unbounded.** Every `waitForX` has a timeout and
  resolves to a boolean rather than hanging. Keep that property in anything new — a
  stuck single item should degrade to "skip and log," never hang the whole sweep.
- **Creating new Google Maps lists can fail with HTTP 400** from
  `.../maps/preview/entitylist/create` for reasons not fully diagnosed (checked:
  not a duplicate-name collision, no stray "Untitled list" entries). Possibly a
  rate-limit from heavy in-session API usage. Don't hammer retries if this happens —
  stop and ask the user to create the list manually rather than guessing at a cause.
- **Verify important state changes via a fresh page reload**, not just in-session
  reads. This codebase has repeatedly hit false-negative *and* false-positive
  verification bugs (an action reported as failed that actually succeeded, and vice
  versa) that only a clean reload's DOM state resolved definitively.

## Repo conventions

- Git commits end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Only commit when explicitly asked, or when a task's own instructions say to commit
  on completion — never commit speculatively.
- This repo has a `wrapup-repos` automation (an off-peak scheduled job, unrelated to
  any specific agent session) that sometimes auto-commits leftover uncommitted
  working-tree changes with a `wip(auto): ...` message. Seeing commits you don't
  remember making is expected, not a sign of a conflicting process — read the diff
  before assuming anything is wrong.
- `.claude/IN_PROGRESS.md` is where that automation (and close-out) record open
  decisions and code-state notes — gitignored on purpose, never commit it.
- Never commit `data/` (real personal data) or `.playwright-mcp/` (local debugging
  artifacts).
