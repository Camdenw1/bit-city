// Bit City — simulation. Pure: no DOM, no Date.now(), no Math.random().
// Time always comes in as `now` (ms epoch). Mutating functions change `state` in place
// and return a result object; they never throw for a normal player action.

import { BUILDINGS, CATEGORIES, GOALS, NEEDS, RECIPES, HAPPY_LINES, PARCELS, TUNING, CROP_PRICE, NEIGHBOURS, PRICE_MODES, SHOP_CATS, GOV, QUALITY, PROBLEMS, TOWN_JOBS, RUSH_MENUS, shopStats, isRoad, parcelAt, levelMult } from './config.js';
import { makeWorld, terrainAt, isSeaAt, streetAt } from './terrain.js';
import { localDay, makeApplicant, rand, randInt, pick } from './state.js';

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

export function stockMaxOf(b) {
  return Math.round(statsOf(b).stockMax * levelMult(b.level));
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
};

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
  if (state.goalsDone.length >= GOALS.length) return;
  for (const goal of GOALS) {
    if (state.goalsDone.includes(goal.id)) continue;
    const test = GOAL_TESTS[goal.id];
    if (!test || !test(state, now)) continue;
    state.goalsDone.push(goal.id);
    events.emit('goal', { goal });
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

export function canBuild(state, type, x, y, cat = null) {
  const def = BUILDINGS[type];
  if (!def) return fail("Hmm, we don't know how to build that.");
  if (!Number.isInteger(x) || !Number.isInteger(y) || !parcelAt(x, y)) {
    return fail("That spot is outside of town.");
  }
  if (!ownsTile(state, x, y)) return fail("You don't own that land yet. Tap it to buy it!");
  if (isRoadAt(state, x, y)) return fail("That's a road. Pick a grassy lot!");
  if (isPlazaAt(state, x, y)) return fail("That's the town square. It stays open for everyone!");
  const ground = terrainOf(state, x, y);
  if (ground === 'water') return fail("That's water. Homes next to it pay extra rent, though!");
  if (ground === 'mountain') return fail("That's a mountain. Pick a flatter lot!");
  if (tileAt(state, x, y)) return fail('Something is already built here.');
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
  const building = { id: state.nextId++, type, x, y, readyAt: now + def.buildSecs * 1000, paid: cost, level: 1 };
  if (cat) {
    building.cat = cat;
    building.tier = shopsIn(state, cat);
    building.q = QUALITY[opts.q] ? opts.q : 0;
    building.stock = shopStats(cat, building.tier).stockMax; // every new shop opens fully stocked
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

export function demolish(state, buildingId, now) {
  const b = buildingById(state, buildingId);
  if (!b) return fail("That building isn't there any more.", { refund: 0 });
  const def = defOf(b);
  if (def.kind === 'home' && residentsOf(state, b.id).length > 0) {
    return fail('People live here! Homes can only be removed when they are empty.', { refund: 0 });
  }
  const refund = Math.floor((b.paid ?? def.cost) * TUNING.refundRate);
  for (const t of state.tenants) {
    if (t.jobId === b.id) {
      t.jobId = null;
      events.emit('job', { tenant: t, building: null, dream: false });
    }
  }
  if (state.ride && (state.ride.fromId === b.id || state.ride.toId === b.id)) {
    // Never lose a fare that was already earned.
    if (state.ride.state === 'driving') completeRide(state, now);
    else clearRide(state, now);
  }
  if (state.job?.shopId === b.id && state.job.kind !== 'courier') state.job = null;
  state.buildings.splice(state.buildings.indexOf(b), 1);
  state.problems = state.problems.filter((p) => p.buildingId !== b.id);
  if (refund > 0) {
    state.coins += refund;
    events.emit('coins', { amount: refund, buildingId: null, reason: 'refund' });
  }
  events.emit('demolished', { id: b.id, x: b.x, y: b.y });
  // Safety net: an empty town can always afford a fresh start.
  if (state.buildings.length === 0 && state.coins < TUNING.safetyNetCoins) {
    const gift = TUNING.safetyNetCoins - state.coins;
    state.coins += gift;
    events.emit('coins', { amount: gift, buildingId: null, reason: 'refund' });
  }
  checkGoals(state, now);
  return { ok: true, reason: '', refund };
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
  const staff = TUNING.staffFactor[Math.min(n, TUNING.staffFactor.length - 1)];
  const skill = 1 + skillSum / TUNING.skillDivisor;
  const dream = 1 + TUNING.dreamBonus * (b.dreamStars || 0);
  const menu = catOf(b) === 'food' ? 1 + TUNING.recipeBonus * state.recipes.length : 1;
  const price = PRICE_MODES[mode] || PRICE_MODES.normal;
  const trouble = problemOf(state, b.id) ? 1 - TUNING.problemSalesCut : 1;
  return statsOf(b).baseRate * staff * skill * dream * menu * qualityOf(b) * levelMult(b.level) * price.speed * price.pay * trouble * favOf(b);
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
  return Math.min(TUNING.parkBoostMax, boost);
}

export function rentPerDay(state, now = state.lastTick) {
  let sum = 0;
  for (const home of state.buildings) {
    if (!isHome(home)) continue;
    const n = residentsOf(state, home.id).length;
    if (n) sum += Math.round(n * defOf(home).rentPerTenant * levelMult(home.level) * (1 + homeBoost(state, home, now)));
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
export function runAd(state, now) {
  if (adActive(state, now)) return fail('Your ad is already running.');
  const cost = adCost(state, now);
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins for an ad.`);
  state.coins -= cost;
  state.adUntil = now + TUNING.adMs;
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
  const coins = Math.floor(qty * tradePrices(state, now)[crop].price);
  state.goods[crop] -= qty;
  state.trade.sold += qty;
  gain(state, coins, 'trade');
  checkGoals(state, now);
  return { ok: true, reason: '', coins, qty };
}

/** Import crops you can't grow yet. They count towards recipes and can fill orders. */
export function buyGoods(state, crop, qty, now) {
  if (!hasTrade(state, now)) return fail('Build a Trading Post first.', { cost: 0 });
  if (!(crop in CROP_PRICE) || !(qty > 0)) return fail("We can't import that.", { cost: 0 });
  const cost = Math.ceil(qty * CROP_PRICE[crop] * TUNING.importMarkup);
  if (state.coins < cost) return fail(`You need ${cost - Math.floor(state.coins)} more coins for that.`, { cost: 0 });
  state.coins -= cost;
  state.goods[crop] = (state.goods[crop] || 0) + qty;
  state.crops[crop] = (state.crops[crop] || 0) + qty;
  events.emit('spend', { amount: cost, reason: 'import' });
  discoverRecipes(state);
  checkGoals(state, now);
  return { ok: true, reason: '', cost };
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
  state.goods[o.crop] -= o.qty;
  state.orders.splice(i, 1);
  state.trade.filled++;
  gain(state, o.coins, 'order');
  gainGems(state, o.gems);
  events.emit('order', { order: o });
  ensureOrders(state);
  checkGoals(state, now);
  return { ok: true, reason: '', coins: o.coins, gems: o.gems };
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
  const t = pick(state, learners);
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
  const have = {}; const served = new Map(); const staffed = {};
  const give = (t, id) => { met.get(t.id).add(id); have[id] = (have[id] || 0) + 1; };
  for (const b of state.buildings) {
    if (!isBiz(b) || !isBuilt(b, now) || workersOf(state, b.id).length === 0) continue;
    staffed[catOf(b)] = (staffed[catOf(b)] || 0) + 1;
  }
  const homes = new Map(state.buildings.map((b) => [b.id, b]));
  for (const n of needs) {
    if (n.id === 'jobs') {
      for (const t of state.tenants) if (t.jobId != null) give(t, n.id);
    } else if (CATEGORIES.includes(n.id)) {
      const room = (staffed[n.id] || 0) * TUNING.needServes;
      state.tenants.slice(0, room).forEach((t) => give(t, n.id));
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
    for (const t of res) sum += each * moodRentFactor(residentMood(state, t, now, mood).score);
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
  return Math.round(Math.max(TUNING.problemMinFee, townRatePerMin(state, now) * TUNING.problemFeeMinutes));
}

function maybeProblem(state, now) {
  if (now < state.nextProblemAt) return;
  state.nextProblemAt = now + TUNING.problemGapMinMs + randInt(state, TUNING.problemGapMaxMs - TUNING.problemGapMinMs + 1);
  if (population(state) < TUNING.problemUnlockPop) return;
  const shops = builtBiz(state, now);
  if (state.problems.length >= 1 + Math.floor(shops.length / TUNING.problemShopsPerSlot)) return;
  const open = shops.filter((b) => workersOf(state, b.id).length > 0 && !problemOf(state, b.id));
  if (!open.length) return;
  const b = pick(state, open);
  const kind = pick(state, Object.keys(PROBLEMS));
  const fixer = fixerFor(state, b, kind, now);
  const problem = { buildingId: b.id, kind, at: now, fixAt: fixer ? now + TUNING.problemAutoFixMs : null, fixerId: fixer ? fixer.id : null };
  state.problems.push(problem);
  events.emit('problem', { building: b, problem });
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
      if (fixer) { p.fixAt = t + TUNING.problemAutoFixMs; p.fixerId = fixer.id; }
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
      const open = builtBiz(state, now).find((b) => workersOf(state, b.id).length < defOf(b).slots);
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
  if (dream && !state.buildings.some((b) => b.type === tenant.dream)) return `I wish we had a ${dream.name}. I'd love to work there.`;
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
  return b.dreamStars ? 0 : Math.round(statsOf(b).restockCost * levelMult(b.level) * Math.max(0, max - b.stock) / max);
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
  state.tenants.push(tenant);
  state.applicants[applicantIndex] = makeApplicant(state);
  events.emit('moveIn', { tenant });
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
    open: workers.length < def.slots || tenant.jobId === b.id,
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
  if (workersOf(state, b.id).length >= defOf(b).slots) {
    return fail('Both jobs here are taken.', { dream: false });
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
  if (first) gainGems(state, 1);
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

// ---- town jobs ------------------------------------------------------------

function jobPay(state, kind) {
  const growth = Math.min(TUNING.jobMaxGrowth, Math.floor(population(state) * TUNING.jobPayPerResident));
  return TOWN_JOBS[kind].pay + growth;
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
  job.pay = jobPay(state, kind);
  clearRide(state, now);
  state.job = job;
  return { ok: true, job };
}

export function skipTownJob(state) {
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
  return finishTownJob(state, job.pay + tenant.skills[job.category]);
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
  const bonus = job.distance === job.best ? TUNING.courierBonus : 0;
  return { ...finishTownJob(state, job.pay + bonus), bonus };
}

// ---- rides ----------------------------------------------------------------

function rideGap(state) {
  return TUNING.rideGapMinMs + randInt(state, TUNING.rideGapMaxMs - TUNING.rideGapMinMs + 1);
}

function makeRide(state, now, kind = null) {
  const built = state.buildings.filter((b) => isBuilt(b, now));
  if (built.length < TUNING.rideMinBuildings) return;
  const riders = state.tenants.filter((t) => built.some((b) => b.id === t.homeId));
  if (!riders.length) return;
  const tenant = pick(state, riders);
  const others = built.filter((b) => b.id !== tenant.homeId);
  if (!others.length) return;
  const to = pick(state, others);
  const shops = others.filter(isBiz);
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

export function startBoardRide(state, kind, now) {
  if (state.job || (state.ride && state.ride.state !== 'waiting')) return fail('Finish or skip your current job first.');
  if (kind !== 'taxi' && kind !== 'delivery') return fail('Choose a ride or delivery.');
  if (!townJobOptions(state, now)[kind]) return fail('This job needs an open shop and a resident.');
  const ride = makeRide(state, now, kind);
  if (!ride) return fail('No route is available yet.');
  state.ride = ride;
  return acceptRide(state, now);
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
      ride.fare = ride.board ? jobPay(state, 'delivery')
        : Math.round(Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.deliveryFareMinutes));
      ride.fare = Math.round(ride.fare * distancePay(state, ride));
    }
  }
  return { ok: true, reason: '', tenant, destination };
}

/** Lots driven, door to door. */
export function rideDistance(state, ride) {
  const a = buildingById(state, ride.fromId), b = buildingById(state, ride.toId);
  return a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 0;
}

/** Longer trips pay more: +rideDistanceBonus per lot. */
function distancePay(state, ride) {
  return 1 + TUNING.rideDistanceBonus * rideDistance(state, ride);
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
    const base = ride.board ? jobPay(state, 'taxi')
      : Math.max(TUNING.rideMinFare, townRatePerMin(state, now) * TUNING.rideFareMinutes);
    ride.fare = Math.round(base * distancePay(state, ride) * tipFor(ride, now));
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
  clearRide(state, now);
  return { ok: true };
}

export function completeRide(state, now) {
  const ride = state.ride;
  if (!ride || ride.state !== 'driving') return fail('There is no ride on the road right now.', { fare: 0 });
  const fare = ride.fare;
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
      const growth = TUNING.cropPerHour * TUNING.staffFactor[staff] * levelMult(b.level) / 3600000;
      shops.push({ b, crop, growth, rate: potentialRate(state, b), pay: (PRICE_MODES[b.price] || PRICE_MODES.normal).pay, sold: 0, restocked: false });
    }
    const farms = shops.filter((shop) => shop.crop && shop.growth > 0);
    const teachers = state.buildings.filter((b) => defOf(b).lessons > 0);
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
        pending.at(-1)?.readyAt ?? Infinity, Math.max(t + 1, state.nextApplicantAt),
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
        const exact = sold * shop.pay * boost * (t < (state.adUntil || 0) ? 1 + TUNING.adSalesBonus : 1) + (b.cc || 0);
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

      // 3. fresh faces: the oldest applicant makes way for a new one
      while (end >= state.nextApplicantAt) {
        if (state.applicants.length >= TUNING.applicantCount) state.applicants.shift();
        state.applicants.push(makeApplicant(state));
        state.nextApplicantAt += TUNING.applicantEveryMs / (end < (state.adUntil || 0) ? 2 : 1);   // ads bring people in faster
      }

      // 4. rent at the top of every hour
      if (end >= nextHour) {
        payRent(end);
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
  checkGoals(state, now);
  return res;
}
