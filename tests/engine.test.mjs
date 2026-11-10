import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as config from '../js/config.js';
import * as S from '../js/state.js';
import * as sim from '../js/sim.js';
import { buildingSpriteId } from '../js/sprites.js';

const { BUILDINGS, GOALS, CATEGORIES, TUNING } = config;
const goalCoins = (id) => GOALS.find((g) => g.id === id).reward.coins || 0;
const allGoalsDone = (s) => { s.goalsDone = GOALS.map((g) => g.id); };
const T0 = new Date(2026, 5, 15, 12, 0, 0).getTime(); // local noon
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

// ---- helpers ----------------------------------------------------------------

function lots() {
  const out = [];
  for (let y = 0; y < config.MAP_H; y++) for (let x = 0; x < config.MAP_W; x++) if (!config.isRoad(x, y)) out.push([x, y]);
  return out;
}
function freeLot(state) {
  return lots().find(([x, y]) => !sim.tileAt(state, x, y));
}
/** Build and finish instantly (time does not move). */
function put(state, type, now) {
  const [x, y] = freeLot(state);
  const def = BUILDINGS[type];
  const noHome = def.kind === 'biz' && !state.buildings.some((b) => BUILDINGS[b.type].kind === 'home');
  if (!sim.isUnlocked(state, type) || noHome) {
    // test towns may use types the population has not unlocked yet, or shops before any home
    const b = { id: state.nextId++, type, x, y, readyAt: Math.min(now, state.lastTick), paid: def.cost, level: 1 };
    if (def.kind === 'biz') Object.assign(b, { stock: Math.round(def.stockMax * TUNING.staffFactor[def.slots] / TUNING.staffFactor[2]), dreamStars: 0, carry: 0, price: 'normal', cc: 0 });
    state.buildings.push(b);
    return b;
  }
  state.coins += sim.costOf(state, type);
  const r = sim.build(state, type, x, y, now);
  assert.ok(r.ok, r.reason);
  r.building.readyAt = Math.min(now, state.lastTick);
  return r.building;
}
/** Move the first applicant into a home, with fixed skills and dream. */
function person(state, home, now, { skill = 6, dream = 'music' } = {}) {
  const r = sim.moveIn(state, 0, home.id, now);
  assert.ok(r.ok, r.reason);
  for (const c of CATEGORIES) r.tenant.skills[c] = skill;
  r.tenant.dream = dream;
  return r.tenant;
}
/** A new game on the even street grid, which the rule tests are written against. */
function gridGame(now) {
  const s = S.newGame(now);
  s.streets = 'grid';
  return s;
}
function fresh() {
  const s = gridGame(T0);
  s.coins = 100000; // most rule tests don't care about money
  s.streets = 'grid'; // rule tests use the even grid, so lot (0,0) is always a lot
  return s;
}
/** Collect events during fn. */
function record(fn) {
  const log = [];
  const types = ['coins', 'spend', 'gem', 'built', 'opened', 'demolished', 'moveIn', 'job', 'outOfStock', 'restocked',
    'rideRequest', 'rideGone', 'rideStart', 'rideDone', 'rent', 'goal', 'unlock', 'recipe', 'lesson'];
  const subs = types.map((type) => [type, sim.events.on(type, (p) => log.push({ type, ...p }))]);
  try { fn(); } finally { for (const [type, f] of subs) sim.events.off(type, f); }
  return log;
}
function fakeStorage() {
  const m = new Map();
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  return ls;
}
function noStorage() {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
}

// ---- config -----------------------------------------------------------------

test('config: shape, roads, every type complete, balance targets', () => {
  assert.equal(config.MAP_W, 11); assert.equal(config.MAP_H, 14); assert.equal(config.TILE, 16);
  assert.equal(config.DAY_LENGTH_MS, 3600000);
  assert.deepEqual(CATEGORIES, ['food', 'retail', 'service', 'farming', 'creative']);
  assert.equal(config.CATEGORY_COLORS.food, '#e8804a');
  assert.equal(config.isRoad(3, 0), true); assert.equal(config.isRoad(0, 2), true); assert.equal(config.isRoad(0, 0), false);
  assert.equal(lots().length, 90);
  const ids = Object.keys(BUILDINGS);
  assert.equal(ids.length, 54);
  assert.equal(ids.filter((id) => BUILDINGS[id].kind === 'biz').length, 38);
  assert.deepEqual([...config.BUILD_ORDER].sort(), [...ids].sort());
  for (const id of ids) {
    const d = BUILDINGS[id];
    assert.equal(d.id, id);
    assert.ok(d.name && d.blurb && d.cost > 0 && d.buildSecs > 0 && d.unlockAt >= 0, id);
    if (d.kind === 'home') { assert.ok(d.capacity >= 1 && d.rentPerTenant > 0); assert.equal(d.category, null); }
    else if (d.kind === 'trade') { assert.equal(d.category, null); }
    else if (d.kind === 'civic' || d.kind === 'park') {
      assert.equal(d.category, null); assert.ok(config.NEEDS.some((n) => n.id === d.provides.need) && d.provides.serves > 0, id);
    } else {
      assert.equal(d.kind, 'biz'); assert.ok(d.slots >= 1 && d.slots <= 4, id); assert.ok(CATEGORIES.includes(d.category));
      assert.equal(d.categories[0], d.category); assert.ok(d.categories.every((c) => CATEGORIES.includes(c)), id);
      assert.ok(d.baseRate > 0 && d.stockMax > 0 && d.restockCost > 0 && d.restockCost < d.stockMax);
      // a full stock lasts 2-6 hours with a full team of average workers (skill 5), whatever the shop's size
      const staff = TUNING.staffFactor[d.slots];
      const hours = (d.stockMax * staff / TUNING.staffFactor[2]) / (d.baseRate * staff * (1 + 5 / TUNING.skillAvgDivisor)) / 60;
      assert.ok(hours >= 2 && hours <= 6, `${id} stock lasts ${hours.toFixed(1)}h`);
    }
  }
  assert.deepEqual(Object.keys(config.SHOP_CATS).filter((c) => config.SHOP_CATS[c].unlockAt === 0), ['food', 'retail', 'service']);
  for (const c of CATEGORIES) assert.ok(ids.filter((id) => BUILDINGS[id].kind === 'biz' && BUILDINGS[id].categories.includes(c)).length >= 6, `${c} has variety`);
  assert.ok(Math.max(...ids.map((id) => BUILDINGS[id].unlockAt)) <= 36);
  assert.ok(BUILDINGS.tent.cost + BUILDINGS.diner.cost <= TUNING.startCoins);
  assert.equal(BUILDINGS.tent.capacity, 1); assert.equal(BUILDINGS.cabin.capacity, 2);
  assert.equal(BUILDINGS.apartment.capacity, 4); assert.equal(BUILDINGS.house.capacity, 3);
  assert.ok(BUILDINGS.house.rentPerTenant > BUILDINGS.apartment.rentPerTenant);
  assert.ok(GOALS.length >= 10);
  assert.equal(new Set(GOALS.map((g) => g.id)).size, GOALS.length);
  assert.ok(config.FIRST_NAMES.length >= 30);
});

// ---- state ------------------------------------------------------------------

test('newGame: shape and JSON round trip', () => {
  const s = gridGame(T0);
  assert.equal(s.v, 1); assert.equal(s.createdAt, T0); assert.equal(s.lastTick, T0);
  assert.equal(s.lastRentHour, Math.floor(T0 / HOUR)); assert.equal(s.rentCarry, 0);
  assert.equal(s.coins, 250); assert.equal(s.gems, 2);
  assert.deepEqual(s.stats, { earned: 0, rides: 0, dreamJobs: 0, rentCollected: 0, restocks: 0 });
  assert.deepEqual(s.buildings, []); assert.deepEqual(s.tenants, []);
  assert.equal(s.applicants.length, 3);
  assert.equal(s.ride, null); assert.deepEqual(s.goalsDone, []); assert.deepEqual(s.settings, { sound: true });
  assert.ok(s.nextApplicantAt > T0 && s.nextRideAt > T0);
  for (const a of s.applicants) {
    assert.equal(a.homeId, null); assert.equal(a.jobId, null);
    assert.equal(BUILDINGS[a.dream].kind, 'biz');
    assert.equal(BUILDINGS[a.dream].unlockAt, 0, 'first applicants dream of a starter business');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(gridGame(T0), s, 'deterministic for the same now');
});

test('applicants: skills 0..9, one clear best, look ranges, dream is a business', () => {
  const s = gridGame(T0);
  let dreamInBest = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const a = S.makeApplicant(s);
    const vals = CATEGORIES.map((c) => a.skills[c]);
    for (const v of vals) assert.ok(Number.isInteger(v) && v >= 0 && v <= 9);
    const sorted = [...vals].sort((x, y) => y - x);
    assert.ok(sorted[0] >= 6, 'decent at something');
    assert.ok(sorted[0] > sorted[1], 'one clearly best category');
    assert.ok(a.look.skin >= 0 && a.look.skin <= 4 && a.look.hair >= 0 && a.look.hair <= 5);
    assert.ok(a.look.hairStyle >= 0 && a.look.hairStyle <= 3 && a.look.shirt >= 0 && a.look.shirt <= 7);
    assert.equal(BUILDINGS[a.dream].kind, 'biz');
    const best = CATEGORIES[vals.indexOf(sorted[0])];
    if (BUILDINGS[a.dream].category === best) dreamInBest++;
  }
  assert.ok(dreamInBest / N > 0.6, `dream usually matches best skill (${dreamInBest}/${N})`);
});

test('localDay uses the local calendar', () => {
  assert.equal(S.localDay(new Date(2026, 0, 5, 0, 0, 1).getTime()), '2026-01-05');
  assert.equal(S.localDay(new Date(2026, 11, 31, 23, 59, 59).getTime()), '2026-12-31');
});

test('export / import round trip and friendly errors', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0);
  const t = person(s, tent, T0);
  t.name = 'Zoë ☕'; // non-latin1 must survive
  const str = S.exportSave(s);
  assert.ok(str.startsWith('BITCITY1:'));
  assert.deepEqual(S.importSave(str), s);
  assert.deepEqual(S.importSave('  ' + str.slice(0, 40) + '\n' + str.slice(40) + ' \n'), s, 'whitespace is forgiven');
  for (const bad of ['', '   ', 'hello', 'BITCITY1:%%%not base64%%%', 'BITCITY1:' + btoa('{"nope":1}'), 'BITCITY1:' + btoa('[1,2'), null, 42]) {
    assert.throws(() => S.importSave(bad), (e) => e instanceof Error && e.message.length > 10 && !/JSON|token|undefined/i.test(e.message), String(bad));
  }
});

test('save / load with a fake localStorage, including the .bak fallback', () => {
  const ls = fakeStorage();
  try {
    assert.equal(S.SAVE_KEY, 'bitcity.save.v1');
    assert.equal(S.load(), null);
    const s = gridGame(T0);
    assert.equal(S.save(s), true);
    assert.equal(ls.getItem(S.SAVE_KEY + '.bak'), null, 'nothing to back up on the first save');
    assert.deepEqual(S.load(), s);

    const first = JSON.stringify(s);
    s.coins = 999;
    assert.equal(S.save(s), true);
    assert.equal(ls.getItem(S.SAVE_KEY + '.bak'), first, 'previous value copied to .bak');
    assert.equal(S.load().coins, 999);

    ls.setItem(S.SAVE_KEY, '{"coins": 12, "broken'); // corrupt main
    assert.equal(S.load().coins, 250, 'falls back to .bak');
    ls.removeItem(S.SAVE_KEY); // missing main
    assert.equal(S.load().coins, 250);
    ls.setItem(S.SAVE_KEY, 'null');
    assert.equal(S.load().coins, 250);

    // saving over a corrupt main must not destroy the good backup
    ls.setItem(S.SAVE_KEY, 'garbage');
    s.coins = 5;
    assert.equal(S.save(s), true);
    assert.equal(JSON.parse(ls.getItem(S.SAVE_KEY + '.bak')).coins, 250);
    assert.equal(S.load().coins, 5);

    ls.setItem(S.SAVE_KEY, 'x'); ls.setItem(S.SAVE_KEY + '.bak', 'y');
    assert.equal(S.load(), null);

    ls.setItem = () => { throw new Error('quota'); };
    assert.equal(S.save(s), false, 'never throws');
  } finally { noStorage(); }
  assert.equal(S.save(gridGame(T0)), false, 'no localStorage: false, no throw');
  assert.equal(S.load(), null);
});

test('migrate fills in missing fields and rejects non-saves', () => {
  assert.equal(S.migrate(null), null); assert.equal(S.migrate([]), null); assert.equal(S.migrate({ a: 1 }), null);
  const s = fresh();
  const diner = put(s, 'diner', T0);
  const tent = put(s, 'tent', T0);
  const t = person(s, tent, T0, { dream: 'diner' });
  sim.assignJob(s, t.id, diner.id, T0);
  const old = JSON.parse(JSON.stringify(s));
  delete old.seed; delete old.settings; delete old.stats.restocks; delete old.buildings[0].carry;
  delete old.tenants[0].dreamDone; old.buildings[0].dreamStars = 7; old.goalsDone.push('nonsense');
  const m = S.migrate(old);
  assert.ok(Number.isFinite(m.seed)); assert.equal(m.settings.sound, true); assert.equal(m.stats.restocks, 0);
  assert.equal(m.buildings[0].dreamStars, 1, 'stars recounted'); assert.ok(!m.goalsDone.includes('nonsense'));
  sim.advance(m, T0 + HOUR); // still playable
});

