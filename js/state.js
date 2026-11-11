// Mini Mayor — state: new game, save/load (with backup copy), export/import, local day.
// Pure: the only platform access is localStorage inside save()/load(), always guarded.

import { BUILDINGS, CARS, CATEGORIES, FIRST_NAMES, GOALS, PARCELS, PROBLEMS, QUALITY, RECIPES, TUNING, levelMult, shopStats, TRAITS, HINTS, UPGRADES, VIPS } from './config.js';

export const SAVE_KEY = 'bitcity.save.v1';
const EXPORT_PREFIX = 'BITCITY1:';

// ---- time -----------------------------------------------------------------

/** 'YYYY-MM-DD' for `now` in the device's local timezone. */
export function localDay(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- seeded randomness (state.seed advances on every use) -------------------

/** Next random float in [0, 1). Deterministic for a given state.seed. */
export function rand(state) {
  state.seed = ((state.seed >>> 0) + 0x6d2b79f5) >>> 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Random integer in [0, n). */
export function randInt(state, n) {
  return Math.floor(rand(state) * n);
}

export function pick(state, arr) {
  return arr[randInt(state, arr.length)];
}

// ---- applicants -----------------------------------------------------------

const BIZ_TYPES = Object.keys(BUILDINGS).filter((id) => BUILDINGS[id].kind === 'biz');

/**
 * Roll a new tenant-shaped applicant. Everyone has one clearly best category (6..9)
 * and low-ish skills elsewhere. The dream job is a business type, usually in their
 * best category. `opts.best` forces the best category; `opts.dreamPool` limits the
 * dream job to those type ids (used to make the first applicants beginner-friendly).
 */
export function makeApplicant(state, opts = {}) {
  const best = opts.best || pick(state, CATEGORIES);
  const skills = {};
  for (const c of CATEGORIES) {
    const r = rand(state);
    skills[c] = c === best ? 6 + randInt(state, 4) : Math.floor(r * r * 6); // others 0..5, skewed low
  }
  const pool = opts.dreamPool && opts.dreamPool.length ? opts.dreamPool : BIZ_TYPES;
  // Shops arrive by surprise, so half of all newcomers dream of a shop the town already
  // has: you can pick the applicant who fits your town.
  const here = pool.filter((id) => (state.buildings || []).some((b) => b.type === id));
  // nobody dreams of a place the land may never allow (a ski lodge with no mountains) unless it exists
  const open = pool.filter((id) => !BUILDINGS[id].near || here.includes(id));
  const from = here.length && rand(state) < 0.5 ? here : open;
  const inBest = from.filter((id) => BUILDINGS[id].categories.includes(best));
  const dream = inBest.length && rand(state) < 0.7 ? pick(state, inBest) : pick(state, from);

  const taken = new Set();
  for (const p of state.tenants || []) taken.add(p.name);
  for (const p of state.applicants || []) taken.add(p.name);
  let name = pick(state, FIRST_NAMES);
  for (let i = 0; i < 12 && taken.has(name); i++) name = pick(state, FIRST_NAMES);

  // A star has two strong skills; anyone may have a trait (a genius gets +2 everywhere).
  const star = rand(state) < TUNING.starChance;
  if (star) {
    skills[best] = 8 + randInt(state, 2);
    const second = pick(state, CATEGORIES.filter((c) => c !== best));
    skills[second] = Math.max(skills[second], 6 + randInt(state, 3));
  }
  const trait = rand(state) < TUNING.traitChance ? pick(state, Object.keys(TRAITS)) : null;
  if (trait === 'genius') for (const c of CATEGORIES) skills[c] = Math.min(9, skills[c] + 2);
  // first impression: a trait always shows its hint; half of everyone else gets a hint too
  const hint = trait ? TRAITS[trait].hint : rand(state) < 0.5 ? pick(state, ['sharp', 'friendly']) : 'nice';
  // what you can see before they move in: each skill as a range around the real one
  const w = star ? 1 : Math.max(0, TUNING.skillRangeWidth - ((state.upgrades || {}).interview || 0));   // interviews narrow it
  const seen = {};
  for (const c of CATEGORIES) {
    const lo = Math.max(0, Math.min(9 - w, skills[c] - randInt(state, w + 1)));
    seen[c] = [lo, Math.max(skills[c], Math.min(9, lo + w))];
  }

  return {
    id: state.nextId++,
    name,
    star, trait, hint, seen,
    look: {
      skin: randInt(state, 5),
      hair: randInt(state, 6),
      hairStyle: randInt(state, 4),
      shirt: randInt(state, 8),
    },
    skills,
    dream,
    homeId: null,
    jobId: null,
    dreamDone: false, // true once this person's first dream job has paid its gem
  };
}

// ---- new game -------------------------------------------------------------

export function newGame(now) {
  const state = {
    v: 1,
    createdAt: now,
    lastTick: now,
    lastRentHour: Math.floor(now / 3600000),   // rent is paid at the top of every hour
    rentCarry: 0,                      // fraction of a coin of rent carried to the next hour
    seed: (Math.floor(now / 1000) ^ 0x9e3779b9) >>> 0,
    worldSeed: (Math.floor(now / 1000) ^ 0x51ed270b) >>> 0,   // the landscape; never changes
    streets: 'plan',                   // a street plan generated from worldSeed ('grid' = towns from before that)
    coins: TUNING.startCoins,
    gems: TUNING.startGems,
    nextId: 1,
    stats: { earned: 0, rides: 0, dreamJobs: 0, rentCollected: 0, restocks: 0, visitors: 0, vips: 0 },
    buildings: [],
    tenants: [],
    applicants: [],
    nextApplicantAt: now + TUNING.applicantEveryMs,
    slowArrivalsUntil: 0,
    upgrades: {},                      // Upgrades tab: id -> level bought (0 if missing)
    nextVisitAt: now + TUNING.visitorGapMaxMs,   // visitors only come while you play
    nextShopAt: now + TUNING.residentShopGapMs,  // residents' own shopping, also only while you play
    contracts: [],                     // standing hourly deliveries: { id, town, crop, signedAt, done, missed }
    friends: {},                       // town -> deliveries made (friendship)
    vip: null,                         // a VIP waiting on the entry road: { kind, name, look, arrivedAt, leaveAt }
    nextVipAt: now + TUNING.vipGapMaxMs,
    nextPostAt: now + TUNING.postGapMs,
    feed: [],                          // posts, newest last: { id, at, name, look, text, who: 'visitor'|'resident', tone }
    feedRead: 0,                       // the id of the newest post you have seen              // after asking someone to move out, newcomers come slower until then
    ride: null,
    job: null,
    nextRideAt: now + TUNING.rideFirstDelayMs,
    goalsDone: [],
    crops: { veggies: 0, fruit: 0 },   // lifetime harvest; only ever goes up
    recipes: [],
    nextLessonAt: now + 1800000,
    land: ['home'],                    // parcels owned; see PARCELS
    goods: { veggies: 0, fruit: 0 },   // crops in the barn, ready to sell or deliver
    orders: [],                        // standing orders from neighbour towns
    trucks: [],                        // trade trucks on the road: { id, kind, crop, qty, coins?, gems?, leaveAt, arriveAt }
    trade: { sold: 0, filled: 0 },
    adUntil: 0,
    car: 1,                            // which of CARS you drive (1 = the first)
    jobCooldowns: {},                  // jobs board: kind -> time it can be taken again
    problems: [],                      // shop troubles: { buildingId, kind, at, fixAt|null, fixerId|null }
    nextProblemAt: now + TUNING.problemGapMaxMs,
    settings: { sound: true },
  };
  // The first three applicants are good at the three starter categories and dream of
  // a starter business, so the very first hires feel great.
  const starters = BIZ_TYPES.filter((id) => BUILDINGS[id].unlockAt === 0);
  const cats = [...new Set(starters.map((id) => BUILDINGS[id].category))];
  for (let i = 0; i < TUNING.applicantCount; i++) {
    state.applicants.push(makeApplicant(state, { best: cats[i % cats.length], dreamPool: starters }));
  }
  return state;
}

// ---- migrate / validate ---------------------------------------------------

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function validJob(job, byId, tenants) {
  if (!job || !Number.isInteger(job.pay) || job.pay <= 0) return false;
  if (job.kind === 'rush') {
    return byId.has(job.shopId) && Object.hasOwn(RUSH_MENUS, job.menu) && Array.isArray(job.orders) &&
      job.orders.every((n) => Number.isInteger(n) && n >= 0 && n < RUSH_MENUS[job.menu].length) &&
      Number.isInteger(job.index) && job.index >= 0 && job.index < job.orders.length;
  }
  if (job.kind === 'odd') {
    return CATEGORIES.includes(job.category) && Array.isArray(job.candidates) && job.candidates.length > 0 &&
      job.candidates.every((id) => tenants.some((t) => t.id === id));
  }
  if (!Number.isInteger(job.x) || !Number.isInteger(job.y)) return false;
  if (job.kind === 'lost') return byId.has(job.shopId) && ['north', 'south', 'east', 'west'].includes(job.direction);
  return job.kind === 'courier' && Array.isArray(job.stops) && job.stops.length > 0 &&
    job.stops.every((id) => byId.has(id)) && isNum(job.distance) && isNum(job.best);
}

function fixPerson(p) {
  if (!p || typeof p !== 'object' || !isNum(p.id)) return null;
  if (typeof p.name !== 'string') p.name = 'Friend';
  const look = p.look && typeof p.look === 'object' ? p.look : {};
  p.look = {
    skin: isNum(look.skin) ? look.skin : 0,
    hair: isNum(look.hair) ? look.hair : 0,
    hairStyle: isNum(look.hairStyle) ? look.hairStyle : 0,
    shirt: isNum(look.shirt) ? look.shirt : 0,
  };
  const skills = p.skills && typeof p.skills === 'object' ? p.skills : {};
  p.skills = {};
  for (const c of CATEGORIES) p.skills[c] = isNum(skills[c]) ? Math.max(0, Math.min(9, Math.round(skills[c]))) : 0;
  if (!BUILDINGS[p.dream] || BUILDINGS[p.dream].kind !== 'biz') p.dream = 'diner';
  if (!isNum(p.homeId)) p.homeId = null;
  if (!isNum(p.jobId)) p.jobId = null;
  p.dreamDone = !!p.dreamDone;
  // newcomers and traits (2026-11-10): older people have no trait and fully known skills
  p.star = !!p.star;
  p.trait = TRAITS[p.trait] ? p.trait : null;
  if (!HINTS[p.hint]) p.hint = p.trait ? TRAITS[p.trait].hint : 'nice';
  if (p.homeId != null) { delete p.seen; return p; }   // residents' skills are known exactly
  const seen = p.seen && typeof p.seen === 'object' ? p.seen : {};
  p.seen = {};
  for (const c of CATEGORIES) {
    const r = Array.isArray(seen[c]) && seen[c].length === 2 && seen[c].every(isNum) ? seen[c] : [p.skills[c], p.skills[c]];
    p.seen[c] = [Math.min(r[0], p.skills[c]), Math.max(r[1], p.skills[c])];
  }
  return p;
}

/**
 * Bring any saved object up to the current shape. Returns the (mutated) state,
 * or null if it isn't a Mini Mayor save at all. Never throws.
 */
export function migrate(state) {
  try {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
    if (!isNum(state.coins) || !Array.isArray(state.buildings) || !Array.isArray(state.tenants)) return null;
    state.v = 1;
    if (!isNum(state.lastTick)) return null;
    if (!isNum(state.createdAt)) state.createdAt = state.lastTick;
    // rent moved from midnight to every hour: an older save is owed the hours since its last midnight
    if (!isNum(state.lastRentHour)) {
      state.lastRentHour = Math.floor(state.lastTick / 3600000) - (typeof state.lastRentDay === 'string' ? new Date(state.lastTick).getHours() : 0);
    }
    delete state.lastRentDay;
    state.rentCarry = isNum(state.rentCarry) && state.rentCarry > 0 && state.rentCarry < 1 ? state.rentCarry : 0;
    if (!isNum(state.seed)) state.seed = (Math.floor(state.createdAt / 1000) ^ 0x9e3779b9) >>> 0;
    // towns from before landscapes existed get one based on the day they were founded
    if (!isNum(state.worldSeed)) state.worldSeed = (Math.floor(state.createdAt / 1000) ^ 0x51ed270b) >>> 0;
    state.coins = Math.max(0, Math.floor(state.coins));
    state.gems = isNum(state.gems) ? Math.max(0, Math.floor(state.gems)) : 0;
    const st = state.stats && typeof state.stats === 'object' ? state.stats : {};
    state.stats = {};
    for (const k of ['earned', 'rides', 'dreamJobs', 'rentCollected', 'restocks', 'visitors', 'vips']) state.stats[k] = isNum(st[k]) ? st[k] : 0;

    state.buildings = state.buildings.filter(
      (b) => b && typeof b === 'object' && isNum(b.id) && BUILDINGS[b.type] && isNum(b.x) && isNum(b.y)
    );
    for (const b of state.buildings) {
      const def = BUILDINGS[b.type];
      if (!isNum(b.readyAt)) b.readyAt = state.lastTick;
      if (!isNum(b.paid)) b.paid = def.cost;   // saves from before prices grew per copy
      b.level = isNum(b.level) ? Math.max(1, Math.min(TUNING.maxLevel, Math.round(b.level))) : 1;
      if (def.kind === 'biz') { if (!['low', 'normal', 'high'].includes(b.price)) b.price = 'normal'; if (!isNum(b.cc)) b.cc = 0; }
      if (def.kind === 'biz' || def.gov) b.q = isNum(b.q) && QUALITY[b.q] ? b.q : 0;
      if (def.kind === 'biz') {
        if (!def.categories.includes(b.cat)) b.cat = def.category;
        // shops from before tiers existed are ranked by the order they were built
        if (!isNum(b.tier) || b.tier < 0) {
          b.tier = state.buildings.filter((o) => o !== b && o.id < b.id && BUILDINGS[o.type] && BUILDINGS[o.type].kind === 'biz' && (o.cat || BUILDINGS[o.type].category) === b.cat).length;
        }
        // the same as stockMaxOf in sim: bigger shops (more jobs) hold more stock
        const slots = (def.slots || 2) + (b.level >= TUNING.slotAtLevel ? 1 : 0);
        const size = TUNING.staffFactor[Math.min(slots, TUNING.staffFactor.length - 1)] / TUNING.staffFactor[2];
        const max = Math.round(shopStats(b.cat, b.tier).stockMax * levelMult(b.level) * size);
        b.stock = isNum(b.stock) ? Math.max(0, Math.min(max, Math.floor(b.stock))) : max;
        b.carry = isNum(b.carry) ? b.carry : 0;
        b.dreamStars = 0; // recounted below
      }
    }
    const byId = new Map(state.buildings.map((b) => [b.id, b]));
    state.tenants = state.tenants.map(fixPerson).filter(Boolean);
    for (const t of state.tenants) {
      const job = t.jobId == null ? null : byId.get(t.jobId);
      if (!job || BUILDINGS[job.type].kind !== 'biz') t.jobId = null;
      else if (t.dream === job.type) job.dreamStars++;
    }
    state.applicants = (Array.isArray(state.applicants) ? state.applicants : []).map(fixPerson).filter(Boolean);
    for (const a of state.applicants) { a.homeId = null; a.jobId = null; }
    state.applicants.length = Math.min(state.applicants.length, TUNING.applicantCount);

    let maxId = 0;
    for (const o of [...state.buildings, ...state.tenants, ...state.applicants, ...(Array.isArray(state.orders) ? state.orders : []).filter((x) => x && isNum(x.id)), ...(Array.isArray(state.trucks) ? state.trucks : []).filter((x) => x && isNum(x.id))]) maxId = Math.max(maxId, o.id);
    state.nextId = Math.max(isNum(state.nextId) ? state.nextId : 1, maxId + 1);
    if (!isNum(state.slowArrivalsUntil)) state.slowArrivalsUntil = 0;
    // visitors and the feed (2026-11-10)
    if (!isNum(state.nextVisitAt)) state.nextVisitAt = state.lastTick + TUNING.visitorGapMaxMs;
    if (!isNum(state.nextShopAt)) state.nextShopAt = state.lastTick + TUNING.residentShopGapMs;
    // trade contracts (2026-11-10)
    state.contracts = (Array.isArray(state.contracts) ? state.contracts : []).filter((c) => c && isNum(c.id) && typeof c.town === 'string' && typeof c.crop === 'string');
    for (const c of state.contracts) { c.done = isNum(c.done) ? c.done : 0; c.missed = isNum(c.missed) ? c.missed : 0; }
    if (!state.friends || typeof state.friends !== 'object') state.friends = {};
    // VIPs (2026-11-10)
    if (!isNum(state.nextVipAt)) state.nextVipAt = state.lastTick + TUNING.vipGapMaxMs;
    if (!state.vip || typeof state.vip !== 'object' || !VIPS[state.vip.kind] || !isNum(state.vip.leaveAt)) state.vip = null;
    if (!isNum(state.stats.vips)) state.stats.vips = 0;
    if (!isNum(state.nextPostAt)) state.nextPostAt = state.lastTick + TUNING.postGapMs;
    state.feed = (Array.isArray(state.feed) ? state.feed : []).filter((p) => p && isNum(p.id) && isNum(p.at) && typeof p.text === 'string').slice(-TUNING.feedMax);
    if (!isNum(state.feedRead)) state.feedRead = 0;
    if (!isNum(state.stats.visitors)) state.stats.visitors = 0;
    // the Upgrades tab (2026-11-10): older saves have bought none
    const ups = state.upgrades && typeof state.upgrades === 'object' ? state.upgrades : {};
    state.upgrades = {};
    for (const id of Object.keys(UPGRADES)) if (isNum(ups[id]) && ups[id] > 0) state.upgrades[id] = Math.min(UPGRADES[id].costs.length, Math.round(ups[id]));

    if (!isNum(state.nextApplicantAt)) state.nextApplicantAt = state.lastTick + TUNING.applicantEveryMs;
    if (!isNum(state.nextRideAt)) state.nextRideAt = state.lastTick + TUNING.rideGapMinMs;
    const r = state.ride;
    // trade trucks (2026-11-10): older saves have none on the road
    if (!Array.isArray(state.trucks)) state.trucks = [];
    state.trucks = state.trucks.filter((t) => t && isNum(t.id) && isNum(t.arriveAt) && typeof t.crop === 'string');
    state.car = isNum(state.car) ? Math.max(1, Math.min(CARS.length, Math.round(state.car))) : 1;
    const fromOk = r && (byId.has(r.fromId) || (r.kind === 'welcome' && r.from && isNum(r.from.x) && isNum(r.from.y)));
    const rideOk = r && typeof r === 'object' && fromOk && byId.has(r.toId) &&
      state.tenants.some((t) => t.id === r.tenantId) && ['waiting', 'choosing', 'driving'].includes(r.state);
    if (!rideOk) state.ride = null;
    else if (r.kind === 'delivery' && r.state !== 'waiting' && (!isNum(r.fare) || r.fare < 0)) state.ride = null;
    if (!validJob(state.job, byId, state.tenants) || state.ride) state.job = null;
    const known = new Set(GOALS.map((g) => g.id));
    state.goalsDone = (Array.isArray(state.goalsDone) ? state.goalsDone : []).filter((id) => known.has(id));
    state.goalsDone = [...new Set(state.goalsDone)];
    state.problems = (Array.isArray(state.problems) ? state.problems : []).filter((p) => p && typeof p === 'object' &&
      byId.has(p.buildingId) && PROBLEMS[p.kind] && isNum(p.at) && (p.fixAt === null || isNum(p.fixAt)));
    const cds = state.jobCooldowns && typeof state.jobCooldowns === 'object' && !Array.isArray(state.jobCooldowns) ? state.jobCooldowns : {};
    state.jobCooldowns = Object.fromEntries(Object.entries(cds).filter(([, v]) => isNum(v)));
    if (!isNum(state.nextProblemAt)) state.nextProblemAt = state.lastTick + TUNING.problemGapMaxMs;
    if (state.streets !== 'plan') state.streets = 'grid';   // a town keeps the streets it was founded with
    // phase 3: land. Every town owns its first parcel; buildings on land that isn't owned are kept by owning it.
    const parcelIds = new Set(PARCELS.map((p) => p.id));
    state.land = [...new Set(['home', ...(Array.isArray(state.land) ? state.land : []).filter((id) => parcelIds.has(id))])];
    // phase 3: trade
    const goods = state.goods && typeof state.goods === 'object' ? state.goods : {};
    state.goods = { veggies: isNum(goods.veggies) ? Math.max(0, goods.veggies) : 0, fruit: isNum(goods.fruit) ? Math.max(0, goods.fruit) : 0 };
    state.orders = (Array.isArray(state.orders) ? state.orders : []).filter(
      (o) => o && isNum(o.id) && typeof o.town === 'string' && (o.crop === 'veggies' || o.crop === 'fruit') && isNum(o.qty) && isNum(o.coins)
    ).slice(0, 2);
    for (const o of state.orders) if (!isNum(o.gems)) o.gems = 1;
    const tr = state.trade && typeof state.trade === 'object' ? state.trade : {};
    state.trade = { sold: isNum(tr.sold) ? tr.sold : 0, filled: isNum(tr.filled) ? tr.filled : 0 };
    if (!isNum(state.adUntil)) state.adUntil = 0;
    // phase 2: crops, recipes, lessons
    const crops = state.crops && typeof state.crops === 'object' ? state.crops : {};
    state.crops = { veggies: isNum(crops.veggies) ? Math.max(0, crops.veggies) : 0, fruit: isNum(crops.fruit) ? Math.max(0, crops.fruit) : 0 };
    const knownRecipes = new Set(RECIPES.map((r) => r.id));
    state.recipes = [...new Set((Array.isArray(state.recipes) ? state.recipes : []).filter((id) => knownRecipes.has(id)))];
    if (!isNum(state.nextLessonAt)) state.nextLessonAt = state.lastTick + 1800000;
    const set = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings = { ...set, sound: set.sound !== false };
    return state;
  } catch {
    return null;
  }
}

// ---- save / load ----------------------------------------------------------

function storage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
  } catch {
    return null;
  }
}

