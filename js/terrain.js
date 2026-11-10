// Bit City — terrain. Pure: the landscape is a function of the town's worldSeed and a
// tile position, so it never needs saving and looks the same every time the town opens.
//
// For now the landscape is scenery around the town (the town itself is all grass).
// When land can be bought, new land should ask terrainAt() what is on it.

import { MAP_W, MAP_H, WORLD, isRoad } from './config.js';

function hash(seed, x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The big decisions for one town: where the sea, mountains, river and lake are. */
export function makeWorld(seed) {
  seed = (Number(seed) || 0) >>> 0;
  const r = (n) => hash(seed, n, 9999);
  const riverWest = r(2) < 0.5;
  return {
    seed,
    seaSouth: r(1) < 0.5,                 // the mountains are on the other side
    riverWest,                            // the lake is on the other side
    lake: {
      x: riverWest ? MAP_W + 1.5 + r(3) : -2.5 - r(3),
      y: 2 + r(4) * (MAP_H - 4),
      rx: 1.1 + r(5) * 0.5,
      ry: 1.2 + r(6) * 1.3,
    },
    p1: r(7) * 6.283, p2: r(8) * 6.283, p3: r(9) * 6.283,
  };
}

const inTown = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** Is this tile open sea (as opposed to the river or the lake, which roads can bridge)? */
export function isSeaAt(world, x, y) {
  const toSea = world.seaSouth ? y - (MAP_H - 1) : -y;
  return toSea >= 5 + Math.round(Math.sin(x * 0.8 + world.p1) * 0.7);
}

// ---- streets -------------------------------------------------------------------
// A town's street plan is cut from the whole world at once, so streets line up across
// land bought later. The world is split again and again by a straight road until every
// block is at most two lots deep (so no lot is buried) and not too long. Early cuts
// become long main streets; later ones are short side streets that end in T-junctions.

const WW = WORLD.x1 - WORLD.x0 + 1, WH = WORLD.y1 - WORLD.y0 + 1;
const keyOf = (x, y) => (y - WORLD.y0) * WW + (x - WORLD.x0);
const inHome = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

function cutPlan(seed) {
  const road = new Set(), blocks = [];
  const split = (x0, y0, x1, y1, depth) => {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return;
    const rnd = (n) => hash(seed, x0 * 31 + y0 * 17 + n * 101, x1 * 13 + y1 * 7 + depth * 53);
    const maxLen = 4 + Math.floor(rnd(1) * 3);                       // blocks are 4 to 6 lots long
    if (Math.min(w, h) <= 2 && Math.max(w, h) <= maxLen) { blocks.push({ x0, y0, x1, y1 }); return; }
    const upright = Math.min(w, h) <= 2 ? w > h : rnd(2) < (w > h ? 0.7 : w < h ? 0.3 : 0.5);   // a north-south road?
    const len = upright ? w : h;
    const lo = len >= 5 ? 2 : 1, hi = len >= 5 ? len - 3 : len - 2;  // keep at least a lot (two if there is room) each side
    // most cuts leave a strip exactly two lots deep on one side, which wastes the least land
    // (only when cutting depth: cuts along a strip land anywhere, so blocks come out different lengths)
    const deep = Math.min(w, h) > 2;
    const at = deep && len >= 5 && rnd(4) < 0.8 ? (rnd(5) < 0.5 ? 2 : len - 3) : lo + Math.floor(rnd(3) * (hi - lo + 1));
    if (upright) {
      for (let y = y0; y <= y1; y++) road.add(keyOf(x0 + at, y));
      split(x0, y0, x0 + at - 1, y1, depth + 1); split(x0 + at + 1, y0, x1, y1, depth + 1);
    } else {
      for (let x = x0; x <= x1; x++) road.add(keyOf(x, y0 + at));
      split(x0, y0, x1, y0 + at - 1, depth + 1); split(x0, y0 + at + 1, x1, y1, depth + 1);
    }
  };
  split(WORLD.x0, WORLD.y0, WORLD.x1, WORLD.y1, 0);
  // the town square: the roomiest block near the middle of the first town is paved, not built on
  const plaza = new Set();
  const inside = blocks.filter((b) => inHome(b.x0, b.y0) && inHome(b.x1, b.y1) && b.x1 > b.x0 && b.y1 > b.y0);
  inside.sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - 5, (a.y0 + a.y1) / 2 - 6.5) - Math.hypot((b.x0 + b.x1) / 2 - 5, (b.y0 + b.y1) / 2 - 6.5));
  const sq = inside[0];
  if (sq) for (let y = sq.y0; y <= Math.min(sq.y1, sq.y0 + 1); y++) for (let x = sq.x0; x <= Math.min(sq.x1, sq.x0 + 1); x++) plaza.add(keyOf(x, y));
  let homeLots = 0;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (!road.has(keyOf(x, y)) && !plaza.has(keyOf(x, y))) homeLots++;
  return { road, plaza, homeLots };
}

