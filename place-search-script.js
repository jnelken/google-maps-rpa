// ==UserScript==
// @name         google-maps-rpa per-place search
// @match        https://www.google.com/maps/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//
// Per-place-search route for moving Starred places into topic lists.
//
// move-script.js walks the rows of the open Starred places list, which needs
// Google Maps' in-app (SPA) navigation. When that navigation is broken - tab
// title changes, DOM and panel don't - use this script instead. It never
// touches the list page: every place is reached by a full page load of
// https://www.google.com/maps/search/<name>, which resolves straight to the
// place page, and list membership is toggled from that page's Save menu.
//
// One Save-menu toggle per page load, because the menu is one-shot: after any
// toggle it closes and the Save button stays inert until a reload. Moving a
// place therefore takes two loads, in two separate phases:
//
//   Phase 1 - gmps.start(1): ADD each queued place to its target list. Only
//   acts when the h1 name matches the queued name and Starred places reads
//   checked (rejects wrong search hits and places no longer starred). Never
//   touches Starred places membership.
//   Phase 2 - gmps.start(2): run separately once you're happy with phase 1.
//   REMOVES Starred places, but only when a fresh load shows the target list
//   checked - that read is the add confirmation.
//
// Gate order means a failure leaves a place in both lists, never in neither.
// Every wait is bounded; a stuck item is logged and skipped, never hung on.
// State and per-place results persist in localStorage (STATE_KEY) on the
// google.com origin, so a rerun skips finished places and resumes.
//
// Setup (Node, offline): `node scripts/plan.js`, then `pbcopy < data/plan.json`.
// Usage (browser, on any google.com/maps tab):
//   1. Paste this whole file into the console.
//   2. gmps.load(<paste data/plan.json>)   - queues every place with a target
//   3. gmps.start(1)                        - phase 1, navigates to the first place
//   4. After every page load, resume with the one-liner (or install this file
//      as a Tampermonkey/Violentmonkey userscript and it resumes on its own):
//        window.gmps = (0,eval)(localStorage.getItem('__gmpsSrc'))(); gmps.resume();
//   5. When phase 1 reports complete, check the target lists, then
//      gmps.start(2) and resume the same way.
//   gmps.status() prints progress, gmps.stop() halts, gmps.retry() re-queues
//   skipped places for the current phase.
//
// VALIDATION STATUS (2026-10): the Save-menu mechanics below were confirmed
// live on 2026-08-09 with a hand-driven version of this flow. This script
// itself has only been statically reviewed and unit-tested (pure logic, see
// place-search-script.test.js) - it has not been run end-to-end live yet.