/** Writes the save; the previous save is first copied to SAVE_KEY + '.bak'. Never throws. */
export function save(state) {
  try {
    const ls = storage();
    if (!ls) return false;
    const json = JSON.stringify(state);
    if (typeof json !== 'string') return false;
    try {
      const prev = ls.getItem(SAVE_KEY);
      // Only keep a previous save as the backup if it is still readable.
      if (typeof prev === 'string' && prev !== json && parseSave(prev)) ls.setItem(SAVE_KEY + '.bak', prev);
    } catch { /* a failed backup must not stop the real save */ }
    ls.setItem(SAVE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

function parseSave(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    return migrate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Returns the saved state, the backup copy if the main one is missing/corrupt, or null. */
export function load() {
  try {
    const ls = storage();
    if (!ls) return null;
    let main = null;
    try { main = parseSave(ls.getItem(SAVE_KEY)); } catch { main = null; }
    if (main) return main;
    try { return parseSave(ls.getItem(SAVE_KEY + '.bak')); } catch { return null; }
  } catch {
    return null;
  }
}

// ---- export / import ------------------------------------------------------

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function exportSave(state) {
  return EXPORT_PREFIX + toBase64(JSON.stringify(state));
}

export function importSave(str) {
  if (typeof str !== 'string' || !str.trim()) {
    throw new Error('Paste your backup code first.');
  }
  const text = str.replace(/\s+/g, '');
  if (!text.startsWith(EXPORT_PREFIX)) {
    throw new Error("That doesn't look like a Mini Mayor backup. It should start with BITCITY1:");
  }
  let data;
  try {
    data = JSON.parse(fromBase64(text.slice(EXPORT_PREFIX.length)));
  } catch {
    throw new Error("That backup code looks incomplete. Try copying the whole thing again.");
  }
  const state = migrate(data);
  if (!state) throw new Error("That backup code couldn't be read. Try copying the whole thing again.");
  return state;
}
