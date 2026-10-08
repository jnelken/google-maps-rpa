// Offline planner: applies move-script.js's exact taxonomy to
// data/starred-places.json and writes the expected category -> list
// assignment for every starred place to data/plan.json (gitignored, local
// only). Re-run any time data/starred-places.json or move-script.js's
// category constants change - this is a pure derivation, never hand-edited.
//
// Usage: node scripts/plan.js
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

const BUCKET_CONSTS = [
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

function parseTypeArray(src, name) {
  const m = src.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
  if (!m) throw new Error('missing ' + name);
  return m[1].split(',').map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/^'|'$/g, '').replace(/\\'/g, "'"));
}

function loadBuckets(src) {
  return BUCKET_CONSTS.map(([label, name]) => [label, parseTypeArray(src, name)]);
}

function extractType(raw) {
  if (!raw) return null;
  const parts = raw.split('·');
  return parts[parts.length - 1].trim().toLowerCase();
}

function routePlace(p, buckets) {
  let target = null;
  let reason = null;
  if (p.isBroken) {
    reason = 'broken/no-thumbnail';
  } else if (p.isPermanentlyClosed || /permanently closed/i.test(p.rawCategory || '')) {
    target = 'Archived';
    reason = 'permanently closed';
  } else {
    const type = extractType(p.rawCategory);
    for (const [label, types] of buckets) {
      if (type && types.includes(type)) { target = label; reason = type; break; }
    }
    if (!target) reason = 'no category match: ' + (type || '(none)');
  }
  return { index: p.index, name: p.name, rawCategory: p.rawCategory, target, reason };
}

function countTargets(plan) {
  const counts = {};
  for (const r of plan) {
    const k = r.target || '(stay in Starred)';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function main() {
  const buckets = loadBuckets(fs.readFileSync(path.join(REPO, 'move-script.js'), 'utf8'));
  const places = JSON.parse(fs.readFileSync(path.join(REPO, 'data/starred-places.json'), 'utf8'));
  const plan = places.map(p => routePlace(p, buckets));
  const counts = countTargets(plan);

  fs.writeFileSync(path.join(REPO, 'data/plan.json'), JSON.stringify(plan, null, 1));
  console.log('total places:', plan.length);
  console.log(Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${String(v).padStart(4)}  ${k}`).join('\n'));
}

if (require.main === module) main();

module.exports = { BUCKET_CONSTS, parseTypeArray, loadBuckets, extractType, routePlace, countTargets };
