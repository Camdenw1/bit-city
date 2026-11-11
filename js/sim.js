// Mini Mayor — simulation. Pure: no DOM, no Date.now(), no Math.random().
// Time always comes in as `now` (ms epoch). Mutating functions change `state` in place
// and return a result object; they never throw for a normal player action.

import { BUILDINGS, CATEGORIES, GOALS, NEEDS, RECIPES, HAPPY_LINES, PARCELS, TUNING, CROP_PRICE, NEIGHBOURS, PRICE_MODES, SHOP_CATS, GOV, QUALITY, PROBLEMS, CARS, TOWN_JOBS, RUSH_MENUS, shopStats, isRoad, parcelAt, levelMult, WORLD, UPGRADES, VISITS, POSTS, FIRST_NAMES, DAY_LENGTH_MS, VIPS, TRAITS, STOCKS, MATERIALS, MAYOR_XP, TOWN_PERKS, PERM_PERKS, SISTER_NAMES } from './config.js';
import { makeWorld, terrainAt, isSeaAt, streetAt } from './terrain.js';
import { localDay, makeApplicant, rand, randInt, pick, newGame } from './state.js';

// ---- events ---------------------------------------------------------------

const listeners = new Map();

export const events = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return fn;
  },
  off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  },
  emit(type, payload) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // A broken listener must never break the game.
        if (typeof console !== 'undefined') console.error('[bitcity] listener for "' + type + '" failed', err);
      }
    }
  },
};

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

// ---- lookups --------------------------------------------------------------

export function tileAt(state, x, y) {
  return state.buildings.find((b) => b.x === x && b.y === y) || null;
}

export function buildingById(state, id) {
  if (id == null) return null;
  return state.buildings.find((b) => b.id === id) || null;
}

export function tenantById(state, id) {
  if (id == null) return null;
  return state.tenants.find((t) => t.id === id) || null;
}

export function isBuilt(b, now) {
  return !!b && now >= b.readyAt;
}

const defOf = (b) => BUILDINGS[b.type];
const isHome = (b) => defOf(b).kind === 'home';
const isBiz = (b) => defOf(b).kind === 'biz';
const isGov = (b) => !!defOf(b).gov;

/** The category a shop trades in: the one it was opened under (some shops fit several). */
export function catOf(b) {
  return b.cat || defOf(b).category;
}
/** Price and strength of this particular shop, from its category and tier. */
export function statsOf(b) {
  return shopStats(catOf(b), b.tier || 0);
}
const qualityOf = (b) => (QUALITY[b.q] || QUALITY[0]).mult;
const favOf = (b) => (defOf(b).fav ? 1 + TUNING.favBonus : 1);

const LAND_WORDS = { mountain: 'mountains', forest: 'woods', water: 'water', sand: 'the beach' };
/** Can this kind of building go here? Most can go anywhere; a few need a kind of land close by. */
export function nearOk(state, type, x, y) {
  const near = BUILDINGS[type]?.near;
  if (!near) return true;
  const r = TUNING.nearRadius;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (near.includes(terrainOf(state, x + dx, y + dy))) return true;
  return false;
}
export function nearHint(type) {
  const near = BUILDINGS[type]?.near;
  return near ? `Needs ${near.map((k) => LAND_WORDS[k] || k).join(' or ')} close by` : '';
}
export function buildingName(b) {
  const quality = QUALITY[b.q]?.name;
  return quality ? `${quality} ${defOf(b).name}` : defOf(b).name;
}
const shopsIn = (state, cat) => state.buildings.filter((b) => isBiz(b) && catOf(b) === cat).length;

export function population(state) {
  return state.tenants.length;
}

/** Beds in finished homes (as of the last tick). */
export function capacity(state) {
  let cap = 0;
  for (const b of state.buildings) if (isHome(b) && isBuilt(b, state.lastTick)) cap += defOf(b).capacity;
  return cap;
}

export function vacancies(state) {
  return Math.max(0, capacity(state) - population(state));
}

export function residentsOf(state, homeId) {
  return state.tenants.filter((t) => t.homeId === homeId);
}

export function workersOf(state, bizId) {
  return state.tenants.filter((t) => t.jobId === bizId);
}

export function homesWithVacancy(state, now) {
  return state.buildings.filter(
    (b) => isHome(b) && isBuilt(b, now) && residentsOf(state, b.id).length < defOf(b).capacity
  );
}

export function unemployed(state) {
  return state.tenants.filter((t) => t.jobId == null);
}

// ---- land -------------------------------------------------------------------

let worldCache = null;
function worldOf(state) {
  if (!worldCache || worldCache.seed !== (state.worldSeed >>> 0)) worldCache = makeWorld(state.worldSeed);
  return worldCache;
}

/** 'grass' | 'water' | 'sand' | 'mountain' | 'forest' at a tile. The first town is all grass. */
export function terrainOf(state, x, y) {
  return terrainAt(worldOf(state), x, y);
}

/** Is there a street on this tile? Streets stop at mountains and the open sea, and bridge rivers and lakes. */
export function isRoadAt(state, x, y) {
  if (streetAt(state.worldSeed, state.streets, x, y) !== 'road') return false;
  const t = terrainOf(state, x, y);
  return t !== 'mountain' && !(t === 'water' && isSeaAt(worldOf(state), x, y));
}

/** The paved town square: nothing is built there. */
export function isPlazaAt(state, x, y) {
  return streetAt(state.worldSeed, state.streets, x, y) === 'plaza';
}

export function ownsTile(state, x, y) {
  const p = parcelAt(x, y);
  return !!p && state.land.includes(p.id);
}

/** Can something be built on this tile (ignoring what is already there)? */
export function isLot(state, x, y) {
  if (!ownsTile(state, x, y) || streetAt(state.worldSeed, state.streets, x, y)) return false;
  const t = terrainOf(state, x, y);
  return t !== 'water' && t !== 'mountain';
}

export function landPrice(state) {
  return Math.round(TUNING.landBasePrice * Math.pow(TUNING.landGrowth, state.land.length - 1));
}

const touching = (a, b) =>
  (a.x0 === b.x1 + 1 || b.x0 === a.x1 + 1) && a.y0 === b.y0 || (a.y0 === b.y1 + 1 || b.y0 === a.y1 + 1) && a.x0 === b.x0;

/** What a parcel offers and whether it can be bought right now. */
export function parcelInfo(state, id) {
  const p = PARCELS.find((q) => q.id === id);
  if (!p) return null;
  let lots = 0, waterfront = 0;
  const nearWater = (x, y) => [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => terrainOf(state, x + dx, y + dy) === 'water'));
  const kinds = new Set();
  for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) {
    const t = terrainOf(state, x, y);
    kinds.add(t);
    if (streetAt(state.worldSeed, state.streets, x, y) || t === 'water' || t === 'mountain') continue;
    lots++;
    if (nearWater(x, y)) waterfront++;
  }
  const owned = state.land.includes(id);
  const reachable = PARCELS.some((q) => state.land.includes(q.id) && touching(p, q));
  const price = landPrice(state);
  return {
    id, name: p.name, lots, waterfront, owned, price, reachable,
    features: ['water', 'sand', 'mountain', 'forest'].filter((k) => kinds.has(k)),
    canBuy: !owned && reachable && state.coins >= price,
  };
}

export function buyLand(state, id, now) {
  const info = parcelInfo(state, id);
  if (!info) return fail("That land isn't on the map.");
  if (info.owned) return fail('You already own this land.');
  if (!info.reachable) return fail('Buy the land next to your town first.');
  if (state.coins < info.price) return fail(`You need ${info.price - Math.floor(state.coins)} more coins for this land.`);
  state.coins -= info.price;
  state.land.push(id);
  events.emit('spend', { amount: info.price, reason: 'land' });
  events.emit('land', { id, name: info.name });
  return { ok: true, reason: '', price: info.price };
}

// ---- upgrades ---------------------------------------------------------------

/** Jobs at a shop: its size (1 to 4), plus one at level TUNING.slotAtLevel. */
export function slotsOf(b) {
  const d = defOf(b);
  if (d.kind !== 'biz') return 0;
  return (d.slots || 2) + ((b.level || 1) >= TUNING.slotAtLevel ? 1 : 0);
}
const staffOf = (n) => TUNING.staffFactor[Math.max(0, Math.min(n, TUNING.staffFactor.length - 1))];
/** Bigger shops hold more stock, so a full team doesn't sell out sooner (no extra restocking). */
const sizeOf = (b) => staffOf(slotsOf(b)) / staffOf(2);

export function stockMaxOf(b) {
  return Math.round(statsOf(b).stockMax * levelMult(b.level) * sizeOf(b));
}

/** Coins to take this building up one level, or 0 when it is already at the top. */
export function upgradeCost(state, b) {
  const level = b.level || 1;
  if (level >= TUNING.maxLevel) return 0;
  return Math.round((isBiz(b) ? statsOf(b).cost : defOf(b).cost) * TUNING.upgradeCost[level]);
}

export function upgrade(state, buildingId, now) {
  const b = buildingById(state, buildingId);
  if (!b) return fail("That building isn't there any more.");
  if (!isBuilt(b, now)) return fail('Let it finish building first.');
  const cost = upgradeCost(state, b);
  if (!cost) return fail("It's already the best it can be!");
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins to upgrade.`);
  state.coins -= cost;
  b.level = (b.level || 1) + 1;
  b.paid = (b.paid ?? defOf(b).cost) + cost;
  if (isBiz(b)) b.stock = stockMaxOf(b);            // a bigger shop opens with full shelves
  events.emit('spend', { amount: cost, reason: 'upgrade' });
  events.emit('upgraded', { building: b });
  return { ok: true, reason: '', cost, level: b.level };
}

/** What an upgrade paid partly in materials uses: { wood, stone, bricks, coins }. */
export function materialUpgrade(state, b) {
  const cost = upgradeCost(state, b);
  if (!cost) return null;
  const n = TUNING.matPerLevel[(b.level || 1) + 1] || 0;
  return { wood: n, stone: n, bricks: Math.ceil(n / 2), coins: Math.round(cost * (1 - TUNING.matDiscount)) };
}
export function hasMaterials(state, need) {
  return !!need && Object.keys(MATERIALS).every((k) => (state.mats[k] || 0) + 1e-9 >= need[k]);
}
/** Upgrade using materials: fewer coins. Never required; the plain upgrade always works too. */
export function upgradeWithMaterials(state, buildingId, now) {
  const b = buildingById(state, buildingId);
  if (!b) return fail("That building isn't there any more.");
  if (!isBuilt(b, now)) return fail('Let it finish building first.');
  const need = materialUpgrade(state, b);
  if (!need) return fail("It's already the best it can be!");
  if (!hasMaterials(state, need)) return fail('Not enough materials yet. Lumber yards, quarries and brickworks make them, or import some.');
  if (state.coins < need.coins) return fail(`You need ${need.coins - Math.floor(state.coins)} more coins to upgrade.`);
  for (const k of Object.keys(MATERIALS)) state.mats[k] -= need[k];
  state.coins -= need.coins;
  b.level = (b.level || 1) + 1;
  b.paid = (b.paid ?? defOf(b).cost) + need.coins;
  if (isBiz(b)) b.stock = stockMaxOf(b);
  events.emit('spend', { amount: need.coins, reason: 'upgrade' });
  events.emit('upgraded', { building: b });
  return { ok: true, reason: '', cost: need.coins, level: b.level };
}
/** Import building materials at the Trading Post (instant, at a fixed price). */
export function buyMaterial(state, kind, qty, now) {
  if (!hasTrade(state, now)) return fail('Build a Trading Post first.');
  if (!MATERIALS[kind] || !(qty > 0)) return fail("We can't import that.");
  const room = Math.floor(TUNING.matCap - (state.mats[kind] || 0));
  qty = Math.min(qty, room);
  if (qty <= 0) return fail('Your store is full.');
  const cost = qty * MATERIALS[kind].price;
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins for that.`);
  state.coins -= cost;
  state.mats[kind] += qty;
  events.emit('spend', { amount: cost, reason: 'import' });
  return { ok: true, reason: '', cost, qty };
}

export function isUnlocked(state, type) {
  const def = BUILDINGS[type];
  return !!def && population(state) >= def.unlockAt && (!def.unlockGoal || state.goalsDone.includes(def.unlockGoal));
}

/** A friendly sentence saying what opens this building, for when it is still locked. */
export function unlockHint(state, type) {
  const def = BUILDINGS[type];
  if (!def) return '';
  if (population(state) < def.unlockAt) return `Unlocks at ${def.unlockAt} residents`;
  const goal = GOALS.find((g) => g.id === def.unlockGoal);
  return goal ? `Unlocks with: ${goal.text}` : '';
}

// ---- goals ----------------------------------------------------------------

const builtBiz = (state, now) => state.buildings.filter((b) => isBiz(b) && isBuilt(b, now));

const GOAL_TESTS = {
  tent: (s) => s.buildings.some((b) => b.type === 'tent'),
  movein: (s) => s.tenants.length >= 1,
  diner: (s) => s.buildings.some((b) => isBiz(b) && catOf(b) === 'food'),
  hire: (s) => s.tenants.some((t) => t.jobId != null),
  restock: (s) => s.stats.restocks >= 1 || s.stats.dreamJobs >= 1,
  ride: (s) => s.stats.rides >= 1,
  pop4: (s) => s.tenants.length >= 4,
  dream: (s) => s.stats.dreamJobs >= 1,
  biz5: (s, now) => builtBiz(s, now).length >= 5,
  pop10: (s) => s.tenants.length >= 10,
  allcats: (s, now) => {
    const have = new Set(builtBiz(s, now).map((b) => catOf(b)));
    return CATEGORIES.every((c) => have.has(c));
  },
  pop16: (s) => s.tenants.length >= 16,
  recipe1: (s) => s.recipes.length >= 1,
  upgrade1: (s) => s.buildings.some((b) => (b.level || 1) > 1),
  trade1: (s) => s.trade.sold > 0,
  iq100: (s) => s.tenants.length >= 10 && townIQ(s) >= 100,
  order1: (s) => s.trade.filled >= 1,
  happy90: (s, now) => s.tenants.length >= 4 && happiness(s, now) >= 90,
  land1: (s) => s.land.length >= 2,
  pop30: (s) => s.tenants.length >= 30,
  recipes: (s) => s.recipes.length >= RECIPES.length,
  pop60: (s) => s.tenants.length >= 60,
  land4: (s) => s.land.length >= 5,
  team3: (s, now) => builtBiz(s, now).some((b) => teamPct(s, b) >= TUNING.teamStars[2] - 1e-9),
  star: (s) => s.tenants.some((t) => t.star),
  vip1: (s) => (s.stats.vips || 0) >= 1,
  contract1: (s) => (s.contracts || []).length > 0 || Object.keys(s.friends || {}).length > 0,
  upgrade3: (s) => Object.values(s.upgrades || {}).reduce((a, b) => a + b, 0) >= 3,
  yard: (s) => s.buildings.some((b) => b.type === 'yard'),
  visitors50: (s) => (s.stats.visitors || 0) >= 50,
  friend1: (s) => NEIGHBOURS.some((t) => friendLevel(s, t) >= 1),
  festival1: (s) => (s.stats.festivals || 0) >= 1,
  dream10: (s) => s.stats.dreamJobs >= 10,
  vip5: (s) => (s.stats.vips || 0) >= 5,
  contract3: (s) => (s.contracts || []).length >= 3,
  friend3: (s) => NEIGHBOURS.some((t) => friendLevel(s, t) >= 3),
  pop100: (s) => s.tenants.length >= 100,
  collect1: (s) => collectionPages(s).some((p) => p.done),
  land8: (s) => s.land.length >= PARCELS.length,
  pop150: (s) => s.tenants.length >= 150,
};

/** How far along a goal is, for goals with a number to reach: { have, need }, or null. */
export function goalProgress(state, goal, now = state.lastTick) {
  const pop = state.tenants.length;
  const n = (have, need) => ({ have: Math.max(0, Math.min(need, Math.floor(have))), need });
  switch (goal.id) {
    case 'pop4': return n(pop, 4);
    case 'pop10': return n(pop, 10);
    case 'pop16': return n(pop, 16);
    case 'pop30': return n(pop, 30);
    case 'pop60': return n(pop, 60);
    case 'biz5': return n(builtBiz(state, now).length, 5);
    case 'allcats': return n(new Set(builtBiz(state, now).map((b) => catOf(b))).size, CATEGORIES.length);
    case 'recipe1': return n(state.crops.veggies || 0, RECIPES[0].needs.veggies);
    case 'recipes': return n(state.recipes.length, RECIPES.length);
    case 'iq100': return pop < 10 ? n(pop, 10) : n(townIQ(state), 100);
    case 'happy90': return n(happiness(state, now), 90);
    case 'land1': return n(state.land.length - 1, 1);
    case 'land4': return n(state.land.length - 1, 4);
    case 'land8': return n(state.land.length - 1, PARCELS.length - 1);
    case 'pop100': return n(pop, 100);
    case 'pop150': return n(pop, 150);
    case 'visitors50': return n(state.stats.visitors || 0, 50);
    case 'dream10': return n(state.stats.dreamJobs, 10);
    case 'vip5': return n(state.stats.vips || 0, 5);
    case 'contract3': return n((state.contracts || []).length, 3);
    case 'upgrade3': return n(Object.values(state.upgrades || {}).reduce((a, b) => a + b, 0), 3);
    default: return null;
  }
}

// ---- the collection book ----------------------------------------------------------
// Everything you have had in town, page by page. Pages fill in by themselves as you play, and a
// finished page pays TUNING.collectionGems once. Land-bound buildings don't count towards the
// Buildings page, since a town may never get the land they need.

