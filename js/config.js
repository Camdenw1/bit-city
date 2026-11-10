// Mini Mayor — config. Every balance number lives in this file. Pure data, no DOM.

export const MAP_W = 11;
export const MAP_H = 14;
export const TILE = 16;

export const DAY_LENGTH_MS = 3600000; // one in-game day/night cycle (cosmetic)

export const CATEGORIES = ['food', 'retail', 'service', 'farming', 'creative'];

export const CATEGORY_COLORS = {
  food: '#e8804a',
  retail: '#4a90d9',
  service: '#9a6fd0',
  farming: '#5bb450',
  creative: '#e85d8a',
};

// Works for negative coordinates too: land west and north of the first town has x or y < 0.
export function isRoad(x, y) {
  return ((x % 4) + 4) % 4 === 3 || ((y % 3) + 3) % 3 === 2;
}

// ---- Land -------------------------------------------------------------------
// The first town is the 'home' parcel at (0,0)..(MAP_W-1, MAP_H-1) and never moves.
// Eight more parcels around it can be bought. Bounds are inclusive.
export const PARCELS = [
  { id: 'home', name: 'Town',            x0: 0,   y0: 0,  x1: 10, y1: 13 },
  { id: 'n',    name: 'North land',      x0: 0,   y0: -6, x1: 10, y1: -1 },
  { id: 's',    name: 'South land',      x0: 0,   y0: 14, x1: 10, y1: 19 },
  { id: 'w',    name: 'West land',       x0: -8,  y0: 0,  x1: -1, y1: 13 },
  { id: 'e',    name: 'East land',       x0: 11,  y0: 0,  x1: 18, y1: 13 },
  { id: 'nw',   name: 'North-west land', x0: -8,  y0: -6, x1: -1, y1: -1 },
  { id: 'ne',   name: 'North-east land', x0: 11,  y0: -6, x1: 18, y1: -1 },
  { id: 'sw',   name: 'South-west land', x0: -8,  y0: 14, x1: -1, y1: 19 },
  { id: 'se',   name: 'South-east land', x0: 11,  y0: 14, x1: 18, y1: 19 },
];
export const WORLD = { x0: -8, y0: -6, x1: 18, y1: 19 };

