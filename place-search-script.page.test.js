// Drives place-search-script.js's browser path against a fake Maps page in a
// vm context: one context per simulated page load, localStorage shared
// between them, timers shortened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, 'place-search-script.js'), 'utf8');

function createStorage(store = {}) {
  return {
    store,
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  };
}

// One browser tab. Pass `localStorage` to share the origin's storage with
// another tab; sessionStorage is always per tab.
function createBrowser({ h1 = 'Test Cafe', lists, onSaveClick = () => {}, localStorage = createStorage() }) {
  const { store } = localStorage;
  const sessionStorage = createStorage();
  const clicks = [];
  const navigations = [];
  const logs = [];
  // Every delay the page asks for, before the clamp below shortens it.
  const timers = [];
  let currentH1 = h1;
  let currentLists = lists;
  let menuOpen = false;

  const listRow = ([label, checked]) => ({
    getAttribute: name => (name === 'aria-checked' ? String(checked) : null),
    querySelector: selector => {
      if (selector === '.mLuXec') return { textContent: label, click: () => clicks.push(`add:${label}`) };
      if (selector === '.r5q4Qd') return { click: () => clicks.push(`remove:${label}`) };
      return null;
    },
  });
  const menuEl = { querySelectorAll: s => (s === '[aria-checked]' ? currentLists.map(listRow) : []) };
  const document = {
    querySelector: selector => {
      if (selector === 'h1') return currentH1 ? { textContent: currentH1 } : null;
      if (selector === '[data-value*="Save"]') {
        return { click: () => { menuOpen = true; onSaveClick(); } };
      }
      if (selector.startsWith('[role="menu"]')) return menuOpen ? menuEl : null;
      return null;
    },
  };

  let page;
  function load() {
    menuOpen = false;
    page = {
      localStorage,
      sessionStorage,
      console: { log: (...args) => logs.push(args.join(' ')), table() {} },
      setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, Math.min(ms, 2)); },
      document,
      location: { assign: url => navigations.push(url) },
    };
    page.window = page;
    vm.createContext(page);
    return page;
  }

  // A fresh page load that rebuilds gmps from the saved source but doesn't
  // resume yet, so a test can drive resume() itself.
  function reload() {
    load();
    vm.runInContext("window.gmps = (0,eval)(localStorage.getItem('__gmpsSrc'))();", page);
    return page.gmps;
  }

  return {
    store,
    clicks,
    navigations,
    logs,
    timers,
    setH1: next => { currentH1 = next; },
    setLists: next => { currentLists = next; },
    pasteScript() {
      load();
      vm.runInContext(SOURCE, page);
      return page.gmps;
    },
    reload,
    reloadAndResume() {
      return reload().resume();
    },
    get gmps() { return page.gmps; },
    state: () => JSON.parse(store.__gmps),
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const KEY = 'Test Cafe\u2192Coffee Shops';

test('phase 1 adds the target without touching Starred places', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  assert.deepEqual(browser.navigations, ['https://www.google.com/maps/search/Test%20Cafe']);

  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, ['add:Coffee Shops']);
  const state = browser.state();
  assert.equal(state.results[KEY].p1.status, 'added');
  assert.equal(state.running, false);
});

test('phase 2 waits for a confirmed target before removing Starred places', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  await browser.reloadAndResume();
  browser.clicks.length = 0;

  browser.gmps.start(2);
  await settle();
  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, []);
  assert.equal(browser.state().results[KEY].p2.status, 'target-not-confirmed');

  browser.setLists([['Starred places', true], ['Coffee Shops', true]]);
  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, ['remove:Starred places']);
  assert.equal(browser.state().results[KEY].p2.status, 'removed');
});

test('a wrong search result is skipped without any toggle', async () => {
  const browser = createBrowser({ h1: 'Some Other Cafe', lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  browser.logs.length = 0;
  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, []);
  assert.equal(browser.state().results[KEY].p1.status, 'name-mismatch');
  assert.ok(browser.logs.includes('gmps: Test Cafe -> name-mismatch (page shows "Some Other Cafe")'));
});

test('only the tab that started the run resumes it', async () => {
  const shared = createStorage();
  const lists = [['Starred places', true], ['Coffee Shops', false]];
  const owner = createBrowser({ lists, localStorage: shared });
  const other = createBrowser({ h1: 'Unrelated Place', lists, localStorage: shared });
  owner.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  owner.gmps.start(1);
  await settle();

  other.pasteScript();
  await other.reloadAndResume();
  assert.deepEqual(other.clicks, []);
  assert.deepEqual(other.navigations, []);
  assert.equal(owner.state().results[KEY], undefined);

  await owner.reloadAndResume();
  assert.deepEqual(owner.clicks, ['add:Coffee Shops']);
  assert.equal(owner.state().results[KEY].p1.status, 'added');
});

test('gmps.stop() while a page is loading prevents the toggle and stays stopped', async () => {
  let browser;
  browser = createBrowser({
    lists: [['Starred places', true], ['Coffee Shops', false]],
    onSaveClick: () => browser.gmps.stop(),
  });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();

  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, []);
  assert.equal(browser.navigations.length, 1);
  const state = browser.state();
  assert.equal(state.running, false);
  assert.equal(state.results[KEY], undefined);
});