// ---- building ---------------------------------------------------------------

test('build rules: afford, occupied, road, bounds, locked, unknown', () => {
  const s = gridGame(T0);
  assert.equal(sim.canBuild(s, 'tent', 3, 0).ok, false, 'road');
  assert.equal(sim.canBuild(s, 'tent', 0, 2).ok, false, 'road');
  assert.equal(sim.canBuild(s, 'tent', -1, 0).ok, false);
  assert.equal(sim.canBuild(s, 'tent', 11, 0).ok, false);
  assert.equal(sim.canBuild(s, 'tent', 0, 14).ok, false);
  assert.equal(sim.canBuild(s, 'tent', 0.5, 0).ok, false);
  assert.equal(sim.canBuild(s, 'castle', 0, 0).ok, false);
  const locked = sim.canBuild(s, 'cabin', 0, 0);
  assert.equal(locked.ok, false); assert.match(locked.reason, /4 residents/);
  assert.equal(sim.isUnlocked(s, 'cabin'), false); assert.equal(sim.isUnlocked(s, 'tent'), true);
  assert.deepEqual(sim.canBuild(s, 'tent', 0, 0), { ok: true, reason: '' });

  const log = record(() => {
    const r = sim.build(s, 'tent', 0, 0, T0);
    assert.ok(r.ok);
    assert.deepEqual(r.building, { id: r.building.id, type: 'tent', x: 0, y: 0, readyAt: T0 + BUILDINGS.tent.buildSecs * 1000, paid: BUILDINGS.tent.cost, level: 1 });
  });
  assert.ok(log.some((e) => e.type === 'built') && log.some((e) => e.type === 'spend' && e.amount === BUILDINGS.tent.cost));
  assert.equal(s.coins, 250 - BUILDINGS.tent.cost + goalCoins('tent'), 'cost paid, tent goal rewarded');
  assert.equal(sim.tileAt(s, 0, 0).type, 'tent'); assert.equal(sim.tileAt(s, 1, 0), null);
  const occ = sim.build(s, 'diner', 0, 0, T0);
  assert.equal(occ.ok, false); assert.equal(typeof occ.reason, 'string'); assert.ok(occ.reason.length > 5);

  const d = sim.build(s, 'diner', 1, 0, T0);
  assert.ok(d.ok);
  assert.equal(d.building.stock, BUILDINGS.diner.stockMax); assert.equal(d.building.dreamStars, 0);
  s.coins = BUILDINGS.well.cost - 1;
  const before = s.coins;
  const poor = sim.build(s, 'well', 2, 0, T0);
  assert.equal(poor.ok, false); assert.match(poor.reason, /more coins/); assert.equal(s.coins, before);
  assert.equal(s.buildings.length, 2);
  assert.equal(sim.buildingById(s, d.building.id), d.building); assert.equal(sim.buildingById(s, 999), null);
});

test('category draws check unlocks, use current prices, and reveal a fresh type', () => {
  const s = fresh();
  const seed = s.seed;
  assert.equal(sim.buildRandom(s, 'food', ...freeLot(s), T0).ok, false);
  assert.equal(sim.buildRandom(s, 'gov', ...freeLot(s), T0).ok, false);
  assert.equal(s.seed, seed, 'failed purchases do not use randomness');
  put(s, 'tent', T0);
  const types = new Set();
  for (let tier = 0; tier < 4; tier++) {
    const cost = sim.categoryCost(s, 'food');
    const { building } = sim.buildRandom(s, 'food', ...freeLot(s), T0);
    assert.ok(building);
    assert.equal(sim.catOf(building), 'food');
    assert.equal(building.tier, tier);
    assert.equal(building.paid, cost);
    assert.equal(building.stock, sim.stockMaxOf(building));
    assert.equal(types.has(building.type), false);
    assert.ok(config.QUALITY[building.q]);
    assert.ok(sim.buildingName(building).endsWith(BUILDINGS[building.type].name));
    types.add(building.type);
  }
  for (let i = 0; i < config.GOV.unlockAt; i++) person(s, put(s, 'tent', T0), T0);
  const gov = sim.buildRandom(s, 'gov', ...freeLot(s), T0);
  assert.ok(gov.ok && BUILDINGS[gov.building.type].gov);
  assert.equal(buildingSpriteId({ type: 'post', cat: 'retail' }), 'post@retail');
  assert.equal(buildingSpriteId({ type: 'post' }), 'post');
});

test('construction timing, opened event, hurry', () => {
  const s = fresh();
  assert.match(sim.build(s, 'diner', 0, 0, T0).reason, /home first/, 'a shop needs a home in town');
  put(s, 'tent', T0);
  const { building: diner } = sim.build(s, 'diner', 5, 0, T0);
  assert.equal(sim.isBuilt(diner, T0), false);
  assert.equal(sim.bizStatus(s, diner, T0), 'building');
  assert.equal(sim.capacity(s), 1);
  let log = record(() => {
    const r = sim.advance(s, T0 + BUILDINGS.diner.buildSecs * 1000 - 1000);
    assert.deepEqual(r.finished, []);
  });
  assert.ok(!log.some((e) => e.type === 'opened'));
  log = record(() => {
    const r = sim.advance(s, T0 + BUILDINGS.diner.buildSecs * 1000);
    assert.deepEqual(r.finished, [diner.id]);
  });
  assert.equal(log.filter((e) => e.type === 'opened').length, 1);
  const open = T0 + BUILDINGS.diner.buildSecs * 1000;
  assert.equal(sim.isBuilt(diner, open), true);
  assert.equal(sim.bizStatus(s, diner, open), 'needs-workers');
  assert.deepEqual(sim.advance(s, open + 10000).finished, [], 'opens only once');

  // hurry
  const now = open + 11000;
  const { building: well } = sim.build(s, 'well', 1, 0, now);
  s.gems = 1;
  log = record(() => assert.deepEqual(sim.hurry(s, well.id, now), { ok: true, reason: '' }));
  assert.equal(s.gems, 0); assert.equal(sim.isBuilt(well, now), true);
  assert.equal(log.filter((e) => e.type === 'opened').length, 1);
  assert.equal(sim.hurry(s, well.id, now).ok, false, 'already finished');
  log = record(() => assert.deepEqual(sim.advance(s, now + 5000).finished, []));
  assert.ok(!log.some((e) => e.type === 'opened'), 'not announced twice');
  const { building: farmless } = sim.build(s, 'market', 2, 0, now + 5000);
  const r = sim.hurry(s, farmless.id, now + 5000);
  assert.equal(r.ok, false); assert.match(r.reason, /gem/);
  assert.equal(sim.hurry(s, 12345, now).ok, false);
});

test('demolish: 75% refund, homes must be empty, workers become unemployed, safety net', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0);
  const diner = put(s, 'diner', T0);
  const t = person(s, tent, T0, { dream: 'diner' });
  assert.ok(sim.assignJob(s, t.id, diner.id, T0).ok);
  assert.equal(diner.dreamStars, 1);
  const no = sim.demolish(s, tent.id, T0);
  assert.equal(no.ok, false); assert.equal(no.refund, 0); assert.equal(s.buildings.length, 2);
  const before = s.coins;
  const refund = Math.floor(BUILDINGS.diner.cost * 0.75);
  const log = record(() => {
    const r = sim.demolish(s, diner.id, T0);
    assert.deepEqual(r, { ok: true, reason: '', refund });
  });
  assert.equal(s.coins, before + refund);
  assert.equal(t.jobId, null); assert.deepEqual(sim.unemployed(s), [t]);
  assert.ok(log.some((e) => e.type === 'demolished' && e.id === diner.id && e.x === diner.x && e.y === diner.y));
  assert.ok(log.some((e) => e.type === 'coins' && e.reason === 'refund' && e.amount === refund));
  assert.equal(sim.tileAt(s, diner.x, diner.y), null);
  assert.equal(sim.demolish(s, diner.id, T0).ok, false);
  // the dream gem is not paid twice after the business is rebuilt
  const diner2 = put(s, 'diner', T0);
  const gems = s.gems;
  assert.equal(sim.assignJob(s, t.id, diner2.id, T0).dream, true);
  assert.equal(s.gems, gems); assert.equal(diner2.dreamStars, 1);

  // safety net: an empty town can always start again
  const p = gridGame(T0);
  sim.build(p, 'well', 0, 0, T0); sim.build(p, 'tent', 1, 0, T0);
  p.coins = 0;
  for (const b of [...p.buildings]) sim.demolish(p, b.id, T0);
  assert.ok(p.coins >= BUILDINGS.tent.cost + BUILDINGS.diner.cost);
});

// ---- people and jobs --------------------------------------------------------

test('move-in, capacity, vacancies, fresh applicant, unlock events', () => {
  const s = fresh();
  const { building: tent } = sim.build(s, 'tent', 0, 0, T0);
  assert.equal(sim.moveIn(s, 0, tent.id, T0).ok, false, 'still being built');
  const now = T0 + BUILDINGS.tent.buildSecs * 1000;
  sim.advance(s, now);
  assert.equal(sim.capacity(s), 1); assert.equal(sim.vacancies(s), 1);
  assert.deepEqual(sim.homesWithVacancy(s, now), [tent]);
  const chosen = s.applicants[1];
  const others = [s.applicants[0], s.applicants[2]];
  const r = sim.moveIn(s, 1, tent.id, now);
  assert.ok(r.ok); assert.equal(r.tenant, chosen); assert.equal(chosen.homeId, tent.id); assert.equal(chosen.jobId, null);
  assert.equal(s.applicants.length, 3);
  assert.equal(s.applicants[0], others[0]); assert.equal(s.applicants[2], others[1]);
  assert.notEqual(s.applicants[1].id, chosen.id);
  assert.equal(sim.population(s), 1); assert.equal(sim.vacancies(s), 0);
  assert.deepEqual(sim.homesWithVacancy(s, now), []);
  assert.deepEqual(sim.residentsOf(s, tent.id), [chosen]);
  assert.equal(sim.tenantById(s, chosen.id), chosen);
  const full = sim.moveIn(s, 0, tent.id, now);
  assert.equal(full.ok, false); assert.match(full.reason, /full/);
  assert.equal(sim.moveIn(s, 7, tent.id, now).ok, false);
  const diner = put(s, 'diner', now);
  assert.equal(sim.moveIn(s, 0, diner.id, now).ok, false, 'not a home');
  assert.equal(sim.population(s), 1);

  // unlocks by population
  const tent2 = put(s, 'tent', now);
  const unlocked = [];
  const onUnlock = (p) => unlocked.push(p.type);
  sim.events.on('unlock', onUnlock);
  sim.moveIn(s, 0, tent2.id, now);
  sim.events.off('unlock', onUnlock);
  const tent3 = put(s, 'tent', now);
  sim.events.on('unlock', onUnlock);
  sim.moveIn(s, 0, tent3.id, now);
  sim.events.off('unlock', onUnlock);
  assert.equal(sim.population(s), BUILDINGS.farm.unlockAt);
  assert.ok(sim.isUnlocked(s, 'farm')); assert.ok(!sim.isUnlocked(s, 'cabin')); assert.ok(!sim.isUnlocked(s, 'studio'));
  assert.ok(sim.categoryUnlocked(s, 'farming')); assert.ok(!sim.categoryUnlocked(s, 'creative')); assert.ok(!sim.categoryUnlocked(s, 'gov'));
  assert.deepEqual(unlocked, [undefined], 'the Farming category opened, not one building');
  assert.ok(sim.canBuild(s, 'farm', 4, 4).ok);
  const cabin = put(s, 'cabin', now);
  assert.equal(sim.capacity(s), 5);
  sim.moveIn(s, 0, cabin.id, now); sim.moveIn(s, 0, cabin.id, now);
  assert.equal(sim.moveIn(s, 0, cabin.id, now).ok, false);
  assert.equal(sim.population(s), 5); assert.ok(sim.isUnlocked(s, 'cabin'));
});

