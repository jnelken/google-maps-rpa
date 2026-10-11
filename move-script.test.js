// Drives move-script.js against a fake Google Maps list page in a vm context:
// rows, the place detail h1, the Save dialog and the Back button are plain
// objects answering exactly the selectors the script uses. Timers are
// shortened and Date.now() advances 1s per call, so bounded waits time out
// fast.
//
// The fake models the page move-script.js assumes, not live Maps: clicking
// the [aria-checked] row toggles it, and document.body.click() closes a Save
// menu that can be reopened on the same load. CLAUDE.md records that live
// Maps (2026-08) does neither. These tests pin the script's current
// behavior; they are not evidence that it works live.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, 'move-script.js'), 'utf8');

const BUCKET_ORDER = [
  ['Restaurants', 'RESTAURANT_TYPES'],
  ['Coffee Shops', 'CAFE_TYPES'],
  ['Nightlife', 'NIGHTLIFE_TYPES'],
  ['Forest', 'FOREST_TYPES'],
  ['Visited', 'VISITED_TYPES'],
  ['Outdoors', 'OUTDOORS_TYPES'],
  ['Health', 'HEALTH_TYPES'],
  ['Kids', 'KIDS_TYPES'],
  ['Beauty', 'BEAUTY_TYPES'],
  ['Shopping', 'SHOPPING_TYPES'],
  ['Errands', 'ERRANDS_TYPES'],
  ['Fitness', 'FITNESS_TYPES'],
  ['Going Out', 'GOING_OUT_TYPES'],
  ['Ashrams', 'ASHRAMS_TYPES'],
  ['Desks', 'DESKS_TYPES'],
];
const SOURCE = 'Starred places';
const DIALOG_LABELS = [SOURCE, 'Archived', ...BUCKET_ORDER.map(([label]) => label)];