const COMMANDS = ['load', 'start', 'stop', 'resume', 'retry', 'status', 'reset'];

test('the saved source rebuilds the full command set in a bare page', () => {
  const browser = createBrowser({ lists: [] });
  browser.pasteScript();
  const bare = { localStorage: createStorage(), sessionStorage: createStorage(), console };
  bare.window = bare;
  vm.createContext(bare);
  const gmps = vm.runInContext(`(${browser.store.__gmpsSrc})()`, bare);
  for (const name of COMMANDS) assert.equal(typeof gmps[name], 'function', name);
  assert.equal(gmps.SRC_KEY, '__gmpsSrc');
  assert.equal(gmps.searchUrl('A B'), 'https://www.google.com/maps/search/A%20B');
});

test('re-running the pasted file (the userscript path) resumes an owned run', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();

  browser.pasteScript();
  await settle();
  assert.deepEqual(browser.clicks, ['add:Coffee Shops']);
  assert.equal(browser.state().results[KEY].p1.status, 'added');
});

test('phase 1 records a place already in its target without toggling', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', true]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, []);
  assert.equal(browser.state().results[KEY].p1.status, 'already-in-target');
});

test('a stale navigation is recorded as a load-timeout and navigated again', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  const state = browser.state();
  state.current.at = Date.now() - 16 * 60 * 1000;
  browser.store.__gmps = JSON.stringify(state);

  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, []);
  const { status, tries } = browser.state().results[KEY].p1;
  assert.deepEqual({ status, tries }, { status: 'load-timeout', tries: 1 });
  assert.equal(browser.navigations.length, 2);
  assert.equal(browser.state().running, true);
});

test('start with an empty queue does nothing', async () => {
  const browser = createBrowser({ lists: [] });
  browser.pasteScript().start(1);
  await settle();
  assert.deepEqual(browser.navigations, []);
  assert.equal(browser.store.__gmps, undefined);
  assert.ok(browser.logs.some(line => line.includes('queue is empty')));
  assert.throws(() => browser.gmps.start(3));
});