test('jobs: slots, moving between jobs, dream gem once, dreamStars bookkeeping', () => {
  const s = fresh();
  const homes = [put(s, 'tent', T0), put(s, 'tent', T0), put(s, 'tent', T0)];
  const diner = put(s, 'diner', T0);
  const market = put(s, 'market', T0);
  const a = person(s, homes[0], T0, { dream: 'diner' });
  const b = person(s, homes[1], T0, { dream: 'market' });
  const c = person(s, homes[2], T0, { dream: 'music' });
  assert.equal(sim.unemployed(s).length, 3);
  assert.deepEqual(sim.jobFit(s, a, diner), { skill: 6, dream: true, open: true });

  const gems = s.gems;
  let log = record(() => assert.deepEqual(sim.assignJob(s, a.id, diner.id, T0), { ok: true, reason: '', dream: true, firstDream: true }));
  assert.equal(s.gems, gems + 1 + 1, 'dream gem + the dream goal gem');
  assert.equal(log.filter((e) => e.type === 'gem').length, 2);
  assert.ok(log.some((e) => e.type === 'job' && e.tenant === a && e.building === diner && e.dream === true));
  assert.equal(s.stats.dreamJobs, 1); assert.equal(diner.dreamStars, 1); assert.equal(a.jobId, diner.id);
  assert.deepEqual(sim.workersOf(s, diner.id), [a]);

  assert.equal(sim.assignJob(s, b.id, diner.id, T0).dream, false);
  assert.equal(diner.dreamStars, 1);
  const fullR = sim.assignJob(s, c.id, diner.id, T0);
  assert.equal(fullR.ok, false); assert.equal(fullR.dream, false); assert.equal(c.jobId, null);
  assert.equal(sim.jobFit(s, c, diner).open, false);
  assert.equal(sim.jobFit(s, a, diner).open, true, 'your own job counts as open');

  // dream worker leaves: star goes away; comes back: star returns but no second gem
  const g2 = s.gems;
  assert.ok(sim.assignJob(s, a.id, market.id, T0).ok);
  assert.equal(diner.dreamStars, 0); assert.equal(market.dreamStars, 0); assert.equal(a.jobId, market.id);
  assert.equal(sim.workersOf(s, diner.id).length, 1);
  assert.equal(sim.assignJob(s, a.id, null, T0).ok, true); assert.equal(a.jobId, null);
  const back = sim.assignJob(s, a.id, diner.id, T0);
  assert.equal(back.dream, true); assert.equal(back.firstDream, false);
  assert.equal(diner.dreamStars, 1); assert.equal(s.gems, g2); assert.equal(s.stats.dreamJobs, 1);
  assert.equal(sim.assignJob(s, a.id, diner.id, T0).ok, true, 'same job again is fine');
  assert.equal(diner.dreamStars, 1);

  // a second tenant's own first dream job does pay
  assert.equal(sim.assignJob(s, b.id, market.id, T0).dream, true);
  assert.equal(s.gems, g2 + 1); assert.equal(market.dreamStars, 1);

  assert.equal(sim.assignJob(s, 999, diner.id, T0).ok, false);
  assert.equal(sim.assignJob(s, c.id, homes[0].id, T0).ok, false, 'homes are not jobs');
  const { building: site } = sim.build(s, 'well', 9, 13, T0);
  assert.equal(sim.assignJob(s, c.id, site.id, T0).ok, false, 'not open yet');
});

test('bestJobs: better jobs only, open first, dream before skill', () => {
  const s = fresh();
  const homes = [put(s, 'cabin', T0), put(s, 'cabin', T0)];
  const diner = put(s, 'diner', T0); const market = put(s, 'market', T0); const well = put(s, 'well', T0);
  const a = person(s, homes[0], T0, { dream: 'well' });
  a.skills.food = 2; a.skills.retail = 8; a.skills.service = 1;
  let best = sim.bestJobs(s, a.id, T0);
  assert.deepEqual(best.map((j) => j.building.id), [well.id, market.id, diner.id]);
  assert.deepEqual(best[0], { building: well, skill: 1, dream: true, open: true });
  sim.assignJob(s, a.id, diner.id, T0);
  assert.deepEqual(sim.bestJobs(s, a.id, T0).map((j) => j.building.id), [well.id, market.id]);
  sim.assignJob(s, a.id, market.id, T0);
  assert.deepEqual(sim.bestJobs(s, a.id, T0).map((j) => j.building.id), [well.id]);
  // fill the well: still listed (not open), but open jobs sort first
  const b = person(s, homes[0], T0); const c = person(s, homes[1], T0);
  sim.assignJob(s, b.id, well.id, T0); sim.assignJob(s, c.id, well.id, T0);
  sim.assignJob(s, a.id, diner.id, T0);
  best = sim.bestJobs(s, a.id, T0);
  assert.deepEqual(best.map((j) => [j.building.id, j.open]), [[market.id, true], [well.id, false]]);
  sim.assignJob(s, c.id, null, T0); sim.assignJob(s, a.id, well.id, T0);
  assert.deepEqual(sim.bestJobs(s, a.id, T0), [], 'nothing beats a dream job');
  assert.deepEqual(sim.bestJobs(s, 999, T0), []);
});

// ---- income -----------------------------------------------------------------

test('rate formula: baseRate * staff * skill * dream', () => {
  const s = fresh();
  const cabin = put(s, 'cabin', T0);
  const diner = put(s, 'diner', T0);
  const base = BUILDINGS.diner.baseRate;
  assert.equal(sim.ratePerMin(s, diner), 0, 'unstaffed');
  assert.equal(sim.ratePerMin(s, cabin), 0, 'homes earn no sales');
  const a = person(s, cabin, T0, { skill: 6 });
  const b = person(s, cabin, T0, { skill: 3, dream: 'diner' });
  sim.assignJob(s, a.id, diner.id, T0);
  assert.ok(Math.abs(sim.ratePerMin(s, diner) - base * TUNING.staffFactor[1] * (1 + 6 / TUNING.skillAvgDivisor) * 1) < 1e-9);
  sim.assignJob(s, b.id, diner.id, T0);
  assert.ok(Math.abs(sim.ratePerMin(s, diner) - base * TUNING.staffFactor[2] * (1 + 4.5 / TUNING.skillAvgDivisor) * (1 + TUNING.dreamBonus)) < 1e-9);
  assert.ok(Math.abs(sim.townRatePerMin(s, T0) - sim.ratePerMin(s, diner)) < 1e-9);
  assert.equal(sim.bizStatus(s, diner, T0), 'open');
  diner.stock = 0;
  assert.equal(sim.ratePerMin(s, diner), 0, 'out of stock');
  assert.equal(sim.townRatePerMin(s, T0), 0);
  assert.equal(sim.bizStatus(s, diner, T0), 'out-of-stock');
  const { building: site } = sim.build(s, 'market', 9, 13, T0);
  assert.equal(sim.ratePerMin(s, site), 0, 'unbuilt');
  assert.equal(sim.rentPerDay(s), 2 * BUILDINGS.cabin.rentPerTenant);
});

test('sales deplete stock, pay coins, and stop at zero', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0);
  const diner = put(s, 'diner', T0);
  const a = person(s, tent, T0, { skill: 9 });
  sim.assignJob(s, a.id, diner.id, T0);
  allGoalsDone(s);
  const max = BUILDINGS.diner.stockMax;
  const perMin = BUILDINGS.diner.baseRate * TUNING.staffFactor[1] * (1 + 9 / TUNING.skillAvgDivisor);
  const sold100 = Math.floor(perMin * 100 + 1e-9);
  const coins0 = s.coins;
  let log = record(() => {
    const r = sim.advance(s, T0 + 100 * MIN);
    assert.equal(r.coinsEarned, sold100); assert.deepEqual(r.ranOut, []);
  });
  assert.equal(diner.stock, max - sold100); assert.equal(s.coins, coins0 + sold100 + s.stats.rentCollected); assert.ok(Number.isInteger(s.coins));
  assert.deepEqual(log.filter((e) => e.type === 'coins' && e.reason === 'sales'), [{ type: 'coins', amount: sold100, buildingId: diner.id, reason: 'sales' }]);

  // many tiny live ticks add up to the same thing (no coins lost to rounding)
  const s2 = JSON.parse(JSON.stringify(s));
  for (let i = 1; i <= 600; i++) sim.advance(s2, T0 + 100 * MIN + i * 1000);
  sim.advance(s, T0 + 110 * MIN);
  assert.equal(s2.coins, s.coins); assert.equal(s2.buildings[1].stock, diner.stock);
  assert.ok(Number.isInteger(s2.coins) && Number.isInteger(s2.buildings[1].stock));

  log = record(() => {
    const r = sim.advance(s, T0 + 10 * HOUR);
    assert.deepEqual(r.ranOut, [diner.id]);
  });
  assert.equal(diner.stock, 0); assert.equal(diner.stock + (s.coins - coins0 - s.stats.rentCollected), max, 'coins + stock is conserved');
  assert.equal(log.filter((e) => e.type === 'outOfStock').length, 1);
  assert.equal(sim.bizStatus(s, diner, T0 + 10 * HOUR), 'out-of-stock');
  const r = sim.advance(s, T0 + 20 * HOUR);
  assert.equal(r.coinsEarned, 0); assert.deepEqual(r.ranOut, []); assert.equal(diner.stock, 0);
  assert.equal(s.stats.rentCollected, Math.floor((BUILDINGS.tent.rentPerTenant + sim.rentBonusPerDay(s, T0)) * 20 / 24 + 1e-6), '20 hours of rent');
  assert.equal(s.stats.earned, max + s.stats.rentCollected + goalCoins('tent') + goalCoins('movein') + goalCoins('diner') + goalCoins('hire'));
});

test('a dream-job worker restocks for free', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0);
  const diner = put(s, 'diner', T0);
  const a = person(s, tent, T0, { skill: 9, dream: 'diner' });
  sim.assignJob(s, a.id, diner.id, T0);
  assert.ok(s.goalsDone.includes('restock'), 'a dream worker satisfies the tutorial without a paid refill');
  allGoalsDone(s);
  const coins0 = s.coins;
  const log = record(() => {
    const r = sim.advance(s, T0 + 12 * HOUR - 1000);
    assert.deepEqual(r.ranOut, []);
    assert.ok(r.coinsEarned > BUILDINGS.diner.stockMax, 'kept selling past one full stock');
    assert.equal(s.coins, coins0 + r.coinsEarned + r.rentPaid, 'restocking cost nothing');
  });
  assert.ok(diner.stock > 0);
  assert.equal(log.filter((e) => e.type === 'outOfStock').length, 0);
  assert.deepEqual(log.filter((e) => e.type === 'restocked').map((e) => [e.building.id, e.auto]), [[diner.id, true]]);
});

test('restock: pro-rated cost, already full, and never blocks a poor player', () => {
  const s = fresh();
  const diner = put(s, 'diner', T0);
  allGoalsDone(s);
  const { stockMax, restockCost } = BUILDINGS.diner;
  const full = sim.restock(s, diner.id, T0);
  assert.equal(full.ok, false); assert.equal(full.cost, 0); assert.match(full.reason, /full/);

  diner.stock = 0; s.coins = 1000;
  let log = record(() => assert.deepEqual(sim.restock(s, diner.id, T0), { ok: true, reason: '', cost: restockCost, partial: false }));
  assert.equal(diner.stock, stockMax); assert.equal(s.coins, 1000 - restockCost); assert.equal(s.stats.restocks, 1);
  assert.ok(log.some((e) => e.type === 'restocked' && e.auto === false && e.building === diner));
  assert.ok(log.some((e) => e.type === 'spend' && e.amount === restockCost && e.reason === 'restock'));

  diner.stock = stockMax / 2;
  assert.equal(sim.restock(s, diner.id, T0).cost, Math.round(restockCost / 2));
  assert.equal(diner.stock, stockMax);

  // broke: free top-up of at least 25%
  diner.stock = 0; s.coins = 0;
  let r = sim.restock(s, diner.id, T0);
  assert.equal(r.ok, true); assert.equal(r.cost, 0); assert.equal(r.partial, true);
  assert.ok(diner.stock >= stockMax * 0.25 && diner.stock < stockMax); assert.equal(s.coins, 0);
  // some coins: pays what they have, gets what that buys
  diner.stock = 0; s.coins = Math.floor(restockCost * 0.6);
  r = sim.restock(s, diner.id, T0);
  assert.equal(r.ok, true); assert.equal(r.cost, Math.floor(restockCost * 0.6)); assert.equal(s.coins, 0);
  assert.ok(Math.abs(diner.stock - stockMax * 0.6) <= stockMax * 0.02);
  // nearly full and broke: just fills up
  diner.stock = stockMax - 20; s.coins = 0;
  r = sim.restock(s, diner.id, T0);
  assert.equal(r.ok, true); assert.equal(diner.stock, stockMax); assert.ok(s.coins >= 0);

  assert.equal(sim.restock(s, 999, T0).ok, false);
  const tent = put(s, 'tent', T0);
  assert.equal(sim.restock(s, tent.id, T0).ok, false);
});

test('batch restock covers previously empty shops and charges the current tier price', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0);
  const diner = put(s, 'diner', T0);
  const bakery = put(s, 'bakery', T0);
  const market = put(s, 'market', T0);
  const worker = person(s, tent, T0, { dream: 'diner' });
  sim.assignJob(s, worker.id, diner.id, T0);
  allGoalsDone(s);
  diner.stock = bakery.stock = 0;
  const summary = sim.advance(s, T0 + HOUR, { live: false });
  assert.deepEqual(summary.ranOut, [], 'the bakery was already empty');
  assert.ok(diner.stock > 0, 'a dream worker restarts an empty shop');
  assert.deepEqual(sim.soldOutShops(s, s.lastTick), [bakery]);
  const before = s.coins;
  assert.equal(sim.restockAll(s, s.lastTick).count, 1);
  assert.equal(bakery.stock, sim.stockMaxOf(bakery));
  assert.equal(before - s.coins, Math.round(sim.statsOf(bakery).restockCost * TUNING.staffFactor[BUILDINGS.bakery.slots] / TUNING.staffFactor[2]));
  assert.equal(market.stock, sim.stockMaxOf(market));
  assert.equal(sim.restockAll(s, s.lastTick).count, 0);
});

// ---- offline ----------------------------------------------------------------

function smallTown() {
  const s = fresh();
  const homes = [put(s, 'tent', T0), put(s, 'cabin', T0)];
  const diner = put(s, 'diner', T0); const market = put(s, 'market', T0);
  const a = person(s, homes[0], T0); const b = person(s, homes[1], T0); const c = person(s, homes[1], T0);
  sim.assignJob(s, a.id, diner.id, T0); sim.assignJob(s, b.id, diner.id, T0); sim.assignJob(s, c.id, market.id, T0);
  return { s, diner, market };
}