export function parcelAt(x, y) {
  return PARCELS.find((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) || null;
}

/** How much stronger a building is at this level (1 at level 1). */
export function levelMult(level) {
  return 1 + TUNING.levelBonus * (Math.max(1, Math.min(TUNING.maxLevel, level || 1)) - 1);
}

// ---- Tuning knobs used by state.js / sim.js -------------------------------
export const TUNING = {
  startCoins: 250,
  startGems: 2,
  stepMs: 60000,                 // largest simulation step
  maxOfflineMs: 14 * 86400000,   // offline catch-up cap
  applicantCount: 3,
  applicantEveryMs: 4 * 60000,   // oldest applicant is replaced this often
  refundRate: 0.75,              // demolish refund (of what was paid)
  copyCostGrowth: 1.35,          // each copy of a building you already own multiplies its price by this
  hurryGems: 1,
  staffFactor: [0, 1.25, 1.85, 2.35, 2.75, 3.05],   // sales by number of workers: each one adds a little less
  skillAvgDivisor: 13.5,         // skill factor = 1 + average skill / 13.5 (a team of 9s sells 1.67x)
  teamStars: [0.4, 0.7, 0.95],   // team meter share for 1, 2 and 3 stars
  slotAtLevel: 3,                // a shop at this level gets one more job
  dreamBonus: 0.25,              // dream factor = 1 + 0.25 * dreamStars
  restockMinFraction: 0.25,      // a restock always fills at least this much of the shelf
  rideFirstDelayMs: 20000,       // first ride can appear this long after a new game
  deliveryUnlockPop: 6,
  deliveryChance: 0.25,
  deliveryFareMinutes: 5,
  rushOrders: 5,
  courierStops: 3,
  oddSkillBonus: 0.1,            // Odd Jobs pay this much more per skill point of the helper you send
  jobPayPerResident: 0.25,
  jobMaxGrowth: 22,
  rideGapMinMs: 40000,
  rideGapMaxMs: 80000,
  rideExpireMs: 90000,           // an ignored request quietly disappears
  rideMinFare: 15,
  rideFareMinutes: 8,            // fare = this many minutes of town income (before tip)
  gasBonus: 0.5,                 // extra fare for holding the gas the whole trip (in proportion if less)
  gasSpeed: 2.5,                 // how much faster the car goes while the gas is held
  carBaseSpeed: 0.75,            // lots per second with no gas, in the first car
  truckSpeed: 1.2,               // lots per second for a trade truck on the entry road
  truckMinMs: 8000,              // shortest truck trip
  truckMaxMs: 25000,             // longest truck trip (a Trading Post far from the entry road)
  trucksPerLevel: 1,             // trucks per Trading Post level (all out = the next trade waits)
  welcomeFareMinutes: 4,         // driving a new resident home pays this many minutes of shop income
  rideDistanceBonus: 0.1,        // every lot of distance adds this much to a fare
  activeBoost: 10,               // shop sales pay this many times more while the game is open
  rideTipMax: 2.0,
  rideTipFastMs: 3000,
  rideTipSlowMs: 10000,
  rideWrongTryPenalty: 0.2,
  pickupTipFastMs: 10000,        // a rider picked up this fast tips the most (the game picks where they go)
  pickupTipSlowMs: 60000,        // ...and this slow, no tip
  rideMinBuildings: 2,
  needServes: 10,                // a shop with two average workers keeps this many residents happy with its kind of thing
  happyRentBonus: 0.5,           // extra rent from a resident who is 100% happy
  unhappyRentCut: 0.2,           // rent lost from a resident who is 0% happy (a straight line in between)
  reach: 5,                      // town buildings serve homes and shops this many lots away (+1 per level)
  problemUnlockPop: 10,          // shops only get problems once the town is this big
  problemGapMinMs: 6 * 60000,    // a new problem can turn up this often, only while playing
  problemGapMaxMs: 14 * 60000,
  problemShopsPerSlot: 12,       // one problem at a time, plus one more per this many shops
  problemSalesCut: 0.25,         // a shop with a problem sells this much less
  problemAutoFixMs: 3 * 60000,   // a station or clinic in reach sorts it out after this long
  problemFeeMinutes: 4,          // fixing it yourself costs this many minutes of shop income
  problemMinFee: 40,
  favBonus: 0.25,                // the mayor's favourite places sell (or serve) this much more
  nearRadius: 2,                 // a building that needs mountains, woods or water must be this close to some
  cropPerHour: 10,               // crops one farmer grows per real hour (more farmers: in step with staffFactor)
  recipeBonus: 0.1,              // extra sales for every food shop, per recipe the town knows
  parkRadius: 2,                 // parks boost homes this many lots away (2 reaches across a road)
  parkBoostMax: 0.5,             // most extra rent one home can get from parks
  landBasePrice: 20000,          // the first extra parcel; each one after costs x landGrowth
  landGrowth: 2,
  waterfrontBoost: 0.1,          // extra rent for a home next to water
  maxLevel: 3,
  levelBonus: 0.5,               // each level above 1 adds this much rent / sales / stock / reach
  upgradeCost: [0, 2, 5],        // x the building's base price to go from level 1 -> 2, and 2 -> 3
  importMarkup: 2.5,             // importing a crop costs this x its usual price (always more than selling pays)
  orderPay: 2.5,                 // a neighbour's order pays this x the usual price of the goods
  orderFirstQty: 40,             // orders grow x1.4 each time one is filled
  orderGrowth: 1.4,
  adMs: 2 * 3600000,             // how long an ad campaign lasts
  adSalesBonus: 0.25,            // extra coins from every sale while it runs
  adCostMinutes: 20,             // an ad costs this many minutes of shop income (at least adMinCost)
  adMinCost: 300,
  safetyNetCoins: 200,           // an empty town never has less than this (tent + diner)
};

// Small troubles a shop can run into. `fixer` is the need whose town buildings sort it out for free.
export const PROBLEMS = {
  leak:   { name: 'Burst pipe',      fixer: 'safety' },
  theft:  { name: 'Shoplifters',     fixer: 'safety' },
  sniffles: { name: 'Staff caught a cold', fixer: 'health' },
};

// Your car. Each one is faster and earns a little more on every ride, delivery and welcome drive.
export const CARS = [
  { name: 'Old Taxi',    speed: 1,   pay: 1,    cost: 0 },
  { name: 'City Cab',    speed: 1.6, pay: 1.1,  cost: 2500 },
  { name: 'Sports Car',  speed: 2.4, pay: 1.2,  cost: 15000 },
  { name: 'Rocket Taxi', speed: 3.5, pay: 1.35, cost: 80000 },
];

// The jobs board: things to do for coins whenever you like. `minutes` = pay in minutes of the
// town's shop income (never less than `pay`); each job rests for `cooldownMs` after you take it.
export const TOWN_JOBS = {
  taxi:     { name: 'Taxi Ride',        icon: 'taxi',     hint: 'Drive a resident across town',  pay: 12, minutes: 8, cooldownMs: 60000 },
  delivery: { name: 'Package Delivery', icon: 'box',      hint: 'Take a parcel to a home',       pay: 14, minutes: 5, cooldownMs: 90000 },
  rush:     { name: 'Lunch Rush',       icon: 'cat_food', hint: 'Serve five orders',             pay: 22, minutes: 6, cooldownMs: 120000 },
  odd:      { name: 'Odd Jobs',         icon: 'person',   hint: 'Send the best resident to help', pay: 6,  minutes: 3, cooldownMs: 90000 },
  lost:     { name: 'Lost & Found',     icon: 'dog',      hint: 'Find Pip the dog on the map',   pay: 14, minutes: 5, cooldownMs: 150000 },
  courier:  { name: 'Courier Route',    icon: 'box',      hint: 'Three homes: shortest route pays a bonus', pay: 7, minutes: 2.5, cooldownMs: 180000 },
};

// Orders use pictures and labels so they work with or without colour.
export const RUSH_MENUS = {
  diner: [['🍔', 'Burger'], ['🍟', 'Fries'], ['🥞', 'Pancakes']],
  bakery: [['🥐', 'Croissant'], ['🧁', 'Cupcake'], ['🥖', 'Baguette']],
  florist: [['🌷', 'Tulips'], ['🌻', 'Sunflowers'], ['🌹', 'Roses']],
  cafe: [['☕', 'Coffee'], ['🍪', 'Cookie'], ['🥪', 'Sandwich']],
  icecream: [['🍦', 'Cone'], ['🍨', 'Sundae'], ['🍧', 'Shaved ice']],
  food: [['🍽️', 'Main dish'], ['🥗', 'Side salad'], ['🥤', 'Drink']],
  retail: [['🛍️', 'Shop bag'], ['🎁', 'Gift'], ['🏷️', 'Price tag']],
  service: [['📦', 'Parcel'], ['🧾', 'Receipt'], ['🔑', 'Key']],
  farming: [['🥕', 'Carrots'], ['🍎', 'Apples'], ['🌽', 'Corn']],
  creative: [['🎨', 'Paint'], ['🎵', 'Music'], ['📷', 'Photo']],
};

export const ODD_JOBS = {
  food: 'Pack a picnic',
  retail: 'Set up a market stall',
  service: 'Fix a squeaky gate',
  farming: 'Plant a garden',
  creative: 'Paint a shop sign',
};

// ---- Buildings ------------------------------------------------------------
// Homes and town buildings: x copyCostGrowth for every copy already owned.
// stockMax ~ 480 minutes of baseRate (about 3 h with two decent workers, 6 h with one).
// restockCost ~ 25% of stockMax. rentPerTenant = coins per tenant per real day.

function home(id, name, cost, buildSecs, unlockAt, capacity, rentPerTenant, blurb) {
  return { id, name, kind: 'home', category: null, cost, buildSecs, unlockAt, capacity, rentPerTenant, blurb };
}
// ---- Shops ------------------------------------------------------------------
// You choose what KIND of shop to open; which shop you get is a surprise. So a shop's
// strength can't depend on its type: it comes from its category and its `tier`, which is
// how many shops of that category the town already had when it opened. Every type is
// just a flavour: a name, a picture, and somebody's dream job.
export const SHOP_CATS = {
  //          first shop: cost, coins/min   category opens at this many residents
  food:     { cost: 120, rate: 0.4,  unlockAt: 0, name: 'Food' },
  retail:   { cost: 160, rate: 0.5,  unlockAt: 0, name: 'Retail' },
  service:  { cost: 200, rate: 0.6,  unlockAt: 0, name: 'Service' },
  farming:  { cost: 400, rate: 0.75, unlockAt: 3, name: 'Farming' },
  creative: { cost: 800, rate: 1.0,  unlockAt: 6, name: 'Creative' },
};
export const SHOP_COST_GROWTH = 1.8;   // each further shop of a category costs this much more...
export const SHOP_RATE_GROWTH = 1.3;   // ...and earns this much more

/** Price and strength of the (tier+1)-th shop of a category. Stock lasts about 8 hours at factor 1. */
export function shopStats(cat, tier = 0) {
  const c = SHOP_CATS[cat] || SHOP_CATS.food;
  const baseRate = Math.round(c.rate * Math.pow(SHOP_RATE_GROWTH, tier) * 100) / 100;
  const stockMax = Math.round((baseRate * 480) / 10) * 10;
  return { cost: Math.round(c.cost * Math.pow(SHOP_COST_GROWTH, tier)), baseRate, stockMax, restockCost: Math.round((stockMax * 0.25) / 10) * 10 };
}

// Luck of the draw when a shop or government building opens. Never worse than normal.
export const QUALITY = [
  { name: '',        mult: 1,   odds: 0.6 },
  { name: 'Popular', mult: 1.2, odds: 0.3 },
  { name: 'Famous',  mult: 1.5, odds: 0.1 },
];

// `cats`: every category this shop can turn up in; the first is its usual one.
function biz(id, name, cats, buildSecs, blurb, extra = {}) {
  const s = shopStats(cats[0], 0);
  return { id, name, kind: 'biz', category: cats[0], categories: cats, slots: 2, buildSecs,
    unlockAt: Math.min(...cats.map((c) => SHOP_CATS[c].unlockAt)), ...s, ...extra, blurb };
}

// Town buildings need no workers and no stock. `provides` meets a need for that many
// residents; `lessons` is skill points taught per real hour; `rentBoost` raises the rent
// of homes within TUNING.parkRadius lots.
function town(id, name, kind, cost, buildSecs, unlockAt, extra, blurb) {
  return { id, name, kind, category: null, cost, buildSecs, unlockAt, ...extra, blurb };
}

export const BUILDINGS = {
  //            id           name             cost  secs unlock cap rent
  tent:      home('tent',      'Tent',           80,   10,  0, 1, 250, 'A cozy tent for one. Everyone starts somewhere!'),
  cabin:     home('cabin',     'Cabin',         600,   90,  4, 2, 450, 'A snug log cabin with room for two.'),
  apartment: home('apartment', 'Apartments',   4000,  420, 12, 4, 700, 'Four friendly neighbours under one roof.'),
  house:     home('house',     'Family House',15000, 1500, 24, 3, 1400, 'The nicest home in town. Pays the best rent.'),

  // food
  diner:    biz('diner',    'Burger Diner',   ['food'],             30, 'Burgers and pancakes all day.'),
  bakery:   biz('bakery',   'Bakery',         ['food', 'retail'],   60, 'Warm bread and sticky buns every morning.'),
  noodle:   biz('noodle',   'Noodle Bar',     ['food'],             60, 'Big steaming bowls, slurping encouraged.'),
  pizza:    biz('pizza',    'Pizzeria',       ['food'],             60, 'A slice for every mood.', { slots: 3 }),
  taco:     biz('taco',     'Taco Shop',      ['food'],             45, 'Crunchy, saucy and gone in three bites.', { fav: true, slots: 3 }),
  sushi:    biz('sushi',    'Sushi Bar',      ['food'],             90, 'Tiny, tidy and delicious.', { slots: 3 }),
  icecream: biz('icecream', 'Ice Cream Shop', ['food'],             45, 'Two scoops and a wafer, please.', { fav: true, slots: 1 }),
  cafe:     biz('cafe',     'Café',           ['food', 'creative'], 60, 'Coffee, cake and somewhere to dream.'),
  // retail
  market:   biz('market',   'General Store',  ['retail'],            45, 'A little bit of everything on the shelves.', { slots: 4 }),
  bookshop: biz('bookshop', 'Bookshop',       ['retail', 'creative'], 90, 'Stories stacked up to the ceiling.'),
  toys:     biz('toys',     'Toy Shop',       ['retail'],            60, 'Bouncy balls and teddy bears.'),
  clothes:  biz('clothes',  'Clothes Shop',   ['retail'],            60, 'Something for every season.', { slots: 3 }),
  florist:  biz('florist',  'Florist',        ['retail', 'farming'], 60, 'Bunches of colour, freshly cut.', { slots: 1 }),
  pets:     biz('pets',     'Pet Shop',       ['retail', 'service'], 90, 'Treats, toys and wagging tails.'),
  hardware: biz('hardware', 'Hardware Store', ['retail'],            60, 'Nuts, bolts and good advice.', { slots: 3 }),
  // service
  well:     biz('well',     'Water Works',    ['service'],           60, 'Fresh, clean water for the whole town.'),
  barber:   biz('barber',   'Barber',         ['service'],           60, 'Fresh cuts and friendly chats.', { slots: 1 }),
  laundry:  biz('laundry',  'Laundromat',     ['service'],           60, 'Round and round until it is clean.'),
  bank:     biz('bank',     'Bank',           ['service'],           120, 'A safe place for everyone\'s savings.', { slots: 4 }),
  gym:      biz('gym',      'Gym',            ['service'],           90, 'Stretch, lift and feel great.', { fav: true, slots: 3 }),
  bikes:    biz('bikes',    'Bike Shop',      ['retail', 'service'], 90, 'Tune-ups, tyres and trail maps.', { fav: true }),
  surf:     biz('surf',     'Surf Shop',      ['retail', 'creative'], 90, 'Wax, boards and the morning swell report.', { near: ['water'], slots: 1 }),
  post:     biz('post',     'Post Office',    ['service', 'retail'], 90, 'Letters and parcels, in and out.'),
  // farming (a `crop` grows while staffed)
  farm:     biz('farm',     'Veggie Farm',    ['farming'],           120, 'Rows of crunchy carrots and leafy greens.', { crop: 'veggies', slots: 3 }),
  orchard:  biz('orchard',  'Orchard',        ['farming'],           120, 'Apple trees as far as you can see.', { crop: 'fruit', slots: 3 }),
  pumpkin:  biz('pumpkin',  'Pumpkin Patch',  ['farming'],           120, 'Big, round and very orange.', { crop: 'veggies' }),
  berry:    biz('berry',    'Berry Farm',     ['farming'],           120, 'Pick your own, eat half on the way.', { crop: 'fruit' }),
  herbs:    biz('herbs',    'Herb Garden',    ['farming', 'food'],   120, 'Smells wonderful from across the road.', { crop: 'veggies', slots: 1 }),
  vineyard: biz('vineyard', 'Vineyard',       ['farming'],           120, 'Grapes ripening in neat rows.', { crop: 'fruit', slots: 3 }),
  // creative
  studio:   biz('studio',   'Art Studio',     ['creative'],          120, 'Paint, clay and big ideas.'),
  music:    biz('music',    'Music Shop',     ['creative', 'retail'], 120, 'Guitars, drums and happy noise.', { fav: true }),
  hoops:    biz('hoops',    'Basketball Gym', ['creative', 'service'], 120, 'Squeaky sneakers and nothing but net.', { fav: true, slots: 3 }),
  venue:    biz('venue',    'Concert Venue',  ['creative'],          180, 'Lights down, amps up.', { fav: true, slots: 4 }),
  ski:      biz('ski',      'Ski Lodge',      ['creative', 'service'], 180, 'Fresh powder and hot chocolate.', { fav: true, near: ['mountain'], slots: 3 }),
  cinema:   biz('cinema',   'Cinema',         ['creative'],          180, 'Popcorn and a big screen.', { slots: 3 }),
  arcade:   biz('arcade',   'Arcade',         ['creative'],          120, 'Blinking lights and high scores.'),
  theatre:  biz('theatre',  'Theatre',        ['creative'],          180, 'Tonight only: the whole town on stage.', { slots: 4 }),
  photo:    biz('photo',    'Photo Studio',   ['creative', 'service'], 120, 'Say cheese!', { slots: 1 }),

  //            id          name        kind     cost  secs unlock
  tree:     town('tree',     'Tree',     'park',    150,   20,  5, { provides: { need: 'beauty', serves: 3 },  rentBoost: 0.05 }, 'A leafy tree. Nearby homes pay a little more rent.'),
  clinic:   town('clinic',   'Clinic',   'civic',  1500,  300,  8, { gov: true, provides: { need: 'health', serves: 12 } }, 'A friendly doctor keeps the town healthy.'),
  police:   town('police',   'Police Station', 'civic', 1500, 300, 8, { gov: true, provides: { need: 'safety', serves: 12 } }, 'Friendly officers keep an eye on things.'),
  fire:     town('fire',     'Fire Station', 'civic', 1500, 300,  8, { gov: true, provides: { need: 'safety', serves: 12 } }, 'A shiny red engine, ready to roll.'),
  school:   town('school',   'School',   'civic',  1500,  300,  8, { gov: true, fav: true, provides: { need: 'education', serves: 12 }, lessons: 1 }, 'Residents learn new skills here, a little every hour.'),
  park:     town('park',     'Park',     'park',   3000,  420, 18, { provides: { need: 'beauty', serves: 10 }, rentBoost: 0.15 }, 'Grass, a bench and fresh air. Nearby homes pay more rent.'),
  library:  town('library',  'Library',  'civic',  1500,  300,  8, { gov: true, provides: { need: 'education', serves: 16 }, lessons: 1 }, 'Quiet shelves where clever people get cleverer.'),
  fountain: town('fountain', 'Fountain', 'park',  12000, 1200, 30, { provides: { need: 'beauty', serves: 14 }, rentBoost: 0.2 }, 'The prettiest spot in town. Nearby homes pay much more rent.'),
};
// `near`: only buildable within TUNING.nearRadius lots of that kind of land. Rare on purpose.
BUILDINGS.university = town('university', 'University', 'civic', 1500, 600, 20, { gov: true, fav: true, provides: { need: 'education', serves: 30 }, lessons: 3 }, 'Big ideas, late nights and a very good library.');
BUILDINGS.track = town('track', 'Running Track', 'park', 2000, 300, 10, { fav: true, provides: { need: 'beauty', serves: 8 }, rentBoost: 0.1 }, 'Laps before breakfast. Nearby homes pay more rent.');
BUILDINGS.trail = town('trail', 'Hiking Trail', 'park', 2500, 300, 12, { fav: true, near: ['forest', 'mountain'], provides: { need: 'beauty', serves: 12 }, rentBoost: 0.15 }, 'A path up into the hills. Nearby homes pay more rent.');
BUILDINGS.trade = town('trade', 'Trading Post', 'trade', 2000, 300, 10, {}, 'Sell your harvest, import what you lack, and fill orders from neighbour towns.');
BUILDINGS.fountain.unlockGoal = 'happy90';  // a milestone opens this one

// Government buildings are a surprise too: you ask for one, the council decides which.
export const GOV = { cost: 1500, growth: 1.8, unlockAt: 8, name: 'Government' };

export const CROPS = { veggies: 'Veggies', fruit: 'Fruit' };
export const CROP_PRICE = { veggies: 6, fruit: 10 };    // usual coins per unit; the day's price drifts around it
export const NEIGHBOURS = ['Maple Hollow', 'Pebble Bay', 'Sunny Ridge', 'Willow Creek', 'Clover Field', 'Foxglove'];

// How a shop prices its goods. speed = how fast stock sells, pay = coins per item sold.
export const PRICE_MODES = {
  low:    { name: 'Bargain', speed: 1.5, pay: 0.85, note: 'Sells fast. Best while you are playing.' },
  normal: { name: 'Normal',  speed: 1,   pay: 1,    note: 'A fair price.' },
  high:   { name: 'Premium', speed: 0.7, pay: 1.4,  note: 'Sells slowly but pays more per item. Best while you are away.' },
};

// Recipes are discovered once the town has grown enough crops in total. Each one a
// restaurant knows adds a star and TUNING.recipeBonus to its sales. Ordered easiest first.
export const RECIPES = [
  { id: 'salad',    name: 'Garden Salad',   shop: 'diner',  needs: { veggies: 30 } },
  { id: 'applepie', name: 'Apple Pie',      shop: 'bakery', needs: { fruit: 60 } },
  { id: 'carrot',   name: 'Carrot Cake',    shop: 'bakery', needs: { veggies: 120 } },
  { id: 'pancakes', name: 'Fruit Pancakes', shop: 'diner',  needs: { fruit: 150 } },
  { id: 'feast',    name: 'Harvest Feast',  shop: 'diner',  needs: { veggies: 400, fruit: 300 } },
  { id: 'tarts',    name: 'Jam Tarts',      shop: 'bakery', needs: { veggies: 300, fruit: 500 } },
];

export const BUILD_ORDER = Object.keys(BUILDINGS);


// ---- Needs (phase 2) --------------------------------------------------------
// What the town wants. Each need appears once the town is big enough to care about it.
// 'jobs' is met by employing people; the rest by staffed shops of that category.
// Health, education and beauty are met by town buildings that `provides` them.
export const NEEDS = [
  { id: 'jobs',     name: 'Jobs',          unlockAt: 1,  icon: 'briefcase',    wish: "I'd love a job." },
  { id: 'food',     name: 'Food',          unlockAt: 1,  icon: 'cat_food',     wish: "I'm hungry! I wish we had more places to eat." },
  { id: 'service',  name: 'Water & care',  unlockAt: 2,  icon: 'cat_service',  wish: 'I wish this town had more services.' },
  { id: 'retail',   name: 'Shopping',      unlockAt: 4,  icon: 'cat_retail',   wish: 'I wish we had more shops to browse.' },
  { id: 'farming',  name: 'Fresh produce', unlockAt: 8,  icon: 'cat_farming',  wish: 'I wish we had more fresh fruit and veg.' },
  { id: 'health',   name: 'Health',        unlockAt: 10, icon: 'heart',        wish: 'I wish we had a doctor nearby.' },
  { id: 'creative', name: 'Fun',           unlockAt: 12, icon: 'cat_creative', wish: 'I wish there was more to do for fun.' },
  { id: 'safety',   name: 'Safety',        unlockAt: 14, icon: 'key',          wish: 'I wish we had police and firefighters nearby.' },
  { id: 'education', name: 'Learning',     unlockAt: 16, icon: 'star',         wish: 'I wish I could learn something new.' },
  { id: 'beauty',   name: 'Green space',   unlockAt: 20, icon: 'cat_farming',  wish: 'I wish we had more trees and parks.' },
];

// Things a content resident says. Picked per person, so everyone has a little personality.
export const HAPPY_LINES = [
  'What a lovely day in town!', 'I love it here.', 'Best landlord ever.', 'This place feels like home.',
  'Have you seen the view lately?', 'I waved at everyone today.', 'Life is good.', 'I might take a walk later.',
];

// ---- Goals (ordered; conditions live in sim.js keyed by id) ---------------
export const GOALS = [
  { id: 'tent',    text: 'Build a Tent for your first resident',  reward: { coins: 30 } },
  { id: 'movein',  text: 'Move someone into a home',              reward: { coins: 30 } },
  { id: 'diner',   text: 'Open a Food shop',                      reward: { coins: 40 } },
  { id: 'hire',    text: 'Give a resident a job',                 reward: { coins: 40 } },
  { id: 'restock', text: 'Restock a shop or hire a dream worker', reward: { coins: 30 } },
  { id: 'ride',    text: 'Give a resident a ride',                reward: { coins: 50, gems: 1 } },
  { id: 'pop4',    text: 'Reach 4 residents',                     reward: { coins: 50 } },
  { id: 'dream',   text: 'Put someone in their dream job',        reward: { coins: 50, gems: 1 } },
  { id: 'biz5',    text: 'Open 5 businesses',                     reward: { coins: 120, gems: 1 } },
  { id: 'pop10',   text: 'Reach 10 residents',                    reward: { coins: 250, gems: 2 } },
  { id: 'allcats', text: 'Open one business of every kind',       reward: { coins: 500, gems: 2 } },
  { id: 'pop16',   text: 'Reach 16 residents',                    reward: { coins: 800, gems: 3 } },
  // milestones: the long game after the starter goals
  { id: 'recipe1', text: 'Discover a recipe (staff a Veggie Farm)', reward: { coins: 300, gems: 1 } },
  { id: 'upgrade1', text: 'Upgrade a building',                    reward: { coins: 300, gems: 1 } },
  { id: 'trade1',  text: 'Sell crops at a Trading Post',          reward: { coins: 500, gems: 1 } },
  { id: 'iq100',   text: 'Town IQ 100 with 10+ residents (a School helps)',    reward: { coins: 1000, gems: 2 } },
  { id: 'order1',  text: "Fill a neighbour town's order",         reward: { coins: 1000, gems: 2 } },
  { id: 'happy90', text: 'Make the town 90% happy',               reward: { coins: 2000, gems: 3 } },
  { id: 'land1',   text: 'Buy more land',                         reward: { coins: 2000, gems: 3 } },
  { id: 'pop30',   text: 'Reach 30 residents',                    reward: { coins: 3000, gems: 3 } },
  { id: 'recipes', text: 'Discover every recipe',                 reward: { coins: 5000, gems: 5 } },
  { id: 'pop60',   text: 'Reach 60 residents',                    reward: { coins: 10000, gems: 5 } },
  { id: 'land4',   text: 'Own five pieces of land',               reward: { coins: 20000, gems: 10 } },
];

export const FIRST_NAMES = [
  'Ada', 'Alfie', 'Amara', 'Ben', 'Bea', 'Bruno', 'Cleo', 'Cody', 'Dara', 'Dot',
  'Eli', 'Elsa', 'Enzo', 'Fern', 'Finn', 'Gus', 'Gwen', 'Hana', 'Hugo', 'Ines',
  'Iris', 'Ivan', 'Jade', 'Jax', 'Juno', 'Kai', 'Kit', 'Lena', 'Leo', 'Lulu',
  'Mabel', 'Max', 'Mika', 'Milo', 'Nell', 'Nico', 'Nora', 'Olive', 'Omar', 'Otis',
  'Pia', 'Pip', 'Quinn', 'Remy', 'Rosa', 'Rory', 'Sam', 'Suki', 'Tess', 'Theo',
  'Tilly', 'Toby', 'Uma', 'Vera', 'Wes', 'Willa', 'Yara', 'Yuki', 'Zane', 'Zoe',
  'Arlo', 'Bo', 'Cora', 'Dev',
];
