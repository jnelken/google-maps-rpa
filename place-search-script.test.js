const test = require('node:test');
const assert = require('node:assert/strict');
const gmps = require('./place-search-script.js');

const menu = (overrides = {}) => ({
  sourceFound: true,
  sourceChecked: true,
  targetFound: true,
  targetChecked: false,
  ...overrides,
});

test('normalizeName strips accents, punctuation and case', () => {
  assert.equal(gmps.normalizeName('Café de Flore!'), 'cafe de flore');
  assert.equal(gmps.normalizeName('Ben & Jerry’s'), 'ben and jerry s');
  assert.equal(gmps.normalizeName(null), '');
});

test('namesMatch accepts names equal after normalizing', () => {
  assert.ok(gmps.namesMatch('Blue Bottle Coffee', 'Blue Bottle Coffee'));
  assert.ok(gmps.namesMatch('Café de Flore', 'Cafe de Flore'));
  assert.ok(gmps.namesMatch('Joe’s Pizza', "JOE'S PIZZA"));
});

test('namesMatch rejects branch suffixes in either direction', () => {
  assert.ok(!gmps.namesMatch('Blue Bottle Coffee', 'Blue Bottle Coffee - Hayes Valley'));
  assert.ok(!gmps.namesMatch('Notion', 'Notion Labs'));
});

test('namesMatch rejects unrelated search results', () => {
  assert.ok(!gmps.namesMatch('Blue Bottle Coffee', 'Results'));
  assert.ok(!gmps.namesMatch('Blue Bottle Coffee', 'Starbucks'));
  assert.ok(!gmps.namesMatch('Blue Bottle Coffee', ''));
});

test('namesMatch rejects different places that share words', () => {
  assert.ok(!gmps.namesMatch('Joe’s Pizza', 'Joe’s Coffee'));
  assert.ok(!gmps.namesMatch('Blue Bottle Coffee', 'Blue Door Coffee'));
  assert.ok(!gmps.namesMatch('Hayes Valley Bakery', 'Blue Bottle Coffee Hayes Valley'));
  assert.ok(!gmps.namesMatch('The Grill', 'The Grille Room'));
});

test('namesMatch rejects a generic page for a queued branch name', () => {
  assert.ok(!gmps.namesMatch('Blue Bottle Coffee - Hayes Valley', 'Blue Bottle Coffee'));
  assert.ok(!gmps.namesMatch('Starbucks Reserve Roastery', 'Starbucks'));
});

test('searchUrl encodes the place name', () => {
  assert.equal(gmps.searchUrl('A & B/C'), 'https://www.google.com/maps/search/A%20%26%20B%2FC');
});

test('buildQueue keeps targeted rows and trims names', () => {
  const { queue, ambiguous } = gmps.buildQueue([
    { index: 0, name: ' Cafe Uno ', target: 'Coffee Shops', reason: 'cafe' },
    { index: 1, name: 'Unmatched', target: null, reason: 'no category match' },
    { index: 3, name: '', target: 'Restaurants' },
    null,
    { index: 4, name: 'Diner', target: 'Restaurants' },
  ]);
  assert.deepEqual(queue, [
    { name: 'Cafe Uno', target: 'Coffee Shops' },
    { name: 'Diner', target: 'Restaurants' },
  ]);
  assert.deepEqual(ambiguous, []);
});

test('buildQueue leaves out every place whose name repeats', () => {
  const { queue, ambiguous } = gmps.buildQueue([
    { name: 'Starbucks', target: 'Coffee Shops' },
    { name: 'Diner', target: 'Restaurants' },
    { name: 'starbucks', target: 'Coffee Shops' },
    { name: 'Starbucks', target: 'Errands' },
  ]);
  assert.deepEqual(queue, [{ name: 'Diner', target: 'Restaurants' }]);
  assert.equal(ambiguous.length, 3);
});