test('offline recipes, lessons, ads, refills and hourly rent agree with short ticks', () => {
  const s = fresh();
  const home = put(s, 'cabin', T0);
  const diner = put(s, 'diner', T0);
  const farm = put(s, 'farm', T0);
  const school = put(s, 'school', T0);
  const tree = put(s, 'tree', T0);
  const later = put(s, 'tree', T0);
  Object.assign(tree, { x: home.x, y: home.y + 1 });
  Object.assign(later, { x: home.x + 1, y: home.y + 1 });
  sim.assignJob(s, person(s, home, T0, { skill: 3, dream: 'diner' }).id, diner.id, T0);
  sim.assignJob(s, person(s, home, T0, { skill: 5, dream: 'farm' }).id, farm.id, T0);
  allGoalsDone(s);
  const midnight = new Date(2026, 5, 16).getTime();
  const start = midnight - 30 * MIN - 17500;
  s.lastTick = start;
  s.lastRentHour = Math.floor(start / HOUR);
  s.nextLessonAt = start + 15000;
  s.nextApplicantAt = start + 43000;
  s.adUntil = start + 79513;
  s.crops.veggies = 29.83;
  diner.stock = 1;
  tree.readyAt = midnight - 13000;
  later.readyAt = midnight + 10000;
  school.readyAt = start - 1;
  const stop = start + 4 * HOUR;
  const chunked = structuredClone(s);
  const offline = sim.advance(s, stop, { live: false });
  let sales = 0;
  let rent = 0;
  while (chunked.lastTick < stop) {
    const tick = sim.advance(chunked, Math.min(chunked.lastTick + 18503, stop), { live: false });
    sales += tick.coinsEarned;
    rent += tick.rentPaid;
  }
  assert.ok(offline.recipes.includes('salad'));
  assert.ok(offline.lessons > 0);
  assert.equal(offline.coinsEarned, sales);
  assert.equal(offline.rentPaid, rent);
  assert.ok(rent > 0);
  assert.equal(offline.rentHours, 4);
  assert.ok(sim.rentPerDay(s, midnight) < sim.rentPerDay(s, stop), 'the later tree opened after that hour');
  assert.deepEqual(s.stats, chunked.stats);
  assert.deepEqual(s.tenants, chunked.tenants);
  assert.equal(diner.stock, sim.buildingById(chunked, diner.id).stock);
});

test('three days offline: sane totals, exactly 72 hours of rent, fast', () => {
  const { s, diner, market } = smallTown();
  const rent = BUILDINGS.tent.rentPerTenant + 2 * BUILDINGS.cabin.rentPerTenant;
  assert.equal(sim.rentPerDay(s), rent);
  const nightly = rent + sim.rentBonusPerDay(s, T0);   // a happy town pays extra
  const coins0 = s.coins; const earned0 = s.stats.earned;
  const firstApplicants = s.applicants.map((a) => a.id);
  let res;
  const t = performance.now();
  const log = record(() => { res = sim.advance(s, T0 + 3 * DAY, { live: false }); });
  const ms = performance.now() - t;
  assert.ok(ms < 300, `took ${ms.toFixed(1)} ms`);
  assert.equal(res.elapsedMs, 3 * DAY);
  assert.equal(res.rentHours, 72); assert.equal(res.rentPaid, 3 * nightly);
  assert.equal(res.coinsEarned, sim.stockMaxOf(diner) + sim.stockMaxOf(market), 'each shop sold exactly one full stock');
  assert.deepEqual([...res.ranOut].sort(), [diner.id, market.id].sort());
  assert.equal(s.coins, coins0 + res.coinsEarned + res.rentPaid);
  assert.equal(s.stats.earned, earned0 + res.coinsEarned + res.rentPaid);
  assert.equal(s.stats.rentCollected, 3 * nightly);
  assert.equal(s.lastTick, T0 + 3 * DAY); assert.equal(s.lastRentHour, Math.floor((T0 + 3 * DAY) / HOUR));
  assert.deepEqual(log.filter((e) => e.type === 'rent'), [{ type: 'rent', amount: 3 * nightly, hours: 72, bonus: 3 * (nightly - rent) }]);
  assert.equal(log.filter((e) => e.type === 'coins' && e.reason === 'rent').length, 1);
  assert.equal(log.filter((e) => e.type === 'coins' && e.reason === 'sales').length, 2, 'one sales event per business');
  assert.equal(log.filter((e) => e.type === 'rideRequest').length, 0); assert.equal(s.ride, null);
  assert.equal(s.applicants.length, 3);
  assert.ok(s.applicants.every((a) => !firstApplicants.includes(a.id)), 'applicants refreshed');
  assert.ok(s.nextApplicantAt > s.lastTick);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  // nothing more happens inside the same hour
  const again = sim.advance(s, T0 + 3 * DAY + 10 * MIN, { live: false });
  assert.equal(again.rentPaid, 0); assert.equal(again.rentHours, 0);
});

test('rent is paid at the top of every hour, once, and a day of it adds up exactly', () => {
  const { s } = smallTown();
  const rent = sim.rentPerDay(s) + sim.rentBonusPerDay(s, T0);
  const top = (Math.floor(T0 / HOUR) + 1) * HOUR;
  assert.equal(sim.advance(s, top - 1000).rentPaid, 0);
  const r = sim.advance(s, top + 1000);
  assert.equal(r.rentPaid, Math.floor(rent / 24 + 1e-6)); assert.equal(r.rentHours, 1); assert.equal(s.lastRentHour, top / HOUR);
  assert.equal(sim.advance(s, top + 5000).rentPaid, 0);
  let day = r.rentPaid;
  for (let h = 1; h < 24; h++) day += sim.advance(s, top + h * HOUR + 1000).rentPaid;
  assert.equal(day, rent, 'fractions carry over, so 24 hours pay one full day');
  // an empty town crossing midnight pays nothing and emits no rent event
  const e = gridGame(T0);
  const log = record(() => assert.equal(sim.advance(e, T0 + DAY, { live: false }).rentPaid, 0));
  assert.equal(log.filter((x) => x.type === 'rent').length, 0); assert.equal(e.lastRentHour, Math.floor((T0 + DAY) / HOUR));
});

test('offline time is capped at 14 days; clock going backwards is harmless', () => {
  const { s } = smallTown();
  const rent = sim.rentPerDay(s) + sim.rentBonusPerDay(s, T0);
  const t = performance.now();
  const res = sim.advance(s, T0 + 40 * DAY, { live: false });
  assert.ok(performance.now() - t < 1000);
  assert.equal(res.elapsedMs, 14 * DAY);
  assert.equal(res.rentHours, 14 * 24); assert.equal(res.rentPaid, 14 * rent);
  assert.equal(s.lastTick, T0 + 40 * DAY);
  const coins = s.coins;
  const back = sim.advance(s, T0 + 39 * DAY);
  assert.equal(back.elapsedMs, 0); assert.equal(back.rentPaid, 0); assert.equal(s.coins, coins);
});

test('applicants: the oldest is replaced about every 4 minutes', () => {
  const s = gridGame(T0);
  const [a, b, c] = s.applicants;
  sim.advance(s, T0 + 3 * MIN);
  assert.deepEqual(s.applicants, [a, b, c]);
  sim.advance(s, T0 + 4 * MIN);
  assert.equal(s.applicants.length, 3);
  assert.equal(s.applicants[0], b); assert.equal(s.applicants[1], c); assert.notEqual(s.applicants[2].id, a.id);
  sim.advance(s, T0 + 8 * MIN);
  assert.equal(s.applicants[0], c);
});

// ---- rides ------------------------------------------------------------------

function rideTown() {
  const { s, diner, market } = smallTown();
  s.nextRideAt = T0 + 1000;
  return { s, diner, market };
}

test('rides: need 2 buildings and a tenant; never created when live=false', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0);
  person(s, tent, T0);
  sim.advance(s, T0 + 10 * MIN);
  assert.equal(s.ride, null, 'only 1 building');
  put(s, 'market', T0 + 10 * MIN);
  sim.advance(s, T0 + 11 * MIN, { live: false });
  assert.equal(s.ride, null, 'not live');
  const log = record(() => sim.advance(s, T0 + 11 * MIN + 1000));
  assert.ok(s.ride);
  assert.equal(log.filter((e) => e.type === 'rideRequest').length, 1);
  assert.equal(s.ride.state, 'waiting'); assert.equal(s.ride.fromId, tent.id); assert.notEqual(s.ride.toId, tent.id);
  assert.equal(s.ride.tries, 0); assert.equal(s.ride.requestedAt, T0 + 11 * MIN + 1000);
  const first = s.ride;
  sim.advance(s, T0 + 11 * MIN + 2000);
  assert.equal(s.ride, first, 'at most one at a time');

  const empty = fresh();
  put(empty, 'diner', T0); put(empty, 'market', T0); put(empty, 'well', T0);
  sim.advance(empty, T0 + 10 * MIN);
  assert.equal(empty.ride, null, 'no tenants');
});

test('ride lifecycle: accept, wrong picks, tip timing, fare paid on completion', () => {
  const { s } = rideTown();
  assert.equal(sim.acceptRide(s, T0).ok, false);
  assert.equal(sim.chooseDestination(s, 1, T0).ok, false);
  assert.equal(sim.completeRide(s, T0).ok, false);
  sim.advance(s, T0 + 2000);
  const ride = s.ride;
  assert.ok(ride);
  assert.equal(sim.chooseDestination(s, ride.toId, T0 + 2000).ok, false, 'must accept first');
  const t1 = T0 + 5000;
  const acc = sim.acceptRide(s, t1);
  assert.ok(acc.ok); assert.equal(acc.tenant.id, ride.tenantId); assert.equal(acc.destination.id, ride.toId);
  assert.equal(ride.state, 'choosing'); assert.equal(ride.acceptedAt, t1);
  const far = 1 + TUNING.rideDistanceBonus * sim.rideDistance(s, ride);
  assert.ok(far > 1, 'longer trips pay more');
  const base = Math.max(15, sim.townRatePerMin(s, t1) * 8) * far;

  // tip table (fresh copies of the state so each case is independent)
  const fareAt = (delayMs, wrong) => {
    const c = JSON.parse(JSON.stringify(s));
    const want = c.buildings.find((b) => b.id === c.ride.toId);
    const wrongId = c.buildings.find((b) => b.id !== c.ride.toId && b.type !== want.type).id;
    for (let i = 0; i < wrong; i++) {
      assert.deepEqual(sim.chooseDestination(c, wrongId, t1 + 100), { ok: true, reason: '', correct: false, fare: 0 });
    }
    assert.equal(c.ride.tries, wrong); assert.equal(c.ride.state, 'choosing');
    const r = sim.chooseDestination(c, c.ride.toId, t1 + delayMs);
    assert.equal(r.correct, true); assert.equal(c.ride.state, 'driving'); assert.equal(c.ride.fare, r.fare);
    return r.fare;
  };
  assert.equal(fareAt(1000, 0), Math.round(base * 2.0));
  assert.equal(fareAt(3000, 0), Math.round(base * 2.0));
  assert.equal(fareAt(6500, 0), Math.round(base * 1.5));
  assert.equal(fareAt(10000, 0), Math.round(base * 1.0));
  assert.equal(fareAt(60000, 0), Math.round(base * 1.0));
  assert.equal(fareAt(1000, 1), Math.round(base * 1.8));
  assert.equal(fareAt(1000, 2), Math.round(base * 1.6));
  assert.equal(fareAt(1000, 9), Math.round(base * 1.0), 'tip never drops below 1.0');
  assert.equal(fareAt(9000, 3), Math.round(base * 1.0));
  assert.ok(fareAt(60000, 9) >= 15);

  // an accepted ride does not expire while live
  sim.advance(s, t1 + 200000);
  assert.equal(s.ride, ride);
  const t2 = t1 + 201000;
  const coins = s.coins;
  let log = record(() => {
    const r = sim.chooseDestination(s, ride.toId, t2);
    assert.ok(r.ok && r.correct); assert.equal(r.fare, Math.round(Math.max(15, sim.townRatePerMin(s, t2) * 8) * far));
  });
  assert.deepEqual(log.filter((e) => e.type === 'rideStart').map((e) => e.fare), [ride.fare]);
  assert.equal(s.coins, coins, 'not paid until the car arrives');
  assert.equal(sim.chooseDestination(s, ride.toId, t2).ok, false);
  log = record(() => assert.deepEqual(sim.completeRide(s, t2 + 3000), { ok: true, reason: '', fare: ride.fare }));
  assert.equal(s.coins, coins + ride.fare + goalCoins('ride'), 'fare + ride goal'); assert.equal(s.ride, null); assert.equal(s.stats.rides, 1);
  assert.ok(log.some((e) => e.type === 'coins' && e.reason === 'ride' && e.amount === ride.fare));
  assert.ok(log.some((e) => e.type === 'rideDone' && e.fare === ride.fare));
  const gap = s.nextRideAt - (t2 + 3000);
  assert.ok(gap >= 40000 && gap <= 80000, `next ride in ${gap} ms`);
  sim.advance(s, t2 + 3000 + 39000);
  assert.equal(s.ride, null);
  sim.advance(s, t2 + 3000 + 80000);
  assert.ok(s.ride, 'a new request arrives 40-80 s later');
});

