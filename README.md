# 📍 Google Maps Saved place organizer
Google Maps recently introduced a limit of 3000 saved places in the Want to go category in mobile. They still appear on desktop but make Google Maps unusable for digital nomads with a large number of pins. This script makes it possible to reorganize saved locations into smaller topic lists at scale.

# How to use the script

To use the script:
1. Create lists named `Food`, `Test`, `Coffee`, `Bakery`, `Dessert` in your Google Maps Saved section. (You can modify the `targetCategories` mapping to add support for different lists.)
2. Open the `Want to go` list
3. Copy and paste the code from the `console-script.js` file into your browser Console (`Cmd + Option + I`) and run it
4. Keep the tab open while until the script finishes running. It may get stuck in which case just refresh the page and run it again to continue.

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

# Moving Starred places into topic lists (Phase 2)

This is a two-phase process — it never removes anything from `Starred
places` until you explicitly run phase 2, so it's safe to stop after phase 1
and review before committing to the removals.

`move-script.js` routes each currently-rendered Starred place into one of
the following lists, based on its category (matching the taxonomy in
`scripts/categorize.js` — `RESTAURANT_TYPES`, `CAFE_TYPES`,
`NIGHTLIFE_TYPES`, etc.):

- `Restaurants` (restaurant/cuisine categories)
- `Coffee Shops` (cafes, coffee shops, juice bars, health food)
- `Nightlife` (bars, pubs, night clubs)
- `Forest` (vets, pet stores, dog parks)
- `Visited` (hotels, transit hubs, past-trip locations)
- `Outdoors` (hiking, parks, tourist attractions)
- `Health` (clinics, pharmacies, doctors)
- `Kids` (preschools, day cares, playgrounds)
- `Beauty` (barbers, spas, beauty supply)
- `Shopping` (clothing, furniture, markets)
- `Errands` (storage, parking, shipping, real estate)
- `Fitness` (fitness centers)
- `Going Out` (event venues, movie theaters)
- `Ashrams` (non-profits, temples, community centers)
- `Desks` (software companies, corporate offices)
- `Archived` (permanently closed places)

Anything matching none of these categories is left in `Starred places` and
logged to the `skipped` table for manual review — that's expected, not a
bug; the goal is to minimize, not necessarily zero out, what's left in
Starred places.

1. In Google Maps, create any of the lists above that you don't already
   have (same manual step as creating `Restaurants`, `Food`, etc.).
2. Open the `Starred places` list.
3. Copy and paste `move-script.js` into the browser Console and run it.
   This is phase 1: it *adds* each place to its matching list (see above),
   without touching `Starred places` membership. Everything else is left
   alone and printed as a table of skipped items (name + category) for
   manual follow-up.
4. On the first item it opens, it logs the real checkbox labels found in
   the Save dialog — confirm `SOURCE_LIST_LABEL` (`'Starred places'` by
   default) actually appears in that list before trusting the rest of the
   run. If it doesn't match, stop, edit the constant at the top of the
   script to the label you actually see, and re-run.
5. It processes one item at a time and recurses; if it looks stuck or
   wrong, refresh the tab to stop it — it's safe to resume later since it
   only acts on whatever's currently rendered.
6. When it stops on its own ("No more matching rows..."), scroll the list
   to load more rows and run `processStarred()` again in the console.
7. Once you're happy with what got added (check the target lists directly),
   run `sweepRemoveFromStarred()` in the same console session —
   this is phase 2, and it removes everything phase 1 successfully added
   from `Starred places`. Same scroll-and-re-run pattern applies if it
   doesn't find everything in one pass.

Why two phases instead of one move: testing live turned up a real Google
Maps quirk — the Save dialog's checkbox for `Starred places` can report a
stale/wrong checked state on first paint for a large (200+ item) list, which
made a single-pass "uncheck source, check target" approach unsafe. Splitting
into add-then-sweep, with a close-and-reopen-the-dialog step before trusting
any checked-state read, worked around it. (Later testing found that clicking
the page doesn't actually close the Save menu, and that only a full page
reload gives a trustworthy read — see the per-place route below.)

Both phases have been run live end-to-end against a real account and
verified via a fresh page reload (not just in-session state) — confirmed
correctly adding to `Restaurants`/`Archived` without touching `Starred
places`, and confirmed correctly removing from `Starred places` afterward.

# Per-place search (when the list page won't navigate)

Sometimes Google Maps' in-page navigation stops working: clicking a list or a
row only highlights it, and the panel never changes. `move-script.js` can't
work then, because it opens places from the list page.
`place-search-script.js` never uses the list page. It loads
`google.com/maps/search/<place name>` for each place, which opens the place
page directly, and uses that page's Save menu. Same two phases and the same
safety order: phase 1 only adds, and phase 2 removes a place from `Starred
places` only after a fresh load shows it in the target list. If anything goes
wrong, a place ends up in both lists, never in neither.

1. Build the queue offline: `node scripts/plan.js`, then
   `pbcopy < data/plan.json` (personal data — keep it out of git).
2. On any `google.com/maps` tab, paste `place-search-script.js` into the
   Console, then run `gmps.load(<paste>)` and `gmps.start(1)`.
3. Every place takes a full page load, which clears the Console. After each
   load, run
   `window.gmps = (0,eval)(localStorage.getItem('__gmpsSrc'))(); gmps.resume();`
   to carry on, or install the file as a Tampermonkey/Violentmonkey
   userscript so it resumes by itself. Only the tab where you ran
   `gmps.start()` carries on; other open Maps tabs are left alone.
4. Each place is checked before anything is clicked: the page title has to
   match the queued name, and the place has to still be in `Starred places`.
   Anything that doesn't match is skipped and logged. A name search can't
   tell two places with the same name apart, so `gmps.load()` leaves out any
   name that appears more than once and lists those for you to move by hand. `gmps.status()` shows
   progress and skips; `gmps.stop()` halts.
5. When phase 1 reports complete, check the target lists, then run
   `gmps.start(2)` and resume the same way after each load.

Progress is saved in the tab's `localStorage`, so you can stop, reload, or
rerun at any time and finished places are skipped. `gmps.retry()` re-queues
the skipped ones. This route has been unit-tested and reviewed but not yet run
live end-to-end; watch the first few places closely.

`npm test` runs the dependency-free unit tests for its logic.

Made by [@seifip](https://twitter.com/seifip) 