const plans = new Map();
/** The street plan for a town: { road, plaza } as sets of tile keys. Always leaves the first town plenty of lots. */
export function streetPlan(seed) {
  seed = (Number(seed) || 0) >>> 0;
  if (plans.has(seed)) return plans.get(seed);
  let best = null;
  for (let i = 0; i < 12; i++) {
    const p = cutPlan((seed + i * 7919) >>> 0);
    if (!best || p.homeLots > best.homeLots) best = p;
    if (p.homeLots >= 78) break;
  }
  if (plans.size > 8) plans.clear();
  plans.set(seed, best);
  return best;
}

/**
 * 'road' | 'plaza' | null for a tile. `streets` is 'plan' (a generated plan) or 'grid'
 * (the even grid that towns founded before street plans keep for ever).
 */
export function streetAt(seed, streets, x, y) {
  if (x < WORLD.x0 || y < WORLD.y0 || x > WORLD.x1 || y > WORLD.y1) return null;
  if (streets !== 'plan') return isRoad(x, y) ? 'road' : null;
  const p = streetPlan(seed);
  const k = keyOf(x, y);
  return p.road.has(k) ? 'road' : p.plaza.has(k) ? 'plaza' : null;
}

/** 'grass' | 'water' | 'sand' | 'mountain' | 'forest' for any tile, in or out of town. */
export function terrainAt(world, x, y) {
  if (inTown(x, y)) return 'grass';
  const south = y - (MAP_H - 1), north = -y;           // 1 = the first row outside town
  const toSea = world.seaSouth ? south : north;
  const toMtn = world.seaSouth ? north : south;
  const shore = Math.round(Math.sin(x * 0.8 + world.p1) * 0.7);
  if (toSea >= 5 + shore) return 'water';

  // the river runs from the mountains to the sea just outside one edge of town
  const base = world.riverWest ? -2 : MAP_W + 1;
  const bend = (yy) => base + Math.round(Math.sin(yy * 0.55 + world.p2) * 0.9);
  const a = bend(y), b = bend(y + (world.seaSouth ? -1 : 1));
  if (x >= Math.min(a, b) && x <= Math.max(a, b) && toMtn < 7) return 'water';

  if (toSea >= 3 + shore) return 'sand';
  const ridge = Math.round(Math.sin(x * 0.6 + world.p3) * 0.7);
  if (toMtn >= 5 + ridge) return 'mountain';
  if (toMtn >= 4 + ridge) return 'forest';

  const L = world.lake;
  const dx = (x + 0.5 - L.x) / L.rx, dy = (y + 0.5 - L.y) / L.ry;
  if (dx * dx + dy * dy <= 1) return 'water';

  // loose clumps of trees in the meadow
  const clump = Math.sin(x * 0.7 + world.p2) + Math.sin(y * 0.6 + world.p3);
  return hash(world.seed, x, y) < (clump > 0.6 ? 0.45 : 0.08) ? 'forest' : 'grass';
}