const TRAIT_ENTRIES = () => [...Object.keys(TRAITS), 'star'];
function noteSeen(state) {
  if (!state.seen) return;
  const sn = state.seen;
  for (const b of state.buildings) if (!sn.types.includes(b.type)) sn.types.push(b.type);
  for (const t of state.tenants) {
    if (t.trait && !sn.traits.includes(t.trait)) sn.traits.push(t.trait);
    if (t.star && !sn.traits.includes('star')) sn.traits.push('star');
  }
  for (const p of collectionPages(state)) {
    if (!p.done || sn.pages.includes(p.id)) continue;
    sn.pages.push(p.id);
    gainGems(state, TUNING.collectionGems);
    addXp(state, MAYOR_XP.page);
    events.emit('pageDone', { page: p });
  }
}
/** The collection book: [{ id, name, entries: [{ id, name, found }], have, total, done }]. */
export function collectionPages(state) {
  const sn = state.seen || { types: [], traits: [], vips: [] };
  const page = (id, name, list) => {
    const have = list.filter((e) => e.found).length;
    return { id, name, entries: list, have, total: list.length, done: list.length > 0 && have === list.length };
  };
  const types = Object.values(BUILDINGS).filter((d) => !d.near);
  return [
    page('buildings', 'Buildings', types.map((d) => ({ id: d.id, name: d.name, found: sn.types.includes(d.id) }))),
    page('people', 'Residents', TRAIT_ENTRIES().map((k) => ({ id: k, name: k === 'star' ? 'Star' : TRAITS[k].name, found: sn.traits.includes(k) }))),
    page('vips', 'VIPs', Object.keys(VIPS).map((k) => ({ id: k, name: VIPS[k].name, found: (sn.vips || []).includes(k) }))),
    page('recipes', 'Recipes', RECIPES.map((r) => ({ id: r.id, name: r.name, found: state.recipes.includes(r.id) }))),
  ];
}

export function nextGoal(state) {
  return GOALS.find((g) => !state.goalsDone.includes(g.id)) || null;
}

function gain(state, amount, reason, buildingId = null) {
  if (!(amount > 0)) return;
  state.coins += amount;
  state.stats.earned += amount;
  events.emit('coins', { amount, buildingId, reason });
}

function gainGems(state, amount) {
  if (!(amount > 0)) return;
  state.gems += amount;
  events.emit('gem', { amount });
}

/** Completes every goal whose condition is true and pays it out straight away. */
function checkGoals(state, now) {
  noteSeen(state);
  if (state.goalsDone.length >= GOALS.length) return;
  for (const goal of GOALS) {
    if (state.goalsDone.includes(goal.id)) continue;
    const test = GOAL_TESTS[goal.id];
    if (!test || !test(state, now)) continue;
    state.goalsDone.push(goal.id);
    events.emit('goal', { goal });
    addXp(state, MAYOR_XP.goal);
    // a milestone can open a building
    for (const d of Object.values(BUILDINGS)) if (d.unlockGoal === goal.id && population(state) >= d.unlockAt) events.emit('unlock', { type: d.id });
    if (goal.reward && goal.reward.coins) gain(state, goal.reward.coins, 'goal');
    if (goal.reward && goal.reward.gems) gainGems(state, goal.reward.gems);
  }
}

// ---- building -------------------------------------------------------------

/** What the next one of this building costs: each copy you already own makes it pricier. */
export function costOf(state, type) {
  const def = BUILDINGS[type];
  if (!def) return 0;
  if (def.kind === 'biz') return categoryCost(state, def.category);
  if (def.gov) return categoryCost(state, 'gov');
  const owned = state.buildings.filter((b) => b.type === type).length;
  return Math.round(def.cost * Math.pow(TUNING.copyCostGrowth, owned));
}

/** What the next shop of a category ('food', ... or 'gov') costs. It only depends on how many you have. */
export function categoryCost(state, cat) {
  if (cat === 'gov') return Math.round(GOV.cost * Math.pow(GOV.growth, state.buildings.filter(isGov).length));
  return shopStats(cat, shopsIn(state, cat)).cost;
}

export function categoryUnlocked(state, cat) {
  const at = cat === 'gov' ? GOV.unlockAt : SHOP_CATS[cat]?.unlockAt;
  return at != null && population(state) >= at;
}

function placementIssue(state, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !parcelAt(x, y)) {
    return "That spot is outside of town.";
  }
  if (!ownsTile(state, x, y)) return "You don't own that land yet. Tap it to buy it!";
  if (isRoadAt(state, x, y)) return "That's a road. Pick a grassy lot!";
  if (isPlazaAt(state, x, y)) return "That's the town square. It stays open for everyone!";
  const ground = terrainOf(state, x, y);
  if (ground === 'water') return "That's water. Homes next to it pay extra rent, though!";
  if (ground === 'mountain') return "That's a mountain. Pick a flatter lot!";
  if (tileAt(state, x, y)) return 'Something is already built here.';
  return '';
}

export function canBuild(state, type, x, y, cat = null) {
  const def = BUILDINGS[type];
  if (!def) return fail("Hmm, we don't know how to build that.");
  const issue = placementIssue(state, x, y);
  if (issue) return fail(issue);
  if (!isUnlocked(state, type)) {
    return fail(population(state) < def.unlockAt ? `${def.name} unlocks at ${def.unlockAt} residents.` : `${def.name}: ${unlockHint(state, type)}.`);
  }
  if (!nearOk(state, type, x, y)) return fail(`A ${def.name} ${nearHint(type).toLowerCase()}.`);
  // A shop with nobody in town to run it earns nothing, and could leave a new player stuck.
  if (def.kind === 'biz' && !state.buildings.some(isHome)) {
    return fail('Build a home first, so someone can work here!');
  }
  const cost = def.kind === 'biz' ? categoryCost(state, cat || def.category) : costOf(state, type);
  if (state.coins < cost) {
    return fail(`You need ${cost - Math.floor(state.coins)} more coins for that.`);
  }
  return { ok: true, reason: '' };
}

/**
 * Build an exact type. The game's own menu uses buildRandom() for shops and government;
 * this is what it calls underneath. `opts.cat` picks which of the shop's categories it
 * opens under, `opts.q` its quality (0..2).
 */
export function build(state, type, x, y, now, opts = {}) {
  const def = BUILDINGS[type];
  const cat = def && def.kind === 'biz' ? (def.categories.includes(opts.cat) ? opts.cat : def.category) : null;
  const check = canBuild(state, type, x, y, cat);
  if (!check.ok) return { ok: false, reason: check.reason, building: null };
  const cost = cat ? categoryCost(state, cat) : costOf(state, type);
  state.coins -= cost;
  const building = { id: state.nextId++, type, x, y, readyAt: now + Math.round(def.buildSecs * 1000 * buildFactor(state, x, y, now)), paid: cost, level: 1 };
  if (cat) {
    building.cat = cat;
    building.tier = shopsIn(state, cat);
    building.q = QUALITY[opts.q] ? opts.q : 0;
    building.stock = stockMaxOf(building);                  // every new shop opens fully stocked
    building.dreamStars = 0;
    building.carry = 0;
    building.price = 'normal';
    building.cc = 0;
  } else if (def.gov) {
    building.q = QUALITY[opts.q] ? opts.q : 0;
  }
  state.buildings.push(building);
  events.emit('spend', { amount: cost, reason: 'build' });
  events.emit('built', { building });
  checkGoals(state, now);
  return { ok: true, reason: '', building };
}

function rollQuality(state) {
  let r = rand(state);
  for (let i = 0; i < QUALITY.length; i++) { r -= QUALITY[i].odds; if (r < 0) return i; }
  return 0;
}

/** The types a category can turn up, with how likely each is right now. */
function drawPool(state, cat, now, x, y) {
  // only what this lot allows (a ski lodge needs mountains) and what the town is big enough for
  const all = Object.values(BUILDINGS).filter((d) => (cat === 'gov' ? d.gov : d.kind === 'biz' && d.categories.includes(cat)) &&
    population(state) >= d.unlockAt && nearOk(state, d.id, x, y));
  const fresh = all.filter((d) => !state.buildings.some((b) => b.type === d.id));   // never a duplicate while something new is left
  const pool = fresh.length ? fresh : all;
  const needs = cat === 'gov' ? needsStatus(state, now) : [];
  return pool.map((d) => {
    let weight = 1;
    if (cat === 'gov') {
      const n = needs.find((x) => x.id === d.provides.need);     // the council usually builds what is missing most
      if (n && n.score < 1) weight += 4 * (1 - n.score);
    } else {
      weight += 3 * state.tenants.filter((t) => t.dream === d.id).length;   // dreams tend to come true
    }
    if (d.fav) weight += 1;       // the mayor's favourites turn up a little more often
    if (d.near) weight += 4;      // the right land usually brings its special building
    return { d, weight };
  });
}

/**
 * Open a shop of a category (or a government building with cat 'gov'). You choose the
 * kind; which one arrives, and how good it is, is the surprise.
 */
export function buildRandom(state, cat, x, y, now) {
  if (cat !== 'gov' && !SHOP_CATS[cat]) return fail("Hmm, we don't know that kind of shop.", { building: null });
  if (!categoryUnlocked(state, cat)) {
    return fail(`${cat === 'gov' ? GOV.name : SHOP_CATS[cat].name} opens at ${cat === 'gov' ? GOV.unlockAt : SHOP_CATS[cat].unlockAt} residents.`, { building: null });
  }
  const pool = drawPool(state, cat, now, x, y);
  // check the lot and the price before spending any luck, so a failed tap never changes the draw
  const probe = canBuild(state, pool[0].d.id, x, y, cat === 'gov' ? null : cat);
  if (!probe.ok) return { ok: false, reason: probe.reason, building: null };
  let r = rand(state) * pool.reduce((sum, p) => sum + p.weight, 0);
  let chosen = pool[pool.length - 1].d;
  for (const p of pool) { r -= p.weight; if (r < 0) { chosen = p.d; break; } }
  return build(state, chosen.id, x, y, now, { cat, q: rollQuality(state) });
}

export function hurry(state, buildingId, now) {
  const b = buildingById(state, buildingId);
  if (!b) return fail("That building isn't there any more.");
  if (isBuilt(b, now)) return fail("It's already finished!");
  if (state.gems < TUNING.hurryGems) return fail('You need a gem to hurry. It will be done soon anyway!');
  state.gems -= TUNING.hurryGems;
  // Finished as of the last tick, so advance() does not announce it a second time.
  b.readyAt = Math.min(now, state.lastTick);
  events.emit('spend', { amount: TUNING.hurryGems, reason: 'hurry' });
  events.emit('opened', { building: b });
  checkGoals(state, now);
  return { ok: true, reason: '' };
}

function recountStars(state, b) {
  if (!b || !isBiz(b)) return;
  b.dreamStars = state.tenants.filter((t) => t.jobId === b.id && t.dream === b.type).length;
}

function clearRide(state, now, quiet = false) {
  if (!state.ride) return;
  state.ride = null;
  state.nextRideAt = now + rideGap(state);
  if (!quiet) events.emit('rideGone', {});
}

export function buildingWorkFee(b, action) {
  const rate = action === 'move' ? TUNING.moveFeeRate : TUNING.demolishFeeRate;
  return Math.max(1, Math.round((b.paid ?? defOf(b).cost) * rate));
}

function buildingInUse(state, b, now) {
  const ride = state.ride;
  if (ride && ride.state !== 'waiting' && (ride.fromId === b.id || ride.toId === b.id)) {
    return 'Wait for the current trip to finish.';
  }
  if (b.type === 'trade' && state.trucks.some((truck) => truck.arriveAt > now)) {
    return 'Wait for the trade trucks to finish their trips.';
  }
  if (state.job?.shopId === b.id || state.job?.stops?.includes(b.id)) {
    return 'Finish or skip the current town job first.';
  }
  return '';
}

export function canMoveBuilding(state, id, x, y, now) {
  const b = buildingById(state, id);
  if (!b) return fail("That building isn't there any more.");
  const issue = buildingInUse(state, b, now) || placementIssue(state, x, y);
  if (issue) return fail(issue);
  if (!nearOk(state, b.type, x, y)) return fail(`A ${defOf(b).name} ${nearHint(b.type).toLowerCase()}.`);
  const cost = buildingWorkFee(b, 'move');
  if (state.coins < cost) return fail(`You need ${Math.ceil(cost - state.coins)} more coins to move this.`);
  return { ok: true, cost };
}

export function moveBuilding(state, id, x, y, now) {
  const check = canMoveBuilding(state, id, x, y, now);
  if (!check.ok) return check;
  const b = buildingById(state, id);
  const from = { x: b.x, y: b.y };
  state.coins -= check.cost;
  b.x = x;
  b.y = y;
  events.emit('spend', { amount: check.cost, reason: 'move' });
  events.emit('moved', { building: b, from });
  checkGoals(state, now);
  return { ok: true, cost: check.cost, building: b };
}

export function canDemolish(state, id, now) {
  const b = buildingById(state, id);
  if (!b) return fail("That building isn't there any more.");
  if (isHome(b) && residentsOf(state, id).length) return fail('Empty this home before removing it.');
  const issue = buildingInUse(state, b, now);
  if (issue) return fail(issue);
  const cost = buildingWorkFee(b, 'demolish');
  if (state.coins < cost) return fail(`You need ${Math.ceil(cost - state.coins)} more coins to remove this.`);
  if (!state.buildings.some((other) => other.id !== id && isHome(other)) && state.coins - cost < BUILDINGS.tent.cost) {
    return fail(`Keep ${BUILDINGS.tent.cost} coins for a starter home.`);
  }
  return { ok: true, cost };
}

export function demolish(state, buildingId, now) {
  const check = canDemolish(state, buildingId, now);
  if (!check.ok) return check;
  const b = buildingById(state, buildingId);
  state.coins -= check.cost;
  for (const t of state.tenants) {
    if (t.jobId === b.id) {
      t.jobId = null;
      events.emit('job', { tenant: t, building: null, dream: false });
    }
  }
  if (state.ride?.fromId === b.id || state.ride?.toId === b.id) clearRide(state, now);
  state.buildings.splice(state.buildings.indexOf(b), 1);
  state.problems = state.problems.filter((p) => p.buildingId !== b.id);
  events.emit('spend', { amount: check.cost, reason: 'demolish' });
  events.emit('demolished', { id: b.id, x: b.x, y: b.y });
  checkGoals(state, now);
  return { ok: true, reason: '', cost: check.cost };
}

// ---- income ---------------------------------------------------------------

/** Rate ignoring stock and construction: what this shop earns while it is selling. */
function potentialRate(state, b, mode = b.price) {
  const def = defOf(b);
  if (def.kind !== 'biz') return 0;
  let n = 0;
  let skillSum = 0;
  for (const t of state.tenants) {
    if (t.jobId === b.id) {
      n++;
      skillSum += t.skills[catOf(b)] || 0;
    }
  }
  if (n === 0) return 0;
  const staff = staffOf(n);
  const skill = skillFactor(skillSum / n);
  const dream = 1 + TUNING.dreamBonus * (b.dreamStars || 0);
  const menu = catOf(b) === 'food' ? 1 + TUNING.recipeBonus * state.recipes.length : 1;
  const price = PRICE_MODES[mode] || PRICE_MODES.normal;
  const trouble = problemOf(state, b.id) ? 1 - TUNING.problemSalesCut : 1;
  return statsOf(b).baseRate * staff * skill * dream * menu * qualityOf(b) * levelMult(b.level) * price.speed * price.pay * trouble * favOf(b) * vipBoost(state, b) * salesPerk(state);
}

export function ratePerMin(state, b) {
  if (!b || !isBiz(b)) return 0;
  if (!isBuilt(b, state.lastTick) || !(b.stock > 0)) return 0;
  return potentialRate(state, b);
}

/** Typical earnings while stocked and time until the remaining stock runs out. */
export function priceForecast(state, b, mode) {
  const rate = potentialRate(state, b, mode);
  const pay = (PRICE_MODES[mode] || PRICE_MODES.normal).pay;
  return {
    coinsPerHour: rate * 60,
    selloutMs: rate > 0 && !b.dreamStars ? Math.max(0, b.stock - (b.carry || 0)) * pay / rate * 60000 : null,
  };
}

export function townRatePerMin(state, now) {
  let sum = 0;
  for (const b of state.buildings) {
    if (isBiz(b) && isBuilt(b, now) && b.stock > 0) sum += potentialRate(state, b);
  }
  return sum;
}

/** Is there water right next to this tile (including diagonally)? */
export function isWaterfront(state, x, y) {
  if (!(TUNING.waterfrontBoost > 0)) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (terrainOf(state, x + dx, y + dy) === 'water') return true;
  return false;
}

/** Extra rent share (0..parkBoostMax) this home gets from parks nearby and from being by the water. */
export function homeBoost(state, home, now = state.lastTick) {
  let boost = 0;
  for (const b of state.buildings) {
    const d = defOf(b);
    if (!d.rentBoost || !isBuilt(b, now)) continue;
    if (Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y)) <= TUNING.parkRadius) boost += d.rentBoost * levelMult(b.level);
  }
  if (isWaterfront(state, home.x, home.y)) boost += TUNING.waterfrontBoost;
  // a bus stop in reach (easy commute) and bike lanes come on top of the park cap
  const bus = state.buildings.some((b) => b.type === 'busstop' && isBuilt(b, now) && Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y)) <= reachOf(b));
  return Math.min(TUNING.parkBoostMax, boost) + (bus ? TUNING.transitRent : 0) + UPGRADES.bikes.per * upLevel(state, 'bikes');
}

