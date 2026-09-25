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

## Files

- `probe-script.js` — read-only. Prints a table of currently-rendered rows in
  whatever list is open (name, raw category, closed/broken flags). Never clicks
  anything. Use this first whenever DOM selectors might have drifted, before trusting
  any list-modifying script.
- `move-script.js` — the main tool. Two-phase: `processStarred()` adds
  category-matched places from `Starred places` into topic lists (without touching
  Starred places membership), `sweepRemoveFromStarred()` removes confirmed adds from
  Starred places afterward. See its own header comment for the current category →
  list mapping and validation status — that comment is kept up to date by whoever
  last touched the file, trust it over this doc for the current state.
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
  navigation, `.BsJqK`/`h1` stay empty). Root cause not identified. If it doesn't
  work: try the left sidebar's persistent "Saved" tab, or search for the list by
  name directly in the main search box, instead of retrying the same click — this
  has been a fresh 30+ minute dead end more than once.

These cost real debugging time across multiple sessions. Read before touching the
Save-dialog or list-scrolling logic in `move-script.js`.

- **Row click target**: a Starred-list row's outer div (`.BsJqK`) is an inert
  wrapper with no `jsaction` — clicking it does nothing. The actual clickable
  element is `row.querySelector('.fontHeadlineSmall').closest('button')`. Confirmed
  live by inspecting the real row HTML the user pasted in — don't re-derive this
  from guesswork, it required seeing the real markup.
- **Checkbox click target**: inside the Save dialog, click
  `element.closest('[aria-checked="..."]')`, never `element.parentElement`. Google's
  jsaction handlers bind at specific nesting depths — a sibling div can carry its
  own unrelated jsaction (e.g. a photo-viewer trigger), so clicking "some nearby
  parent" is not reliable; you have to click the element that actually owns the
  `aria-checked` attribute.
- **Checkbox state reads are unreliable close to a state change.** Confirmed live,
  repeatedly, against a 200+ item list: a place visibly already in a list can still
  show `aria-checked="false"` the instant the Save dialog opens, and polling
  `aria-checked` immediately after clicking a checkbox can report a false negative
  even though the click genuinely worked (Google re-sorts checked items to the top
  of the dialog, and the DOM node you're polling can be mid-reorder/replaced). The
  only reliable pattern found: close the dialog (`document.body.click()`), wait,
  reopen it, *then* read. Never trust a same-paint read.
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