// rows: { name, rawCategory, rating, isBroken, inStarred = true, lists = [] }
// stuck: names whose Save-dialog checkbox clicks never take effect.
// unopenable: names whose row button opens nothing.
// layout: 'card' keeps the list rendered under an open place; 'replace'
// swaps it out and needs the Back button.
function createPage({ rows = [], stuck = [], unopenable = [], layout = 'card' } = {}) {
  const logs = [];
  const clicks = [];
  const membership = new Map();
  let listShown = false;
  let open = null;
  let dialogOpen = false;
  let now = 0;

  const rowEls = rows.map((place) => {
    const key = place.name ?? null;
    membership.set(key, new Set([...(place.inStarred === false ? [] : [SOURCE]), ...(place.lists || [])]));
    const button = {
      click: () => {
        clicks.push(['open', key]);
        if (!unopenable.includes(key)) open = key;
      },
    };
    const nameEl = { textContent: ` ${key} `, closest: s => (s === 'button' ? button : null) };
    const blocks = [];
    if (place.rating) blocks.push({ textContent: place.rating });
    if (place.rawCategory != null) blocks.push({ textContent: ` ${place.rawCategory} ` });
    const imgs = [{ src: place.isBroken ? 'https://x/result-no-thumbnail.png' : 'https://x/photo.jpg' }];
    return {
      querySelector: s => (s === '.fontHeadlineSmall' && key !== null ? nameEl : null),
      querySelectorAll: s => (s === '.yfRytc > .IIrLbb' ? blocks : s === 'img' ? imgs : []),
    };
  });

  const checkbox = (label, checked) => ({
    click: () => {
      clicks.push([checked ? 'uncheck' : 'check', open, label]);
      if (stuck.includes(open)) return;
      const lists = membership.get(open);
      if (checked) lists.delete(label); else lists.add(label);
    },
  });
  const dialogDivs = (checked) => {
    if (!dialogOpen) return [];
    const lists = membership.get(open);
    return DIALOG_LABELS
      .filter(label => checked === undefined || lists.has(label) === checked)
      .map((label) => {
        const isChecked = lists.has(label);
        const box = checkbox(label, isChecked);
        return { textContent: label, closest: s => (s === `[aria-checked="${isChecked}"]` ? box : null) };
      });
  };
  const saveButton = { click: () => { clicks.push(['save', open]); dialogOpen = true; } };
  const backButton = {
    getAttribute: name => (name === 'aria-label' ? 'Back' : null),
    click: () => { clicks.push(['back', open]); open = null; dialogOpen = false; },
  };

  const document = {
    body: { click: () => { dialogOpen = false; } },
    querySelector: (s) => {
      if (s === '[data-value*="Save"]') return open !== null ? saveButton : null;
      if (s === 'button[aria-label="Back"], button[jsaction*="back"]') {
        return layout === 'replace' && open !== null ? backButton : null;
      }
      return null;
    },
    querySelectorAll: (s) => {
      if (s === '.BsJqK') return listShown && (layout === 'card' || open === null) ? rowEls : [];
      if (s === 'h1') return open !== null ? [{ textContent: open }] : [];
      if (s === '[aria-checked] div') return dialogDivs();
      if (s === '[aria-checked="true"] div') return dialogDivs(true);
      if (s === '[aria-checked="false"] div') return dialogDivs(false);
      return [];
    },
  };

  const ctx = vm.createContext({
    console: { log: (...a) => logs.push(a.join(' ')), table: () => {} },
    document,
    Date: { now: () => (now += 1000) },
    setTimeout: fn => setTimeout(fn, 0),
    setInterval: fn => setInterval(fn, 0),
    clearInterval,
  });

  const get = expr => vm.runInContext(expr, ctx);
  return {
    ctx,
    logs,
    clicks,
    get,
    lists: name => [...membership.get(name)].sort(),
    adds: () => clicks.filter(c => c[0] === 'check').map(([, name, label]) => [name, label]),
    moved: () => JSON.parse(JSON.stringify(get('moved'))),
    skipped: () => JSON.parse(JSON.stringify(get('skipped'))),
    process: () => get('processStarred()'),
    sweep: () => get('sweepRemoveFromStarred()'),
    async paste() {
      vm.runInContext(SRC, ctx);
      await new Promise(resolve => setImmediate(resolve));
      listShown = true;
      logs.length = 0;
      clicks.length = 0;
      return this;
    },
  };
}

const load = opts => createPage(opts).paste();