/** Rent share for one resident from traits: party animals pay more and their next-door neighbours less. */
export function traitRent(state, t, home) {
  let f = 1;
  if (t.trait === 'party') f += 0.3;
  if (t.trait === 'gogetter') f -= 0.1;
  for (const o of state.tenants) {
    if (o.trait !== 'party' || o.homeId === home.id) continue;
    const h = buildingById(state, o.homeId);
    if (h && Math.max(Math.abs(h.x - home.x), Math.abs(h.y - home.y)) <= 1) f -= 0.1;
  }
  return Math.max(0.5, f);
}

export function rentPerDay(state, now = state.lastTick) {
  let sum = 0;
  for (const home of state.buildings) {
    if (!isHome(home)) continue;
    const res = residentsOf(state, home.id);
    if (res.length) sum += Math.round(res.reduce((n, t) => n + traitRent(state, t, home), 0) * defOf(home).rentPerTenant * levelMult(home.level) * (1 + homeBoost(state, home, now)) * rentPerk(state));
  }
  return sum;
}

// ---- shop pricing, ads -------------------------------------------------------

export function setPrice(state, buildingId, mode, now) {
  const b = buildingById(state, buildingId);
  if (!b || !isBiz(b)) return fail('Only shops set prices.');
  if (!PRICE_MODES[mode]) return fail("That isn't a price we know.");
  b.price = mode;
  return { ok: true, reason: '' };
}

export function adActive(state, now) {
  return now < (state.adUntil || 0);
}

export function adCost(state, now) {
  return Math.max(TUNING.adMinCost, Math.round(townRatePerMin(state, now) * TUNING.adCostMinutes));
}

/** Pay for an ad campaign: for a while every sale pays more and applicants arrive twice as often. */
/** How long an ad runs: 2 hours, plus Marketing. */
export function adLengthMs(state) {
  return TUNING.adMs + UPGRADES.marketing.per * 3600000 * upLevel(state, 'marketing');
}

export function runAd(state, now) {
  if (adActive(state, now)) return fail('Your ad is already running.');
  const cost = adCost(state, now);
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins for an ad.`);
  state.coins -= cost;
  state.adUntil = now + adLengthMs(state);
  events.emit('spend', { amount: cost, reason: 'ad' });
  events.emit('ad', { until: state.adUntil });
  return { ok: true, reason: '', cost };
}

// ---- trade --------------------------------------------------------------------

export function hasTrade(state, now) {
  return state.buildings.some((b) => b.type === 'trade' && isBuilt(b, now));
}

/** Today's selling price per crop. It changes at local midnight; `good` marks a day worth selling on. */
export function tradePrices(state, now) {
  const day = dayNumber(localDay(now));
  const out = {};
  Object.keys(CROP_PRICE).forEach((crop, i) => {
    let h = (Math.imul(day, 374761393) + Math.imul(i + 1, 668265263) + Math.imul(state.worldSeed | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const f = 0.6 + (((h ^ (h >>> 16)) >>> 0) / 4294967296);          // 0.6 .. 1.6
    const usual = CROP_PRICE[crop];
    out[crop] = { price: Math.max(1, Math.round(usual * f * 10) / 10), usual, good: f >= 1.25, importPrice: usual * TUNING.importMarkup };
  });
  return out;
}

/** Sell everything you hold of one crop at today's price. */
export function sellGoods(state, crop, now) {
  if (!hasTrade(state, now)) return fail('Build a Trading Post first.', { coins: 0 });
  const qty = Math.floor(state.goods[crop] || 0);
  if (!(crop in CROP_PRICE) || qty <= 0) return fail('Nothing to sell yet. Staffed farms grow it.', { coins: 0 });
  const busy = truckBusy(state, now);
  if (busy) return fail(busy, { coins: 0 });
  const coins = Math.floor(qty * tradePrices(state, now)[crop].price);
  state.goods[crop] -= qty;
  state.trade.sold += qty;
  const truck = sendTruck(state, now, { kind: 'sell', crop, qty, coins });
  checkGoals(state, now);
  return { ok: true, reason: '', coins, qty, truck };
}

/** Import crops you can't grow yet. They count towards recipes and can fill orders. */
export function buyGoods(state, crop, qty, now) {
  if (!hasTrade(state, now)) return fail('Build a Trading Post first.', { cost: 0 });
  if (!(crop in CROP_PRICE) || !(qty > 0)) return fail("We can't import that.", { cost: 0 });
  const cost = Math.ceil(qty * CROP_PRICE[crop] * TUNING.importMarkup);
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins for that.`, { cost: 0 });
  const busy = truckBusy(state, now);
  if (busy) return fail(busy, { cost: 0 });
  state.coins -= cost;
  events.emit('spend', { amount: cost, reason: 'import' });
  const truck = sendTruck(state, now, { kind: 'import', crop, qty });   // the crop lands in the barn when it arrives
  checkGoals(state, now);
  return { ok: true, reason: '', cost, truck };
}

function makeOrder(state) {
  const crop = pick(state, Object.keys(CROP_PRICE));
  const n = state.trade.filled + state.orders.length;
  const qty = Math.min(5000, Math.round((TUNING.orderFirstQty * Math.pow(TUNING.orderGrowth, n)) / 10) * 10);
  let town = pick(state, NEIGHBOURS);
  for (let i = 0; i < 6 && state.orders.some((o) => o.town === town); i++) town = pick(state, NEIGHBOURS);
  return { id: state.nextId++, town, crop, qty, coins: Math.round(qty * CROP_PRICE[crop] * TUNING.orderPay), gems: 1 };
}

/** Standing orders from neighbour towns. There are always two and they never expire. */
export function ensureOrders(state) {
  while (state.orders.length < 2) state.orders.push(makeOrder(state));
  return state.orders;
}

export function fillOrder(state, orderId, now) {
  if (!hasTrade(state, now)) return fail('Build a Trading Post first.');
  const i = state.orders.findIndex((o) => o.id === orderId);
  if (i < 0) return fail('That order is already done.');
  const o = state.orders[i];
  const have = Math.floor(state.goods[o.crop] || 0);
  if (have < o.qty) return fail(`You need ${o.qty - have} more. Farms are growing it, or import some.`);
  const busy = truckBusy(state, now);
  if (busy) return fail(busy);
  state.goods[o.crop] -= o.qty;
  state.orders.splice(i, 1);
  state.trade.filled++;
  const truck = sendTruck(state, now, { kind: 'order', crop: o.crop, qty: o.qty, coins: o.coins, gems: o.gems, town: o.town });
  ensureOrders(state);
  checkGoals(state, now);
  return { ok: true, reason: '', coins: o.coins, gems: o.gems, truck };
}

// ---- trade contracts ------------------------------------------------------------
// Neighbour towns sign standing contracts: a set amount of crops every hour, collected by their
// own truck and paid well. Sign once and it runs by itself; a short hour is simply skipped.
// Every delivery builds friendship, and friendship makes contracts bigger and better paid.

/** The towns you trade with: four neighbours, then your sister towns (old towns). */
export function tradeTowns(state) {
  return NEIGHBOURS.slice(0, TUNING.contractTowns).concat(((state.legacy || {}).oldTowns || []).map((t) => t.name));
}
const isSister = (state, town) => ((state.legacy || {}).oldTowns || []).some((t) => t.name === town);
export function friendLevel(state, town) {
  if (isSister(state, town)) return TUNING.contractLevels.length;     // sister towns are best friends from the start
  const n = (state.friends || {})[town] || 0;
  return TUNING.contractLevels.filter((x) => n >= x).length;
}
/** Contracts you can hold at once: one, plus one per Trading Post level. */
export function contractSlots(state, now) {
  return hasTrade(state, now) ? 1 + truckCount(state, now) + (has(state, 'port', now) ? 1 : 0) : 0;
}
/** What a town's contract asks for and pays right now. */
export function contractTerms(state, town, now) {
  const i = tradeTowns(state).indexOf(town);
  const level = friendLevel(state, town);
  const crop = Object.keys(CROP_PRICE)[(i < 0 ? 0 : i) % Object.keys(CROP_PRICE).length];
  const qty = TUNING.contractQty[level];
  const pay = Math.max(qty * CROP_PRICE[crop] * 2, Math.round(townRatePerMin(state, now) * TUNING.contractMinutes * (1 + TUNING.contractLevelPay * level)));
  return { town, crop, qty, pay, level, deliveries: (state.friends || {})[town] || 0, next: TUNING.contractLevels[level] ?? null };
}
/** The towns that offer contracts and whether you have signed each. */
export function contractOffers(state, now) {
  return tradeTowns(state).map((town) => ({ ...contractTerms(state, town, now), signed: state.contracts.some((c) => c.town === town), sister: isSister(state, town) }));
}
export function signContract(state, town, now) {
  if (!hasTrade(state, now)) return fail('Build a Trading Post first.');
  if (!tradeTowns(state).includes(town)) return fail("That town isn't trading yet.");
  if (state.contracts.some((c) => c.town === town)) return fail(`You already have a contract with ${town}.`);
  if (state.contracts.length >= contractSlots(state, now)) return fail('No room for another contract. Upgrade the Trading Post for more.');
  const t = contractTerms(state, town, now);
  state.contracts.push({ id: state.nextId++, town, crop: t.crop, signedAt: now, done: 0, missed: 0 });
  events.emit('contractSigned', { town });
  return { ok: true, reason: '' };
}
export function cancelContract(state, town) {
  const n = state.contracts.length;
  state.contracts = state.contracts.filter((c) => c.town !== town);
  return n === state.contracts.length ? fail('There is no contract with that town.') : { ok: true, reason: '' };
}
/** The top of the hour: every contract's truck comes for its crops. */
function runContracts(state, now) {
  if (!state.contracts.length || !hasTrade(state, now)) return;
  for (const c of state.contracts) {
    const t = contractTerms(state, c.town, now);
    if ((state.goods[t.crop] || 0) + 1e-9 < t.qty) {
      c.missed++;
      events.emit('contractMissed', { town: c.town, crop: t.crop, qty: t.qty });
      continue;
    }
    state.goods[t.crop] -= t.qty;
    c.done++;
    state.friends[c.town] = (state.friends[c.town] || 0) + 1;
    const ms = truckTripMs(state, now);
    state.trucks.push({ id: state.nextId++, kind: 'contract', town: c.town, crop: t.crop, qty: t.qty, coins: t.pay, leaveAt: now, arriveAt: now + ms });
    if (friendLevel(state, c.town) > t.level) events.emit('friendUp', { town: c.town, level: t.level + 1 });
  }
}

// ---- stock market ------------------------------------------------------------------

function marketOf(state) {
  if (!state.market) {
    const prices = {}, zero = {};
    for (const id of Object.keys(STOCKS)) { prices[id] = 100; zero[id] = 0; }
    state.market = { prices, prev: { ...prices }, shares: { ...zero }, paid: { ...zero } };
  }
  return state.market;
}
export function hasExchange(state, now) {
  return state.buildings.some((b) => b.type === 'exchange' && isBuilt(b, now));
}
/** How strong the town is in a stock's part of the economy: its share of shop income (0..1). */
function sectorShare(state, id) {
  const shops = builtBiz(state, state.lastTick);
  const total = shops.reduce((n, b) => n + potentialRate(state, b), 0);
  if (!total) return 1 / Object.keys(STOCKS).length;
  return shops.filter((b) => STOCKS[id].cats.includes(catOf(b))).reduce((n, b) => n + potentialRate(state, b), 0) / total;
}
/** The top of the hour: every price takes a step (luck plus a lean towards your town's strengths). */
function runMarket(state, now) {
  if (!state.market && !hasExchange(state, now)) return;
  const m = marketOf(state);
  const n = Object.keys(STOCKS).length;
  for (const id of Object.keys(STOCKS)) {
    const lean = Math.max(-TUNING.stockLean / 2, Math.min(TUNING.stockLean / 2, TUNING.stockLean * (sectorShare(state, id) - 1 / n) * n / 2));
    const step = (rand(state) - 0.5) * TUNING.stockSwing + lean;
    m.prev[id] = m.prices[id];
    m.prices[id] = Math.max(20, Math.min(500, Math.round(m.prices[id] * (1 + step) * 100) / 100));
  }
}
/** The most you can have invested at once: an hour of the town's shop income. */
export function stockCap(state, now) {
  return Math.max(200, Math.round(townRatePerMin(state, now) * TUNING.stockCapMinutes));
}
/** Your shares: what each is worth now and what it cost you. */
export function portfolio(state, now) {
  const m = marketOf(state);
  const rows = Object.keys(STOCKS).map((id) => ({ id, ...STOCKS[id], price: m.prices[id], prev: m.prev[id], shares: m.shares[id], value: Math.floor(m.shares[id] * m.prices[id]), paid: Math.round(m.paid[id]) }));
  const invested = rows.reduce((a, r) => a + r.paid, 0);
  const cap = stockCap(state, now);
  return { rows, invested, cap, room: Math.max(0, cap - invested) };
}
/** Buy shares for up to `coins` (never past the cap). */
export function buyStock(state, id, coins, now) {
  if (!hasExchange(state, now)) return fail('Build a Stock Exchange first.');
  if (!STOCKS[id]) return fail("That stock isn't traded here.");
  const p = portfolio(state, now);
  if (p.room < 1) return fail('You have invested as much as the market allows. Sell something first.');
  const spend = Math.floor(Math.min(coins, p.room, state.coins));
  if (spend < 1) return fail('You need some coins to invest.');
  const m = marketOf(state);
  state.coins -= spend;
  m.shares[id] += spend / m.prices[id];
  m.paid[id] += spend;
  events.emit('spend', { amount: spend, reason: 'stocks' });
  return { ok: true, reason: '', spent: spend };
}
/** Sell all your shares of one stock at this hour's price: more or less than you paid. */
export function sellStock(state, id, now) {
  const m = marketOf(state);
  if (!STOCKS[id] || !(m.shares[id] > 0)) return fail("You don't own any of that.");
  const coins = Math.floor(m.shares[id] * m.prices[id]);
  const gainLoss = coins - Math.round(m.paid[id]);
  m.shares[id] = 0; m.paid[id] = 0;
  if (coins > 0) gain(state, coins, 'stocks');
  events.emit('stockSold', { id, coins, gainLoss });
  return { ok: true, reason: '', coins, gainLoss };
}

// ---- mayor level and prestige ---------------------------------------------------------
// Mayor XP (goals, VIPs, festivals, collection pages) raises the mayor level; every level is a
// point for a town perk. Founding a new town (prestige) turns the city's value into prestige
// points for permanent perks, and keeps those perks and the collection book.

export const townPerk = (state, k) => Math.max(0, Math.min(TOWN_PERKS[k].max, ((state.mayor || {}).spent || {})[k] || 0));
export const permPerk = (state, k) => Math.max(0, Math.min(PERM_PERKS[k].max, ((state.legacy || {}).perks || {})[k] || 0));
const rentPerk = (state) => 1 + TOWN_PERKS.rent.per * townPerk(state, 'rent');
const salesPerk = (state) => (1 + TOWN_PERKS.sales.per * townPerk(state, 'sales')) * (1 + PERM_PERKS.sales.per * permPerk(state, 'sales'));
/** What rides and deliveries pay, on top of the fare: your car and the Good tipper perk. */
function farePay(state) {
  return carOf(state).pay * (1 + TOWN_PERKS.fares.per * townPerk(state, 'fares'));
}
/** How fast your taxi drives: the car, and both Lead foot (this town) and Turbo taxi (for good). */
export function carSpeed(state) {
  return carOf(state).speed * (1 + TOWN_PERKS.drive.per * townPerk(state, 'drive')) * (1 + PERM_PERKS.drive.per * permPerk(state, 'drive'));
}

/** Mayor level from XP: level L needs 5 + 10 + ... + 5L XP in all. */
export function mayorLevel(state) {
  const xp = (state.mayor || {}).xp || 0;
  let level = 0;
  while (xp >= 5 * (level + 1) * (level + 2) / 2) level++;
  return { level, xp, next: 5 * (level + 1) * (level + 2) / 2, from: 5 * level * (level + 1) / 2 };
}
export function perkPoints(state) {
  const spent = Object.values((state.mayor || {}).spent || {}).reduce((a, b) => a + b, 0);
  return Math.max(0, mayorLevel(state).level - spent);
}
function addXp(state, n) {
  if (!state.mayor) state.mayor = { xp: 0, spent: {} };
  const before = mayorLevel(state).level;
  state.mayor.xp += n;
  const after = mayorLevel(state).level;
  if (after > before) events.emit('mayorUp', { level: after });
}
export function buyTownPerk(state, k) {
  const p = TOWN_PERKS[k];
  if (!p) return fail("We don't know that perk.");
  if (townPerk(state, k) >= p.max) return fail(`${p.name} is maxed out.`);
  if (perkPoints(state) < 1) return fail('No perk points left. Mayor levels come from goals, VIPs, festivals and the collection book.');
  state.mayor.spent[k] = townPerk(state, k) + 1;
  return { ok: true, reason: '', rank: state.mayor.spent[k] };
}
export function buyPermPerk(state, k) {
  const p = PERM_PERKS[k];
  if (!p) return fail("We don't know that perk.");
  if (permPerk(state, k) >= p.max) return fail(`${p.name} is maxed out.`);
  if ((state.legacy.points || 0) < p.cost) return fail(`You need ${p.cost} prestige points. Found a new town to earn them.`);
  state.legacy.points -= p.cost;
  state.legacy.perks[k] = permPerk(state, k) + 1;
  return { ok: true, reason: '', rank: state.legacy.perks[k] };
}