test('packages survive reopening and pay once, or can be skipped for free', () => {
  const { s } = rideTown();
  for (let i = s.tenants.length; i < TUNING.deliveryUnlockPop; i++) person(s, put(s, 'tent', T0), T0);
  s.stats.rides = 1;
  allGoalsDone(s);
  for (let i = 0; i < 50; i++) {
    sim.advance(s, s.nextRideAt);
    if (s.ride?.kind === 'delivery') break;
    sim.advance(s, s.lastTick + 1, { live: false });
  }
  assert.equal(s.ride?.kind, 'delivery');
  const now = s.lastTick;
  const { destination } = sim.acceptRide(s, now);
  assert.equal(destination.id, sim.tenantById(s, s.ride.tenantId).homeId);
  const fare = s.ride.fare;
  const restored = S.importSave(S.exportSave(s));
  sim.advance(restored, now + HOUR, { live: false });
  assert.equal(restored.ride?.state, 'choosing');
  assert.equal(sim.chooseDestination(restored, s.ride.fromId, now + HOUR).correct, false);
  assert.equal(sim.chooseDestination(restored, destination.id, now + HOUR).fare, fare);
  assert.equal(sim.skipDelivery(restored, now + HOUR).ok, false);
  const before = restored.coins;
  sim.advance(restored, now + HOUR, { live: false });
  assert.equal(restored.coins, before + fare);
  assert.equal(restored.stats.rides, 1);
  assert.equal(sim.completeRide(restored, now + HOUR).ok, false);
  assert.ok(sim.skipDelivery(s, now).ok);
  assert.equal(s.ride, null);
});

test('an ignored ride quietly disappears after 90 s; leftovers are tidied when returning', () => {
  const { s } = rideTown();
  sim.advance(s, T0 + 2000);
  assert.ok(s.ride);
  const coins = s.coins;
  let log = record(() => sim.advance(s, T0 + 2000 + 89000));
  assert.ok(s.ride); assert.equal(log.filter((e) => e.type === 'rideGone').length, 0);
  log = record(() => sim.advance(s, T0 + 2000 + 90000));
  assert.equal(s.ride, null); assert.equal(log.filter((e) => e.type === 'rideGone').length, 1);
  assert.ok(s.coins >= coins, 'no penalty');
  assert.ok(s.nextRideAt >= T0 + 92000 + 40000);

  // a ride that was already driving when the app closed still pays
  let now = s.nextRideAt;
  sim.advance(s, now);
  sim.acceptRide(s, now);
  const { fare } = sim.chooseDestination(s, s.ride.toId, now);
  const before = s.coins;
  const res = sim.advance(s, now + HOUR, { live: false });
  assert.equal(s.ride, null); assert.equal(s.coins, before + res.coinsEarned + res.rentPaid + fare + goalCoins('ride'));

  // demolishing the destination cancels the request without fuss
  now = s.nextRideAt + HOUR;
  sim.advance(s, now);
  assert.ok(s.ride);
  const to = sim.buildingById(s, s.ride.toId);
  if (BUILDINGS[to.type].kind === 'home') for (const t of [...s.tenants]) if (t.homeId === to.id) s.tenants.splice(s.tenants.indexOf(t), 1);
  assert.ok(sim.demolish(s, to.id, now).ok);
  assert.equal(s.ride, null);
});

// ---- goals ------------------------------------------------------------------

test('goals: complete automatically, pay once, in any order; nextGoal walks the list', () => {
  const s = gridGame(T0);
  assert.equal(sim.nextGoal(s), GOALS[0]);
  let log = record(() => sim.build(s, 'tent', 0, 0, T0));
  assert.deepEqual(s.goalsDone, ['tent']);
  assert.deepEqual(log.filter((e) => e.type === 'goal').map((e) => e.goal.id), ['tent']);
  assert.ok(log.some((e) => e.type === 'coins' && e.reason === 'goal' && e.amount === GOALS[0].reward.coins));
  assert.equal(s.coins, 250 - BUILDINGS.tent.cost + goalCoins('tent'));
  assert.equal(sim.nextGoal(s).id, GOALS[1].id);
  log = record(() => { sim.build(s, 'tent', 1, 0, T0); sim.advance(s, T0 + 10000); sim.advance(s, T0 + 20000); });
  assert.equal(log.filter((e) => e.type === 'goal').length, 0, 'paid only once');
  assert.equal(s.coins, 250 - BUILDINGS.tent.cost - Math.round(BUILDINGS.tent.cost * TUNING.copyCostGrowth) + goalCoins('tent'));

  // out of order: diner before moving anyone in
  s.coins += 500;
  assert.ok(sim.build(s, 'diner', 2, 0, T0 + 20000).ok);
  assert.deepEqual(s.goalsDone, ['tent', 'diner']);
  assert.equal(sim.nextGoal(s).id, 'movein');
  sim.advance(s, T0 + 5 * MIN);
  const tent = sim.tileAt(s, 0, 0);
  const tenant = sim.moveIn(s, 0, tent.id, T0 + 5 * MIN).tenant;
  tenant.dream = 'music';
  sim.assignJob(s, tenant.id, sim.tileAt(s, 2, 0).id, T0 + 5 * MIN);
  assert.deepEqual(s.goalsDone, ['tent', 'diner', 'movein', 'hire']);
  sim.advance(s, T0 + 20 * MIN);
  const gems = s.gems;
  assert.ok(sim.restock(s, sim.tileAt(s, 2, 0).id, T0 + 20 * MIN).ok);
  assert.ok(s.goalsDone.includes('restock'));
  assert.equal(s.gems, gems);
  assert.equal(sim.nextGoal(s).id, 'ride');
});

test('goals: population, businesses and every-category milestones all pay out', () => {
  const s = fresh();
  s.gems = 0;
  const log = record(() => {
    for (let i = 0; i < 4; i++) put(s, 'apartment', T0);
    const homes = s.buildings.slice();
    for (let i = 0; i < 16; i++) assert.ok(sim.moveIn(s, 0, homes[i >> 2].id, T0).ok);
    for (const type of ['diner', 'market', 'well', 'farm', 'studio']) put(s, type, T0);
    sim.advance(s, T0 + 1000);
  });
  for (const id of ['pop4', 'pop10', 'pop16', 'biz5', 'allcats']) assert.ok(s.goalsDone.includes(id), id);
  const gemTotal = log.filter((e) => e.type === 'gem').reduce((n, e) => n + e.amount, 0);
  assert.equal(s.gems, gemTotal);
  assert.equal(new Set(s.goalsDone).size, s.goalsDone.length);
  assert.ok(Object.keys(BUILDINGS).every((t) => sim.isUnlocked(s, t) === (BUILDINGS[t].unlockAt <= 16)), 'unlocks follow population');
  // complete the rest and make sure nextGoal ends at null
  s.goalsDone = GOALS.map((g) => g.id);
  assert.equal(sim.nextGoal(s), null);
});

// ---- events -----------------------------------------------------------------

test('events: on / off / emit, and a broken listener cannot break the game', () => {
  const seen = [];
  const f = (p) => seen.push(p);
  sim.events.on('test', f);
  sim.events.emit('test', 1);
  sim.events.off('test', f);
  sim.events.emit('test', 2);
  sim.events.emit('nobody-listens', 3);
  assert.deepEqual(seen, [1]);
  const bad = () => { throw new Error('boom'); };
  const origErr = console.error; console.error = () => {};
  try {
    sim.events.on('built', bad);
    const s = gridGame(T0);
    assert.ok(sim.build(s, 'tent', 0, 0, T0).ok);
  } finally { sim.events.off('built', bad); console.error = origErr; }
});

test('nothing ever takes coins away during a long random session', () => {
  const s = gridGame(T0);
  let now = T0; let lowest = s.coins;
  for (let i = 0; i < 3000; i++) {
    now += 1000 + (i % 7) * 500;
    const before = s.coins;
    sim.advance(s, now);
    assert.ok(s.coins >= before, 'advance never reduces coins');
    assert.ok(Number.isInteger(s.coins) && s.coins >= 0 && s.gems >= 0);
    lowest = Math.min(lowest, s.coins);
  }
  assert.ok(lowest >= 0);
});

// ---- the first 15 minutes ---------------------------------------------------

function greedyStep(s, now, rideClock, casual = false) {
  if (s.ride && s.ride.requestedAt !== rideClock.seen) { rideClock.seen = s.ride.requestedAt; rideClock.n = (rideClock.n || 0) + 1; }
  if (casual && s.ride && s.ride.state === 'waiting' && rideClock.n % 3 === 0) { /* a casual player misses every third ride */ }
  else
  // rides: accept after 1 s, pick the right building 2 s later (casual: 6 s), arrive 3 s after that
  if (s.ride) {
    if (s.ride.state === 'waiting' && now - s.ride.requestedAt >= (casual ? 8000 : 1000)) sim.acceptRide(s, now);
    else if (s.ride.state === 'choosing' && now - s.ride.acceptedAt >= (casual ? 6000 : 2000)) { sim.chooseDestination(s, s.ride.toId, now); rideClock.at = now; }
    else if (s.ride.state === 'driving' && now - rideClock.at >= 3000) sim.completeRide(s, now);
  }
  // move people in
  for (const home of sim.homesWithVacancy(s, now)) {
    let best = 0;
    s.applicants.forEach((a, i) => { if (Math.max(...Object.values(a.skills)) > Math.max(...Object.values(s.applicants[best].skills))) best = i; });
    sim.moveIn(s, best, home.id, now);
  }
  // jobs: anyone with a better open job takes it
  for (const t of s.tenants) {
    const j = sim.bestJobs(s, t.id, now).find((x) => x.open);
    if (j && (t.jobId == null || j.dream)) sim.assignJob(s, t.id, j.building.id, now);
  }
  // restock: once for the goal, and whenever something runs out
  for (const b of s.buildings) {
    if (BUILDINGS[b.type].kind !== 'biz' || !sim.isBuilt(b, now)) continue;
    const needGoal = !s.goalsDone.includes('restock') && b.stock < BUILDINGS[b.type].stockMax;
    if (needGoal || b.stock === 0) sim.restock(s, b.id, now);
  }
  // build: keep beds and jobs in balance, never more than one site at a time
  if (s.buildings.some((b) => !sim.isBuilt(b, now))) return;
  const homes = s.buildings.filter((b) => BUILDINGS[b.type].kind === 'home');
  const shops = s.buildings.filter((b) => BUILDINGS[b.type].kind === 'biz');
  const beds = homes.reduce((n, b) => n + BUILDINGS[b.type].capacity, 0);
  const wantHome = beds <= shops.length * 2 - 1 || homes.length === 0;
  const options = config.BUILD_ORDER.filter((t) => sim.isUnlocked(s, t) && sim.costOf(s, t) <= s.coins &&
    (BUILDINGS[t].kind === 'home') === wantHome);
  if (!options.length) return;
  const owned = new Set(s.buildings.map((b) => b.type));
  const fresh = options.filter((t) => !owned.has(t));
  const type = wantHome ? options[options.length - 1] : (fresh.length ? fresh[0] : options[options.length - 1]);
  const [x, y] = freeLot(s);
  sim.build(s, type, x, y, now);
}

function playFifteen(casual) {
  const s = gridGame(T0);
  const rideClock = { at: 0 };
  const lines = [];
  let now = T0;
  for (let sec = 1; sec <= 15 * 60; sec++) {
    now = T0 + sec * 1000;
    sim.advance(s, now);
    // the casual player only does something every 6 seconds
    if (!casual || sec % 6 === 0) greedyStep(s, now, rideClock, casual);
    if (sec % 60 === 0) {
      lines.push(`  ${String(sec / 60).padStart(2)} min  coins ${String(s.coins).padStart(5)}  gems ${String(s.gems).padStart(2)}  buildings ${String(s.buildings.length).padStart(2)}` +
        `  pop ${String(sim.population(s)).padStart(2)}/${String(sim.capacity(s)).padEnd(2)}  rate ${(sim.townRatePerMin(s, now) * 60).toFixed(0).padStart(4)}/h` +
        `  rent ${String(sim.rentPerDay(s)).padStart(5)}/day  rides ${String(s.stats.rides).padStart(2)}  goals ${s.goalsDone.length}`);
    }
  }
  console.log(`\nFirst 15 minutes (${casual ? 'casual' : 'greedy, tireless'} player):\n` + lines.join('\n'));
  console.log('  buildings: ' + s.buildings.map((b) => b.type).join(', '));
  console.log('  goals done: ' + s.goalsDone.join(', '));
  const hourly = sim.townRatePerMin(s, now) * 60;
  console.log(`  earned ${s.stats.earned} coins in 15 min; rent/day = ${(sim.rentPerDay(s) / hourly).toFixed(1)} hours of business income\n`);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  return s;
}

test('first 15 minutes of greedy play ends with at least 6 buildings', () => {
  const s = playFifteen(false);
  assert.ok(s.buildings.length >= 6, `only ${s.buildings.length} buildings`);
  assert.ok(s.buildings.length <= 14, `${s.buildings.length} buildings is too fast`);
  assert.ok(sim.population(s) >= 3);
  assert.ok(s.stats.rides >= 3);
  assert.ok(s.goalsDone.length >= 6);
});

