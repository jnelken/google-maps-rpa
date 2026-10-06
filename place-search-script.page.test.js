// Drives place-search-script.js's browser path against a fake Maps page in a
// vm context: one context per simulated page load, localStorage shared
// between them, timers shortened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, 'place-search-script.js'), 'utf8');

function createBrowser({ h1 = 'Test Cafe', lists, onSaveClick = () => {} }) {
  const store = {};
  const localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  };
  const clicks = [];
  const navigations = [];
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
      console: { log() {}, table() {} },
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