/** Once a local day, each sister town sends a truck with one hour of its old shop income. */
function sendCare(state, now) {
  const sisters = (state.legacy || {}).oldTowns || [];
  if (!sisters.length) return;
  const day = localDay(now);
  if (state.lastCareDay === day) return;
  state.lastCareDay = day;
  sisters.forEach((t, i) => {
    const coins = Math.max(1, Math.round(t.income * TUNING.careHours));
    state.trucks.push({ id: state.nextId++, kind: 'care', town: t.name, crop: 'veggies', qty: 0, coins, leaveAt: now, arriveAt: now + 12000 + i * 4000 });
  });
}

/** What the city is worth: everything spent on buildings and land. */
export function cityValue(state) {
  let land = 0;
  for (let i = 1; i < state.land.length; i++) land += Math.round(TUNING.landBasePrice * Math.pow(TUNING.landGrowth, i - 1));
  return Math.round(state.buildings.reduce((n, b) => n + (b.paid ?? defOf(b).cost), 0) + land);
}
export function prestigePoints(state) {
  return Math.floor(Math.sqrt(cityValue(state) / TUNING.prestigeValuePerPoint));
}
export function prestigeIssue(state) {
  if (state.tenants.length < TUNING.prestigePop) return `Found a new town once you have ${TUNING.prestigePop} residents.`;
  if (prestigePoints(state) < 1) return 'Your city needs to be worth a little more first.';
  if (state.ride || state.job) return 'Finish your current ride or job first.';
  return '';
}
/**
 * Found a new town: a fresh map and start, keeping prestige points (plus the ones this city
 * earns), permanent perks, the collection book and settings. Returns the new state.
 */
export function foundNewTown(state, now) {
  const issue = prestigeIssue(state);
  if (issue) return fail(issue);
  const earned = prestigePoints(state);
  const next = newGame(now);
  // the town you leave lives on as a sister town
  const old = (state.legacy.oldTowns || []).slice();
  old.push({ name: SISTER_NAMES[old.length % SISTER_NAMES.length] + (old.length >= SISTER_NAMES.length ? ` ${Math.floor(old.length / SISTER_NAMES.length) + 1}` : ''),
    pop: state.tenants.length, income: Math.round(townRatePerMin(state, now) * 60), founded: now });
  next.legacy = { points: (state.legacy.points || 0) + earned, perks: { ...state.legacy.perks }, towns: (state.legacy.towns || 1) + 1, oldTowns: old };
  next.lastCareDay = localDay(now);                 // the first care packages come tomorrow
  next.seen = JSON.parse(JSON.stringify(state.seen || next.seen));
  next.settings = { ...(state.settings || {}) };
  next.coins += PERM_PERKS.coins.per * permPerk(next, 'coins');
  events.emit('newTown', { earned, towns: next.legacy.towns });
  return { ok: true, reason: '', earned, state: next };
}

// ---- transit and gateways ---------------------------------------------------------
// Bus stops (rent for homes in reach; two or more make a bus line that brings visitors), and the
// gateways that connect to other cities: a train station, a port and an airport.

/** Is there a built building of this type? */
function has(state, type, now) {
  return state.buildings.some((b) => b.type === type && isBuilt(b, now));
}
/** How many newcomers can wait at the Welcome sign: one more with a train station. */
export function maxApplicants(state) {
  return TUNING.applicantCount + (has(state, 'station', state.lastTick) ? 1 : 0);
}
/** How much more often visitors come: the bus line, a station, an airport. */
export function visitorsMult(state, now) {
  const stops = state.buildings.filter((b) => b.type === 'busstop' && isBuilt(b, now)).length;
  return (1 + TUNING.busLineVisitors * Math.max(0, Math.min(3, stops - 1)))
    * (has(state, 'station', now) ? 1 + TUNING.stationVisitors : 1) * (has(state, 'airport', now) ? 1 + TUNING.airportVisitors : 1);
}

// ---- the entry road and trucks ------------------------------------------------
// One road leads in from the edge of the world to the first town. It follows the
// town's own street plan (so it never takes a lot), crossing land not bought yet.
// Trade travels on it by truck: a sale or an order pays when its truck leaves town,
// an import lands in the barn when its truck reaches the Trading Post.

const entryCache = new Map();
const tkey = (x, y) => `${x},${y}`;
const STEPS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The entry road: tiles in order from the world's edge to the first road of the first
 * town, plus `out`, the step that leads off the edge. null if no street reaches the edge.
 */
export function entryRoute(state) {
  const id = `${state.worldSeed >>> 0}|${state.streets || 'grid'}`;
  if (entryCache.has(id)) return entryCache.get(id);
  const home = PARCELS[0];
  const prev = new Map(), queue = [];
  for (let y = home.y0; y <= home.y1; y++) for (let x = home.x0; x <= home.x1; x++) {
    if (isRoadAt(state, x, y)) { prev.set(tkey(x, y), null); queue.push({ x, y }); }
  }
  const onEdge = (x, y) => x === WORLD.x0 || x === WORLD.x1 || y === WORLD.y0 || y === WORLD.y1;
  let end = null;
  for (let i = 0; i < queue.length && !end; i++) {
    const cur = queue[i];
    for (const [dx, dy] of STEPS4) {
      const x = cur.x + dx, y = cur.y + dy, k = tkey(x, y);
      if (prev.has(k) || x < WORLD.x0 || x > WORLD.x1 || y < WORLD.y0 || y > WORLD.y1 || !isRoadAt(state, x, y)) continue;
      prev.set(k, cur);
      if (onEdge(x, y)) { end = { x, y }; break; }
      queue.push({ x, y });
    }
  }
  let res = null;
  if (end) {
    const tiles = [];
    for (let t = end; t; t = prev.get(tkey(t.x, t.y))) tiles.push({ x: t.x, y: t.y });
    const out = end.x === WORLD.x0 ? { dx: -1, dy: 0 } : end.x === WORLD.x1 ? { dx: 1, dy: 0 } : end.y === WORLD.y0 ? { dx: 0, dy: -1 } : { dx: 0, dy: 1 };
    res = { tiles, out, keys: new Set(tiles.map((t) => tkey(t.x, t.y))) };
  }
  if (entryCache.size > 8) entryCache.clear();
  entryCache.set(id, res);
  return res;
}

/** Is this tile part of the entry road (which is a road even on land you don't own)? */
export function isEntryRoad(state, x, y) {
  const e = entryRoute(state);
  return !!e && e.keys.has(tkey(x, y));
}

function tradePost(state, now) {
  return state.buildings.filter((b) => b.type === 'trade' && isBuilt(b, now)).sort((a, b) => a.id - b.id)[0] || null;
}

/**
 * The road a truck drives: from the Trading Post's front road out along the entry road
 * to the world's edge (an import drives it backwards). Only roads on your land or the entry road.
 */
export function truckRoute(state, now) {
  const post = tradePost(state, now), e = entryRoute(state);
  if (!post || !e) return null;
  const ok = (x, y) => isRoadAt(state, x, y) && (ownsTile(state, x, y) || e.keys.has(tkey(x, y)));
  let start = null;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (!start && ok(post.x + dx, post.y + dy)) start = { x: post.x + dx, y: post.y + dy };
  if (!start) {                            // no road beside it: the nearest one will do
    let best = Infinity;
    for (let y = WORLD.y0; y <= WORLD.y1; y++) for (let x = WORLD.x0; x <= WORLD.x1; x++) {
      const d = Math.abs(x - post.x) + Math.abs(y - post.y);
      if (d < best && ok(x, y)) { best = d; start = { x, y }; }
    }
  }
  if (!start) return null;
  const goal = e.tiles[0];
  const prev = new Map([[tkey(start.x, start.y), null]]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur.x === goal.x && cur.y === goal.y) {
      const path = [];
      for (let t = cur; t; t = prev.get(tkey(t.x, t.y))) path.push({ x: t.x, y: t.y });
      return path.reverse();
    }
    for (const [dx, dy] of STEPS4) {
      const x = cur.x + dx, y = cur.y + dy, k = tkey(x, y);
      if (prev.has(k) || !ok(x, y)) continue;
      prev.set(k, cur); queue.push({ x, y });
    }
  }
  return null;
}

/** How long one trip takes: longer the farther the Trading Post is from the entry road. */
export function truckTripMs(state, now) {
  const path = truckRoute(state, now);
  const lots = path ? path.length - 1 : 15;
  const speed = TUNING.truckSpeed * (1 + UPGRADES.trucks.per * upLevel(state, 'trucks'));
  return Math.round(Math.min(TUNING.truckMaxMs, Math.max(TUNING.truckMinMs, (lots / speed) * 1000)));
}

/** Trucks the town has: one per level of each Trading Post. */
export function truckCount(state, now) {
  return state.buildings.filter((b) => b.type === 'trade' && isBuilt(b, now)).reduce((n, b) => n + (b.level || 1) * TUNING.trucksPerLevel, 0);
}

/** A friendly reason when every truck is out, else ''. */
function truckBusy(state, now) {
  const out = (state.trucks || []).filter((t) => t.arriveAt > now && t.kind !== 'contract' && t.kind !== 'care');   // neighbours bring their own trucks
  if (out.length < truckCount(state, now)) return '';
  const back = Math.max(1, Math.ceil((Math.min(...out.map((t) => t.arriveAt)) - now) / 1000));
  return `Your ${out.length > 1 ? 'trucks are' : 'truck is'} on the road. One is free in ${back}s (upgrade the Trading Post for more trucks).`;
}

function sendTruck(state, now, load) {
  const ms = truckTripMs(state, now);
  const truck = { id: state.nextId++, ...load, leaveAt: now, arriveAt: now + ms };
  state.trucks.push(truck);
  events.emit('truckOut', { truck });
  return truck;
}

/** Trucks that have finished their trip hand over what they carry. Runs on every advance. */
function finishTrucks(state, now) {
  if (!state.trucks.length) return;
  const done = state.trucks.filter((t) => t.arriveAt <= now).sort((a, b) => a.arriveAt - b.arriveAt);
  if (!done.length) return;
  state.trucks = state.trucks.filter((t) => t.arriveAt > now);
  for (const t of done) {
    if (t.kind === 'import') {
      state.goods[t.crop] = (state.goods[t.crop] || 0) + t.qty;
      state.crops[t.crop] = (state.crops[t.crop] || 0) + t.qty;
      discoverRecipes(state);
    } else if (t.kind === 'contract') {
      gain(state, t.coins, 'contract');
    } else if (t.kind === 'care') {
      gain(state, t.coins, 'care');
      events.emit('care', { town: t.town, coins: t.coins });
    } else if (t.kind === 'order') {
      gain(state, t.coins, 'order');
      gainGems(state, t.gems);
      events.emit('order', { order: t });
    } else {
      gain(state, t.coins, 'trade');
    }
    events.emit('truckIn', { truck: t });
  }
}

// ---- crops, recipes, learning -------------------------------------------------

/** Recipes a shop cooks: every one the town has discovered if it is a food shop, else none. */
export function recipesFor(state, b) {
  return b && isBiz(b) && catOf(b) === 'food' ? RECIPES.filter((r) => (state.recipes || []).includes(r.id)) : [];
}

/** The next undiscovered recipe with how far along each crop is, or null when all are known. */
export function nextRecipe(state) {
  const r = RECIPES.find((x) => !state.recipes.includes(x.id));
  if (!r) return null;
  return { recipe: r, progress: Object.keys(r.needs).map((crop) => ({ crop, have: Math.min(r.needs[crop], Math.floor(state.crops[crop] || 0)), want: r.needs[crop] })) };
}

const CROP_EPSILON = 1e-8;

function discoverRecipes(state) {
  for (const r of RECIPES) {
    if (state.recipes.includes(r.id)) continue;
    if (Object.keys(r.needs).every((crop) => (state.crops[crop] || 0) + CROP_EPSILON >= r.needs[crop])) {
      state.recipes.push(r.id);
      events.emit('recipe', { recipe: r });
    }
  }
}

function msUntilRecipe(state, growth) {
  let next = Infinity;
  for (const recipe of RECIPES) {
    if (state.recipes.includes(recipe.id)) continue;
    let wait = 0;
    for (const [crop, target] of Object.entries(recipe.needs)) {
      const missing = target - (state.crops[crop] || 0) - CROP_EPSILON;
      if (missing > 0) wait = Math.max(wait, missing / (growth[crop] || 0));
    }
    next = Math.min(next, Math.max(1, Math.ceil(wait)));
  }
  return next;
}

/** How clever the town is: grows as residents gain skill. About 90 for newcomers, 150 at best. */
export function townIQ(state) {
  if (!state.tenants.length) return 0;
  let sum = 0;
  for (const t of state.tenants) for (const c of CATEGORIES) sum += t.skills[c] || 0;
  return Math.round(70 + (sum / state.tenants.length / (CATEGORIES.length * 9)) * 80);
}

/** One resident gains a skill point: the skill their job uses if it can grow, else their strongest that can. */
function teach(state) {
  const learners = state.tenants.filter((t) => CATEGORIES.some((c) => t.skills[c] < 9));
  if (!learners.length) return;
  // go-getters learn twice as often, homebodies half as often
  const t = pickWeighted(state, learners, (p) => (p.trait === 'gogetter' ? 2 : p.trait === 'homebody' ? 0.5 : 1));
  const job = buildingById(state, t.jobId);
  let cat = job && isBiz(job) ? catOf(job) : null;
  if (!cat || t.skills[cat] >= 9) {
    cat = CATEGORIES.filter((c) => t.skills[c] < 9).sort((a, b) => t.skills[b] - t.skills[a])[0];
  }
  t.skills[cat]++;
  events.emit('lesson', { tenant: t, category: cat, value: t.skills[cat] });
}

// ---- needs and happiness ----------------------------------------------------
// Everything here is worked out from the town as it is right now. Nothing is stored
// and nothing decays. Each resident is happy about the needs they personally have met.

/** How many lots away a town building reaches (homes it serves, shops it looks after). */
export function reachOf(b) {
  return (defOf(b).reach ?? TUNING.reach) + ((b.level || 1) - 1);
}
const inReach = (b, x, y) => Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= reachOf(b);
const servesOf = (b) => Math.round(defOf(b).provides.serves * levelMult(b.level) * qualityOf(b) * favOf(b));

/**
 * Who has what. `needs` are the needs this town cares about so far, `met` maps a resident's id
 * to the set of needs they have, `have` counts residents per need, `served` counts residents
 * per town building.
 * - jobs: you have one or you don't.
 * - shop needs: every staffed shop serves `needServes` residents, longest-standing residents first.
 * - town buildings: each serves its nearest residents whose home is within reach.
 */
export function townMood(state, now) {
  const pop = state.tenants.length;
  const needs = NEEDS.filter((n) => pop >= n.unlockAt);
  const met = new Map(state.tenants.map((t) => [t.id, new Set()]));
  const have = {}; const served = new Map(); const staffed = {}; const room = {};
  const give = (t, id) => { met.get(t.id).add(id); have[id] = (have[id] || 0) + 1; };
  for (const b of state.buildings) {
    if (!isBiz(b) || !isBuilt(b, now) || workersOf(state, b.id).length === 0) continue;
    staffed[catOf(b)] = (staffed[catOf(b)] || 0) + 1;
    room[catOf(b)] = (room[catOf(b)] || 0) + shopServes(state, b);
  }
  const homes = new Map(state.buildings.map((b) => [b.id, b]));
  for (const n of needs) {
    if (n.id === 'jobs') {
      for (const t of state.tenants) if (t.jobId != null) give(t, n.id);
    } else if (CATEGORIES.includes(n.id)) {
      state.tenants.slice(0, room[n.id] || 0).forEach((t) => give(t, n.id));
    } else {
      for (const b of state.buildings) {
        if (defOf(b).provides?.need !== n.id || !isBuilt(b, now)) continue;
        const near = state.tenants
          .filter((t) => !met.get(t.id).has(n.id) && homes.has(t.homeId) && inReach(b, homes.get(t.homeId).x, homes.get(t.homeId).y))
          .map((t) => ({ t, d: Math.abs(homes.get(t.homeId).x - b.x) + Math.abs(homes.get(t.homeId).y - b.y) }))
          .sort((a, z) => a.d - z.d || a.t.id - z.t.id)
          .slice(0, servesOf(b));
        for (const { t } of near) give(t, n.id);
        served.set(b.id, near.length);
      }
    }
  }
  return { needs, met, have, served, staffed };
}

/** The needs this town cares about so far, each with a score from 0 (unmet) to 1 (met). */
export function needsStatus(state, now, mood = townMood(state, now)) {
  const pop = state.tenants.length;
  if (pop === 0) return [];
  return mood.needs.map((n) => {
    const have = mood.have[n.id] || 0;
    return { id: n.id, name: n.name, icon: n.icon, have, want: pop, score: Math.min(1, have / pop) };
  });
}

/** Town happiness, 0..100: the average of everyone's own happiness. */
export function happiness(state, now, mood = townMood(state, now)) {
  const needs = needsStatus(state, now, mood);
  if (!needs.length) return 0;
  return Math.round((100 * needs.reduce((sum, n) => sum + n.score, 0)) / needs.length);
}

/**
 * One resident's happiness (0..100) and, for every need they are missing, a plain reason.
 * Pass `mood` when asking about many residents at once.
 */
export function residentMood(state, tenant, now, mood = townMood(state, now)) {
  const mine = mood.met.get(tenant.id) || new Set();
  const home = buildingById(state, tenant.homeId);
  const missing = [];
  for (const n of mood.needs) {
    if (mine.has(n.id)) continue;
    let why;
    if (n.id === 'jobs') why = 'No job yet';
    else if (CATEGORIES.includes(n.id)) why = mood.staffed[n.id] ? 'the places in town are full' : 'nowhere open in town yet';
    else {
      const all = state.buildings.filter((b) => defOf(b).provides?.need === n.id && isBuilt(b, now));
      why = !all.length ? 'nothing in town yet'
        : home && all.some((b) => inReach(b, home.x, home.y)) ? 'the nearest one is full' : 'too far from home';
    }
    missing.push({ id: n.id, name: n.name, icon: n.icon, why: n.id === 'jobs' ? why : `${n.name}: ${why}` });
  }
  const score = mood.needs.length ? Math.round((100 * (mood.needs.length - missing.length)) / mood.needs.length) : 100;
  return { score, missing };
}