test('pasting with no rows rendered runs phase 1 once and opens nothing', async () => {
  const page = createPage();
  vm.runInContext(SRC, page.ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(page.clicks, []);
  assert.ok(page.logs[0].startsWith('No more matching rows in the currently-rendered list.'));
});

test('each bucket routes its own types to its list, in table order', async () => {
  const probe = await load();
  const rows = [];
  const expected = [];
  for (const [, constName] of BUCKET_ORDER) {
    for (const type of probe.get(constName)) {
      const owner = BUCKET_ORDER.find(([, c]) => probe.get(c).includes(type))[0];
      const name = `Place ${rows.length}`;
      rows.push({ name, rawCategory: `$$ · ${type.toUpperCase()}` });
      expected.push([name, owner]);
    }
  }

  const s = await load({ rows });
  await s.process();
  assert.deepEqual(s.adds(), expected);
  assert.equal(s.moved().length, rows.length);
  assert.deepEqual(s.skipped(), []);
});

test('a routed row logs its target and records name, rawCategory and targetLabel', async () => {
  const s = await load({ rows: [{ name: 'Alpha', rating: '4.5', rawCategory: '$20–40 · Italian' }] });
  await s.process();
  assert.deepEqual(s.adds(), [['Alpha', 'Restaurants']]);
  assert.deepEqual(s.moved(), [{ name: 'Alpha', rawCategory: '$20–40 · Italian', targetLabel: 'Restaurants' }]);
  assert.ok(s.logs.includes('Adding to Restaurants: Alpha [$20–40 · Italian]'));
});

test('permanently closed goes to Archived ahead of any category match', async () => {
  const s = await load({ rows: [{ name: 'Beta', rawCategory: 'Permanently closed · Cafe' }] });
  await s.process();
  assert.deepEqual(s.adds(), [['Beta', 'Archived']]);
  assert.deepEqual(s.moved(), [{ name: 'Beta', rawCategory: 'Permanently closed · Cafe', targetLabel: 'Archived' }]);
  assert.ok(s.logs.includes('Adding to Archived (permanently closed): Beta'));
});

test('broken rows are skipped before the closed check and never opened', async () => {
  const s = await load({
    rows: [{ name: 'Gamma', rawCategory: 'Permanently closed · Cafe', isBroken: true }],
  });
  await s.process();
  assert.deepEqual(s.clicks, []);
  assert.deepEqual(s.skipped(), [{ name: 'Gamma', rawCategory: 'Permanently closed · Cafe' }]);
  assert.ok(s.logs.includes('Skipping (broken/no thumbnail): Gamma'));
});

test('rows matching no bucket are skipped silently', async () => {
  const s = await load({
    rows: [
      { name: 'Delta', rawCategory: 'Unlisted thing' },
      { name: 'Epsilon', rawCategory: null },
      { rawCategory: 'Cafe extra' },
    ],
  });
  await s.process();
  assert.deepEqual(s.clicks, []);
  assert.deepEqual(s.skipped(), [
    { name: 'Delta', rawCategory: 'Unlisted thing' },
    { name: 'Epsilon', rawCategory: null },
    { name: '(unnamed row)', rawCategory: 'Cafe extra' },
  ]);
  assert.ok(!s.logs.some(l => l.startsWith('Adding to')));
});

test('a failed add is skipped for manual review and the loop moves on', async () => {
  const s = await load({
    rows: [
      { name: 'Zeta', rawCategory: 'Pub' },
      { name: 'Eta', rawCategory: 'Permanently closed' },
      { name: 'Theta', rawCategory: 'Park' },
    ],
    stuck: ['Zeta', 'Eta'],
  });
  await s.process();
  assert.deepEqual(s.adds(), [['Zeta', 'Nightlife'], ['Eta', 'Archived'], ['Theta', 'Outdoors']]);
  assert.deepEqual(s.skipped(), [
    { name: 'Zeta', rawCategory: 'Pub' },
    { name: 'Eta', rawCategory: 'Permanently closed' },
  ]);
  assert.deepEqual(s.moved(), [{ name: 'Theta', rawCategory: 'Park', targetLabel: 'Outdoors' }]);
  assert.ok(s.logs.includes('After reopening, "Nightlife" still doesn\'t show aria-checked="true" - treating as failed'));
  assert.ok(s.logs.includes('Failed to add Zeta to Nightlife, leaving in place for manual review'));
  assert.ok(s.logs.includes('Failed to add Eta to Archived, leaving in place for manual review'));
});

test('already moved or skipped rows are not retried on a re-run', async () => {
  const s = await load({
    rows: [{ name: 'Iota', rawCategory: 'Fitness center' }, { name: 'Kappa', rawCategory: 'Nope' }],
  });
  await s.process();
  await s.process();
  assert.deepEqual(s.adds(), [['Iota', 'Fitness']]);
  assert.equal(s.skipped().length, 1);
});

test('phase 1 opens the row button, saves to the target via a reopened dialog, and leaves Starred alone', async () => {
  const s = await load({ rows: [{ name: 'Lambda', rawCategory: 'Cafe' }] });
  await s.process();
  assert.deepEqual(s.clicks, [
    ['open', 'Lambda'],
    ['save', 'Lambda'],
    ['check', 'Lambda', 'Coffee Shops'],
    ['save', 'Lambda'],
  ]);
  assert.deepEqual(s.lists('Lambda'), ['Coffee Shops', SOURCE]);
  assert.equal(s.logs.filter(l => l.startsWith('Checkbox labels found in Save dialog')).length, 1);
  assert.ok(s.logs.includes(`1 item(s) added to target lists and still in ${SOURCE} - run sweepRemoveFromStarred() when ready to remove them.`));
});

test('a row whose detail panel never opens is skipped without touching the Save dialog', async () => {
  const s = await load({ rows: [{ name: 'Mu', rawCategory: 'Cafe' }], unopenable: ['Mu'] });
  await s.process();
  assert.deepEqual(s.clicks, [['open', 'Mu']]);
  assert.deepEqual(s.skipped(), [{ name: 'Mu', rawCategory: 'Cafe' }]);
  assert.ok(s.logs.includes('Detail panel for "Mu" never opened (h1 text didn\'t match) - skipping'));
});

test('in the replacing layout every item clicks Back to return to the list', async () => {
  const s = await load({
    rows: [{ name: 'Nu', rawCategory: 'Cafe' }, { name: 'Xi', rawCategory: 'Pub' }],
    stuck: ['Xi'],
    layout: 'replace',
  });
  await s.process();
  assert.deepEqual(s.clicks.filter(c => c[0] === 'back'), [['back', 'Nu'], ['back', 'Xi']]);
  assert.deepEqual(s.moved().map(m => m.name), ['Nu']);
  assert.deepEqual(s.skipped().map(m => m.name), ['Xi']);
});

test('phase 2 removes Starred only from added places, keeping the target', async () => {
  const s = await load({
    rows: [{ name: 'Omicron', rawCategory: 'Cafe' }, { name: 'Pi', rawCategory: 'Nope' }],
  });
  await s.process();
  s.clicks.length = 0;
  await s.sweep();
  assert.deepEqual(s.clicks, [
    ['open', 'Omicron'],
    ['save', 'Omicron'],
    ['save', 'Omicron'],
    ['uncheck', 'Omicron', SOURCE],
    ['save', 'Omicron'],
  ]);
  assert.deepEqual(s.lists('Omicron'), ['Coffee Shops']);
  assert.deepEqual(s.lists('Pi'), [SOURCE]);
  assert.equal(s.moved()[0].removedFromStarred, true);
  assert.equal(s.logs.at(-1), 'Nothing left to remove - moved list is empty or everything is already removed.');
});

test('phase 2 treats a place already out of Starred as removed without toggling', async () => {
  const s = await load({ rows: [{ name: 'Rho', rawCategory: 'Cafe', inStarred: false }] });
  await s.process();
  s.clicks.length = 0;
  await s.sweep();
  assert.ok(!s.clicks.some(c => c[0] === 'uncheck'));
  assert.equal(s.moved()[0].removedFromStarred, true);
  assert.ok(s.logs.includes(`"Rho" is not currently checked in ${SOURCE} - nothing to remove`));
});

test('phase 2 leaves a failed removal pending for a later sweep', async () => {
  const s = await load({ rows: [{ name: 'Sigma', rawCategory: 'Cafe', lists: ['Coffee Shops'] }], stuck: ['Sigma'] });
  s.get('moved').push({ name: 'Sigma', rawCategory: 'Cafe', targetLabel: 'Coffee Shops' });
  await s.sweep();
  assert.ok(s.clicks.some(c => c[0] === 'uncheck'));
  assert.equal(s.moved()[0].removedFromStarred, undefined);
  assert.ok(s.logs.includes(`Failed to remove Sigma from ${SOURCE}, leaving for manual review`));
  assert.ok(s.logs.includes('1 added item(s) not found in the currently-rendered list. Scroll down to load more, then run sweepRemoveFromStarred() again.'));
});

test('phase 2 with nothing pending opens nothing', async () => {
  const s = await load({ rows: [{ name: 'Tau', rawCategory: 'Cafe' }] });
  await s.sweep();
  assert.deepEqual(s.clicks, []);
  assert.ok(s.logs.includes('Nothing left to remove - moved list is empty or everything is already removed.'));
});