test('first 15 minutes of casual play still reaches about 6 buildings', () => {
  const s = playFifteen(true);
  assert.ok(s.buildings.length >= 5 && s.buildings.length <= 10, `${s.buildings.length} buildings`);
  assert.ok(sim.population(s) >= 3);
});

test('balance: rent is worth about 8-12 hours of business income in a balanced town', () => {
  // 12 residents, 6 fully staffed shops with ordinary workers (skill 5), one dream worker in town
  const s = fresh();
  const homes = [put(s, 'tent', T0), put(s, 'tent', T0), put(s, 'cabin', T0), put(s, 'cabin', T0), put(s, 'cabin', T0), put(s, 'apartment', T0)];
  const beds = homes.flatMap((h) => Array(BUILDINGS[h.type].capacity).fill(h));
  const people = beds.map((h) => person(s, h, T0, { skill: 5 }));
  ['diner', 'market', 'well', 'farm', 'bakery', 'studio'].forEach((type, i) => {
    const b = put(s, type, T0);
    if (i === 0) people[0].dream = type;
    sim.assignJob(s, people[i * 2].id, b.id, T0); sim.assignJob(s, people[i * 2 + 1].id, b.id, T0);
  });
  const hours = sim.rentPerDay(s) / (sim.townRatePerMin(s, T0) * 60);
  console.log(`\nBalanced 12-resident town: ${(sim.townRatePerMin(s, T0) * 60).toFixed(0)} coins/h from shops, rent ${sim.rentPerDay(s)}/day = ${hours.toFixed(1)} h of income\n`);
  assert.ok(hours >= 8 && hours <= 12, `${hours.toFixed(1)} h`);
});

test('needs, happiness, rent bonus, most wanted and wishes', () => {
  const s = fresh();
  assert.equal(sim.happiness(s, T0), 0); assert.deepEqual(sim.needsStatus(s, T0), []);
  assert.equal(sim.mostWanted(s, T0)[0].type, 'tent', 'an empty town wants a first home');
  const tent = put(s, 'tent', T0);
  const a = person(s, tent, T0, { dream: 'music' });
  // one resident, no job, no shops: jobs and food are both unmet
  assert.deepEqual(sim.needsStatus(s, T0).map((n) => [n.id, n.score]), [['jobs', 0], ['food', 0]]);
  assert.equal(sim.happiness(s, T0), 0);
  assert.equal(sim.rentBonusPerDay(s, T0), -Math.round(BUILDINGS.tent.rentPerTenant * TUNING.unhappyRentCut), 'an unhappy resident pays a little less');
  assert.match(sim.tenantWish(s, a, T0), /Music Shop/);
  const wanted = sim.mostWanted(s, T0);
  assert.ok(wanted.length >= 2 && wanted.length <= 3);
  assert.deepEqual(wanted.slice(0, 2).map((w) => w.id).sort(), ['food', 'jobs']);
  const diner = put(s, 'diner', T0);
  assert.equal(sim.happiness(s, T0), 0, 'a shop with no worker feeds nobody');
  const targets = sim.mostWanted(s, T0);
  assert.equal(targets.find((w) => w.id === 'food').buildingId, diner.id);
  assert.equal(targets.find((w) => w.id === 'jobs').buildingId, diner.id);
  sim.assignJob(s, a.id, diner.id, T0);
  assert.equal(sim.happiness(s, T0), 100);
  assert.equal(sim.rentBonusPerDay(s, T0), Math.round(BUILDINGS.tent.rentPerTenant * TUNING.happyRentBonus));
  diner.stock = 0;
  assert.equal(sim.happiness(s, T0), 100, 'an empty shelf never makes anyone unhappy');
  // unhappy residents never cost more than the cut: rent stays well above zero
  for (let i = 0; i < 3; i++) person(s, put(s, 'tent', T0), T0);
  assert.ok(sim.happiness(s, T0) < 100);
  assert.ok(sim.rentPerDay(s) + sim.rentBonusPerDay(s, T0) >= sim.rentPerDay(s) * (1 - TUNING.unhappyRentCut) - 1);
  for (const t of s.tenants) assert.ok(sim.tenantWish(s, t, T0).length > 5);
});

test('town buildings: needs, park rent boost, crops, recipes, lessons, town IQ', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0);            // lot (0,0)
  const a = person(s, tent, T0, { skill: 5 });
  const base = BUILDINGS.tent.rentPerTenant;
  assert.equal(sim.rentPerDay(s), base);
  // a tree two lots away boosts rent; the boost is capped
  const tree = put(s, 'tree', T0);
  assert.ok(Math.max(Math.abs(tree.x - tent.x), Math.abs(tree.y - tent.y)) <= TUNING.parkRadius);
  assert.equal(sim.homeBoost(s, tent), BUILDINGS.tree.rentBoost);
  assert.equal(sim.rentPerDay(s), Math.round(base * (1 + BUILDINGS.tree.rentBoost)));
  for (let i = 0; i < 4; i++) put(s, 'fountain', T0);
  assert.ok(sim.homeBoost(s, tent) <= TUNING.parkBoostMax);
  // town buildings never hold workers or stock
  assert.equal(sim.assignJob(s, a.id, tree.id, T0).ok, false);
  assert.equal(sim.restock(s, tree.id, T0).ok, false);

  // crops grow only on staffed farms; recipes are discovered from lifetime harvest
  const farm = put(s, 'farm', T0);
  const before = s.lastTick;
  sim.advance(s, before + 2 * HOUR);
  assert.equal(s.crops.veggies, 0, 'nobody is farming yet');
  sim.assignJob(s, a.id, farm.id, s.lastTick);
  const log = record(() => sim.advance(s, s.lastTick + 4 * HOUR));
  assert.ok(Math.abs(s.crops.veggies - 4 * TUNING.cropPerHour) < 1e-6);
  assert.deepEqual(s.recipes, ['salad']);
  assert.equal(log.filter((e) => e.type === 'recipe').length, 1);
  assert.equal(sim.recipesFor(s, farm).length, 0, 'only food shops cook');
  assert.equal(sim.nextRecipe(s).recipe.id, 'applepie');
  // a recipe makes that restaurant sell more
  const diner = put(s, 'diner', s.lastTick);
  const b = person(s, put(s, 'tent', s.lastTick), s.lastTick, { skill: 0 });
  sim.assignJob(s, b.id, diner.id, s.lastTick);
  assert.ok(Math.abs(sim.ratePerMin(s, diner) - BUILDINGS.diner.baseRate * TUNING.staffFactor[1] * (1 + TUNING.recipeBonus)) < 1e-9);
  assert.equal(sim.recipesFor(s, diner).length, 1);

  // school: skills only ever go up, and the town gets cleverer
  const iq = sim.townIQ(s);
  const skills0 = s.tenants.map((t) => ({ ...t.skills }));
  put(s, 'school', s.lastTick);
  const res = sim.advance(s, s.lastTick + 6 * HOUR);
  const due = 6 * BUILDINGS.school.lessons;
  assert.ok(res.lessons >= due - 2 && res.lessons <= due + 1, `${res.lessons} lessons`);
  s.tenants.forEach((t, i) => { for (const c of CATEGORIES) assert.ok(t.skills[c] >= skills0[i][c] && t.skills[c] <= 9); });
  assert.ok(sim.townIQ(s) > iq);
  // saves from before these features load cleanly
  const old = JSON.parse(JSON.stringify(s)); delete old.crops; delete old.recipes; delete old.nextLessonAt; delete old.worldSeed;
  const m = S.migrate(old);
  assert.deepEqual(m.crops, { veggies: 0, fruit: 0 }); assert.deepEqual(m.recipes, []);
  assert.ok(Number.isFinite(m.nextLessonAt) && Number.isFinite(m.worldSeed));
});

test('land: parcels, prices, terrain lots, waterfront; upgrades: cost, effect, cap', () => {
  const s = fresh();
  assert.deepEqual(s.land, ['home']);
  assert.equal(config.isRoad(-1, 0), true); assert.equal(config.isRoad(0, -1), true); assert.equal(config.isRoad(-2, -2), false);
  assert.equal(config.parcelAt(-1, 0).id, 'w'); assert.equal(config.parcelAt(11, 14).id, 'se'); assert.equal(config.parcelAt(40, 0), null);
  // every tile of the first town is plain grass, whatever the seed
  for (const seed of [1, 2, 3, 99]) { s.worldSeed = seed; for (const [x, y] of lots()) assert.equal(sim.terrainOf(s, x, y), 'grass'); }
  assert.equal(sim.ownsTile(s, 0, 0), true); assert.equal(sim.ownsTile(s, -2, 0), false);
  assert.match(sim.canBuild(s, 'tent', -2, 0).reason, /own that land/);
  // corners need a neighbour first; each parcel costs more than the last
  assert.equal(sim.buyLand(s, 'nw', T0).ok, false);
  s.coins = 10;
  assert.match(sim.buyLand(s, 'w', T0).reason, /more coins/);
  s.coins = 1e9;
  assert.equal(sim.landPrice(s), TUNING.landBasePrice);
  const before = s.coins;
  const log = record(() => assert.equal(sim.buyLand(s, 'w', T0).ok, true));
  assert.equal(s.coins, before - TUNING.landBasePrice);
  assert.equal(sim.landPrice(s), TUNING.landBasePrice * TUNING.landGrowth);
  assert.equal(sim.buyLand(s, 'w', T0).ok, false, 'already owned');
  assert.equal(sim.buyLand(s, 'nw', T0).ok, true, 'now reachable');
  // the new land has real terrain: water and mountains can't be built on, and info counts match isLot
  for (const id of ['w', 'nw']) {
    const p = config.PARCELS.find((q) => q.id === id);
    let n = 0;
    for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) {
      const kind = sim.terrainOf(s, x, y);
      const ok = sim.canBuild(s, 'tent', x, y).ok;
      assert.equal(ok, sim.isLot(s, x, y));
      if (kind === 'water' || kind === 'mountain' || config.isRoad(x, y)) assert.equal(ok, false);
      if (ok) n++;
    }
    assert.equal(sim.parcelInfo(s, id).lots, n);
  }
  // a save keeps its land
  assert.deepEqual(S.migrate(JSON.parse(JSON.stringify(s))).land, ['home', 'w', 'nw']);

  // upgrades
  const tent = put(s, 'tent', T0); const diner = put(s, 'diner', T0); const tree = put(s, 'tree', T0);
  const a = person(s, tent, T0, { skill: 0 });
  sim.assignJob(s, a.id, diner.id, T0);
  const rent1 = sim.rentPerDay(s), rate1 = sim.ratePerMin(s, diner), boost1 = sim.homeBoost(s, tent);
  assert.equal(sim.upgradeCost(s, diner), BUILDINGS.diner.cost * TUNING.upgradeCost[1]);
  s.coins = 0;
  assert.match(sim.upgrade(s, diner.id, T0).reason, /more coins/);
  s.coins = 1e9;
  for (const b of [tent, diner, tree]) assert.equal(sim.upgrade(s, b.id, T0).ok, true);
  assert.equal(diner.level, 2); assert.equal(diner.stock, sim.stockMaxOf(diner));
  assert.equal(sim.stockMaxOf(diner), Math.round(BUILDINGS.diner.stockMax * (1 + TUNING.levelBonus)));
  assert.ok(Math.abs(sim.ratePerMin(s, diner) - rate1 * (1 + TUNING.levelBonus)) < 1e-9);
  assert.ok(sim.homeBoost(s, tent) > boost1);
  assert.ok(sim.rentPerDay(s) > rent1 * (1 + TUNING.levelBonus) - 1);
  assert.equal(diner.paid, BUILDINGS.diner.cost + BUILDINGS.diner.cost * TUNING.upgradeCost[1], 'refund covers the upgrade');
  assert.equal(sim.upgrade(s, diner.id, T0).ok, true); assert.equal(diner.level, 3);
  assert.equal(sim.upgradeCost(s, diner), 0); assert.equal(sim.upgrade(s, diner.id, T0).ok, false);
  // restocking a bigger shop fills the bigger shelf
  diner.stock = 0;
  assert.equal(sim.restock(s, diner.id, T0).ok, true); assert.equal(diner.stock, sim.stockMaxOf(diner));
  assert.equal(S.migrate(JSON.parse(JSON.stringify(s))).buildings.find((b) => b.id === diner.id).level, 3);
});

