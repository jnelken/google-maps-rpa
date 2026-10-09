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
      if (selector === 'h1') return h1 ? { textContent: h1 } : null;
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
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 2)),
      document,
      location: { assign: url => navigations.push(url) },
    };
    page.window = page;
    vm.createContext(page);
    return page;
  }

  return {
    store,
    clicks,
    navigations,
    logs,
    setLists: next => { currentLists = next; },
    pasteScript() {
      load();
      vm.runInContext(SOURCE, page);
      return page.gmps;
    },
    reloadAndResume() {
      load();
      vm.runInContext("window.gmps = (0,eval)(localStorage.getItem('__gmpsSrc'))();", page);
      return page.gmps.resume();
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
  await browser.reloadAndResume();
  assert.deepEqual(browser.clicks, []);
  assert.equal(browser.state().results[KEY].p1.status, 'name-mismatch');
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