test('buildQueue counts untargeted rows when looking for repeated names', () => {
  const { queue, ambiguous } = gmps.buildQueue([
    { name: 'Starbucks', target: 'Coffee Shops' },
    { name: 'Starbucks', target: null, reason: 'no category match' },
  ]);
  assert.deepEqual(queue, []);
  assert.deepEqual(ambiguous, [{ name: 'Starbucks', target: 'Coffee Shops' }]);
});

test('buildQueue rejects non-array input', () => {
  assert.throws(() => gmps.buildQueue({ name: 'x' }));
});

function stateWith(queue, phase = 1) {
  return { ...gmps.emptyState(), queue, phase };
}

test('nextItem skips done places and resumes at the first pending one', () => {
  const a = { name: 'A', target: 'Restaurants' };
  const b = { name: 'B', target: 'Restaurants' };
  let state = stateWith([a, b]);
  assert.equal(gmps.nextItem(state), a);
  state = gmps.recordResult(state, a, 1, 'added', 1);
  assert.equal(gmps.nextItem(state), b);
  state = gmps.recordResult(state, b, 1, 'name-mismatch', 2);
  assert.equal(gmps.nextItem(state), null);
});

test('nextItem retries retryable statuses up to three tries', () => {
  const a = { name: 'A', target: 'Restaurants' };
  let state = stateWith([a]);
  state = gmps.recordResult(state, a, 1, 'menu-timeout', 1);
  assert.equal(gmps.nextItem(state), a);
  state = gmps.recordResult(state, a, 1, 'menu-timeout', 2);
  assert.equal(gmps.nextItem(state), a);
  state = gmps.recordResult(state, a, 1, 'menu-timeout', 3);
  assert.equal(gmps.nextItem(state), null);
});

test('phase 2 only queues places phase 1 added or found already in target', () => {
  const added = { name: 'Added', target: 'Restaurants' };
  const already = { name: 'Already', target: 'Restaurants' };
  const skipped = { name: 'Skipped', target: 'Restaurants' };
  const untouched = { name: 'Untouched', target: 'Restaurants' };
  let state = stateWith([skipped, untouched, added, already]);
  state = gmps.recordResult(state, added, 1, 'added', 1);
  state = gmps.recordResult(state, already, 1, 'already-in-target', 1);
  state = gmps.recordResult(state, skipped, 1, 'not-starred', 1);
  state = { ...state, phase: 2 };
  assert.equal(gmps.nextItem(state), added);
  state = gmps.recordResult(state, added, 2, 'removed', 2);
  assert.equal(gmps.nextItem(state), already);
  state = gmps.recordResult(state, already, 2, 'already-removed', 2);
  assert.equal(gmps.nextItem(state), null);
});

test('isStillCurrent requires this tab to own a running state pointed at this item', () => {
  const a = { name: 'A', target: 'Restaurants' };
  const b = { name: 'B', target: 'Restaurants' };
  const running = {
    ...stateWith([a, b]),
    running: true,
    owner: 'tab-1',
    current: { key: gmps.placeKey(a), phase: 1, at: 1 },
  };
  assert.ok(gmps.isStillCurrent(running, a, 1, 'tab-1'));
  assert.ok(!gmps.isStillCurrent(running, a, 1, 'tab-2'));
  assert.ok(!gmps.isStillCurrent(running, a, 1, null));
  assert.ok(!gmps.isStillCurrent({ ...running, running: false }, a, 1, 'tab-1'));
  assert.ok(!gmps.isStillCurrent({ ...running, current: null }, a, 1, 'tab-1'));
  assert.ok(!gmps.isStillCurrent(running, b, 1, 'tab-1'));
  assert.ok(!gmps.isStillCurrent({ ...running, phase: 2 }, a, 1, 'tab-1'));
});

