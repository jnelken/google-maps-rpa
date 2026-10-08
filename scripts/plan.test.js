const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  BUCKET_CONSTS, parseTypeArray, loadBuckets, extractType, routePlace, countTargets,
} = require('./plan.js');

const MOVE_SRC = fs.readFileSync(path.join(__dirname, '..', 'move-script.js'), 'utf8');

const BUCKETS = [
  ['Restaurants', ['restaurant', 'pizza']],
  ['Coffee Shops', ['cafe', 'restaurant']],
  ['Health', ['dentist']],
];

const route = p => routePlace({ index: 0, name: 'Place A', ...p }, BUCKETS);

// Evaluates move-script.js with no DOM so its constants can be read directly;
// its trailing processStarred() call finds no rows and returns.
async function evaluatedMoveScriptConsts() {
  const ctx = vm.createContext({
    console: { log() {}, table() {} },
    document: { querySelectorAll: () => [], body: { click() {} } },
    setTimeout,
    setInterval,
    clearInterval,
  });
  vm.runInContext(MOVE_SRC, ctx);
  await new Promise(resolve => setImmediate(resolve));
  return name => JSON.parse(JSON.stringify(vm.runInContext(name, ctx)));
}

test('extractType takes the last middle-dot segment, trimmed and lowercased', () => {
  assert.equal(extractType('4.5(120) · $$ · Pizza Restaurant '), 'pizza restaurant');
  assert.equal(extractType('Cafe'), 'cafe');
  assert.equal(extractType(' · '), '');
  assert.equal(extractType(''), null);
  assert.equal(extractType(null), null);
  assert.equal(extractType(undefined), null);
});

test('routePlace sends a matching type to its bucket and keeps the row fields', () => {
  assert.deepEqual(
    routePlace({ index: 7, name: 'Place B', rawCategory: '$$ · Dentist', extra: 1 }, BUCKETS),
    { index: 7, name: 'Place B', rawCategory: '$$ · Dentist', target: 'Health', reason: 'dentist' },
  );
});

test('routePlace uses the first bucket in table order when a type is in two', () => {
  const r = route({ rawCategory: '$ · Restaurant' });
  assert.equal(r.target, 'Restaurants');
  assert.equal(r.reason, 'restaurant');
});

test('routePlace matches the whole type, not a substring', () => {
  const r = route({ rawCategory: '$ · Pizza Restaurant' });
  assert.equal(r.target, null);
  assert.equal(r.reason, 'no category match: pizza restaurant');
});

test('routePlace leaves unmatched or category-less places in Starred', () => {
  assert.deepEqual(
    [route({ rawCategory: 'Hardware store' }), route({ rawCategory: null }), route({})]
      .map(r => [r.target, r.reason]),
    [
      [null, 'no category match: hardware store'],
      [null, 'no category match: (none)'],
      [null, 'no category match: (none)'],
    ],
  );
});

test('routePlace archives permanently closed places ahead of any bucket match', () => {
  for (const p of [
    { rawCategory: '$ · Cafe', isPermanentlyClosed: true },
    { rawCategory: 'Permanently closed · Cafe' },
    { rawCategory: 'PERMANENTLY CLOSED' },
  ]) {
    const r = route(p);
    assert.equal(r.target, 'Archived');
    assert.equal(r.reason, 'permanently closed');
  }
});

test('routePlace flags broken rows ahead of Archived and bucket matches', () => {
  const r = route({ rawCategory: 'Permanently closed · Cafe', isPermanentlyClosed: true, isBroken: true });
  assert.equal(r.target, null);
  assert.equal(r.reason, 'broken/no-thumbnail');
});

test('countTargets tallies targets with unrouted places under Starred', () => {
  assert.deepEqual(
    countTargets([{ target: 'Health' }, { target: null }, { target: 'Health' }, { target: 'Archived' }]),
    { Health: 2, '(stay in Starred)': 1, Archived: 1 },
  );
});

test('parseTypeArray reads single-line and multi-line quoted arrays', () => {
  const src = [
    "const ONE_TYPES = ['a', 'b c'];",
    'const MULTI_TYPES = [',
    "  'x',",
    "  'y\\'s',",
    '];',
  ].join('\n');
  assert.deepEqual(parseTypeArray(src, 'ONE_TYPES'), ['a', 'b c']);
  assert.deepEqual(parseTypeArray(src, 'MULTI_TYPES'), ['x', "y's"]);
});

test('parseTypeArray throws when the constant is missing', () => {
  assert.throws(() => parseTypeArray('const OTHER = [];', 'ONE_TYPES'), /missing ONE_TYPES/);
});

test('loadBuckets parses every move-script.js bucket non-empty, matching its runtime values', async () => {
  const buckets = loadBuckets(MOVE_SRC);
  const read = await evaluatedMoveScriptConsts();
  assert.deepEqual(buckets.map(([label]) => label), BUCKET_CONSTS.map(([label]) => label));
  for (const [i, [label, types]] of buckets.entries()) {
    assert.ok(types.length > 0, `${label} is empty`);
    assert.deepEqual(types, read(BUCKET_CONSTS[i][1]), `${label} parsed differently than it evaluates`);
  }
});