test('trade, orders, ads, shop pricing and milestone unlocks', () => {
  const s = fresh();
  const homes = [put(s, 'tent', T0), put(s, 'tent', T0)];
  const a = person(s, homes[0], T0, { skill: 0 }); const b = person(s, homes[1], T0, { skill: 0 });
  const farm = put(s, 'farm', T0);
  sim.assignJob(s, a.id, farm.id, T0);
  assert.equal(sim.sellGoods(s, 'veggies', T0).ok, false, 'no trading post yet');
  put(s, 'trade', T0);
  assert.equal(sim.sellGoods(s, 'veggies', s.lastTick).ok, false, 'nothing grown yet');
  sim.advance(s, s.lastTick + 3 * HOUR);
  assert.ok(Math.abs(s.goods.veggies - 3 * TUNING.cropPerHour) < 1e-6);
  assert.ok(Math.abs(s.crops.veggies - s.goods.veggies) < 1e-6);
  // prices: stable within a day, within the drift range, and importing always costs more than selling pays
  const now = s.lastTick;
  const p = sim.tradePrices(s, now);
  assert.deepEqual(sim.tradePrices(s, now + 1000), p);
  for (const crop of Object.keys(config.CROP_PRICE)) {
    for (let d = 0; d < 60; d++) {
      const q = sim.tradePrices(s, now + d * DAY)[crop];
      assert.ok(q.price >= q.usual * 0.59 && q.price <= q.usual * 1.61, `${crop} ${q.price}`);
      assert.ok(q.importPrice > q.price);
    }
  }
  const lifetime = s.crops.veggies;
  const coins0 = s.coins;
  const sale = sim.sellGoods(s, 'veggies', now);
  assert.equal(sale.coins, Math.floor(30 * p.veggies.price));
  assert.ok(s.goods.veggies < 1); assert.equal(s.crops.veggies, lifetime, 'selling never touches recipe progress');
  assert.ok(s.goalsDone.includes('trade1'));
  // the coins come when the truck leaves town; one truck, so the next trade waits for it
  assert.equal(s.trucks.length, 1);
  const sent = s.coins;
  assert.match(sim.buyGoods(s, 'fruit', 60, now).reason, /on the road/);
  sim.advance(s, sale.truck.arriveAt);
  assert.ok(s.coins >= sent + sale.coins && s.coins >= coins0 + sale.coins);
  // importing counts for recipes once the truck is in
  const imp = sim.buyGoods(s, 'fruit', 60, s.lastTick);
  assert.equal(imp.ok, true); assert.equal(s.goods.fruit || 0, 0, 'still on the road');
  sim.advance(s, imp.truck.arriveAt);
  assert.equal(s.goods.fruit, 60); assert.ok(s.recipes.includes('applepie'));
  // orders: always two, grow, never expire, pay coins and a gem
  const orders = sim.ensureOrders(s);
  assert.equal(orders.length, 2); assert.equal(orders[0].qty, TUNING.orderFirstQty);
  const o = orders[0];
  s.goods[o.crop] = 0;
  assert.match(sim.fillOrder(s, o.id, now).reason, /more/);
  s.goods[o.crop] = o.qty + 5;
  const gems0 = s.gems;
  const done = sim.fillOrder(s, o.id, s.lastTick);
  assert.equal(done.ok, true); assert.ok(Math.abs(s.goods[o.crop] - 5) < 1e-6); const gemsSent = s.gems;
  sim.advance(s, done.truck.arriveAt);
  assert.equal(s.gems, gemsSent + o.gems, 'the gem comes with the truck'); assert.ok(s.gems > gems0);
  assert.equal(s.orders.length, 2); assert.ok(!s.orders.some((x) => x.id === o.id)); assert.ok(s.goalsDone.includes('order1'));

  // shop pricing: premium sells fewer items for more coins each; bargain the other way
  const diner = put(s, 'diner', now);
  sim.assignJob(s, b.id, diner.id, now);
  const base = sim.ratePerMin(s, diner);
  for (const mode of ['high', 'low']) {
    const m = config.PRICE_MODES[mode];
    assert.equal(sim.setPrice(s, diner.id, mode, now).ok, true);
    assert.ok(Math.abs(sim.ratePerMin(s, diner) - base * m.speed * m.pay) < 1e-9);
    farm.stock = 0;   // only the diner sells in this check
    diner.stock = sim.stockMaxOf(diner); diner.carry = 0; diner.cc = 0;
    const stock0 = diner.stock;
    const r = sim.advance(s, s.lastTick + 60 * MIN);
    const items = stock0 - diner.stock;
    assert.ok(Math.abs(items - base * m.speed * 60) <= 1, `${mode} items ${items}`);
    assert.ok(Math.abs(r.coinsEarned - items * m.pay) <= 1, `${mode} coins ${r.coinsEarned}`);
  }
  sim.setPrice(s, diner.id, 'normal', s.lastTick);
  assert.equal(sim.setPrice(s, diner.id, 'silly', s.lastTick).ok, false);

  // ads: cost, no stacking, more coins per sale while running
  const t1 = s.lastTick;
  assert.equal(sim.adCost(s, t1), TUNING.adMinCost);
  assert.equal(sim.runAd(s, t1).ok, true); assert.equal(sim.runAd(s, t1).ok, false);
  assert.equal(sim.adActive(s, t1 + TUNING.adMs - 1), true); assert.equal(sim.adActive(s, t1 + TUNING.adMs), false);
  farm.stock = 0;
  diner.stock = sim.stockMaxOf(diner); diner.carry = 0; diner.cc = 0;
  const stock1 = diner.stock;
  const boosted = sim.advance(s, t1 + 60 * MIN);
  assert.ok(Math.abs(boosted.coinsEarned - (stock1 - diner.stock) * (1 + TUNING.adSalesBonus)) <= 1);

  // milestone unlocks: the Fountain needs enough residents AND the happiness milestone
  const big = fresh();
  for (let i = 0; i < 8; i++) put(big, 'apartment', T0);
  for (let i = 0; i < 30; i++) sim.moveIn(big, 0, big.buildings[i >> 2].id, T0);
  assert.equal(sim.population(big), 30);
  assert.equal(sim.isUnlocked(big, 'fountain'), false);
  assert.match(sim.unlockHint(big, 'fountain'), /90% happy/);
  assert.match(sim.canBuild(big, 'fountain', 9, 13).reason, /90% happy/);
  big.goalsDone.push('happy90');
  assert.equal(sim.isUnlocked(big, 'fountain'), true);
  // an old save gains the new fields
  const old = JSON.parse(JSON.stringify(s)); delete old.goods; delete old.orders; delete old.trade; delete old.adUntil;
  for (const x of old.buildings) { delete x.price; delete x.cc; }
  const m2 = S.migrate(old);
  assert.deepEqual(m2.goods, { veggies: 0, fruit: 0 }); assert.deepEqual(m2.orders, []); assert.equal(m2.adUntil, 0);
  assert.equal(m2.buildings.find((x) => x.type === 'diner').price, 'normal');
});

test('economy batch: play boost, same-kind ride destinations, old saves move to hourly rent', () => {
  // sales pay TUNING.activeBoost times as much while the game is open, and stock lasts just as long
  const mk = () => {
    const s = fresh(); const tent = put(s, 'tent', T0); const diner = put(s, 'diner', T0);
    sim.assignJob(s, person(s, tent, T0, { skill: 9 }).id, diner.id, T0); allGoalsDone(s);
    return { s, diner };
  };
  const away = mk(), here = mk();
  const a = sim.advance(away.s, T0 + 30 * MIN, { live: false });
  const b = sim.advance(here.s, T0 + 30 * MIN, { live: true, active: true });
  assert.ok(a.coinsEarned > 0); assert.equal(b.coinsEarned, a.coinsEarned * TUNING.activeBoost);
  assert.equal(here.diner.stock, away.diner.stock);

  // "take me to the Tent": any tent is right, and the ride goes to the one that was tapped
  const s = fresh();
  const home = put(s, 'cabin', T0); const t1 = put(s, 'tent', T0); const t2 = put(s, 'tent', T0);
  const rider = person(s, home, T0);
  s.ride = { tenantId: rider.id, fromId: home.id, toId: t1.id, state: 'choosing', requestedAt: T0, acceptedAt: T0, fare: 0, tries: 0 };
  const r = sim.chooseDestination(s, t2.id, T0 + 1000);
  assert.ok(r.correct); assert.equal(s.ride.toId, t2.id); assert.equal(s.ride.tries, 0);

  // a save from the midnight-rent days is owed the hours since its last midnight, never less
  const old = JSON.parse(JSON.stringify(fresh()));
  delete old.lastRentHour; delete old.rentCarry; old.lastRentDay = '2026-06-15';
  const m = S.migrate(old);
  assert.equal(m.lastRentHour, Math.floor(T0 / HOUR) - 12); assert.equal(m.rentCarry, 0); assert.equal(m.lastRentDay, undefined);
});

test('government batch: reach, each resident\'s happiness and reasons, shop problems', () => {
  const s = fresh();
  const homes = []; const people = [];
  for (let i = 0; i < 10; i++) { const h = put(s, 'tent', T0); homes.push(h); people.push(person(s, h, T0)); }
  const clinic = put(s, 'clinic', T0);
  const health = () => sim.needsStatus(s, T0).find((n) => n.id === 'health');
  assert.ok(health(), 'health matters at 10 residents');
  // a clinic only serves homes within its reach
  Object.assign(clinic, { x: homes[0].x + 100, y: homes[0].y });
  assert.equal(health().have, 0);
  let m = sim.residentMood(s, people[0], T0);
  assert.ok(m.missing.some((x) => x.id === 'health' && /too far/.test(x.why)));
  assert.ok(m.missing.some((x) => x.id === 'jobs' && x.why === 'No job yet'));
  Object.assign(clinic, { x: homes[0].x, y: homes[0].y + sim.reachOf(clinic) });
  assert.ok(health().have > 0);
  m = sim.residentMood(s, people[0], T0);
  assert.ok(!m.missing.some((x) => x.id === 'health'));
  // the town's happiness is the average of its residents
  const avg = s.tenants.reduce((a, t) => a + sim.residentMood(s, t, T0).score, 0) / s.tenants.length;
  assert.ok(Math.abs(avg - sim.happiness(s, T0)) <= 1);
  assert.equal(sim.moodRentFactor(0), -TUNING.unhappyRentCut); assert.equal(sim.moodRentFactor(100), TUNING.happyRentBonus);

  // problems: only while playing, cut sales a little, cost a small fee or get fixed by a station in reach
  const diner = put(s, 'diner', T0);
  sim.assignJob(s, people[0].id, diner.id, T0); allGoalsDone(s);
  const away = structuredClone(s);
  sim.advance(away, T0 + 2 * DAY, { live: false });
  assert.equal(away.problems.length, 0, 'nothing goes wrong while you are away');
  const rate = sim.ratePerMin(s, diner);
  let log = record(() => { for (let t = T0; t <= T0 + HOUR && !s.problems.length; t += 30000) sim.advance(s, t); });
  assert.equal(s.problems.length, 1); assert.equal(s.problems[0].buildingId, diner.id);
  assert.equal(log.filter((e) => e.type === 'spend').length, 0);
  assert.ok(Math.abs(sim.ratePerMin(s, diner) - rate * (1 - TUNING.problemSalesCut)) < 1e-9);
  const now = s.lastTick; const fee = sim.problemFee(s, now);
  const poor = structuredClone(s); poor.coins = 0;
  assert.equal(sim.fixProblem(poor, diner.id, now).ok, false); assert.equal(poor.problems.length, 1);
  const coins = s.coins;
  assert.deepEqual(sim.fixProblem(s, diner.id, now), { ok: true, reason: '', cost: fee });
  assert.equal(s.coins, coins - fee); assert.equal(s.problems.length, 0);
  assert.ok(Math.abs(sim.ratePerMin(s, diner) - rate) < 1e-9);
  assert.equal(sim.fixProblem(s, diner.id, now).ok, false);
  // with a station in reach, help arrives by itself and costs nothing
  const station = put(s, 'fire', now); Object.assign(station, { x: diner.x, y: diner.y + 1 });
  s.problems.push({ buildingId: diner.id, kind: 'leak', at: now, fixAt: null, fixerId: null });
  const before = s.coins;
  sim.advance(s, now + 1000, { live: false });
  assert.equal(s.problems[0].fixerId, station.id); assert.ok(s.problems[0].fixAt > now);
  log = [];
  const sub = sim.events.on('problemFixed', (e) => log.push(e));
  const res = sim.advance(s, now + 1000 + TUNING.problemAutoFixMs + 1000, { live: false });
  sim.events.off('problemFixed', sub);
  assert.equal(s.problems.length, 0); assert.equal(log.length, 1); assert.equal(log[0].auto, true);
  assert.equal(s.coins, before + res.coinsEarned + res.rentPaid);
  // saves from before problems existed load cleanly
  const old = JSON.parse(JSON.stringify(s)); delete old.problems; delete old.nextProblemAt;
  const mig = S.migrate(old); assert.deepEqual(mig.problems, []); assert.ok(Number.isFinite(mig.nextProblemAt));
});

test('mayor\'s places: favourites do more, special land is needed for a few, and the draw respects it', () => {
  const s = fresh();
  const tent = put(s, 'tent', T0); const cabin = put(s, 'cabin', T0);
  const diner = put(s, 'diner', T0); const taco = put(s, 'taco', T0);
  diner.tier = taco.tier = 0; diner.q = taco.q = 0;
  sim.assignJob(s, person(s, tent, T0, { skill: 5 }).id, diner.id, T0);
  sim.assignJob(s, person(s, cabin, T0, { skill: 5 }).id, taco.id, T0);
  assert.ok(Math.abs(sim.ratePerMin(s, taco) / sim.ratePerMin(s, diner) - (1 + TUNING.favBonus)) < 1e-9);
  // the middle of the first town is all grass: no ski lodge, no trail, no surf shop
  const lot = lots().find(([x, y]) => x >= 4 && x <= 6 && y >= 5 && y <= 8 && !sim.tileAt(s, x, y));
  for (const id of ['ski', 'trail', 'surf']) {
    assert.equal(sim.nearOk(s, id, ...lot), false, id);
    assert.equal(sim.canBuild(s, id, ...lot).ok, false);
  }
  assert.equal(sim.nearOk(s, 'diner', ...lot), true); assert.match(sim.nearHint('trail'), /woods or mountains/);
  // surprise draws on plain land never turn up a land-bound shop, however many are opened
  s.coins = 1e12;
  for (const [x, y] of lots()) {
    if (sim.tileAt(s, x, y) || sim.nearOk(s, 'ski', x, y) || sim.nearOk(s, 'surf', x, y)) continue;
    const r = sim.buildRandom(s, 'creative', x, y, T0);
    if (r.ok) assert.ok(!BUILDINGS[r.building.type].near, r.building.type);
  }
  // nobody dreams of a place the land can't give them
  for (let i = 0; i < 300; i++) assert.ok(!BUILDINGS[S.makeApplicant(s).dream].near);
});