/** Rent change for a resident this happy: -unhappyRentCut at 0, +happyRentBonus at 100, a straight line between. */
export function moodRentFactor(score) {
  return (TUNING.happyRentBonus * score - TUNING.unhappyRentCut * (100 - score)) / 100;
}

/** What happiness adds to (or, for unhappy residents, takes from) a day's rent. */
export function rentBonusPerDay(state, now, mood = townMood(state, now)) {
  let sum = 0;
  for (const home of state.buildings) {
    if (!isHome(home)) continue;
    const res = residentsOf(state, home.id);
    if (!res.length) continue;
    const each = (defOf(home).rentPerTenant * levelMult(home.level) * (1 + homeBoost(state, home, now)));
    for (const t of res) sum += each * rentPerk(state) * traitRent(state, t, home) * moodRentFactor(t.trait === 'homebody' ? 100 : residentMood(state, t, now, mood).score);
  }
  return Math.round(sum);
}

// ---- shop problems ------------------------------------------------------------
// A small trouble makes one shop sell a bit less until it is fixed. A police or fire station
// (or a clinic, for health troubles) within reach fixes it for free; otherwise the mayor pays.

export function problemOf(state, buildingId) {
  return (state.problems || []).find((p) => p.buildingId === buildingId) || null;
}

function fixerFor(state, shop, kind, now) {
  const need = PROBLEMS[kind].fixer;
  return state.buildings.find((b) => defOf(b).gov && defOf(b).provides?.need === need && isBuilt(b, now) && inReach(b, shop.x, shop.y)) || null;
}

export function problemFee(state, now) {
  return Math.round(Math.max(TUNING.problemMinFee, townRatePerMin(state, now) * TUNING.problemFeeMinutes) * (1 - UPGRADES.repair.per * upLevel(state, 'repair')));
}

function maybeProblem(state, now) {
  if (now < state.nextProblemAt) return;
  state.nextProblemAt = now + TUNING.problemGapMinMs + randInt(state, TUNING.problemGapMaxMs - TUNING.problemGapMinMs + 1);
  if (population(state) < TUNING.problemUnlockPop) return;
  const shops = builtBiz(state, now);
  if (state.problems.length >= 1 + Math.floor(shops.length / TUNING.problemShopsPerSlot)) return;
  const open = shops.filter((b) => workersOf(state, b.id).length > 0 && !problemOf(state, b.id));
  if (!open.length) return;
  // a shop with a genius on the team has trouble twice as often
  const b = pickWeighted(state, open, (s) => (workersOf(state, s.id).some((t) => t.trait === 'genius') ? 2 : 1));
  const kind = pick(state, Object.keys(PROBLEMS));
  const fixer = fixerFor(state, b, kind, now);
  const problem = { buildingId: b.id, kind, at: now, fixAt: fixer ? now + fixMs(state) : null, fixerId: fixer ? fixer.id : null };
  state.problems.push(problem);
  events.emit('problem', { building: b, problem });
  const worker = workersOf(state, b.id)[0];
  if (worker) post(state, now, worker, 'resident', POSTS.problem.replace('{shop}', buildingName(b)), 'bad');
}

/** Clears problems whose helpers have finished, and sends help to any that a new station can now reach. */
function resolveProblems(state, t) {
  let changed = false;
  for (const p of [...state.problems]) {
    const shop = buildingById(state, p.buildingId);
    if (!shop || (p.fixAt != null && p.fixAt <= t)) {
      state.problems.splice(state.problems.indexOf(p), 1);
      changed = true;
      if (shop) events.emit('problemFixed', { building: shop, problem: p, auto: true });
    } else if (p.fixAt == null) {
      const fixer = fixerFor(state, shop, p.kind, t);
      if (fixer) { p.fixAt = t + fixMs(state); p.fixerId = fixer.id; }
    }
  }
  return changed;
}

/** The mayor pays to sort a problem out right away. */
export function fixProblem(state, buildingId, now) {
  const p = problemOf(state, buildingId);
  if (!p) return fail('Everything is fine here.', { cost: 0 });
  const cost = problemFee(state, now);
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins to fix this.`, { cost: 0 });
  state.coins -= cost;
  state.problems.splice(state.problems.indexOf(p), 1);
  events.emit('spend', { amount: cost, reason: 'fix' });
  events.emit('problemFixed', { building: buildingById(state, buildingId), problem: p, auto: false });
  return { ok: true, reason: '', cost };
}

/**
 * Up to three things the town wants most right now, most wanted first.
 * Each is { id, icon, title, hint, type? } where `type` is a building that would help.
 */
export function mostWanted(state, now) {
  const pop = state.tenants.length;
  const out = [];
  const cheapest = (pred) => Object.values(BUILDINGS).filter((d) => pred(d) && isUnlocked(state, d.id))
    .sort((a, b) => costOf(state, a.id) - costOf(state, b.id))[0];
  if (state.buildings.every((b) => !isHome(b))) {
    return [{ id: 'homes', icon: 'key', title: 'A first home', hint: 'Build a Tent so someone can move in.', type: 'tent', score: 0 }];
  }
  for (const n of needsStatus(state, now)) {
    if (n.score >= 1) continue;
    const short = n.want - n.have;
    if (n.id === 'jobs') {
      const open = builtBiz(state, now).find((b) => workersOf(state, b.id).length < slotsOf(b));
      out.push({ id: 'jobs', icon: n.icon, title: `Jobs for ${short} ${short === 1 ? 'resident' : 'residents'}`,
        hint: open ? `Hire at ${buildingName(open)}` : 'Open a shop',
        buildingId: open?.id, type: null, cat: open ? null : 'food', score: n.score });
    } else if (!CATEGORIES.includes(n.id)) {
      const direct = cheapest((d) => !d.gov && d.provides && d.provides.need === n.id);     // parks
      const viaGov = Object.values(BUILDINGS).some((d) => d.gov && d.provides.need === n.id);
      out.push({ id: n.id, icon: n.icon, title: `More ${n.name.toLowerCase()}`,
        hint: direct ? 'Choose a park or decoration' : viaGov && categoryUnlocked(state, 'gov') ? 'Open Government' : 'Unlocks as the town grows',
        have: n.have, want: n.want,
        type: direct?.id ?? null, cat: !direct && viaGov && categoryUnlocked(state, 'gov') ? 'gov' : null, score: n.score });
    } else {
      const idle = state.buildings.find((b) => isBiz(b) && catOf(b) === n.id && isBuilt(b, now) && workersOf(state, b.id).length === 0);
      const can = categoryUnlocked(state, n.id);
      out.push({ id: n.id, icon: n.icon, title: `More ${n.name.toLowerCase()}`,
        hint: idle ? `Hire at ${buildingName(idle)}` : can ? `Open ${SHOP_CATS[n.id].name}` : `Unlocks at ${SHOP_CATS[n.id].unlockAt} residents`,
        buildingId: idle?.id, have: n.have, want: n.want,
        type: null, cat: idle || !can ? null : n.id, score: n.score });
    }
  }
  if (vacancies(state) === 0) {
    const home = cheapest((d) => d.kind === 'home');
    out.push({ id: 'homes', icon: 'key', title: 'More homes', hint: 'Build a home', type: home?.id ?? null, score: 0.5 });
  }
  // a shop several people dream of working at
  const dreams = {};
  for (const t of state.tenants) if (!state.buildings.some((b) => b.type === t.dream)) dreams[t.dream] = (dreams[t.dream] || 0) + 1;
  const top = Object.keys(dreams).sort((a, b) => dreams[b] - dreams[a])[0];
  if (top && pop > 0) {
    const d = BUILDINGS[top];
    out.push({ id: 'dream', icon: 'star', title: `A ${d.name}`,
      hint: `Try a ${SHOP_CATS[d.category].name} draw · ${dreams[top]} dreaming of it`,
      type: null, cat: categoryUnlocked(state, d.category) ? d.category : null, score: 0.8 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 3);
}

/** What this resident would say if you asked how things are going. Always a friendly sentence. */
export function tenantWish(state, tenant, now, mood = townMood(state, now)) {
  const job = buildingById(state, tenant.jobId);
  if (job && job.type === tenant.dream) return 'I have my dream job. Thank you!';
  const dream = BUILDINGS[tenant.dream];
  if (dream && !state.buildings.some((b) => b.type === tenant.dream)) return `I wish we had ${/^[AEIOU]/i.test(dream.name) ? 'an' : 'a'} ${dream.name}. I'd love to work there.`;
  if (!job) return NEEDS[0].wish;
  // otherwise they voice one of the town's unmet needs, a different one per person
  const unmet = residentMood(state, tenant, now, mood).missing.filter((n) => n.id !== 'jobs');
  if (unmet.length) return NEEDS.find((n) => n.id === unmet[tenant.id % unmet.length].id).wish;
  return HAPPY_LINES[tenant.id % HAPPY_LINES.length];
}

export function bizStatus(state, b, now) {
  if (!isBuilt(b, now)) return 'building';
  if (!isBiz(b)) return 'open';
  if (workersOf(state, b.id).length === 0) return 'needs-workers';
  if (!(b.stock > 0)) return 'out-of-stock';
  return 'open';
}

export function restockCostOf(b) {
  const max = stockMaxOf(b);
  return b.dreamStars ? 0 : Math.round(statsOf(b).restockCost * levelMult(b.level) * sizeOf(b) * Math.max(0, max - b.stock) / max);
}

export function soldOutShops(state, now) {
  return state.buildings.filter((b) => isBiz(b) && isBuilt(b, now) && b.stock <= 0);
}

export function restockAll(state, now) {
  const shops = soldOutShops(state, now);
  for (const b of shops) restock(state, b.id, now);
  return { ok: true, count: shops.length };
}

export function restock(state, buildingId, now) {
  const b = buildingById(state, buildingId);
  if (!b || !isBiz(b)) return fail("There's nothing to restock here.", { cost: 0 });
  if (!isBuilt(b, now)) return fail('Still being built. It opens fully stocked!', { cost: 0 });
  const max = stockMaxOf(b);
  const missing = max - b.stock;
  if (missing <= 0) return fail('The shelves are already full!', { cost: 0 });
  const fullCost = restockCostOf(b);
  let cost = fullCost;
  let partial = false;
  if (state.coins >= fullCost) {
    b.stock = max;
  } else {
    // Never block the player: pay what they have and fill as much as that buys,
    // but always at least a quarter of the shelf.
    cost = Math.max(0, Math.floor(state.coins));
    const bought = Math.floor((missing * cost) / fullCost);
    const atLeast = Math.ceil(max * TUNING.restockMinFraction);
    b.stock = Math.min(max, b.stock + Math.max(bought, atLeast));
    partial = b.stock < max;
  }
  state.coins -= cost;
  state.stats.restocks++;
  if (cost > 0) events.emit('spend', { amount: cost, reason: 'restock' });
  events.emit('restocked', { building: b, auto: false });
  checkGoals(state, now);
  return { ok: true, reason: '', cost, partial };
}

// ---- people ---------------------------------------------------------------

export function moveIn(state, applicantIndex, homeId, now) {
  const person = state.applicants[applicantIndex];
  if (!person) return fail('That person already found a place. Pick someone else!', { tenant: null });
  const home = buildingById(state, homeId);
  if (!home || !isHome(home)) return fail('People can only move into homes.', { tenant: null });
  if (!isBuilt(home, now)) return fail('This home is still being built.', { tenant: null });
  if (residentsOf(state, home.id).length >= defOf(home).capacity) {
    return fail('This home is full. Build another one!', { tenant: null });
  }
  const before = population(state);
  const tenant = person;
  tenant.homeId = home.id;
  tenant.jobId = null;
  delete tenant.seen;               // now you know their real skills (and their trait)
  tenant.welcome = true;            // can be driven home once for a bonus (optional)
  state.tenants.push(tenant);
  state.applicants.splice(applicantIndex, 1);
  openSpot(state, now);
  events.emit('moveIn', { tenant, reveal: true });
  const after = population(state);
  for (const cat of [...Object.keys(SHOP_CATS), 'gov']) {
    const at = cat === 'gov' ? GOV.unlockAt : SHOP_CATS[cat].unlockAt;
    if (at > before && at <= after) events.emit('unlock', { category: cat, name: cat === 'gov' ? GOV.name : SHOP_CATS[cat].name });
  }
  for (const type of Object.keys(BUILDINGS)) {
    const d = BUILDINGS[type];
    if (d.kind === 'biz' || d.gov) continue;          // those arrive through their category
    const at = d.unlockAt;
    if (at > before && at <= after && isUnlocked(state, type)) events.emit('unlock', { type });
  }
  checkGoals(state, now);
  return { ok: true, reason: '', tenant };
}

export function jobFit(state, tenant, b) {
  if (!tenant || !b || !isBiz(b)) return { skill: 0, dream: false, open: false };
  const def = defOf(b);
  const workers = workersOf(state, b.id);
  return {
    skill: tenant.skills[catOf(b)] || 0,
    dream: tenant.dream === b.type,
    open: workers.length < slotsOf(b) || tenant.jobId === b.id,
  };
}

export function assignJob(state, tenantId, bizId, now) {
  const tenant = tenantById(state, tenantId);
  if (!tenant) return fail("We couldn't find that person.", { dream: false });
  const old = buildingById(state, tenant.jobId);

  if (bizId == null) {
    tenant.jobId = null;
    recountStars(state, old);
    events.emit('job', { tenant, building: null, dream: false });
    checkGoals(state, now);
    return { ok: true, reason: '', dream: false };
  }

  const b = buildingById(state, bizId);
  if (!b || !isBiz(b)) return fail('People can only work at a business.', { dream: false });
  if (!isBuilt(b, now)) return fail("It isn't open yet. Almost there!", { dream: false });
  const dream = tenant.dream === b.type;
  if (tenant.jobId === b.id) return { ok: true, reason: '', dream };
  if (workersOf(state, b.id).length >= slotsOf(b)) {
    return fail('Every job here is taken. Move someone first.', { dream: false });
  }

  tenant.jobId = b.id;
  recountStars(state, old);
  recountStars(state, b);
  let first = false;
  if (dream && !tenant.dreamDone) {
    tenant.dreamDone = true;
    first = true;
    state.stats.dreamJobs++;
  }
  events.emit('job', { tenant, building: b, dream });
  if (first) { gainGems(state, 1); post(state, now, tenant, 'resident', POSTS.dream.replace('{shop}', buildingName(b)), 'good'); }
  checkGoals(state, now);
  return { ok: true, reason: '', dream, firstDream: first };
}

/**
 * Up to 3 jobs that would be better for this person than what they do now
 * (dream job beats anything; otherwise higher skill). Jobs with a free slot come
 * first, then dream jobs, then higher skill.
 */
export function bestJobs(state, tenantId, now) {
  const tenant = tenantById(state, tenantId);
  if (!tenant) return [];
  const cur = buildingById(state, tenant.jobId);
  const curFit = cur ? jobFit(state, tenant, cur) : null;
  const out = [];
  for (const b of state.buildings) {
    if (!isBiz(b) || !isBuilt(b, now) || b.id === tenant.jobId) continue;
    const fit = jobFit(state, tenant, b);
    if (curFit) {
      if (curFit.dream) continue; // already living the dream
      if (!fit.dream && fit.skill <= curFit.skill) continue;
    }
    out.push({ building: b, skill: fit.skill, dream: fit.dream, open: fit.open });
  }
  out.sort(
    (a, b) => (b.open - a.open) || (b.dream - a.dream) || (b.skill - a.skill) || (a.building.id - b.building.id)
  );
  return out.slice(0, 3);
}

// ---- upgrades -------------------------------------------------------------------
// The Upgrades tab: short ladders bought with coins that make the town run better.

