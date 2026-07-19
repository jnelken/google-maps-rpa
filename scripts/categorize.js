const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'starred-places.json');

// Edit these arrays to iterate on the rules - rerun with `node scripts/categorize.js`.
const RESTAURANT_TYPES = [
  'restaurant', 'italian', 'mexican', 'chicken', 'american', 'new american',
  'japanese', 'british', 'mediterranean', 'sri lankan', 'bistro', 'diner',
  'grill',
];
const CAFE_TYPES = ['cafe', 'coffee shop', 'juice', 'health food'];
const NIGHTLIFE_TYPES = ['bar', 'pub', 'cocktail bar', 'beer hall', 'night club'];
const FOREST_TYPES = [
  'veterinarian', 'animal hospital', 'pet store', 'pet groomer',
  'emergency veterinarian service', 'dog park',
];
const VISITED_TYPES = [
  '3-star hotel', '4-star hotel', '2-star hotel', '4-star tourist hotel',
  '4-star tourist residence', 'train station', 'international airport',
  'united kingdom', 'thailand', 'sri lanka', 'mexico', 'france',
  'united arab emirates', 'utah', 'california', 'hawaii', 'london',
];
const OUTDOORS_TYPES = [
  'hiking area', 'park', 'state park', 'national park', 'mountain peak',
  'ski resort', 'swimming facility', 'tourist attraction',
];
const HEALTH_TYPES = [
  'medical clinic', 'medical center', 'pharmacy', 'pediatrician', 'doctor',
  'family practice physician', 'cosmetic dentist', 'skin care clinic',
  'medical laboratory', 'children\'s hospital',
];
const KIDS_TYPES = ['preschool', 'day care center', 'playground'];
const BEAUTY_TYPES = ['barber shop', 'massage spa', 'beauty supply store'];
const SHOPPING_TYPES = [
  'clothing store', 'furniture store', 'nut store', 'market',
  'fresh food market', 'supermarket', 'cannabis store', 'tesla showroom',
];
const ERRANDS_TYPES = [
  'self-storage facility', 'parking lot', 'bus ticket agency',
  'shipping and mailing service', 'office space rental agency',
  'commercial real estate agency', 'real estate agent', 'registration office',
  'interior plant service', 'audio visual equipment supplier', 'car wash',
];
const FITNESS_TYPES = ['fitness center'];
const GOING_OUT_TYPES = ['event venue', 'movie theater', 'wedding venue', 'event planner'];
const ASHRAMS_TYPES = ['non-profit organization', 'buddhist temple', 'community center'];
const DESKS_TYPES = ['software company', 'corporate office'];

// "$20-70 · Italian" -> "italian"; "Medical clinic" -> "medical clinic"
function extractType(rawCategory) {
  if (!rawCategory) return null;
  const parts = rawCategory.split('·');
  return parts[parts.length - 1].trim().toLowerCase();
}

function classify(place) {
  if (place.isPermanentlyClosed) return 'Archived';
  if (place.isBroken && !place.rawCategory) return 'FlagForDeletion';

  const type = extractType(place.rawCategory);
  if (type && CAFE_TYPES.includes(type)) return 'Cafes';
  if (type && NIGHTLIFE_TYPES.includes(type)) return 'Nightlife';
  if (type && RESTAURANT_TYPES.includes(type)) return 'Restaurants';
  if (type && FOREST_TYPES.includes(type)) return 'Forest';
  if (type && VISITED_TYPES.includes(type)) return 'Visited';
  if (type && OUTDOORS_TYPES.includes(type)) return 'Outdoors';
  if (type && HEALTH_TYPES.includes(type)) return 'Health';
  if (type && KIDS_TYPES.includes(type)) return 'Kids';
  if (type && BEAUTY_TYPES.includes(type)) return 'Beauty';
  if (type && SHOPPING_TYPES.includes(type)) return 'Shopping';
  if (type && ERRANDS_TYPES.includes(type)) return 'Errands';
  if (type && FITNESS_TYPES.includes(type)) return 'Fitness';
  if (type && GOING_OUT_TYPES.includes(type)) return 'Going Out';
  if (type && ASHRAMS_TYPES.includes(type)) return 'Ashrams';
  if (type && DESKS_TYPES.includes(type)) return 'Desks';

  return 'Skipped';
}

const ALL_TARGETS = [
  'Restaurants', 'Cafes', 'Nightlife', 'Archived',
  'Forest', 'Visited', 'Outdoors', 'Health', 'Kids', 'Beauty',
  'Shopping', 'Errands', 'Fitness', 'Going Out', 'Ashrams', 'Desks',
];

function main() {
  const places = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  const grouped = Object.fromEntries([...ALL_TARGETS, 'FlagForDeletion', 'Skipped'].map(k => [k, []]));
  for (const place of places) {
    grouped[classify(place)].push(place);
  }

  for (const target of ALL_TARGETS) {
    console.log(`\n=== ${target} (${grouped[target].length}) ===`);
    for (const place of grouped[target]) {
      console.log(`  ${place.name}  [${place.rawCategory}]`);
    }
  }

  console.log(`\n=== Flag for manual deletion (${grouped.FlagForDeletion.length}) - broken, no category, likely dropped pins ===`);
  for (const place of grouped.FlagForDeletion) {
    console.log(`  ${place.name}  (index ${place.index})`);
  }

  console.log(`\n=== Skipped (${grouped.Skipped.length}) - left in Starred for manual review ===`);
  const byCategory = {};
  for (const place of grouped.Skipped) {
    const key = place.rawCategory || (place.isBroken ? '(broken, no category)' : '(no category)');
    byCategory[key] = byCategory[key] || [];
    byCategory[key].push(place.name);
  }
  for (const [category, names] of Object.entries(byCategory).sort()) {
    console.log(`  ${category} (${names.length}): ${names.join(', ')}`);
  }

  console.log('\n=== Summary ===');
  const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
  for (const target of [...ALL_TARGETS, 'FlagForDeletion', 'Skipped']) {
    console.log(`  ${target}: ${grouped[target].length}`);
  }
  console.log(`  Total: ${total}`);
}

main();