test('status, retry and reset act on the saved state', async () => {
  const browser = createBrowser({ h1: 'Some Other Cafe', lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  await browser.reloadAndResume();
  assert.equal(browser.state().results[KEY].p1.status, 'name-mismatch');

  browser.logs.length = 0;
  browser.gmps.status();
  assert.deepEqual(browser.logs, ['gmps: phase 1, stopped, 1 queued']);

  browser.gmps.retry();
  assert.equal(browser.state().results[KEY].p1, undefined);
  assert.equal(browser.state().queue.length, 1);

  browser.gmps.reset();
  assert.equal(browser.store.__gmps, undefined);
});

test('missing persisted state loads as empty defaults', () => {
  const browser = createBrowser({ lists: [] });
  browser.pasteScript();
  assert.equal(browser.store.__gmps, undefined);
  browser.logs.length = 0;
  browser.gmps.status();
  assert.deepEqual(browser.logs, ['gmps: phase 1, stopped, 0 queued']);
  assert.equal(browser.store.__gmps, undefined);
});

test('malformed persisted state starts empty and logs', () => {
  const browser = createBrowser({ lists: [] });
  browser.store.__gmps = '{not-json';
  browser.pasteScript();
  browser.logs.length = 0;
  browser.gmps.status();
  assert.ok(browser.logs.some(line => line.startsWith('gmps: could not read saved state, starting empty')));
  assert.deepEqual(browser.logs.filter(line => line.startsWith('gmps: phase')), ['gmps: phase 1, stopped, 0 queued']);
});

test('partial persisted state fills missing fields from emptyState', () => {
  const browser = createBrowser({ lists: [] });
  browser.store.__gmps = JSON.stringify({
    queue: [{ name: 'Test Cafe', target: 'Coffee Shops' }],
    results: { [KEY]: { p1: { status: 'added', tries: 1, at: 1 } } },
  });
  browser.pasteScript();
  browser.logs.length = 0;
  browser.gmps.status();
  assert.deepEqual(browser.logs, ['gmps: phase 1, stopped, 1 queued']);

  // stop() re-persists through loadState, so missing fields are filled in.
  browser.gmps.stop();
  const state = browser.state();
  assert.deepEqual(state.queue, [{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  assert.equal(state.results[KEY].p1.status, 'added');
  assert.equal(state.phase, 1);
  assert.equal(state.running, false);
  assert.equal(state.current, null);
  assert.equal(state.owner, null);
});

test('resume does nothing when persisted owner does not match this tab', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  const state = browser.state();
  assert.ok(state.owner);
  state.owner = 'someone-else';
  browser.store.__gmps = JSON.stringify(state);

  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, []);
  assert.equal(browser.navigations.length, 1);
  assert.equal(browser.state().results[KEY], undefined);
  assert.equal(browser.state().running, true);
});

test('phase 1 walks a two-place queue and stops when nothing is left', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([
    { name: 'Test Cafe', target: 'Coffee Shops' },
    { name: 'Second Cafe', target: 'Coffee Shops' },
  ]);
  browser.gmps.start(1);
  await settle();
  await browser.reloadAndResume();
  assert.deepEqual(browser.navigations, [
    'https://www.google.com/maps/search/Test%20Cafe',
    'https://www.google.com/maps/search/Second%20Cafe',
  ]);

  browser.setH1('Second Cafe');
  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, ['add:Coffee Shops', 'add:Coffee Shops']);
  assert.deepEqual(browser.navigations.length, 2);
  const state = browser.state();
  assert.equal(state.results[KEY].p1.status, 'added');
  assert.equal(state.results['Second Cafe→Coffee Shops'].p1.status, 'added');
  assert.equal(state.running, false);
  assert.equal(state.current, null);
});

test('a toggle waits 5.5s before moving on, a skip only 0.5s', async () => {
  const lists = [['Starred places', true], ['Coffee Shops', false]];
  const toggled = createBrowser({ lists });
  toggled.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  toggled.gmps.start(1);
  await settle();
  toggled.timers.length = 0;
  await toggled.reloadAndResume();
  assert.deepEqual(toggled.clicks, ['add:Coffee Shops']);
  assert.deepEqual(toggled.timers, [5500]);

  const skipped = createBrowser({ h1: 'Some Other Cafe', lists });
  skipped.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  skipped.gmps.start(1);
  await settle();
  skipped.timers.length = 0;
  await skipped.reloadAndResume();
  assert.deepEqual(skipped.clicks, []);
  assert.deepEqual(skipped.timers, [500]);
});

test('phase 1 logs the navigation, the result and the phase 2 hint', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.logs.length = 0;
  browser.gmps.start(1);
  await settle();
  assert.deepEqual(browser.logs, ['gmps: phase 1 -> Test Cafe (Coffee Shops)']);

  browser.logs.length = 0;
  await browser.reloadAndResume();
  assert.deepEqual(browser.logs, [
    'gmps: Test Cafe -> added',
    'gmps: phase 1 complete.',
    'gmps: check the target lists, then run gmps.start(2) to remove confirmed places from Starred places.',
  ]);
});

test('phase 2 reports complete without the phase 2 hint', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', true]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();
  await browser.reloadAndResume();
  assert.equal(browser.state().results[KEY].p1.status, 'already-in-target');

  browser.gmps.start(2);
  await settle();
  browser.logs.length = 0;
  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, ['remove:Starred places']);
  assert.deepEqual(browser.logs, [
    'gmps: Test Cafe -> removed',
    'gmps: phase 2 complete.',
  ]);
});

test('a current pointer this phase cannot use is dropped and the queue advances', async () => {
  const lists = [['Starred places', true], ['Coffee Shops', false]];
  const otherPhase = createBrowser({ lists });
  otherPhase.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  otherPhase.gmps.start(1);
  await settle();
  const stale = otherPhase.state();
  stale.current = { key: KEY, phase: 2, at: Date.now() };
  otherPhase.store.__gmps = JSON.stringify(stale);

  await otherPhase.reloadAndResume();
  assert.deepEqual(otherPhase.clicks, []);
  assert.equal(otherPhase.state().results[KEY], undefined);
  assert.deepEqual(otherPhase.navigations, [
    'https://www.google.com/maps/search/Test%20Cafe',
    'https://www.google.com/maps/search/Test%20Cafe',
  ]);

  const unknownKey = createBrowser({ lists });
  unknownKey.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  unknownKey.gmps.start(1);
  await settle();
  const dropped = unknownKey.state();
  dropped.current = { key: 'Gone Cafe→Coffee Shops', phase: 1, at: Date.now() };
  unknownKey.store.__gmps = JSON.stringify(dropped);

  await unknownKey.reloadAndResume();
  assert.deepEqual(unknownKey.clicks, []);
  assert.equal(unknownKey.state().results[KEY], undefined);
  assert.equal(unknownKey.navigations.length, 2);
});

test('a second resume on the same page load is ignored', async () => {
  const browser = createBrowser({ lists: [['Starred places', true], ['Coffee Shops', false]] });
  browser.pasteScript().load([{ name: 'Test Cafe', target: 'Coffee Shops' }]);
  browser.gmps.start(1);
  await settle();

  const gmps = browser.reload();
  const first = gmps.resume();
  await gmps.resume();
  await first;
  assert.deepEqual(browser.clicks, ['add:Coffee Shops']);
  assert.equal(browser.state().results[KEY].p1.tries, 1);
});
