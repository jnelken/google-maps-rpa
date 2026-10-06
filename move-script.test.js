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

// Loads move-script.js into a sandbox with no DOM, then swaps the page-facing
// functions for fakes: rows are plain objects and addToList records its calls.
async function load({ rows = [], failFor = [] } = {}) {
  const logs = [];
  const calls = [];
  const ctx = vm.createContext({
    console: { log: (...a) => logs.push(a.join(' ')), table: () => {} },
    document: { querySelectorAll: () => [], body: { click() {} } },
    setTimeout,
    setInterval,
    clearInterval,
  });
  vm.runInContext(SRC, ctx);
  await new Promise(resolve => setImmediate(resolve));
  logs.length = 0;
  ctx.getRows = () => rows;
  ctx.readRow = row => ({
    name: row.name ?? null,
    rawCategory: row.rawCategory ?? null,
    isPermanentlyClosed: !!row.isPermanentlyClosed,
    isBroken: !!row.isBroken,
  });
  ctx.addToList = async (row, label) => {
    calls.push([row.name ?? null, label]);
    return !failFor.includes(row.name);
  };
  const get = expr => vm.runInContext(expr, ctx);
  return {
    logs,
    calls,
    get,
    run: () => get('processStarred()'),
    moved: () => JSON.parse(JSON.stringify(get('moved'))),
    skipped: () => JSON.parse(JSON.stringify(get('skipped'))),
  };
}

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
  await s.run();
  assert.deepEqual(s.calls, expected);
  assert.equal(s.moved().length, rows.length);
  assert.deepEqual(s.skipped(), []);
});

test('a routed row logs its target and records name, rawCategory and targetLabel', async () => {
  const s = await load({ rows: [{ name: 'Alpha', rawCategory: '$20–40 · Italian' }] });
  await s.run();
  assert.deepEqual(s.calls, [['Alpha', 'Restaurants']]);
  assert.deepEqual(s.moved(), [{ name: 'Alpha', rawCategory: '$20–40 · Italian', targetLabel: 'Restaurants' }]);
  assert.ok(s.logs.includes('Adding to Restaurants: Alpha [$20–40 · Italian]'));
});

test('permanently closed goes to Archived ahead of any category match', async () => {
  const s = await load({
    rows: [{ name: 'Beta', rawCategory: 'Permanently closed · Cafe', isPermanentlyClosed: true }],
  });
  await s.run();
  assert.deepEqual(s.calls, [['Beta', 'Archived']]);
  assert.deepEqual(s.moved(), [{ name: 'Beta', rawCategory: 'Permanently closed · Cafe', targetLabel: 'Archived' }]);
  assert.ok(s.logs.includes('Adding to Archived (permanently closed): Beta'));
});

test('broken rows are skipped before the closed check and never opened', async () => {
  const s = await load({
    rows: [{ name: 'Gamma', rawCategory: 'Cafe', isBroken: true, isPermanentlyClosed: true }],
  });
  await s.run();
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.skipped(), [{ name: 'Gamma', rawCategory: 'Cafe' }]);
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
  await s.run();
  assert.deepEqual(s.calls, []);
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
      { name: 'Eta', rawCategory: 'Closed', isPermanentlyClosed: true },
      { name: 'Theta', rawCategory: 'Park' },
    ],
    failFor: ['Zeta', 'Eta'],
  });
  await s.run();
  assert.deepEqual(s.calls, [['Zeta', 'Nightlife'], ['Eta', 'Archived'], ['Theta', 'Outdoors']]);
  assert.deepEqual(s.skipped(), [
    { name: 'Zeta', rawCategory: 'Pub' },
    { name: 'Eta', rawCategory: 'Closed' },
  ]);
  assert.deepEqual(s.moved(), [{ name: 'Theta', rawCategory: 'Park', targetLabel: 'Outdoors' }]);
  assert.ok(s.logs.includes('Failed to add Zeta to Nightlife, leaving in place for manual review'));
  assert.ok(s.logs.includes('Failed to add Eta to Archived, leaving in place for manual review'));
});

test('already moved or skipped rows are not retried on a re-run', async () => {
  const s = await load({
    rows: [{ name: 'Iota', rawCategory: 'Fitness center' }, { name: 'Kappa', rawCategory: 'Nope' }],
  });
  await s.run();
  await s.run();
  assert.deepEqual(s.calls, [['Iota', 'Fitness']]);
  assert.equal(s.skipped().length, 1);
});