function gmPlaceSearch() {
  const STATE_KEY = '__gmps';
  const SRC_KEY = '__gmpsSrc';
  const SOURCE_LIST_LABEL = 'Starred places';
  const MAX_TRIES = 3;
  // Navigating away sooner than this after a toggle cancels the save in
  // flight (confirmed live: an add that reported success didn't persist).
  const POST_TOGGLE_WAIT_MS = 5500;
  const POST_SKIP_WAIT_MS = 500;
  const PAGE_READY_TIMEOUT_MS = 20000;
  const MENU_TIMEOUT_MS = 8000;
  // A pending navigation older than this means the page we're on isn't the
  // one we navigated to (user wandered off, tab was restored later). Generous
  // because a human may take a while to paste the resume one-liner.
  const STALE_NAV_MS = 15 * 60 * 1000;
  const MIN_PREFIX_MATCH_LENGTH = 4;

  const DONE_STATUSES = {
    1: ['added', 'already-in-target'],
    2: ['removed', 'already-removed'],
  };
  const RETRYABLE_STATUSES = ['load-timeout', 'menu-timeout', 'target-not-confirmed'];

  // ---- Pure logic (unit-tested) ----

  function normalizeName(name) {
    return String(name || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Same normalized name, or the page name is the queued name plus trailing
  // whole words (a branch suffix like "Blue Bottle Coffee - Hayes Valley").
  // Never the reverse: a queued branch name must not accept the generic
  // place. Partial overlap ("Joe's Pizza" vs "Joe's Coffee") never matches.
  function namesMatch(expected, actual) {
    const ne = normalizeName(expected);
    const na = normalizeName(actual);
    if (!ne || !na) return false;
    if (ne === na) return true;
    return ne.length >= MIN_PREFIX_MATCH_LENGTH && na.startsWith(ne + ' ');
  }

  function placeKey(item) {
    return `${item.name}\u2192${item.target}`;
  }

  function searchUrl(name) {
    return 'https://www.google.com/maps/search/' + encodeURIComponent(name);
  }

  // Accepts data/plan.json rows (or bare { name, target } objects) and keeps
  // only places with a target list. A name search can't tell two places with
  // the same name apart (the plan has no address or place ID), so every name
  // that appears more than once is left out of the queue for manual handling.
  function buildQueue(planRows) {
    if (!Array.isArray(planRows)) throw new Error('expected an array of plan rows');
    const items = [];
    const counts = new Map();
    for (const row of planRows) {
      if (!row || typeof row.name !== 'string' || !row.name.trim()) continue;
      if (typeof row.target !== 'string' || !row.target.trim()) continue;
      const item = { name: row.name.trim(), target: row.target.trim() };
      const norm = normalizeName(item.name);
      counts.set(norm, (counts.get(norm) || 0) + 1);
      items.push(item);
    }
    const isAmbiguous = item => counts.get(normalizeName(item.name)) > 1;
    return {
      queue: items.filter(item => !isAmbiguous(item)),
      ambiguous: items.filter(isAmbiguous),
    };
  }

  function emptyState() {
    return { queue: [], results: {}, phase: 1, running: false, current: null };
  }

  function phaseResult(state, item, phase) {
    const entry = state.results[placeKey(item)];
    return entry ? entry['p' + phase] : undefined;
  }

  function isEligible(state, item, phase) {
    if (phase === 2) {
      const p1 = phaseResult(state, item, 1);
      if (!p1 || !DONE_STATUSES[1].includes(p1.status)) return false;
    }
    const result = phaseResult(state, item, phase);
    if (!result) return true;
    return RETRYABLE_STATUSES.includes(result.status) && result.tries < MAX_TRIES;
  }

  // The persisted state still expects this page to act on `item` - false
  // once gmps.stop() ran or another tab moved the run on.
  function isStillCurrent(state, item, phase) {
    return !!state.running && state.phase === phase && !!state.current
      && state.current.phase === phase && state.current.key === placeKey(item);
  }

  function nextItem(state) {
    return state.queue.find(item => isEligible(state, item, state.phase)) || null;
  }

  // Returns a new state; `status` is the outcome of one page-load attempt.
  function recordResult(state, item, phase, status, now) {
    const key = placeKey(item);
    const entry = { ...(state.results[key] || {}) };
    const prev = entry['p' + phase];
    entry['p' + phase] = { status, tries: (prev ? prev.tries : 0) + 1, at: now };
    return { ...state, results: { ...state.results, [key]: entry } };
  }

  // Clears every non-done result for `phase` so those places run again.
  function clearSkipped(state, phase) {
    const results = {};
    for (const [key, entry] of Object.entries(state.results)) {
      const result = entry['p' + phase];
      const next = { ...entry };
      if (result && !DONE_STATUSES[phase].includes(result.status)) delete next['p' + phase];
      results[key] = next;
    }
    return { ...state, results };
  }

  // Phase 1: add to target only when this is the right place and it is
  // still starred. `menu` is null when the Save menu never opened.
  function decidePhase1({ expectedName, h1, menu }) {
    if (!h1) return { action: 'skip', status: 'load-timeout' };
    if (!namesMatch(expectedName, h1)) return { action: 'skip', status: 'name-mismatch' };
    if (!menu) return { action: 'skip', status: 'menu-timeout' };
    if (!menu.sourceFound || !menu.sourceChecked) return { action: 'skip', status: 'not-starred' };
    if (!menu.targetFound) return { action: 'skip', status: 'target-missing' };
    if (menu.targetChecked) return { action: 'none', status: 'already-in-target' };
    return { action: 'add-target', status: 'added' };
  }

  // Phase 2: remove from Starred places only once this fresh load shows the
  // target list checked. Server sync can lag an add by a load, so an
  // unconfirmed target is retryable rather than final.
  function decidePhase2({ expectedName, h1, menu }) {
    if (!h1) return { action: 'skip', status: 'load-timeout' };
    if (!namesMatch(expectedName, h1)) return { action: 'skip', status: 'name-mismatch' };
    if (!menu) return { action: 'skip', status: 'menu-timeout' };
    if (!menu.targetFound) return { action: 'skip', status: 'target-missing' };
    if (!menu.targetChecked) return { action: 'skip', status: 'target-not-confirmed' };
    if (!menu.sourceFound || !menu.sourceChecked) return { action: 'none', status: 'already-removed' };
    return { action: 'remove-source', status: 'removed' };
  }

  function summarize(state) {
    const counts = {};
    for (const item of state.queue) {
      for (const phase of [1, 2]) {
        const result = phaseResult(state, item, phase);
        const label = `p${phase}:${result ? result.status : 'pending'}`;
        counts[label] = (counts[label] || 0) + 1;
      }
    }
    return counts;
  }

  // ---- Browser side ----

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? { ...emptyState(), ...JSON.parse(raw) } : emptyState();
    } catch (err) {
      console.log('gmps: could not read saved state, starting empty', err);
      return emptyState();
    }
  }

  function saveState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Resolves to the predicate's truthy value, or null after timeoutMs.
  async function waitFor(predicate, timeoutMs, intervalMs = 200) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      const value = predicate();
      if (value) return value;
      await delay(intervalMs);
    }
    return null;
  }

  function readH1() {
    const h1 = document.querySelector('h1');
    const text = h1 ? h1.textContent.trim() : '';
    return text || null;
  }

  function findMenu() {
    return document.querySelector('[role="menu"][aria-label="Save in your lists"]');
  }

  // Each list in the Save menu is an [aria-checked] row whose .mLuXec div
  // holds the list name.
  function findListRow(menuEl, label) {
    const rows = Array.from(menuEl.querySelectorAll('[aria-checked]'));
    return rows.find(row => {
      const labelEl = row.querySelector('.mLuXec');
      return labelEl && labelEl.textContent.trim() === label;
    }) || null;
  }

  async function openSaveMenu() {
    const button = await waitFor(() => document.querySelector('[data-value*="Save"]'), MENU_TIMEOUT_MS);
    if (!button) return null;
    button.click();
    return waitFor(findMenu, MENU_TIMEOUT_MS);
  }

  function readMenu(menuEl, targetLabel) {
    const source = findListRow(menuEl, SOURCE_LIST_LABEL);
    const target = findListRow(menuEl, targetLabel);
    return {
      sourceFound: !!source,
      sourceChecked: !!source && source.getAttribute('aria-checked') === 'true',
      targetFound: !!target,
      targetChecked: !!target && target.getAttribute('aria-checked') === 'true',
    };
  }

  // The menu takes one toggle per page load. Adding means clicking the row's
  // .mLuXec label; removing means clicking the checked row's .r5q4Qd check
  // icon (.mLuXec on a checked row is a silent no-op, and clicking the
  // [aria-checked] row itself does nothing).
  function toggleOnce(menuEl, label, kind) {
    if (window.__gmpsToggled) {
      console.log('gmps: already toggled on this page load, refusing a second toggle');
      return false;
    }
    const row = findListRow(menuEl, label);
    const clickTarget = row && row.querySelector(kind === 'add' ? '.mLuXec' : '.r5q4Qd');
    if (!clickTarget) {
      console.log(`gmps: no ${kind} target found in the "${label}" row`);
      return false;
    }
    window.__gmpsToggled = true;
    clickTarget.click();
    return true;
  }

  function goTo(state, item) {
    const next = { ...state, current: { key: placeKey(item), phase: state.phase, at: Date.now() } };
    saveState(next);
    console.log(`gmps: phase ${state.phase} -> ${item.name} (${item.target})`);
    location.assign(searchUrl(item.name));
  }

  function advance(state) {
    const item = nextItem(state);
    if (item) {
      goTo(state, item);
      return;
    }
    const done = { ...state, running: false, current: null };
    saveState(done);
    console.log(`gmps: phase ${state.phase} complete.`);
    console.table(summarize(done));
    if (state.phase === 1) {
      console.log('gmps: check the target lists, then run gmps.start(2) to remove confirmed places from Starred places.');
    }
  }

  async function actOnCurrentPage(state, item) {
    const h1 = await waitFor(readH1, PAGE_READY_TIMEOUT_MS);
    let menu = null;
    let menuEl = null;
    if (h1 && namesMatch(item.name, h1)) {
      menuEl = await openSaveMenu();
      if (menuEl) menu = readMenu(menuEl, item.target);
    }
    const phase = state.phase;
    const decide = phase === 1 ? decidePhase1 : decidePhase2;
    let { action, status } = decide({ expectedName: item.name, h1, menu });

    if (!isStillCurrent(loadState(), item, phase)) {
      console.log(`gmps: run stopped or moved on while ${item.name} loaded - not touching it`);
      return null;
    }

    let toggled = false;
    if (action === 'add-target') toggled = toggleOnce(menuEl, item.target, 'add');
    if (action === 'remove-source') toggled = toggleOnce(menuEl, SOURCE_LIST_LABEL, 'remove');
    if ((action === 'add-target' || action === 'remove-source') && !toggled) status = 'menu-timeout';

    console.log(`gmps: ${item.name} -> ${status}${h1 && status === 'name-mismatch' ? ` (page shows "${h1}")` : ''}`);
    // Record onto the freshest persisted state so a stop() that lands
    // mid-page isn't overwritten with this page's stale `running: true`.
    saveState({ ...recordResult(loadState(), item, phase, status, Date.now()), current: null });
    await delay(toggled ? POST_TOGGLE_WAIT_MS : POST_SKIP_WAIT_MS);
    return loadState();
  }

  async function resume() {
    if (window.__gmpsActive) return;
    const state = loadState();
    if (!state.running) return;
    window.__gmpsActive = true;
    try {
      const { current } = state;
      const item = current && current.phase === state.phase
        ? state.queue.find(q => placeKey(q) === current.key)
        : null;
      if (!item) {
        advance({ ...state, current: null });
        return;
      }
      if (Date.now() - current.at > STALE_NAV_MS) {
        console.log(`gmps: navigation to ${item.name} is stale, retrying it`);
        advance(recordResult(state, item, state.phase, 'load-timeout', Date.now()));
        return;
      }
      const after = await actOnCurrentPage(state, item);
      if (after && after.running) advance(after);
    } finally {
      window.__gmpsActive = false;
    }
  }

  function load(planRows) {
    const { queue, ambiguous } = buildQueue(planRows);
    const state = { ...loadState(), queue, running: false, current: null };
    saveState(state);
    console.log(`gmps: queued ${queue.length} place(s); earlier results kept, so finished places are skipped.`);
    if (ambiguous.length) {
      console.log(`gmps: left out ${ambiguous.length} place(s) whose name appears more than once - move these by hand:`);
      console.table(ambiguous);
    }
    return queue.length;
  }

  function start(phase = 1) {
    if (phase !== 1 && phase !== 2) throw new Error('phase must be 1 or 2');
    const state = { ...loadState(), phase, running: true, current: null };
    if (state.queue.length === 0) {
      console.log('gmps: queue is empty - run gmps.load(<data/plan.json>) first');
      return;
    }
    saveState(state);
    resume();
  }

  function stop() {
    saveState({ ...loadState(), running: false, current: null });
    console.log('gmps: stopped. gmps.start(<phase>) picks up where it left off.');
  }

  function retry() {
    const state = loadState();
    saveState(clearSkipped(state, state.phase));
    console.log(`gmps: cleared skipped phase ${state.phase} results; gmps.start(${state.phase}) to retry them.`);
  }

  function status() {
    const state = loadState();
    console.log(`gmps: phase ${state.phase}, ${state.running ? 'running' : 'stopped'}, ${state.queue.length} queued`);
    console.table(summarize(state));
    const skipped = state.queue
      .map(item => ({ name: item.name, target: item.target, result: phaseResult(state, item, state.phase) }))
      .filter(r => r.result && !DONE_STATUSES[state.phase].includes(r.result.status))
      .map(r => ({ name: r.name, target: r.target, status: r.result.status, tries: r.result.tries }));
    if (skipped.length) console.table(skipped);
  }

  function reset() {
    localStorage.removeItem(STATE_KEY);
    console.log('gmps: state cleared.');
  }

  return {
    // pure, exported for tests
    normalizeName,
    namesMatch,
    placeKey,
    searchUrl,
    buildQueue,
    emptyState,
    isStillCurrent,
    nextItem,
    recordResult,
    clearSkipped,
    decidePhase1,
    decidePhase2,
    summarize,
    // browser commands
    load,
    start,
    stop,
    resume,
    retry,
    status,
    reset,
    SRC_KEY,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = gmPlaceSearch();
} else {
  window.gmps = gmPlaceSearch();
  localStorage.setItem(window.gmps.SRC_KEY, '(' + gmPlaceSearch.toString() + ')');
  window.gmps.resume();
}
