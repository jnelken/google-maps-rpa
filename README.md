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

Made by [@seifip](https://twitter.com/seifip) 