test('recordResult keeps the other phase and counts tries', () => {
  const a = { name: 'A', target: 'Restaurants' };
  let state = stateWith([a]);
  state = gmps.recordResult(state, a, 1, 'added', 1);
  state = gmps.recordResult(state, a, 2, 'target-not-confirmed', 2);
  state = gmps.recordResult(state, a, 2, 'removed', 3);
  const entry = state.results[gmps.placeKey(a)];
  assert.equal(entry.p1.status, 'added');
  assert.deepEqual(entry.p2, { status: 'removed', tries: 2, at: 3 });
});

test('clearSkipped re-queues skipped places but keeps done ones', () => {
  const done = { name: 'Done', target: 'Restaurants' };
  const skipped = { name: 'Skipped', target: 'Restaurants' };
  let state = stateWith([done, skipped]);
  state = gmps.recordResult(state, done, 1, 'added', 1);
  state = gmps.recordResult(state, skipped, 1, 'name-mismatch', 1);
  state = gmps.clearSkipped(state, 1);
  assert.equal(state.results[gmps.placeKey(done)].p1.status, 'added');
  assert.equal(state.results[gmps.placeKey(skipped)].p1, undefined);
  assert.equal(gmps.nextItem(state), skipped);
});

test('decidePhase1 adds only a matching, starred place', () => {
  const base = { expectedName: 'Cafe Uno', h1: 'Cafe Uno' };
  assert.deepEqual(gmps.decidePhase1({ ...base, menu: menu() }), { action: 'add-target', status: 'added' });
  assert.equal(gmps.decidePhase1({ ...base, menu: menu({ targetChecked: true }) }).status, 'already-in-target');
  assert.equal(gmps.decidePhase1({ ...base, menu: menu({ sourceChecked: false }) }).status, 'not-starred');
  assert.equal(gmps.decidePhase1({ ...base, menu: menu({ sourceFound: false }) }).status, 'not-starred');
  assert.equal(gmps.decidePhase1({ ...base, menu: menu({ targetFound: false }) }).status, 'target-missing');
  assert.equal(gmps.decidePhase1({ ...base, menu: null }).status, 'menu-timeout');
  assert.equal(gmps.decidePhase1({ ...base, h1: 'Something Else', menu: menu() }).status, 'name-mismatch');
  assert.equal(gmps.decidePhase1({ ...base, h1: null, menu: null }).status, 'load-timeout');
});

test('decidePhase1 never removes from Starred places', () => {
  const actions = [menu(), menu({ targetChecked: true }), menu({ sourceChecked: false })]
    .map(m => gmps.decidePhase1({ expectedName: 'A Place', h1: 'A Place', menu: m }).action);
  assert.ok(!actions.includes('remove-source'));
});

test('decidePhase2 removes only after target membership is confirmed', () => {
  const base = { expectedName: 'Cafe Uno', h1: 'Cafe Uno' };
  assert.deepEqual(
    gmps.decidePhase2({ ...base, menu: menu({ targetChecked: true }) }),
    { action: 'remove-source', status: 'removed' },
  );
  assert.deepEqual(
    gmps.decidePhase2({ ...base, menu: menu({ targetChecked: false }) }),
    { action: 'skip', status: 'target-not-confirmed' },
  );
  assert.equal(
    gmps.decidePhase2({ ...base, menu: menu({ targetChecked: true, sourceChecked: false }) }).status,
    'already-removed',
  );
  assert.equal(gmps.decidePhase2({ ...base, menu: menu({ targetFound: false }) }).status, 'target-missing');
  assert.equal(gmps.decidePhase2({ ...base, h1: 'Other Spot', menu: menu({ targetChecked: true }) }).status, 'name-mismatch');
});

test('summarize counts statuses per phase', () => {
  const a = { name: 'A', target: 'Restaurants' };
  const b = { name: 'B', target: 'Restaurants' };
  let state = stateWith([a, b]);
  state = gmps.recordResult(state, a, 1, 'added', 1);
  assert.deepEqual(gmps.summarize(state), { 'p1:added': 1, 'p2:pending': 2, 'p1:pending': 1 });
});