export function upLevel(state, id) {
  return Math.max(0, Math.min(UPGRADES[id].costs.length, (state.upgrades || {})[id] || 0));
}
/** What the next level of an upgrade costs, or 0 when it is maxed. */
export function upgradeNextCost(state, id) {
  return UPGRADES[id] ? UPGRADES[id].costs[upLevel(state, id)] || 0 : 0;
}
export function buyUpgrade(state, id, now) {
  const u = UPGRADES[id];
  if (!u) return fail("We don't know that upgrade.");
  const cost = upgradeNextCost(state, id);
  if (!cost) return fail(`${u.name} is fully upgraded.`);
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins.`);
  state.coins -= cost;
  state.upgrades = { ...(state.upgrades || {}), [id]: upLevel(state, id) + 1 };
  events.emit('spend', { amount: cost, reason: 'upgrade' });
  events.emit('upgradeBought', { id, level: state.upgrades[id] });
  return { ok: true, reason: '', level: state.upgrades[id], cost };
}
const fixMs = (state) => TUNING.problemAutoFixMs * (1 - UPGRADES.repair.per * upLevel(state, 'repair'));

/** Is there a built Construction Yard whose reach covers (x, y)? */
export function yardNear(state, x, y, now) {
  return state.buildings.some((b) => b.type === 'yard' && isBuilt(b, now) && Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= reachOf(b));
}
/** Share of the usual build time: the crew upgrade, and half again near a Construction Yard. */
export function buildFactor(state, x, y, now) {
  return (1 - UPGRADES.crew.per * upLevel(state, 'crew')) * (yardNear(state, x, y, now) ? TUNING.yardFactor : 1)
    * (1 - TOWN_PERKS.build.per * townPerk(state, 'build')) * (1 - PERM_PERKS.build.per * permPerk(state, 'build'));
}

// ---- newcomers -----------------------------------------------------------------
// Newcomers drive in on the entry road and wait at the Welcome sign. You see their skills
// as ranges and a first-impression hint; their real skills and trait show when they move in.

function pickWeighted(state, list, weight) {
  const total = list.reduce((n, x) => n + weight(x), 0);
  let r = rand(state) * total;
  for (const x of list) { r -= weight(x); if (r < 0) return x; }
  return list[list.length - 1];
}

/** Time until the next newcomer: arriveMs, half that during an ad, twice that after a move-out. */
function arrivalGap(state, at) {
  let gap = TUNING.arriveMs * (1 - UPGRADES.welcome.per * upLevel(state, 'welcome')) * (1 - TOWN_PERKS.welcome.per * townPerk(state, 'welcome'));
  if (at < (state.adUntil || 0)) gap /= 2;
  if (at < (state.slowArrivalsUntil || 0)) gap *= 2;
  if (has(state, 'station', at)) gap *= 1 - TUNING.stationArrivals;
  return gap;
}

/** A spot at the Welcome sign just opened: someone new drives in a little later. */
function openSpot(state, now) {
  const next = now + arrivalGap(state, now);
  if (state.nextApplicantAt <= now || state.nextApplicantAt > next) state.nextApplicantAt = next;
}

/** "Not now": a newcomer drives on, for free, and someone else arrives a little later. */
export function sendAway(state, applicantIndex, now) {
  const a = state.applicants[applicantIndex];
  if (!a) return fail('They already left.');
  state.applicants.splice(applicantIndex, 1);
  openSpot(state, now);
  events.emit('sendAway', { applicant: a });
  return { ok: true, reason: '' };
}

/**
 * Ask a resident to move out. It is always allowed and never costs coins; the mild catch is
 * that word gets around, so newcomers take twice as long to arrive for a while.
 */
export function moveOut(state, tenantId, now) {
  const t = tenantById(state, tenantId);
  if (!t) return fail("We couldn't find that person.");
  const job = buildingById(state, t.jobId);
  state.tenants = state.tenants.filter((x) => x !== t);
  if (job) recountStars(state, job);
  if (state.ride && state.ride.tenantId === t.id) clearRide(state, now);
  state.slowArrivalsUntil = now + TUNING.moveOutSlowMs;
  if (state.nextApplicantAt > now) state.nextApplicantAt = Math.max(state.nextApplicantAt, now + arrivalGap(state, now));
  events.emit('moveOut', { tenant: t });
  checkGoals(state, now);
  return { ok: true, reason: '' };
}

/** Where newcomers wait: on the entry road just outside the first town, so nothing built is covered. */
export function welcomeSpot(state) {
  const e = entryRoute(state);
  return e ? e.tiles.at(e.tiles.length >= 2 ? -2 : -1) : null;
}

// ---- visitors and the feed ----------------------------------------------------------
// While you play, visitors drive in on the entry road wanting one kind of place. They spend
// at your best shop of that kind (a little extra income) and post about it; if there is none,
// their post says what the town is missing. A happy visitor may join the newcomers.

/** Add a post to the feed (oldest posts drop off). `who` is a person-like { name, look }. */
function post(state, now, who, kind, text, tone = 'hint') {
  state.feed.push({ id: state.nextId++, at: now, name: who.name, look: who.look, text, who: kind, tone });
  if (state.feed.length > TUNING.feedMax) state.feed.splice(0, state.feed.length - TUNING.feedMax);
  events.emit('post', { post: state.feed[state.feed.length - 1] });
}

export function unreadPosts(state) {
  return state.feed.filter((p) => p.id > (state.feedRead || 0)).length;
}
export function readFeed(state) {
  state.feedRead = state.feed.length ? state.feed[state.feed.length - 1].id : state.feedRead;
  return { ok: true, reason: '' };
}

function maybeVisitor(state, now) {
  if (now < state.nextVisitAt) return;
  state.nextVisitAt = now + Math.round((TUNING.visitorGapMinMs + randInt(state, TUNING.visitorGapMaxMs - TUNING.visitorGapMinMs + 1)) / (state.festivalUntil > now ? 2 : 1) / visitorsMult(state, now));
  if (population(state) < TUNING.visitorUnlockPop) return;
  visit(state, now);
}

/** One visitor arrives, wanting a kind of place. Returns what happened (for tests). */
export function visit(state, now, cat = null) {
  const v = makeApplicant(state);           // a whole person, so they can move in later
  cat = cat || pick(state, CATEGORIES.filter((c) => categoryUnlocked(state, c)).concat(CATEGORIES.filter((c) => categoryUnlocked(state, c) && shopsIn(state, c))));
  const open = builtBiz(state, now).filter((b) => catOf(b) === cat && workersOf(state, b.id).length && (b.stock > 0 || b.dreamStars));
  const shop = open.sort((a, b) => ratePerMin(state, b) - ratePerMin(state, a) || a.id - b.id)[0];
  state.stats.visitors++;
  if (!shop) {
    post(state, now, v, 'visitor', VISITS[cat].miss, 'bad');
    events.emit('visitMiss', { cat });
    return { ok: true, reason: '', visitor: v, cat, shop: null, spent: 0 };
  }
  const spent = Math.max(5, Math.round(townRatePerMin(state, now) * TUNING.activeBoost * TUNING.visitorSpendMinutes
    * (has(state, 'port', now) ? 1 + TUNING.portSpend : 1) * (1 + UPGRADES.pedestrian.per * upLevel(state, 'pedestrian'))));
  gain(state, spent, 'visitor', shop.id);
  const lines = VISITS[cat].good;
  const sisters = (state.legacy || {}).oldTowns || [];
  const from = sisters.length && rand(state) < 0.3 ? ` (visiting from ${sisters[randInt(state, sisters.length)].name})` : '';
  post(state, now, v, 'visitor', lines[randInt(state, lines.length)].replace('{shop}', buildingName(shop)) + from, 'good');
  events.emit('visit', { building: shop, amount: spent, visitor: v });
  // a great time in a happy town: they may ask to move in
  let movedIn = false;
  if (state.applicants.length < maxApplicants(state) && vacancies(state) > 0 && happiness(state, now) >= 70 && rand(state) < TUNING.visitorMoveInChance) {
    v.dream = shop.type;
    v.arrivedAt = now;
    state.applicants.push(v);
    post(state, now, v, 'visitor', POSTS.movein.replace('{shop}', buildingName(shop)), 'good');
    events.emit('arrival', { applicant: v, visitor: true });
    movedIn = true;
  }
  return { ok: true, reason: '', visitor: v, cat, shop, spent, movedIn };
}

/** The game hour (0-23) of the cosmetic day; one real hour is one game day. */
export function gameHour(now) {
  return Math.floor((((now % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS) / DAY_LENGTH_MS * 24);
}

/**
 * Residents go about their day and spend a little: lunch at a food shop, shopping or fun in
 * the evening. While you play, one of them buys something nearby every residentShopGapMs.
 */
function maybeResidentBuy(state, now) {
  if (now < state.nextShopAt) return;
  state.nextShopAt = now + TUNING.residentShopGapMs;
  residentBuy(state, now);
}
export function residentBuy(state, now) {
  const people = state.tenants.filter((t) => t.homeId != null);
  if (!people.length) return null;
  const t = people[randInt(state, people.length)];
  const home = buildingById(state, t.homeId);
  const hour = gameHour(now);
  const cats = hour >= 11 && hour < 13 ? ['food'] : hour >= 17 && hour < 22 ? ['creative', 'food', 'retail'] : ['retail', 'service', 'food'];
  const open = builtBiz(state, now).filter((b) => cats.includes(catOf(b)) && workersOf(state, b.id).length && (b.stock > 0 || b.dreamStars) && b.id !== t.jobId);
  if (!home || !open.length) return null;
  const shop = open.sort((a, b) => (Math.abs(a.x - home.x) + Math.abs(a.y - home.y)) - (Math.abs(b.x - home.x) + Math.abs(b.y - home.y)) || a.id - b.id)[0];
  const amount = Math.max(1, Math.round(townRatePerMin(state, now) * TUNING.activeBoost * TUNING.residentSpendMinutes));
  gain(state, amount, 'resident', shop.id);
  events.emit('residentBuy', { tenant: t, building: shop, amount });
  return { tenant: t, building: shop, amount };
}

/** Now and then a resident posts what they wish the town had (the most useful hint first). */
function maybePost(state, now) {
  if (now < state.nextPostAt) return;
  state.nextPostAt = now + TUNING.postGapMs;
  if (!state.tenants.length) return;
  const mood = townMood(state, now);
  const unhappy = state.tenants.filter((t) => residentMood(state, t, now, mood).missing.length);
  const t = (unhappy.length ? unhappy : state.tenants)[randInt(state, (unhappy.length ? unhappy : state.tenants).length)];
  post(state, now, t, 'resident', tenantWish(state, t, now, mood), unhappy.length ? 'hint' : 'good');
}

// ---- VIPs ---------------------------------------------------------------------------
// Like Tiny Tower: now and then (only while you play) a VIP waits on the entry road. You tap
// them, then tap the building to send them to. They never cost anything and leave quietly.

/** A shop's sales boost from a VIP: a critic's rave review, a celebrity's buzz. */
function vipBoost(state, b) {
  const t = state.lastTick;
  return (b.criticUntil > t ? 1 + TUNING.criticBoost : 1) * (b.buzzUntil > t ? 2 : 1);
}
/** Extra pay per sale while you play: the night market (food and fun) and a festival (everything). */
function playExtras(state, b, t) {
  const night = nightMarket(state, t) && ['food', 'creative'].includes(catOf(b)) ? 1 + TUNING.nightMarketBoost : 1;
  return night * (state.festivalUntil > t ? 1 + TUNING.festivalBoost : 1);
}

// ---- festivals and the night market ----------------------------------------------
/** Is the night market on? Game hours nightMarketFrom..nightMarketTo. */
export function nightMarket(state, now) {
  const h = gameHour(now);
  return h >= TUNING.nightMarketFrom && h < TUNING.nightMarketTo;
}
/** Where the festival bubble sits: the town square, or the entry road's town end. */
export function festivalSpot(state) {
  const home = PARCELS[0];
  for (let y = home.y0; y <= home.y1; y++) for (let x = home.x0; x <= home.x1; x++) if (isPlazaAt(state, x, y)) return { x, y };
  const e = entryRoute(state);
  return e ? e.tiles.at(-1) : null;
}
/** Can a festival start now? '' if yes, else why not. */
export function festivalIssue(state, now) {
  if (state.festivalUntil > now) return 'The festival is on!';
  if (population(state) < TUNING.festivalUnlockPop) return `Festivals start at ${TUNING.festivalUnlockPop} residents.`;
  if (now < state.festivalReadyAt) return 'The town is still tidying up after the last festival.';
  if (happiness(state, now) < TUNING.festivalHappy) return `Festivals need a ${TUNING.festivalHappy}% happy town.`;
  return '';
}
export function startFestival(state, now) {
  const issue = festivalIssue(state, now);
  if (issue) return fail(issue);
  state.festivalUntil = now + TUNING.festivalMs;
  state.festivalReadyAt = state.festivalUntil + TUNING.festivalCooldownMs;
  state.stats.festivals++;
  addXp(state, MAYOR_XP.festival);
  const t = state.tenants[randInt(state, state.tenants.length)];
  if (t) post(state, now, t, 'resident', 'Best. Festival. Ever. 🎉', 'good');
  events.emit('festival', { until: state.festivalUntil });
  checkGoals(state, now);
  return { ok: true, reason: '', until: state.festivalUntil };
}

/** Where the VIP waits: on the entry road, one step further out than the newcomers. */
export function vipSpot(state) {
  const e = entryRoute(state);
  return e ? e.tiles.at(e.tiles.length >= 3 ? -3 : 0) : null;
}

function maybeVip(state, now) {
  if (state.vip || now < state.nextVipAt) return;
  state.nextVipAt = now + Math.round((TUNING.vipGapMinMs + randInt(state, TUNING.vipGapMaxMs - TUNING.vipGapMinMs + 1)) / (1 + PERM_PERKS.vips.per * permPerk(state, 'vips')) / (has(state, 'airport', now) ? 1 + TUNING.airportVips : 1));
  if (population(state) < TUNING.vipUnlockPop) return;
  arriveVip(state, now);
}
export function arriveVip(state, now, kind = null) {
  const p = makeApplicant(state);
  kind = kind && VIPS[kind] ? kind : pick(state, Object.keys(VIPS));
  state.vip = { kind, name: p.name, look: p.look, arrivedAt: now, leaveAt: now + TUNING.vipWaitMs };
  events.emit('vipArrive', { vip: state.vip });
  return state.vip;
}
function vipLeaves(state, now) {
  const v = state.vip;
  state.vip = null;
  post(state, now, v, 'visitor', 'Had to head off. Maybe next time!', 'hint');
  events.emit('vipLeave', { vip: v });
}

/** Can the waiting VIP be sent to this building? '' if yes, else a friendly reason. */
export function vipTargetIssue(state, buildingId, now) {
  const v = state.vip;
  if (!v) return 'No VIP is waiting right now.';
  const b = buildingById(state, buildingId);
  if (!b) return VIPS[v.kind].ask + '.';
  switch (VIPS[v.kind].target) {
    case 'site': return isBuilt(b, now) ? 'That one is already built. Tap something still going up.' : '';
    case 'shop': return isBiz(b) && isBuilt(b, now) ? '' : `The ${VIPS[v.kind].name} only visits shops.`;
    case 'food': return isBiz(b) && isBuilt(b, now) && catOf(b) === 'food' ? '' : 'The Food Critic only reviews food shops.';
    case 'home': return isHome(b) && isBuilt(b, now) && residentsOf(state, b.id).length < defOf(b).capacity ? '' : 'Tap a home with a free room.';
    default: return '';
  }
}

/** Send the waiting VIP to a building. */
export function sendVip(state, buildingId, now) {
  const issue = vipTargetIssue(state, buildingId, now);
  if (issue) return fail(issue);
  const v = state.vip, b = buildingById(state, buildingId), name = buildingName(b);
  let text = '';
  if (v.kind === 'builder') { b.readyAt = now; text = `Finished the ${name} in record time! 🔨`; }
  else if (v.kind === 'spender') {
    const amount = Math.max(50, Math.round(townRatePerMin(state, now) * TUNING.activeBoost * TUNING.vipSpendMinutes));
    gain(state, amount, 'vip', b.id); text = `Bought half the ${name}. Worth it! 💸`;
  } else if (v.kind === 'critic') { b.criticUntil = now + TUNING.criticMs; text = `Five stars for the ${name}! ⭐⭐⭐⭐⭐`; }
  else if (v.kind === 'celebrity') { b.buzzUntil = now + TUNING.buzzMs; text = `Hanging out at the ${name} today 😎`; }
  else if (v.kind === 'inspector') {
    const n = state.problems.length;
    for (const p of state.problems) { const shop = buildingById(state, p.buildingId); if (shop) events.emit('problemFixed', { building: shop, problem: p, auto: true }); }
    state.problems = [];
    text = n ? `Sorted out ${n} ${n === 1 ? 'problem' : 'problems'}. All in order! ✅` : 'Everything is in order here. Nice town! ✅';
  } else if (v.kind === 'recruiter') {
    const star = makeApplicant(state);
    star.star = true;
    const best = CATEGORIES.reduce((a, c) => (star.skills[c] > star.skills[a] ? c : a), CATEGORIES[0]);
    star.skills[best] = Math.max(star.skills[best], 8);
    state.applicants.unshift(star);
    const r = moveIn(state, 0, b.id, now);
    text = r.ok ? `Found you a star: ${star.name} just moved into the ${name}! 🌟` : 'Could not find a room after all.';
  }
  state.vip = null;
  state.stats.vips++;
  addXp(state, MAYOR_XP.vip);
  if (!state.seen.vips.includes(v.kind)) state.seen.vips.push(v.kind);
  post(state, now, v, 'visitor', text, 'good');
  events.emit('vipUsed', { vip: v, building: b });
  checkGoals(state, now);
  return { ok: true, reason: '', text };
}

// ---- teams ---------------------------------------------------------------------
// A shop's team is how many of its jobs are filled and how skilled those workers are.
// The team meter compares it with the best team the shop could ever have (every job
// filled by a skill-9 worker). Bigger, better teams also serve more residents' needs.

function skillFactor(avg) {
  return 1 + avg / TUNING.skillAvgDivisor;
}

/** How close a shop's team is to the best it could have (0..1). Cheap: no hiring tips. */
export function teamPct(state, b) {
  const ws = workersOf(state, b.id);
  if (!ws.length) return 0;
  const avg = ws.reduce((n, t) => n + (t.skills[catOf(b)] || 0), 0) / ws.length;
  return Math.max(0, Math.min(1, (staffOf(ws.length) * skillFactor(avg)) / (staffOf(slotsOf(b)) * skillFactor(9))));
}

/** Residents a staffed shop keeps happy: needServes for two average workers, more for a bigger, better team. */
export function shopServes(state, b) {
  const ws = workersOf(state, b.id);
  if (!ws.length) return 0;
  const avg = ws.reduce((n, t) => n + (t.skills[catOf(b)] || 0), 0) / ws.length;
  return Math.max(1, Math.round(TUNING.needServes * (staffOf(ws.length) / staffOf(2)) * (0.8 + 0.4 * avg / 9) * favOf(b)));
}

/**
 * The team at a shop: { slots, workers: [{ tenant, skill, dream, adds }], pct, stars, serves, tip }.
 * `adds` is how much that worker adds to sales (0.26 = +26%); `tip` is the one thing that would help most.
 */
export function teamOf(state, b, now) {
  if (!isBiz(b)) return null;
  const slots = slotsOf(b), cat = catOf(b);
  const ws = workersOf(state, b.id);
  const skills = ws.map((t) => t.skills[cat] || 0);
  const avg = ws.length ? skills.reduce((a, c) => a + c, 0) / ws.length : 0;
  const now_ = ws.length ? staffOf(ws.length) * skillFactor(avg) : 0;
  const best = staffOf(slots) * skillFactor(9);
  const pct = Math.max(0, Math.min(1, now_ / best));
  const stars = TUNING.teamStars.filter((x) => pct >= x - 1e-9).length;
  const workers = ws.map((t, i) => {
    // what the shop would lose without this worker
    const rest = skills.filter((_, j) => j !== i);
    const without = rest.length ? staffOf(rest.length) * skillFactor(rest.reduce((a, c) => a + c, 0) / rest.length) : 0;
    return { tenant: t, skill: skills[i], dream: t.dream === b.type, adds: without > 0 ? now_ / without - 1 : null };
  });
  let tip = '';
  const hire = bestHire(state, b.id, now);
  if (ws.length > slots) tip = `This shop has ${slots} ${slots === 1 ? 'job' : 'jobs'} now. ${ws.length - slots === 1 ? 'The extra worker stays' : 'The extra workers stay'} until you move them.`;
  else if (ws.length < slots) tip = hire ? `Hire ${hire.name} (skill ${hire.skills[cat] || 0}) to fill an open job.` : 'An open job is waiting: more residents will fill it.';
  else {
    const weakest = workers.slice().sort((a, z) => a.skill - z.skill)[0];
    const elsewhere = weakest && !weakest.dream ? bestJobs(state, weakest.tenant.id, now).find((j) => j.open) : null;
    if (weakest && weakest.skill < 9) tip = elsewhere
      ? `${weakest.tenant.name} would do better at the ${buildingName(elsewhere.building)}; a more skilled worker could take this job.`
      : `More skilled workers would sell more. A School or Library teaches skills.`;
  }
  return { slots, workers, pct, stars, serves: shopServes(state, b), tip };
}

/** How well a person suits a job: 0 (no job) or 1 to 3 stars; a dream job is always 3. */
export function fitStars(tenant, b) {
  if (!tenant || !b) return 0;
  if (tenant.dream === b.type) return 3;
  const s = tenant.skills[catOf(b)] || 0;
  return s >= 7 ? 3 : s >= 4 ? 2 : 1;
}

/** The best person to hire into a shop's open job: someone without a job or who would do better here. */
export function bestHire(state, bizId, now) {
  const b = buildingById(state, bizId);
  if (!b || !isBiz(b) || !isBuilt(b, now) || workersOf(state, b.id).length >= slotsOf(b)) return null;
  const cat = catOf(b);
  let best = null, bestScore = -Infinity;
  for (const t of state.tenants) {
    if (t.jobId === b.id) continue;
    const cur = buildingById(state, t.jobId);
    const here = t.dream === b.type ? 10 : (t.skills[cat] || 0);
    const now_ = cur ? (t.dream === cur.type ? 10 : (t.skills[catOf(cur)] || 0)) : -1;
    if (here <= now_) continue;                              // only moves that help them
    const score = here + (cur ? 0 : 0.5);                    // ties go to someone without a job
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/**
 * Job moves that would put people where they do best, best first:
 * [{ tenant, from, to, skill, dream, gain }]. Each one is a plain suggestion; nothing moves by itself.
 */
export function jobSuggestions(state, now, max = 8) {
  const score = (t, b) => (!b ? -1 : t.dream === b.type ? 10 : (t.skills[catOf(b)] || 0));
  const free = new Map();
  for (const b of builtBiz(state, now)) free.set(b.id, slotsOf(b) - workersOf(state, b.id).length);
  const where = new Map(state.tenants.map((t) => [t.id, t.jobId]));
  const out = [];
  for (let round = 0; round < max; round++) {
    let pick_ = null;
    for (const t of state.tenants) {
      if (out.some((m) => m.tenant.id === t.id)) continue;
      const cur = buildingById(state, where.get(t.id));
      const have = score(t, cur);
      if (have >= 10) continue;
      for (const b of builtBiz(state, now)) {
        if (b.id === where.get(t.id) || (free.get(b.id) || 0) <= 0) continue;
        const gain = score(t, b) - have;
        if (gain <= 0) continue;
        if (!pick_ || gain > pick_.gain || (gain === pick_.gain && t.id < pick_.tenant.id)) {
          pick_ = { tenant: t, from: cur || null, to: b, skill: t.skills[catOf(b)] || 0, dream: t.dream === b.type, gain };
        }
      }
    }
    if (!pick_) break;
    out.push(pick_);
    free.set(pick_.to.id, free.get(pick_.to.id) - 1);
    if (pick_.from) free.set(pick_.from.id, (free.get(pick_.from.id) || 0) + 1);
    where.set(pick_.tenant.id, pick_.to.id);
  }
  return out;
}

// ---- town jobs ------------------------------------------------------------

/** What a job pays: so many minutes of the town's shop income, with a small floor for tiny towns. */
export function jobPay(state, kind, now) {
  const growth = Math.min(TUNING.jobMaxGrowth, Math.floor(population(state) * TUNING.jobPayPerResident));
  return Math.round(Math.max(TOWN_JOBS[kind].pay + growth, townRatePerMin(state, now) * TOWN_JOBS[kind].minutes));
}

/** Milliseconds until this job can be taken again (0 = ready). */
export function jobReadyIn(state, kind, now) {
  return Math.max(0, ((state.jobCooldowns || {})[kind] || 0) - now);
}
const restJob = (state, kind, now) => { state.jobCooldowns[kind] = now + TOWN_JOBS[kind].cooldownMs; };
const waitText = (ms) => `Ready again in ${Math.ceil(ms / 1000)}s.`;

/** The jobs board, one row per job: { kind, name, icon, hint, pay, readyIn, ok, why }. */
/**
 * Jobs pop up on the map, like Tiny Tower: each ready job sits as a bubble on a building that
 * fits it (Lunch Rush on a shop, Odd Jobs on a home...). At most TUNING.jobSpots at once, and
 * none while you are busy. [{ kind, buildingId }]. Pure: the same town and hour give the same spots.
 */
export function jobSpots(state, now) {
  if (state.job || (state.ride && state.ride.state !== 'waiting')) return [];
  const o = townJobOptions(state, now);
  const homes = occupiedHomes(state, now);
  const food = o.shops.filter((b) => catOf(b) === 'food' && workersOf(state, b.id).length);
  const places = {
    taxi: homes, delivery: o.shops, rush: food.length ? food : o.shops,
    odd: homes, lost: o.shops, courier: o.shops.filter((b) => b.type === 'post').length ? o.shops.filter((b) => b.type === 'post') : o.shops,
  };
  const hour = Math.floor(now / 3600000);
  const taken = new Set(state.ride ? [state.ride.fromId] : []);
  const out = [];
  // the jobs only found here come first; taxi rides and parcels also turn up on their own
  const order = ['rush', 'odd', 'lost', 'courier', 'delivery', 'taxi'];
  for (const j of jobBoard(state, now).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    if (out.length >= TUNING.jobSpots) break;
    if (!j.ok) continue;
    const list = (places[j.kind] || []).filter((b) => !taken.has(b.id)).sort((a, b) => a.id - b.id);
    if (!list.length) continue;
    const b = list[(hour * 7 + j.kind.length * 13) % list.length];
    taken.add(b.id);
    out.push({ kind: j.kind, buildingId: b.id, icon: j.icon, name: j.name, pay: j.pay });
  }
  return out;
}

export function jobBoard(state, now) {
  const o = townJobOptions(state, now);
  const busy = !!state.job || (state.ride && state.ride.state !== 'waiting');
  return Object.keys(TOWN_JOBS).map((kind) => {
    const d = TOWN_JOBS[kind];
    let why = '';
    if (kind === 'taxi') { if (!o.taxi) why = 'Needs a resident and two buildings'; }
    else if (kind === 'delivery') { if (!o.delivery) why = 'Needs an open shop and a resident'; }
    else if (!o.shops.length) why = 'Needs an open shop';
    else if (kind === 'courier' && !o.courier) why = 'Needs two homes with residents';
    else if (kind === 'odd' && !state.tenants.length) why = 'Needs a resident';
    const readyIn = jobReadyIn(state, kind, now);
    const pay = kind === 'taxi' ? Math.round(Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.rideFareMinutes))
      : kind === 'delivery' ? Math.round(Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.deliveryFareMinutes))
      : jobPay(state, kind, now) * (kind === 'courier' ? TUNING.courierStops : 1);
    return { kind, name: d.name, icon: d.icon, hint: d.hint, pay, readyIn, ok: !why && !busy && readyIn === 0, why: why || (busy ? 'Finish your current job first' : '') };
  });
}

function occupiedHomes(state, now) {
  const ids = new Set(state.tenants.map((t) => t.homeId));
  return state.buildings.filter((b) => ids.has(b.id) && isHome(b) && isBuilt(b, now));
}

export function townJobOptions(state, now) {
  const shops = builtBiz(state, now);
  const homes = occupiedHomes(state, now);
  return {
    shops,
    taxi: homes.length > 0 && state.buildings.filter((b) => isBuilt(b, now)).length >= TUNING.rideMinBuildings,
    delivery: shops.length > 0 && homes.length > 0,
    courier: shops.length > 0 && homes.length >= 2,
  };
}

function nearbyDogSpots(state, shops) {
  const directions = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
  const spots = [];
  for (const shop of shops) for (const [dx, dy, direction] of directions) {
    for (const distance of [1, 2]) {
      const x = shop.x + dx * distance, y = shop.y + dy * distance;
      if (ownsTile(state, x, y) && (isLot(state, x, y) || isRoadAt(state, x, y)) && !tileAt(state, x, y)) {
        spots.push({ x, y, direction, shopId: shop.id });
      }
    }
  }
  return spots;
}

function takeRandom(state, items, count) {
  const pool = items.slice();
  const chosen = [];
  while (pool.length && chosen.length < count) chosen.push(pool.splice(randInt(state, pool.length), 1)[0]);
  return chosen;
}

const tileDistance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function shortestRoute(start, stops) {
  if (!stops.length) return 0;
  return Math.min(...stops.map((stop) => tileDistance(start, stop) + shortestRoute(stop, stops.filter((b) => b !== stop))));
}

export function startTownJob(state, kind, shopId, now) {
  if (state.job || (state.ride && state.ride.state !== 'waiting')) return fail('Finish or skip your current job first.');
  if (!TOWN_JOBS[kind] || kind === 'taxi' || kind === 'delivery') return fail('That job is unavailable.');
  if (jobReadyIn(state, kind, now) > 0) return fail(waitText(jobReadyIn(state, kind, now)));
  const { shops, courier } = townJobOptions(state, now);
  if (!shops.length) return fail('Open a shop to start town jobs.');
  let job;
  if (kind === 'rush') {
    const shop = shops.find((b) => b.id === shopId);
    if (!shop) return fail('Choose an open shop.');
    const menu = RUSH_MENUS[shop.type] ? shop.type : catOf(shop);
    const orders = Array.from({ length: TUNING.rushOrders }, () => randInt(state, RUSH_MENUS[menu].length));
    job = { kind, shopId, menu, orders, index: 0 };
  } else if (kind === 'lost') {
    const spots = nearbyDogSpots(state, shops);
    if (!spots.length) return fail('Pip is staying home for now.');
    job = { kind, ...pick(state, spots) };
  } else if (kind === 'odd') {
    if (!state.tenants.length) return fail('Move in a resident first.');
    job = { kind, category: pick(state, CATEGORIES), candidates: takeRandom(state, state.tenants, 3).map((t) => t.id) };
  } else if (kind === 'courier') {
    if (!courier) return fail('Fill at least two homes to plan a route.');
    const shop = pick(state, shops);
    const stops = takeRandom(state, occupiedHomes(state, now), TUNING.courierStops);
    job = { kind, shopId: shop.id, stops: stops.map((b) => b.id), x: shop.x, y: shop.y,
      distance: 0, best: shortestRoute(shop, stops) };
  } else return fail('That job is unavailable.');
  job.pay = jobPay(state, kind, now);
  clearRide(state, now);
  state.job = job;
  restJob(state, kind, now);
  return { ok: true, job };
}

export function skipTownJob(state) {
  if (state.job) delete state.jobCooldowns[state.job.kind];   // nothing earned, so it can be taken again straight away
  state.job = null;
  return { ok: true };
}

function finishTownJob(state, pay) {
  state.job = null;
  gain(state, pay, 'job');
  return { ok: true, done: true, pay };
}

export function serveOrder(state, index, choice) {
  const job = state.job;
  if (job?.kind !== 'rush' || index !== job.index) return fail('That order is already gone.');
  if (job.orders[index] !== choice) return fail('Try the matching picture.');
  job.index++;
  return job.index === job.orders.length ? finishTownJob(state, job.pay) : { ok: true };
}

export function findDog(state, x, y) {
  const job = state.job;
  if (job?.kind !== 'lost' || job.x !== x || job.y !== y) return fail('Pip is somewhere nearby.');
  return finishTownJob(state, job.pay);
}

export function sendHelper(state, id) {
  const job = state.job;
  const tenant = tenantById(state, id);
  if (job?.kind !== 'odd' || !tenant || !job.candidates.includes(id)) return fail('Choose one of the helpers.');
  return finishTownJob(state, Math.round(job.pay * (1 + TUNING.oddSkillBonus * (tenant.skills[job.category] || 0))));
}

export function deliverStop(state, id) {
  const job = state.job;
  const home = buildingById(state, id);
  if (job?.kind !== 'courier' || !home || !job.stops.includes(id)) return fail('Tap one of the marked homes.');
  job.distance += tileDistance(job, home);
  job.x = home.x;
  job.y = home.y;
  job.stops = job.stops.filter((stop) => stop !== id);
  if (job.stops.length) {
    gain(state, job.pay, 'job');
    return { ok: true, pay: job.pay };
  }
  const bonus = job.distance === job.best ? job.pay : 0;   // the shortest route earns one more stop's pay
  return { ...finishTownJob(state, job.pay + bonus), bonus };
}

// ---- rides ----------------------------------------------------------------

function rideGap(state) {
  return TUNING.rideGapMinMs + randInt(state, TUNING.rideGapMaxMs - TUNING.rideGapMinMs + 1);
}

function makeRide(state, now, kind = null, fromId = null) {
  const built = state.buildings.filter((b) => isBuilt(b, now));
  if (built.length < TUNING.rideMinBuildings) return;
  // a job bubble's building is where the ride starts: a rider from that home, or a parcel from that shop
  const atHome = kind === 'taxi' && fromId != null ? state.tenants.filter((t) => t.homeId === fromId) : [];
  const riders = atHome.length ? atHome : state.tenants.filter((t) => built.some((b) => b.id === t.homeId));
  if (!riders.length) return;
  const tenant = pick(state, riders);
  const others = built.filter((b) => b.id !== tenant.homeId);
  if (!others.length) return;
  const to = pick(state, others);
  const fromShop = kind === 'delivery' && fromId != null ? others.find((b) => b.id === fromId && isBiz(b)) : null;
  const shops = fromShop ? [fromShop] : others.filter(isBiz);
  const delivery = kind ? kind === 'delivery' : state.stats.rides > 0 &&
    state.tenants.length >= TUNING.deliveryUnlockPop && shops.length > 0 && rand(state) < TUNING.deliveryChance;
  if (delivery && !shops.length) return;
  return {
    tenantId: tenant.id,
    ...(delivery ? { kind: 'delivery', fromId: pick(state, shops).id, toId: tenant.homeId }
      : { fromId: tenant.homeId, toId: to.id }),
    state: 'waiting',
    requestedAt: now,
    acceptedAt: null,
    fare: 0,
    tries: 0,
    ...(kind ? { board: true } : {}),
  };
}

function maybeRequestRide(state, now) {
  if (state.job || state.ride || now < state.nextRideAt || state.tenants.length < 1) return;
  const ride = makeRide(state, now);
  if (!ride) return;
  state.ride = ride;
  events.emit('rideRequest', { ride: state.ride });
}

export function startBoardRide(state, kind, ...rest) {
  const now = rest[rest.length - 1], fromId = rest.length > 1 ? rest[0] : null;   // (state, kind, now) or (state, kind, fromId, now)
  if (state.job || (state.ride && state.ride.state !== 'waiting')) return fail('Finish or skip your current job first.');
  if (kind !== 'taxi' && kind !== 'delivery') return fail('Choose a ride or delivery.');
  if (!townJobOptions(state, now)[kind]) return fail('This job needs an open shop and a resident.');
  if (jobReadyIn(state, kind, now) > 0) return fail(waitText(jobReadyIn(state, kind, now)));
  const ride = makeRide(state, now, kind, fromId);
  if (!ride) return fail('No route is available yet.');
  state.ride = ride;
  restJob(state, kind, now);
  return pickupRide(state, now);
}

/**
 * Pick up a rider and set off. The game already knows where they're going (a red pin
 * marks it), so a ride goes straight to driving; Camden didn't want to choose. Deliveries
 * work the same way (the parcel's home gets the pin). A quick taxi pickup earns the best tip.
 */
export function pickupRide(state, now) {
  const r = acceptRide(state, now);       // also fine for a rider already picked up (older saves)
  if (!r.ok) return r;
  const ride = state.ride;
  if (ride.state === 'driving') return { ...r, fare: ride.fare, driving: true };
  if (ride.kind === 'delivery') {          // a parcel: the fare is set on pickup; the pin marks the home
    ride.state = 'driving';
    events.emit('rideStart', { ride, fare: ride.fare });
    return { ...r, fare: ride.fare, driving: true };
  }
  const { pickupTipFastMs: fast, pickupTipSlowMs: slow, rideTipMax: max } = TUNING;
  const t = Math.max(0, now - ride.requestedAt);
  const tip = t <= fast ? max : t >= slow ? 1 : max - ((max - 1) * (t - fast)) / (slow - fast);
  const base = Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.rideFareMinutes);
  ride.fare = Math.round(base * distancePay(state, ride) * tip * farePay(state));
  ride.state = 'driving';
  events.emit('rideStart', { ride, fare: ride.fare });
  return { ...r, fare: ride.fare, driving: true };
}

export function acceptRide(state, now) {
  const ride = state.ride;
  if (!ride || state.job) return fail('No ride is available right now.');
  const tenant = tenantById(state, ride.tenantId);
  const destination = buildingById(state, ride.toId);
  if (!tenant || !destination) {
    clearRide(state, now);
    return fail('They changed their mind. Another ride will come along soon!');
  }
  if (ride.state === 'waiting') {
    ride.state = 'choosing';
    ride.acceptedAt = now;
    if (ride.kind === 'delivery') {
      ride.fare = Math.round(Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.deliveryFareMinutes));
      ride.fare = Math.round(ride.fare * distancePay(state, ride) * farePay(state));
    }
  }
  return { ok: true, reason: '', tenant, destination };
}

/** Lots driven, door to door. */
export function rideDistance(state, ride) {
  const a = ride.from || buildingById(state, ride.fromId), b = buildingById(state, ride.toId);
  return a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 0;
}

/** Longer trips pay more: +rideDistanceBonus per lot. */
function distancePay(state, ride) {
  return 1 + TUNING.rideDistanceBonus * rideDistance(state, ride);
}

// ---- the car ----
export function carOf(state) {
  return CARS[Math.max(1, Math.min(CARS.length, state.car || 1)) - 1];
}
export function nextCar(state) {
  return CARS[state.car || 1] || null;
}
export function upgradeCar(state, now) {
  const next = nextCar(state);
  if (!next) return fail('You already drive the best car in town!');
  if (state.coins < next.cost) return fail(`You need ${next.cost - Math.floor(state.coins)} more coins for the ${next.name}.`);
  state.coins -= next.cost;
  state.car = (state.car || 1) + 1;
  events.emit('spend', { amount: next.cost, reason: 'car' });
  return { ok: true, reason: '', car: next };
}

/** How much of the trip the gas was held (0..1). Sets the bonus paid when the ride ends. */
export function rideGas(state, share, now) {
  const ride = state.ride;
  if (!ride || ride.state !== 'driving') return fail('There is no ride on the road right now.');
  ride.gas = Math.max(0, Math.min(1, Number(share) || 0));
  return { ok: true, reason: '' };
}

// ---- welcome drive: take a new resident home from the edge of town for a bonus ----
function edgeRoad(state, home) {
  const e = entryRoute(state);
  if (e) return e.tiles.at(-1);            // new residents arrive on the entry road
  const p = PARCELS[0];
  let best = null, bestD = -1;
  for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) {
    if (x !== p.x0 && x !== p.x1 && y !== p.y0 && y !== p.y1) continue;
    if (!isRoadAt(state, x, y)) continue;
    const d = Math.abs(x - home.x) + Math.abs(y - home.y);
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}
export function welcomeFare(state, tenantId, now) {
  const t = tenantById(state, tenantId); const home = t && buildingById(state, t.homeId);
  const from = home && edgeRoad(state, home);
  if (!t || !t.welcome || !from) return 0;
  const base = Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.welcomeFareMinutes);
  return Math.round(base * distancePay(state, { from, toId: home.id }) * farePay(state));
}
export function startWelcome(state, tenantId, now) {
  if (state.job || state.ride) return fail('Finish or skip your current job first.');
  const tenant = tenantById(state, tenantId);
  const home = tenant && buildingById(state, tenant.homeId);
  if (!tenant || !home || !tenant.welcome) return fail('They are already settled in.');
  const from = edgeRoad(state, home);
  if (!from) return fail('There is no road to drive in on.');
  const fare = welcomeFare(state, tenantId, now);
  delete tenant.welcome;
  state.ride = { kind: 'welcome', tenantId, fromId: null, from, toId: home.id, state: 'driving', requestedAt: now, acceptedAt: now, fare, tries: 0 };
  events.emit('rideStart', { ride: state.ride, fare });
  return { ok: true, reason: '', ride: state.ride };
}

function tipFor(ride, now) {
  const t = Math.max(0, now - ride.acceptedAt);
  const { rideTipMax: max, rideTipFastMs: fast, rideTipSlowMs: slow } = TUNING;
  let tip = t <= fast ? max : t >= slow ? 1 : max - ((max - 1) * (t - fast)) / (slow - fast);
  tip -= TUNING.rideWrongTryPenalty * ride.tries;
  return Math.max(1, tip);
}

export function chooseDestination(state, buildingId, now) {
  const ride = state.ride;
  if (!ride || ride.state !== 'choosing') return fail('No one is waiting for a ride right now.', { correct: false, fare: 0 });
  if (buildingId !== ride.toId) {
    // The rider asks for a kind of place ("the Tent"), so any building of that kind is right.
    const want = buildingById(state, ride.toId), got = buildingById(state, buildingId);
    const same = ride.kind !== 'delivery' && want && got && got.id !== ride.fromId && isBuilt(got, now) &&
      got.type === want.type && (got.cat || '') === (want.cat || '');
    if (!same) {
      if (ride.kind !== 'delivery') ride.tries++;
      return { ok: true, reason: '', correct: false, fare: 0 };
    }
    ride.toId = got.id;
  }
  if (ride.kind !== 'delivery') {
    const base = Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.rideFareMinutes);
    ride.fare = Math.round(base * distancePay(state, ride) * tipFor(ride, now) * farePay(state));
  }
  ride.state = 'driving';
  events.emit('rideStart', { ride, fare: ride.fare });
  return { ok: true, reason: '', correct: true, fare: ride.fare };
}

export function skipDelivery(state, now) {
  if (state.ride?.kind !== 'delivery' || state.ride.state !== 'choosing') return fail('There is no package to put back.');
  clearRide(state, now);
  return { ok: true };
}

export function skipBoardRide(state, now) {
  if (!state.ride?.board || state.ride.state !== 'choosing') return fail('There is no job to skip.');
  delete state.jobCooldowns[state.ride.kind === 'delivery' ? 'delivery' : 'taxi'];
  clearRide(state, now);
  return { ok: true };
}

export function completeRide(state, now) {
  const ride = state.ride;
  if (!ride || ride.state !== 'driving') return fail('There is no ride on the road right now.', { fare: 0 });
  const fare = Math.round(ride.fare * (1 + TUNING.gasBonus * (ride.gas || 0)));   // holding the gas pays extra
  state.ride = null;
  state.nextRideAt = now + rideGap(state);
  if (ride.kind !== 'delivery') state.stats.rides++;
  gain(state, fare, ride.kind === 'delivery' ? 'delivery' : 'ride', ride.toId);
  events.emit('rideDone', { fare });
  checkGoals(state, now);
  return { ok: true, reason: '', fare };
}

// ---- advance --------------------------------------------------------------

const HOUR_MS = 3600000;
const hourNumber = (t) => Math.floor(t / HOUR_MS);

function dayNumber(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function advance(state, now, { live = true, active = false } = {}) {
  // `active` = the player has the game open right now: every sale pays TUNING.activeBoost times as much.
  const boost = active ? TUNING.activeBoost : 1;
  const res = { elapsedMs: 0, coinsEarned: 0, rentPaid: 0, rentBonus: 0, rentHours: 0, finished: [], ranOut: [], lessons: 0, recipes: [] };
  if (!Number.isFinite(now)) return res;

  let t = state.lastTick;
  let capped = false;
  if (now - t > TUNING.maxOfflineMs) {
    t = now - TUNING.maxOfflineMs;
    capped = true;
  }

  // Rent is paid at the top of every hour: a 24th of the day's rent, with fractions carried over.
  const payRent = (at) => {
    const hours = hourNumber(at) - state.lastRentHour;
    if (hours <= 0) return;
    state.lastRentHour = hourNumber(at);
    res.rentHours += hours;
    const bonusDay = rentBonusPerDay(state, at);       // a happy town pays extra
    const exact = ((rentPerDay(state, at) + bonusDay) * hours) / 24 + (state.rentCarry || 0);
    const amount = Math.floor(exact + 1e-6);
    state.rentCarry = Math.max(0, exact - amount);
    res.rentBonus += (bonusDay * hours) / 24;
    if (amount > 0) {
      res.rentPaid += amount;
      state.coins += amount;
      state.stats.earned += amount;
      state.stats.rentCollected += amount;
    }
  };

  if (now > t) {
    res.elapsedMs = now - t;
    // Hours beyond the 14-day cap are skipped, not paid.
    if (capped && state.lastRentHour < hourNumber(t)) state.lastRentHour = hourNumber(t);
    else payRent(t);
    if (state.nextApplicantAt < t) state.nextApplicantAt = t;

    // Staffing stays fixed during catch-up. Recipes and lessons can change sales rates.
    const shops = [];
    for (const b of state.buildings) {
      if (!isBiz(b)) continue;
      const staff = Math.min(workersOf(state, b.id).length, TUNING.staffFactor.length - 1);
      const crop = defOf(b).crop;
      const growth = TUNING.cropPerHour * (staffOf(staff) / staffOf(1)) * levelMult(b.level) / 3600000;   // one farmer grows cropPerHour
      shops.push({ b, crop, growth, rate: potentialRate(state, b), pay: (PRICE_MODES[b.price] || PRICE_MODES.normal).pay, sold: 0, restocked: false });
    }
    const farms = shops.filter((shop) => shop.crop && shop.growth > 0);
    const teachers = state.buildings.filter((b) => defOf(b).lessons > 0);
    const sources = state.buildings.filter((b) => defOf(b).makes && MATERIALS[defOf(b).makes]);
    const knownRecipes = state.recipes.length;
    let lessonsBefore = 0;
    const countLesson = events.on('lesson', () => { lessonsBefore++; });
    const pending = state.buildings.filter((b) => b.readyAt > t).sort((a, b) => b.readyAt - a.readyAt);
    let nextHour = (hourNumber(t) + 1) * HOUR_MS;
    if (hasTrade(state, t)) ensureOrders(state);

    while (t < now) {
      const growth = {};
      for (const farm of farms) {
        if (isBuilt(farm.b, t)) growth[farm.crop] = (growth[farm.crop] || 0) + farm.growth;
      }
      let perHour = 0;
      for (const b of teachers) if (isBuilt(b, t)) perHour += defOf(b).lessons * levelMult(b.level);

      // End at changes that affect rates or rent so a long catch-up applies them
      // at the same time as small live ticks.
      const end = Math.min(now, t + TUNING.stepMs, nextHour,
        pending.at(-1)?.readyAt ?? Infinity,
        state.applicants.length < maxApplicants(state) ? Math.max(t + 1, state.nextApplicantAt) : Infinity,
        perHour > 0 ? Math.max(t + 1, state.nextLessonAt) : Infinity,
        state.adUntil > t ? state.adUntil : Infinity, t + msUntilRecipe(state, growth),
        ...state.problems.map((p) => (p.fixAt != null && p.fixAt > t ? p.fixAt : Infinity)));

      // 1. construction that finishes in this step opens
      while (pending.length && pending.at(-1).readyAt <= end) {
        const b = pending.pop();
        res.finished.push(b.id);
        events.emit('opened', { building: b });
        if (defOf(b).kind === 'trade') ensureOrders(state);
      }

      // 2. sales
      for (const shop of shops) {
        const b = shop.b;
        if (shop.rate <= 0 || !isBuilt(b, t) || (b.stock <= 0 && !b.dreamStars)) continue;
        const amount = (shop.rate / shop.pay * (end - t)) / 60000 + (b.carry || 0);   // items, not coins
        let sold = Math.floor(amount + 1e-9);
        b.carry = Math.max(0, amount - sold);
        if (sold >= b.stock && b.dreamStars) {
          const max = stockMaxOf(b);
          const refills = 1 + Math.floor((sold - b.stock) / max);
          b.stock += refills * max;
          state.stats.restocks += refills;
          shop.restocked = true;
        } else if (sold >= b.stock) {
          sold = b.stock;
          b.carry = 0;
        }
        if (sold <= 0) continue;
        b.stock -= sold;
        // coins for those items: the shop's price, plus the ad bonus while a campaign runs
        const exact = sold * shop.pay * boost * (active ? playExtras(state, b, t) : 1 + PERM_PERKS.away.per * permPerk(state, 'away')) * (t < (state.adUntil || 0) ? 1 + TUNING.adSalesBonus : 1) + (b.cc || 0);
        const got = Math.floor(exact + 1e-9);
        b.cc = exact - got;
        shop.sold += got;
        state.coins += got;
        state.stats.earned += got;
        res.coinsEarned += got;
        if (b.stock === 0) {
          res.ranOut.push(b.id);
          events.emit('outOfStock', { building: b });
        }
      }

      // 2b. staffed farms grow crops, which never run out or spoil
      for (const [crop, rate] of Object.entries(growth)) {
        const grown = rate * (end - t);
        state.crops[crop] = (state.crops[crop] || 0) + grown;
        state.goods[crop] = (state.goods[crop] || 0) + grown;
      }
      // 2b'. lumber yards, quarries and brickworks make materials (up to a cap)
      for (const b of sources) {
        if (!isBuilt(b, t)) continue;
        const k = defOf(b).makes;
        state.mats[k] = Math.min(TUNING.matCap, (state.mats[k] || 0) + TUNING.matPerHour * levelMult(b.level) * (end - t) / 3600000);
      }
      const recipesBefore = state.recipes.length;
      discoverRecipes(state);

      // 2c. school and library: someone learns a skill point every so often
      const lessonCount = lessonsBefore;
      if (perHour <= 0) state.nextLessonAt = end + 1800000;
      else {
        for (let guard = 0; guard < 50 && end >= state.nextLessonAt; guard++) {
          teach(state);
          state.nextLessonAt += 3600000 / perHour;
        }
      }
      const fixed = state.problems.length > 0 && resolveProblems(state, end);
      if (fixed || state.recipes.length !== recipesBefore || lessonsBefore !== lessonCount) {
        for (const shop of shops) shop.rate = potentialRate(state, shop.b);
      }

      // 3. newcomers drive in on the entry road and wait at the Welcome sign. They never
      //    leave on their own: an open spot fills arriveMs after it opened.
      while (end >= state.nextApplicantAt && state.applicants.length < maxApplicants(state)) {
        const a = makeApplicant(state);
        a.arrivedAt = state.nextApplicantAt;
        state.applicants.push(a);
        state.nextApplicantAt += arrivalGap(state, state.nextApplicantAt);
        events.emit('arrival', { applicant: a });
      }
      if (state.applicants.length >= maxApplicants(state) && state.nextApplicantAt < end) state.nextApplicantAt = end;

      // 4. rent and contract pickups at the top of every hour
      if (end >= nextHour) {
        payRent(end);
        runContracts(state, end);
        runMarket(state, end);
        nextHour = (hourNumber(end) + 1) * HOUR_MS;
      }

      // 5. goals
      checkGoals(state, end);
      t = end;
    }

    events.off('lesson', countLesson);
    res.lessons = lessonsBefore;
    res.recipes = state.recipes.slice(knownRecipes);
    for (const shop of shops) {
      if (shop.sold > 0) events.emit('coins', { amount: shop.sold, buildingId: shop.b.id, reason: 'sales' });
      if (shop.restocked) events.emit('restocked', { building: shop.b, auto: true });
    }
    if (res.rentPaid > 0) {
      events.emit('coins', { amount: res.rentPaid, buildingId: null, reason: 'rent' });
      res.rentBonus = Math.round(res.rentBonus);
      events.emit('rent', { amount: res.rentPaid, hours: res.rentHours, bonus: res.rentBonus });
    }
  }

  if (hasTrade(state, now)) ensureOrders(state);   // neighbours start ordering once there is a Trading Post
  sendCare(state, now);                            // sister towns' daily care packages
  finishTrucks(state, now);                        // even after a long time away, every truck arrives
  state.lastTick = now;

  // rides
  const ride = state.ride;
  if (ride) {
    if (ride.state === 'waiting' && now - ride.requestedAt >= TUNING.rideExpireMs) {
      clearRide(state, now);
    } else if (!live) {
      // Coming back from being away: a half-finished ride is tidied up. A fare that
      // was already earned is always paid.
      if (ride.state === 'driving') completeRide(state, now);
      else if ((!ride.board && ride.kind !== 'delivery') || ride.state !== 'choosing') clearRide(state, now);
    }
  }
  if (live) maybeRequestRide(state, now);
  if (live) maybeProblem(state, now);
  if (live) { maybeVisitor(state, now); maybePost(state, now); maybeResidentBuy(state, now); maybeVip(state, now); }
  if (state.vip && now >= state.vip.leaveAt) vipLeaves(state, now);
  else {                                   // visitors and posts only happen while you play
    if (state.nextVisitAt < now) state.nextVisitAt = now + TUNING.visitorGapMinMs;
    if (state.nextPostAt < now) state.nextPostAt = now + TUNING.postGapMs;
    if (state.nextShopAt < now) state.nextShopAt = now + TUNING.residentShopGapMs;
    if (state.nextVipAt < now) state.nextVipAt = now + TUNING.vipGapMinMs;
  }
  checkGoals(state, now);
  return res;
}