test('jobs board: every job can be played, pays with the town, and rests afterwards', () => {
  const s = fresh();
  const homes = [put(s, 'tent', T0), put(s, 'tent', T0), put(s, 'tent', T0)];
  const people = homes.map((h) => person(s, h, T0, { skill: 5 }));
  const diner = put(s, 'diner', T0);
  sim.assignJob(s, people[0].id, diner.id, T0); allGoalsDone(s);
  let now = T0 + 1000;
  const board = () => Object.fromEntries(sim.jobBoard(s, now).map((j) => [j.kind, j]));
  assert.deepEqual(Object.keys(board()), Object.keys(config.TOWN_JOBS));
  assert.ok(Object.values(board()).every((j) => j.ok && j.pay > 0 && j.readyIn === 0));
  // pay follows the town's income once that beats the small floor
  const small = sim.jobPay(s, 'rush', now);
  diner.tier = 12;
  assert.ok(sim.jobPay(s, 'rush', now) > small);
  assert.equal(sim.jobPay(s, 'rush', now), Math.round(sim.townRatePerMin(s, now) * config.TOWN_JOBS.rush.minutes));
  diner.tier = 0;

  // Lunch Rush: wrong picture costs nothing, five right ones pay
  let coins = s.coins;
  let r = sim.startTownJob(s, 'rush', diner.id, now); assert.ok(r.ok);
  assert.equal(board().odd.ok, false, 'one job at a time');
  const pay = s.job.pay;
  assert.equal(sim.serveOrder(s, 0, (s.job.orders[0] + 1) % 3).ok, false);
  while (s.job) r = sim.serveOrder(s, s.job.index, s.job.orders[s.job.index]);
  assert.ok(r.done); assert.equal(r.pay, pay); assert.equal(s.coins, coins + pay);
  // it rests, then comes back
  assert.ok(board().rush.readyIn > 0); assert.equal(sim.startTownJob(s, 'rush', diner.id, now).ok, false);
  now += config.TOWN_JOBS.rush.cooldownMs; assert.equal(board().rush.readyIn, 0);

  // Odd Jobs: a more skilled helper earns more
  assert.ok(sim.startTownJob(s, 'odd', null, now).ok);
  const helper = sim.tenantById(s, s.job.candidates[0]); const cat = s.job.category; const base = s.job.pay;
  coins = s.coins;
  r = sim.sendHelper(s, helper.id);
  assert.equal(r.pay, Math.round(base * (1 + TUNING.oddSkillBonus * helper.skills[cat]))); assert.equal(s.coins, coins + r.pay);

  // Lost & Found: only Pip's own tile counts
  assert.ok(sim.startTownJob(s, 'lost', null, now).ok);
  const { x, y } = s.job;
  assert.equal(sim.findDog(s, x + 1, y).ok, false); assert.ok(sim.findDog(s, x, y).done);

  // Courier: paid per stop, and the shortest route earns one more stop's pay
  assert.ok(sim.startTownJob(s, 'courier', null, now).ok);
  const job = s.job; const per = job.pay; coins = s.coins;
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((v, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [v, ...p])));
  const len = (order) => order.reduce((acc, id) => { const h = sim.buildingById(s, id); const d = Math.abs(acc.x - h.x) + Math.abs(acc.y - h.y); return { x: h.x, y: h.y, d: acc.d + d }; }, { x: job.x, y: job.y, d: 0 }).d;
  const best = perms(job.stops).sort((a, z) => len(a) - len(z))[0];
  for (const id of best) r = sim.deliverStop(s, id);
  assert.ok(r.done); assert.equal(r.bonus, per); assert.equal(s.coins, coins + per * best.length + per); assert.equal(s.job, null);

  // skipping pays nothing and lets you take the job again at once
  now += 10 * MIN;
  assert.ok(sim.startTownJob(s, 'lost', null, now).ok); coins = s.coins;
  sim.skipTownJob(s); assert.equal(s.coins, coins); assert.equal(board().lost.readyIn, 0);

  // board rides pay like street rides and rest too
  r = sim.startBoardRide(s, 'taxi', now); assert.ok(r.ok); assert.equal(s.ride.state, 'choosing');
  const fare = sim.chooseDestination(s, s.ride.toId, now + 1000).fare;
  assert.ok(fare >= Math.round(Math.max(TUNING.rideMinFare, sim.townRatePerMin(s, now) * TUNING.rideFareMinutes)));
  sim.completeRide(s, now + 4000);
  assert.equal(sim.startBoardRide(s, 'taxi', now + 5000).ok, false, 'resting');
  // old saves gain the cooldown table
  const old = JSON.parse(JSON.stringify(s)); delete old.jobCooldowns;
  assert.deepEqual(S.migrate(old).jobCooldowns, {});
});

test('car: gas bonus, upgrades, and the optional welcome drive', () => {
  const { s } = rideTown();
  sim.advance(s, T0 + 2000);
  sim.acceptRide(s, T0 + 3000);
  const fare = sim.chooseDestination(s, s.ride.toId, T0 + 4000).fare;
  // holding the gas for half the trip pays half the bonus; nothing held pays the plain fare
  const plain = structuredClone(s);
  assert.equal(sim.completeRide(plain, T0 + 9000).fare, fare);
  assert.ok(sim.rideGas(s, 0.5, T0 + 8000).ok);
  assert.equal(sim.completeRide(s, T0 + 9000).fare, Math.round(fare * (1 + TUNING.gasBonus * 0.5)));
  assert.equal(sim.rideGas(s, 1, T0 + 9000).ok, false, 'no ride on the road');

  // a better car costs coins and lifts every fare
  assert.equal(sim.carOf(s).name, config.CARS[0].name);
  const poor = structuredClone(s); poor.coins = 0;
  assert.equal(sim.upgradeCar(poor, T0).ok, false); assert.equal(poor.car, 1);
  s.coins = 1e9; const coins = s.coins;
  assert.ok(sim.upgradeCar(s, T0).ok); assert.equal(s.car, 2); assert.equal(s.coins, coins - config.CARS[1].cost);
  while (sim.nextCar(s)) sim.upgradeCar(s, T0);
  assert.equal(s.car, config.CARS.length); assert.equal(sim.upgradeCar(s, T0).ok, false);

  // welcome drive: moving in is instant; the drive is extra, once, and never required
  const t = fresh();
  const home = put(t, 'tent', T0);
  const r = sim.moveIn(t, 0, home.id, T0);
  assert.ok(r.ok); assert.equal(t.tenants.length, 1, 'already living there');
  const offer = sim.welcomeFare(t, r.tenant.id, T0);
  assert.ok(offer >= TUNING.rideMinFare);
  const w = sim.startWelcome(t, r.tenant.id, T0 + 1000);
  assert.ok(w.ok); assert.equal(t.ride.state, 'driving'); assert.equal(t.ride.fare, offer);
  assert.ok(sim.isRoadAt(t, t.ride.from.x, t.ride.from.y));
  const before = t.coins;
  const saved = S.migrate(JSON.parse(JSON.stringify(t))); assert.ok(saved.ride, 'a welcome drive survives a reload');
  sim.rideGas(t, 1, T0 + 2000);
  const done = sim.completeRide(t, T0 + 5000);
  assert.equal(done.fare, Math.round(offer * (1 + TUNING.gasBonus))); assert.ok(t.coins >= before + done.fare);
  assert.equal(sim.startWelcome(t, r.tenant.id, T0 + 6000).ok, false, 'only once');
  assert.equal(sim.welcomeFare(t, r.tenant.id, T0 + 6000), 0);
  const old = JSON.parse(JSON.stringify(t)); delete old.car; assert.equal(S.migrate(old).car, 1);
});

test('entry road and trade trucks', () => {
  // every town, old grid or street plan, has a road in from the edge that never takes a lot
  for (let seed = 0; seed < 40; seed++) {
    for (const streets of ['grid', 'plan']) {
      const s = fresh(); s.worldSeed = seed; s.streets = streets;
      const e = sim.entryRoute(s);
      assert.ok(e && e.tiles.length >= 2, `seed ${seed} ${streets}`);
      for (const t of e.tiles) { assert.ok(sim.isRoadAt(s, t.x, t.y)); assert.equal(sim.isLot(s, t.x, t.y), false); }
      const last = e.tiles.at(-1);
      assert.ok(sim.ownsTile(s, last.x, last.y), 'ends in the first town');
    }
  }
  const s = fresh();
  put(s, 'tent', T0);
  const post = put(s, 'trade', T0);
  const now = s.lastTick;
  const trip = sim.truckTripMs(s, now);
  assert.ok(trip >= TUNING.truckMinMs && trip <= TUNING.truckMaxMs);
  assert.ok(sim.truckRoute(s, now).length >= 2);
  // one truck per Trading Post level
  assert.equal(sim.truckCount(s, now), 1);
  post.level = 2;
  assert.equal(sim.truckCount(s, now), 2);
  s.goods.veggies = 100;
  s.coins = 10000;
  const a = sim.sellGoods(s, 'veggies', now);
  const b = sim.buyGoods(s, 'veggies', 10, now);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(sim.buyGoods(s, 'veggies', 10, now).ok, false, 'both trucks are out');
  // trucks finish even when the game was closed the whole time
  const coins = s.coins;
  sim.advance(s, now + 3 * HOUR, { live: false });
  assert.equal(s.trucks.length, 0);
  assert.ok(s.coins >= coins + a.coins);
  assert.ok(s.goods.veggies >= 10);
  // an older save without trucks loads with an empty road
  const old = JSON.parse(JSON.stringify(s)); delete old.trucks;
  const m = S.migrate(old);
  assert.deepEqual(m.trucks, []);
});

test('teams: shop sizes, team meter, hire best, better-job suggestions', () => {
  const s = fresh();
  const homes = [put(s, 'apartment', T0), put(s, 'apartment', T0)];
  const small = put(s, 'icecream', T0), big = put(s, 'market', T0), diner = put(s, 'diner', T0);
  assert.equal(sim.slotsOf(small), 1); assert.equal(sim.slotsOf(big), 4); assert.equal(sim.slotsOf(diner), 2);
  big.level = TUNING.slotAtLevel; assert.equal(sim.slotsOf(big), 5, 'a top-level shop gets one more job');
  big.level = 1;
  // bigger shops hold more stock, so a full team doesn't sell out sooner
  assert.ok(sim.stockMaxOf(big) > sim.stockMaxOf(small));
  const p = [];
  for (let i = 0; i < 6; i++) p.push(person(s, homes[i % 2], T0, { skill: i < 3 ? 9 : 2, dream: 'cinema' }));
  // the small shop takes one worker only
  assert.equal(sim.assignJob(s, p[0].id, small.id, T0).ok, true);
  assert.equal(sim.assignJob(s, p[1].id, small.id, T0).ok, false);
  // team meter: one skill-9 worker in a one-job shop is the best team it can have
  let team = sim.teamOf(s, small, T0);
  assert.ok(team.pct > 0.99); assert.equal(team.stars, 3);
  // a big shop with one weak worker is far from its best, and says how to improve
  sim.assignJob(s, p[3].id, big.id, T0);
  team = sim.teamOf(s, big, T0);
  assert.ok(team.pct < 0.4 && team.stars === 0); assert.match(team.tip, /Hire/);
  // hire best picks the most skilled person who would do better here
  const hire = sim.bestHire(s, big.id, T0);
  assert.ok(hire && hire.skills.retail === 9 && hire.jobId == null);
  // a fuller, more skilled team serves more residents
  const serves1 = sim.shopServes(s, big);
  sim.assignJob(s, hire.id, big.id, T0);
  assert.ok(sim.shopServes(s, big) > serves1);
  assert.ok(sim.teamOf(s, big, T0).workers.every((w) => w.adds > 0));
  // fit stars
  assert.equal(sim.fitStars(p[0], small), 3); assert.equal(sim.fitStars(p[3], big), 1);
  // suggestions: only moves that help, nobody moved by them
  const before = s.tenants.map((t) => t.jobId);
  const moves = sim.jobSuggestions(s, T0);
  assert.ok(moves.length > 0 && moves.every((m) => m.gain > 0));
  assert.deepEqual(s.tenants.map((t) => t.jobId), before, 'suggestions never move anyone');
  for (const m of moves) assert.equal(sim.assignJob(s, m.tenant.id, m.to.id, T0).ok, true, 'every suggested move fits');
  // a shop that shrank keeps its workers (older saves): two people in a one-job shop
  const extra = p.find((t) => t.jobId == null) || p[5];
  extra.jobId = small.id;
  assert.ok(sim.workersOf(s, small.id).length >= 2);
  assert.ok(sim.ratePerMin(s, small) > 0);
  assert.equal(sim.bestHire(s, small.id, T0), null, 'no new hires while over');
});
