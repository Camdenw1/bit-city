// Bit City — map renderer.
// Draws the town on one canvas and turns touches into pan / zoom / tap.
// It only ever READS game state; all animation state here is cosmetic and local.

import { MAP_W, MAP_H, TILE, isRoad, DAY_LENGTH_MS, BUILDINGS, WORLD, PARCELS, parcelAt } from './config.js';
import { initSprites, getSprite, getPerson, buildingSpriteId } from './sprites.js';
import { makeWorld, terrainAt } from './terrain.js';
import { isBuilt, bizStatus, problemOf, homesWithVacancy, unemployed, workersOf, tileAt, isLot, parcelInfo, isRoadAt, isPlazaAt } from './sim.js';

const SPRITE_H = 16;                 // building sprites are 16 x 16: each one fits its own lot
const OVERLAP = SPRITE_H - TILE;     // 0: nothing pokes into the tile above
const HUD_TOP = 120, HUD_BOTTOM = 104; // CSS px of menu bars that cover the map
const HOME_ZOOM = 1.5;               // default view is this much closer than "whole town"
const WALKER_SIZE = 2 / 3;           // residents are drawn smaller than the buildings' pixels
const INK = '#3b2f4a';
const TAP_MOVE_PX = 8;               // CSS px
const TAP_MS = 400;
const WALK_SPEED = 1.5;              // tiles per second
const TAXI_SPEED = 6;                // tiles per second
const TAXI_MIN_MS = 1200;
const MAX_WALKERS = 8;
const DIRS = [                       // index = direction id; bit = road mask bit
  { dx: 0, dy: -1, bit: 1, name: 'n' },
  { dx: 1, dy: 0, bit: 2, name: 'e' },
  { dx: 0, dy: 1, bit: 4, name: 's' },
  { dx: -1, dy: 0, bit: 8, name: 'w' },
];

// ---------- small pure helpers ----------

function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hashStr(v) {
  const s = String(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// The world is the first town plus the land around it; only owned parcels count as "the map".
const WW = WORLD.x1 - WORLD.x0 + 1, WH = WORLD.y1 - WORLD.y0 + 1;
const OWNED = new Set(['home']);     // parcel ids, kept in step with state.land by the renderer
const inMap = (x, y) => { const p = parcelAt(x, y); return !!p && OWNED.has(p.id); };
const tileKey = (x, y) => (y - WORLD.y0) * WW + (x - WORLD.x0);
let STREET = (x, y) => isRoad(x, y);      // this town's streets; set by the renderer from its state
const roadAt = (x, y) => inMap(x, y) && STREET(x, y);

function roadMask(x, y) {
  let m = 0;
  for (const d of DIRS) if (roadAt(x + d.dx, y + d.dy)) m |= d.bit;
  return m;
}

/** 0 = full day, 1 = deep night, for a time of day in hours (0 = midnight). */
function darknessAt(hourF) {
  if (hourF < 4.5) return 1;
  if (hourF < 7) return 1 - smooth((hourF - 4.5) / 2.5);
  if (hourF < 18) return 0;
  if (hourF < 20.5) return smooth((hourF - 18) / 2.5);
  return 1;
}

/**
 * Game time of day for the HUD. One full day lasts DAY_LENGTH_MS, 0 = midnight.
 * → { hour 0-23, minute 0-59, isNight, label '9:30am', t 0..1, darkness 0..1 }
 * The label is rounded down to 10 game minutes so the clock doesn't flicker.
 */
export function gameClock(now) {
  const t = (((Number(now) || 0) % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS / DAY_LENGTH_MS;
  const totalMin = Math.min(1439, Math.floor(t * 1440));
  const hour = Math.floor(totalMin / 60);
  const minute = totalMin % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const m10 = Math.floor(minute / 10) * 10;
  const label = `${h12}:${String(m10).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;
  return { hour, minute, isNight: hour < 6 || hour >= 20, label, t, darkness: darknessAt(t * 24) };
}

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// ---------- the renderer ----------

export function createRenderer(canvas, { getState, getNow } = {}) {
  initSprites();
  const ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';

  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const mapW = MAP_W * TILE;
  const mapH = MAP_H * TILE;

  // view (all in device pixels)
  let W = 1, H = 1, ratio = 1;         // canvas size, device px per CSS px
  let scale = 1, fitScale = 1, minScale = 1, maxScale = 5;
  let ox = 0, oy = 0;                  // device px of the map's top-left corner
  let userMoved = false;               // has the player panned/zoomed away from the default view?

  // cached static ground
  let ground = null, groundPad = 0, bgColor = '#8ecf7c';
  const roadTiles = [];                // owned road tiles, refilled by buildGround
  let groundKey = null;                // worldSeed + owned land the cached ground was drawn for
  let lotList = [];                    // buildable tiles on owned land: { x, y, sand }
  let saleSigns = [];                  // parcels that can be bought next: { id, x, y }

  // local cosmetic state
  const walkers = new Map();           // tenant id → walker
  const texts = [];
  const particles = [];
  let taxi = null;
  let selection = null;
  let reach = null;        // { x, y, r }: the area a town building serves, shown while its sheet is open
  const tapFns = [];
  let lastRt = clock();
  const alphaCache = new Map();        // sprite id → { w, h, data } | null
  const glowCache = new Map();         // sprite id → [{x, y}] window pixels

  // ---------- geometry ----------

  const toDevX = (ax) => ox + Math.round(ax) * scale;
  const toDevY = (ay) => oy + Math.round(ay) * scale;

  function clampView() {
    // ox, oy are the device px of tile (0,0); the world's own corner is wx, wy away from it
    const mw = WW * TILE * scale, mh = WH * TILE * scale;
    const wx = WORLD.x0 * TILE * scale, wy = WORLD.y0 * TILE * scale;
    const over = TILE * 3 * scale;       // how far past the land you can drag, to look at the landscape
    if (mw <= W) ox = Math.round((W - mw) / 2) - wx;
    else ox = clamp(Math.round(ox + wx), W - mw - over, over) - wx;
    // vertically the map may slide out from under the top bar and the bottom buttons
    const top = Math.round(HUD_TOP * ratio), bottom = Math.round(HUD_BOTTOM * ratio);
    if (mh <= H - top - bottom) oy = Math.round((H + top - bottom - mh) / 2) - wy;
    else oy = clamp(Math.round(oy + wy), H - mh - bottom - over, top + over) - wy;
  }

  function setScale(next, anchorDevX, anchorDevY) {
    next = clamp(Math.round(next), minScale, maxScale);
    if (next === scale) return;
    const ax = (anchorDevX - ox) / scale, ay = (anchorDevY - oy) / scale;
    scale = next;
    ox = anchorDevX - ax * scale;
    oy = anchorDevY - ay * scale;
    clampView();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cssW = rect.width || canvas.clientWidth || 300;
    const cssH = rect.height || canvas.clientHeight || 150;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    const centreArt = userMoved ? { x: (W / 2 - ox) / scale, y: (H / 2 - oy) / scale } : null;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    W = w; H = h; ratio = w / cssW;
    const margin = 8;                  // art px of breathing room around the map
    fitScale = Math.max(1, Math.floor(Math.min(W / (mapW + margin), H / (mapH + margin))));
    minScale = Math.max(1, fitScale - 2);      // far enough out to look over the land for sale
    maxScale = Math.max(fitScale + 2, Math.round(5 * ratio));
    if (centreArt) {
      scale = clamp(scale, minScale, maxScale);
      ox = W / 2 - centreArt.x * scale;
      oy = H / 2 - centreArt.y * scale;
    } else {
      // default view: zoomed in on the town so lots are easy to tap; pinch out to see all of it
      scale = clamp(Math.round(fitScale * HOME_ZOOM), fitScale, maxScale);
      const c = townCentre();
      ox = W / 2 - c.x * scale;
      oy = (H + (HUD_TOP - HUD_BOTTOM) * ratio) / 2 - c.y * scale;
    }
    clampView();
    ctx.imageSmoothingEnabled = false;
    buildGround();
  }

  /** Middle of everything built so far (art px); the middle of the map for an empty town. */
  function townCentre() {
    const bs = ((getState && getState())?.buildings || []).filter((b) => inMap(b.x, b.y));
    if (!bs.length) return { x: mapW / 2, y: mapH / 2 };
    const xs = bs.map((b) => b.x), ys = bs.map((b) => b.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs) + 1) / 2 * TILE,
      y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 * TILE,
    };
  }

  function tileToScreen(x, y) {
    return {
      x: (ox + (x * TILE + TILE / 2) * scale) / ratio,
      y: (oy + (y * TILE + TILE / 2) * scale) / ratio,
    };
  }

  // ---------- static ground (grass + roads), rebuilt on resize ----------

  function grassId(x, y, allowFlowers) {
    const h = hash2(x, y);
    if (allowFlowers && h > 0.9) return 'grass2';
    return h > 0.58 ? 'grass1' : 'grass0';
  }

  function buildGround() {
    const state = getState ? getState() : null;
    OWNED.clear();
    for (const id of state?.land || ['home']) OWNED.add(id);
    const seed = state?.worldSeed ?? 0;
    groundKey = `${seed}|${[...OWNED].join(',')}`;
    STREET = state ? (x, y) => isRoadAt(state, x, y) : (x, y) => isRoad(x, y);
    // enough extra landscape around the world to fill the screen at the smallest zoom
    groundPad = clamp(Math.ceil(Math.max(W, H) / minScale / TILE / 2) + 2, 3, 30);
    const g = document.createElement('canvas');
    g.width = (WW + groundPad * 2) * TILE;
    g.height = (WH + groundPad * 2) * TILE;
    const c = g.getContext('2d');
    c.imageSmoothingEnabled = false;
    const world = makeWorld(seed);
    const land = (x, y) => terrainAt(world, x, y) !== 'water';
    const sceneryId = (x, y) => {
      const kind = terrainAt(world, x, y);
      if (kind === 'water') return `water${(land(x, y - 1) ? 1 : 0) | (land(x + 1, y) ? 2 : 0) | (land(x, y + 1) ? 4 : 0) | (land(x - 1, y) ? 8 : 0)}`;
      if (kind === 'sand' || kind === 'mountain') return kind;
      return kind === 'forest' ? 'tree' : grassId(x, y, true);
    };
    lotList = [];
    for (let ty = WORLD.y0 - groundPad; ty <= WORLD.y1 + groundPad; ty++) {
      for (let tx = WORLD.x0 - groundPad; tx <= WORLD.x1 + groundPad; tx++) {
        const mine = inMap(tx, ty);
        // roads cross water as bridges; everything else on owned land keeps its terrain
        const id = roadAt(tx, ty) ? `road${roadMask(tx, ty)}` : mine && state && isPlazaAt(state, tx, ty) ? 'plaza' : sceneryId(tx, ty);
        const px = (tx - WORLD.x0 + groundPad) * TILE, py = (ty - WORLD.y0 + groundPad) * TILE;
        c.drawImage(getSprite(id), px, py);
        if (!mine) {                        // land that isn't yours yet is a touch deeper
          c.fillStyle = 'rgba(46, 92, 78, 0.16)';
          c.fillRect(px, py, TILE, TILE);
        } else if (state && safe(() => isLot(state, tx, ty), false)) {
          lotList.push({ x: tx, y: ty, sand: terrainAt(world, tx, ty) === 'sand' });
        }
      }
    }
    // a "for sale" sign in the middle of each parcel that can be bought next
    saleSigns = [];
    if (state) {
      for (const p of PARCELS) {
        const info = safe(() => parcelInfo(state, p.id), null);
        if (info && !info.owned && info.reachable) saleSigns.push({ id: p.id, x: Math.floor((p.x0 + p.x1) / 2), y: Math.floor((p.y0 + p.y1) / 2) });
      }
    }
    roadTiles.length = 0;
    for (let y = WORLD.y0; y <= WORLD.y1; y++) for (let x = WORLD.x0; x <= WORLD.x1; x++) if (roadAt(x, y)) roadTiles.push({ x, y });
    ground = g;
    // fallback fill colour = the colour of the far meadow, so nothing ever looks broken
    try {
      const d = c.getImageData(0, 0, TILE, TILE).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      bgColor = `rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})`;
    } catch { /* keep default */ }
  }

  // ---------- sprite helpers ----------

  function blit(sprite, ax, ay) {
    ctx.drawImage(sprite, toDevX(ax), toDevY(ay), sprite.width * scale, sprite.height * scale);
  }
  function rect(ax, ay, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(toDevX(ax), toDevY(ay), Math.round(w) * scale, Math.round(h) * scale);
  }

  function alphaOf(id) {
    if (alphaCache.has(id)) return alphaCache.get(id);
    let res = null;
    try {
      const s = getSprite(id);
      const d = s.getContext('2d').getImageData(0, 0, s.width, s.height);
      res = { w: s.width, h: s.height, data: d.data };
    } catch { res = null; }
    alphaCache.set(id, res);
    return res;
  }
  /** Is the sprite opaque at (px, py)? Padded by 1 px so thin outlines are easy to hit. */
  function spriteOpaque(id, px, py) {
    const a = alphaOf(id);
    if (!a) return true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.floor(px) + dx, y = Math.floor(py) + dy;
        if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
        if (a.data[(y * a.w + x) * 4 + 3] > 40) return true;
      }
    }
    return false;
  }

  /** Window pixels of a building sprite: cool, light "glass" coloured pixels in its body. */
  function glowPixels(id) {
    if (glowCache.has(id)) return glowCache.get(id);
    const out = [];
    const a = alphaOf(id);
    if (a) {
      for (let y = 1; y < a.h - 1; y++) {
        for (let x = 1; x < a.w - 1; x++) {
          const i = (y * a.w + x) * 4;
          const r = a.data[i], g = a.data[i + 1], b = a.data[i + 2];
          if (a.data[i + 3] < 200) continue;
          // exactly the two glass colours of the palette (sky, skyLight), so blue roofs and signs don't light up
          if ((r === 0x8e && g === 0xd1 && b === 0xec) || (r === 0xcd && g === 0xef && b === 0xf5)) out.push({ x, y });
        }
      }
    }
    // sprites that are mostly blue (e.g. water) are not "windows" — skip those
    const res = out.length > 0 && out.length <= 40 ? out : [];
    glowCache.set(id, res);
    return res;
  }

  // ---------- per-frame derived info ----------

  function bubbleFor(b, f) {
    if (f.ride && f.ride.state === 'waiting' && f.ride.fromId === b.id) {
      return f.ride.kind === 'delivery' ? 'parcel' : 'taxi';
    }
    if (!f.built.get(b)) return null;
    const cfg = BUILDINGS[b.type];
    if (!cfg) return null;
    if (cfg.kind === 'biz') {
      if (safe(() => bizStatus(f.state, b, f.now), null) === 'out-of-stock') return 'box';
      if (safe(() => problemOf(f.state, b.id), null)) return 'trouble';
      if (f.anyUnemployed) {
        const slots = cfg.slots ?? 2;
        if (safe(() => workersOf(f.state, b.id).length, slots) < slots) return 'briefcase';
      }
    } else if (cfg.kind === 'home') {
      if (f.vacantIds.has(b.id)) return 'key';
    }
    return null;
  }

  function frameInfo(state, now) {
    const f = { state, now, ride: state.ride || null, built: new Map(), bubbles: new Map(), rows: [] };
    for (let y = 0; y < WH; y++) f.rows.push([]);
    f.vacantIds = new Set(safe(() => homesWithVacancy(state, now), []).map((h) => h.id));
    f.anyUnemployed = safe(() => unemployed(state).length > 0, false);
    for (const b of state.buildings || []) {
      if (!inMap(b.x, b.y)) continue;
      f.built.set(b, !!safe(() => isBuilt(b, now), now >= b.readyAt));
      f.rows[b.y - WORLD.y0].push(b);
    }
    for (const b of state.buildings || []) {
      if (!inMap(b.x, b.y)) continue;
      const icon = bubbleFor(b, f);
      if (icon) f.bubbles.set(b, icon);
    }
    return f;
  }

  const bobOf = (b, rt) => (Math.sin(rt / 1000 * Math.PI * 2 + hashStr(b.id ?? `${b.x},${b.y}`) * Math.PI * 2) > 0 ? -1 : 0);
  // the taxi bubble sits on its own building, so it never hides the row behind
  const bubbleTop = (b) => b.y * TILE;

  // ---------- walkers (cosmetic residents on the roads) ----------



  function pickDir(w) {
    const options = [];
    for (let d = 0; d < 4; d++) if (roadAt(w.x + DIRS[d].dx, w.y + DIRS[d].dy)) options.push(d);
    if (!options.length) return -1;
    const back = (w.dir + 2) % 4;
    const forward = options.filter((d) => d !== back);
    if (!forward.length) return back;
    if (forward.includes(w.dir) && Math.random() < 0.6) return w.dir;
    return forward[Math.floor(Math.random() * forward.length)];
  }

  function makeWalker(tenant) {
    const t = roadTiles[Math.floor(Math.random() * roadTiles.length)] || { x: 0, y: 0 };
    const h = hashStr(tenant.id);
    const w = {
      x: t.x, y: t.y, dir: Math.floor(Math.random() * 4), t: Math.random(),
      latX: Math.round(h * 8) - 4,                    // -4..4, keeps the 8 px body inside the road tile
      latY: Math.round(hashStr(`y${tenant.id}`) * 4) - 3, // feet stay in the upper half of the road
      phase: h * 1000, speed: WALK_SPEED * (0.85 + hashStr(`s${tenant.id}`) * 0.3), facing: 1,
    };
    w.dir = pickDir(w);
    return w;
  }

  function updateWalkers(state, dt) {
    const tenants = (state.tenants || []).filter((t) => t && t.homeId != null).slice(0, MAX_WALKERS);
    const seen = new Set();
    for (const tenant of tenants) {
      seen.add(tenant.id);
      let w = walkers.get(tenant.id);
      if (!w) { w = makeWalker(tenant); walkers.set(tenant.id, w); }
      w.look = tenant.look;
      if (w.dir < 0) continue;
      w.t += (dt / 1000) * w.speed;
      let guard = 0;
      while (w.t >= 1 && guard++ < 8) {
        w.t -= 1;
        w.x += DIRS[w.dir].dx; w.y += DIRS[w.dir].dy;
        w.dir = pickDir(w);
        if (w.dir < 0) { w.t = 0; break; }
      }
      if (w.dir === 1) w.facing = 1; else if (w.dir === 3) w.facing = -1;
    }
    for (const id of walkers.keys()) if (!seen.has(id)) walkers.delete(id);
  }

  function walkerPos(w) {
    const d = w.dir >= 0 ? DIRS[w.dir] : { dx: 0, dy: 0 };
    return {
      x: (w.x + d.dx * w.t) * TILE + TILE / 2 + w.latX,   // centre x
      y: (w.y + d.dy * w.t) * TILE + 8 + w.latY,          // feet y
    };
  }

  function drawWalker(w, rt) {
    const p = walkerPos(w);
    const frame = w.dir < 0 ? 0 : Math.floor((rt + w.phase) / 170) % 2;
    const s = safe(() => getPerson(w.look || {}, frame), null);
    if (!s) return;
    const ws = Math.max(1, Math.round(scale * WALKER_SIZE));   // whole device px, so they stay crisp
    const dw = s.width * ws, dh = s.height * ws;
    const dx = toDevX(p.x) - Math.round(dw / 2), dy = toDevY(p.y) - dh;
    // tiny ground shadow
    ctx.fillStyle = 'rgba(40, 30, 60, 0.22)';
    ctx.fillRect(dx + ws, dy + dh - ws, dw - 2 * ws, ws);
    if (w.facing < 0) {
      ctx.save();
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(s, 0, 0, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(s, dx, dy, dw, dh);
    }
  }

  // ---------- taxi ----------

  function nearestRoad(tile) {
    if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return null;
    const x = Math.round(tile.x), y = Math.round(tile.y);
    if (roadAt(x, y)) return { x, y };
    for (const d of [2, 0, 1, 3]) {           // prefer the road in front (south), then N, E, W
      const nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
      if (roadAt(nx, ny)) return { x: nx, y: ny };
    }
    let best = null, bestD = Infinity;
    for (const r of roadTiles) {
      const dd = Math.abs(r.x - x) + Math.abs(r.y - y);
      if (dd < bestD) { bestD = dd; best = r; }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  function bfsPath(from, to) {
    if (!from || !to) return null;
    const key = tileKey;
    const prev = new Map([[key(from.x, from.y), -1]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      if (cur.x === to.x && cur.y === to.y) {
        const path = [];
        let k = key(cur.x, cur.y);
        while (k !== -1) { path.push({ x: (k % WW) + WORLD.x0, y: Math.floor(k / WW) + WORLD.y0 }); k = prev.get(k); }
        return path.reverse();
      }
      for (const d of DIRS) {
        const nx = cur.x + d.dx, ny = cur.y + d.dy;
        if (!roadAt(nx, ny) || prev.has(key(nx, ny))) continue;
        prev.set(key(nx, ny), key(cur.x, cur.y));
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  function finishTaxi(job) {
    if (!job || job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    if (taxi === job) taxi = null;
    if (typeof job.onDone === 'function') job.onDone();
  }

  function driveTaxi(fromTile, toTile, onDone, delivery = false) {
    if (taxi) finishTaxi(taxi);              // never leave an earlier ride hanging
    const path = bfsPath(nearestRoad(fromTile), nearestRoad(toTile));
    const steps = path ? path.length - 1 : 0;
    const job = {
      path, onDone, delivery, done: false, start: clock(),
      duration: Math.max(TAXI_MIN_MS, (steps / TAXI_SPEED) * 1000),
      dir: 'e',
    };
    if (path && steps > 0) {
      const dx = path[1].x - path[0].x, dy = path[1].y - path[0].y;
      job.dir = dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n';
    }
    // safety net: onDone still fires if drawing stops (e.g. the tab is hidden)
    job.timer = setTimeout(() => finishTaxi(job), job.duration + 400);
    taxi = job;
  }

  function taxiPos(job, rt) {
    if (!job.path) return null;
    const steps = job.path.length - 1;
    const p = clamp((rt - job.start) / job.duration, 0, 1);
    if (steps <= 0) return { x: job.path[0].x * TILE + 8, y: job.path[0].y * TILE + 6, dir: job.dir };
    // ease in/out a little so it feels like a car, not a cursor
    const e = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    const f = Math.min(steps - 1e-6, e * steps);
    const i = Math.floor(f), t = f - i;
    const a = job.path[i], b = job.path[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    job.dir = dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n';
    return { x: lerp(a.x, b.x, t) * TILE + 8, y: lerp(a.y, b.y, t) * TILE + 6, dir: job.dir };
  }

  function drawTaxi(pos, night) {
    const s = getSprite(`taxi_${pos.dir}`);
    const ax = Math.round(pos.x - s.width / 2), ay = Math.round(pos.y - s.height / 2);
    ctx.fillStyle = 'rgba(40, 30, 60, 0.25)';
    ctx.fillRect(toDevX(ax + 1), toDevY(ay + s.height - 1), (s.width - 2) * scale, 2 * scale);
    blit(s, ax, ay);
    if (taxi.delivery) blit(getSprite('box'), Math.round(pos.x) - 5, ay - 7);
    if (night > 0.3) {                         // headlights
      ctx.fillStyle = `rgba(255, 236, 160, ${0.35 * night})`;
      const L = 7;
      if (pos.dir === 'e') ctx.fillRect(toDevX(ax + s.width), toDevY(ay + 2), L * scale, (s.height - 4) * scale);
      else if (pos.dir === 'w') ctx.fillRect(toDevX(ax - L), toDevY(ay + 2), L * scale, (s.height - 4) * scale);
      else if (pos.dir === 's') ctx.fillRect(toDevX(ax + 2), toDevY(ay + s.height), (s.width - 4) * scale, L * scale);
      else ctx.fillRect(toDevX(ax + 2), toDevY(ay - L), (s.width - 4) * scale, L * scale);
    }
  }

  // ---------- effects ----------

  function floatText(x, y, text, color) {
    // nudge texts that pile up on the same tile so they don't sit on top of each other
    const rt = clock();
    let stack = 0;
    for (const t of texts) if (t.tx === x && t.ty === y && rt - t.start < 350) stack++;
    texts.push({ tx: x, ty: y, text: String(text), color: color || '#ffffff', start: rt + stack * 140, life: 1200 });
    if (texts.length > 40) texts.shift();
  }

  const BURSTS = {
    coins: { n: 9, colors: ['#f2c14e', '#ffe08a', '#d99a2b'], life: [600, 900], grav: 150, shape: 'coin' },
    stars: { n: 10, colors: ['#ffe66b', '#fff6c8', '#f2c14e'], life: [600, 950], grav: 0, shape: 'star' },
    hearts: { n: 6, colors: ['#e85d8a', '#ff8fb0', '#f4a6c0'], life: [800, 1150], grav: -12, shape: 'heart' },
    dust: { n: 9, colors: ['#e8dcc0', '#cfc3a8', '#fff6e0'], life: [450, 750], grav: -8, shape: 'puff' },
  };

  function burst(x, y, kind) {
    const k = BURSTS[kind] || BURSTS.dust;
    const cx = x * TILE + TILE / 2;
    const rt = clock();
    for (let i = 0; i < k.n; i++) {
      const ang = (i / k.n) * Math.PI * 2 + Math.random() * 0.6;
      let vx, vy, py = y * TILE + 6;
      if (k.shape === 'coin') { vx = Math.cos(ang) * (14 + Math.random() * 14); vy = -45 - Math.random() * 35; }
      else if (k.shape === 'star') { const sp = 20 + Math.random() * 22; vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp - 6; py -= 2; }
      else if (k.shape === 'heart') { vx = (Math.random() - 0.5) * 16; vy = -16 - Math.random() * 12; }
      else { vx = Math.cos(ang) * (16 + Math.random() * 10); vy = -Math.abs(Math.sin(ang)) * 8 - 2; py = y * TILE + 13; }
      particles.push({
        x: cx + (Math.random() - 0.5) * 6, y: py, vx, vy, grav: k.grav, shape: k.shape,
        color: k.colors[i % k.colors.length], start: rt + (k.shape === 'heart' ? i * 70 : 0),
        life: k.life[0] + Math.random() * (k.life[1] - k.life[0]), last: rt,
      });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  function drawParticle(p, age) {
    const x = Math.round(p.x), y = Math.round(p.y);
    const k = age / p.life;
    ctx.globalAlpha = k > 0.7 ? clamp(1 - (k - 0.7) / 0.3, 0, 1) : 1;
    if (p.shape === 'coin') {
      rect(x - 1, y - 1, 2, 2, INK);
      rect(x - 1, y - 1, 2, 2, p.color);
      rect(x - 1, y - 1, 1, 1, '#fff6c8');
    } else if (p.shape === 'star') {
      if (k < 0.6) { rect(x - 1, y, 3, 1, p.color); rect(x, y - 1, 1, 3, p.color); rect(x, y, 1, 1, '#ffffff'); }
      else rect(x, y, 1, 1, p.color);
    } else if (p.shape === 'heart') {
      rect(x - 2, y - 1, 2, 2, p.color); rect(x + 1, y - 1, 2, 2, p.color);
      rect(x - 1, y, 3, 2, p.color); rect(x, y + 2, 1, 1, p.color);
      rect(x - 2, y - 1, 1, 1, '#ffd3e0');
    } else {
      const sz = k < 0.5 ? 3 : k < 0.8 ? 2 : 1;
      rect(x - 1, y - 1, sz, sz, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawEffects(rt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = rt - p.start;
      if (age < 0) { p.last = rt; continue; }
      if (age >= p.life) { particles.splice(i, 1); continue; }
      const dt = Math.min(0.1, (rt - p.last) / 1000);
      p.last = rt;
      p.vy += p.grav * dt;
      if (p.shape === 'puff' || p.shape === 'star') { p.vx *= 1 - 2.2 * dt; p.vy *= 1 - 2.2 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      drawParticle(p, age);
    }
    if (!texts.length) return;
    const px = Math.max(8, 7 * scale);
    ctx.font = `bold ${px}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      const age = rt - t.start;
      if (age < 0) continue;
      if (age >= t.life) { texts.splice(i, 1); continue; }
      const k = age / t.life;
      const rise = 16 * (1 - (1 - k) * (1 - k));           // ease-out, in art px
      const pop = k < 0.12 ? 1 - k / 0.12 : 0;               // tiny hop at the start
      const dx = toDevX(t.tx * TILE + TILE / 2);
      const dy = toDevY(t.ty * TILE - 2 - rise - pop * 2);
      ctx.globalAlpha = k > 0.6 ? clamp(1 - (k - 0.6) / 0.4, 0, 1) : 1;
      ctx.lineWidth = Math.max(2, scale * 1.6);
      ctx.strokeStyle = INK;
      ctx.strokeText(t.text, dx, dy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, dx, dy);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- map pieces ----------

  function drawBuilding(b, f) {
    const top = b.y * TILE - OVERLAP;
    if (f.built.get(b)) {
      blit(getSprite(buildingSpriteId(b)), b.x * TILE, top);
      // upgraded buildings wear a gold star per level above the first
      for (let i = 1; i < (b.level || 1); i++) blit(getSprite('pip'), b.x * TILE + (i - 1) * 6, b.y * TILE - 1);   // on the roof, clear of the shop's picture
      return;
    }
    blit(getSprite('site'), b.x * TILE, top);
    const cfg = BUILDINGS[b.type];
    const total = Math.max(1, (cfg?.buildSecs ?? 1) * 1000);
    const p = clamp(1 - (b.readyAt - f.now) / total, 0, 1);
    const bx = b.x * TILE + 1, by = b.y * TILE + TILE - 5;
    rect(bx, by, 14, 4, INK);
    rect(bx + 1, by + 1, 12, 2, '#fff6e0');
    const fill = Math.round(12 * p);
    if (fill > 0) {
      rect(bx + 1, by + 1, fill, 2, '#5bb450');
      rect(bx + 1, by + 1, fill, 1, '#8fd97f');
    }
  }

  function drawOutline(ax, ay, w, h, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const x0 = toDevX(ax), y0 = toDevY(ay), dw = w * scale, dh = h * scale, s = scale;
    // rounded: leave the corner pixels out
    ctx.fillRect(x0 + s, y0, dw - 2 * s, s);
    ctx.fillRect(x0 + s, y0 + dh - s, dw - 2 * s, s);
    ctx.fillRect(x0, y0 + s, s, dh - 2 * s);
    ctx.fillRect(x0 + dw - s, y0 + s, s, dh - 2 * s);
    ctx.globalAlpha = 1;
  }

  function drawRing(b, rt) {
    const pulse = 0.5 + 0.5 * Math.sin(rt / 1000 * Math.PI * 2 * 1.1 + (b.x + b.y) * 0.5);
    const grow = pulse > 0.55 ? 1 : 0;
    const ax = b.x * TILE - 1 - grow, ay = b.y * TILE - 1 - grow;
    const w = TILE + 2 + grow * 2, h = TILE + 2 + grow * 2;
    drawOutline(ax - 1, ay - 1, w + 2, h + 2, '#fff2a8', 0.16 + 0.18 * pulse);   // soft halo
    drawOutline(ax, ay, w, h, '#fff6c8', 0.5 + 0.4 * pulse);
  }

  function drawSelection(sel, rt) {
    const pulse = Math.sin(rt / 1000 * Math.PI * 2 * 1.4) > 0 ? 1 : 0;
    const ax = sel.x * TILE - 1 - pulse, ay = sel.y * TILE - 1 - pulse, sz = TILE + 2 + pulse * 2;
    drawOutline(ax - 1, ay - 1, sz + 2, sz + 2, INK, 0.75);
    drawOutline(ax, ay, sz, sz, '#ffffff', 1);
  }

  function drawGlow(b, darkness) {
    const pts = glowPixels(buildingSpriteId(b));
    if (!pts.length) return;
    const top = b.y * TILE - OVERLAP;
    // a few windows stay dark so the town doesn't look uniform
    const seed = hashStr(b.id ?? `${b.x},${b.y}`);
    ctx.globalAlpha = clamp((darkness - 0.35) / 0.4, 0, 1) * 0.92;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (hash2(p.x + Math.floor(seed * 97), Math.floor(p.y / 3) * 7 + Math.floor(p.x / 4)) < 0.18) continue;
      rect(b.x * TILE + p.x, top + p.y, 1, 1, (p.x + p.y) % 2 ? '#ffd97a' : '#ffe9a6');
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the frame ----------

  function draw(now) {
    if (now == null) now = getNow ? getNow() : Date.now();
    const rt = clock();
    const dt = clamp(rt - lastRt, 0, 250);
    lastRt = rt;
    if (!ground) resize();
    else { const st = getState && getState(); if (st && `${st.worldSeed ?? 0}|${(st.land || ['home']).join(',')}` !== groundKey) buildGround(); }   // new town or new land

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    if (ground) {
      const p = groundPad * TILE * scale;
      ctx.drawImage(ground, ox + WORLD.x0 * TILE * scale - p, oy + WORLD.y0 * TILE * scale - p, ground.width * scale, ground.height * scale);
    }

    const state = getState ? getState() : null;
    const day = gameClock(now);
    const darkness = day.darkness;
    const f = state ? frameInfo(state, now) : null;

    if (f) {
      // empty-lot markers
      const lot = getSprite('lot'), lotSand = getSprite('lot_sand');
      const taken = new Set();
      for (const row of f.rows) for (const b of row) taken.add(tileKey(b.x, b.y));
      for (const l of lotList) if (!taken.has(tileKey(l.x, l.y))) blit(l.sand ? lotSand : lot, l.x * TILE, l.y * TILE);
      // land you can buy next
      const sign = getSprite('sign');
      for (const sg of saleSigns) blit(sign, sg.x * TILE, sg.y * TILE + (Math.sin(rt / 400 + sg.x) > 0 ? -1 : 0));

      // movers, bucketed by the row their feet are in
      updateWalkers(state, dt);
      const movers = [];
      for (const w of walkers.values()) {
        const p = walkerPos(w);
        movers.push({ y: p.y, draw: () => drawWalker(w, rt) });
      }
      if (taxi && taxi.path) {
        if (rt - taxi.start >= taxi.duration) finishTaxi(taxi);
        else {
          const pos = taxiPos(taxi, rt);
          const s = getSprite(`taxi_${pos.dir}`);
          movers.push({ y: pos.y + s.height / 2, draw: () => drawTaxi(pos, darkness) });
        }
      } else if (taxi && rt - taxi.start >= taxi.duration) {
        finishTaxi(taxi);
      }
      movers.sort((a, b) => a.y - b.y);

      // rows top to bottom: buildings of the row, then anything standing in that row
      let mi = 0;
      while (mi < movers.length && movers[mi].y < WORLD.y0 * TILE) movers[mi++].draw();
      for (let y = WORLD.y0; y <= WORLD.y1; y++) {
        const row = f.rows[y - WORLD.y0];
        for (const b of row) drawBuilding(b, f);
        const limit = (y + 1) * TILE;
        while (mi < movers.length && movers[mi].y < limit) movers[mi++].draw();
      }
      while (mi < movers.length) movers[mi++].draw();
    } else if (taxi && rt - taxi.start >= taxi.duration) {
      finishTaxi(taxi);
    }

    // night: a gentle blue multiply over everything drawn so far (never darker than ~45% brightness)
    if (darkness > 0.01) {
      const hourF = day.t * 24;
      // warm blush around sunrise / sunset, cool blue at night
      const warm = clamp(1 - Math.abs(darkness - 0.45) / 0.45, 0, 1) * 0.6;
      const nr = lerp(255, lerp(168, 240, warm), darkness);
      const ng = lerp(255, lerp(178, 190, warm), darkness);
      const nb = lerp(255, lerp(228, 200, warm), darkness);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${Math.round(nr)},${Math.round(ng)},${Math.round(nb)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      void hourF;
    }

    if (f) {
      if (darkness > 0.35) for (const row of f.rows) for (const b of row) if (f.built.get(b)) drawGlow(b, darkness);

      // destination candidates while the player is choosing where the rider wants to go
      if (f.ride && f.ride.state === 'choosing') {
        for (const row of f.rows) for (const b of row) {
          const target = f.ride.kind === 'delivery' ? b.id === f.ride.toId : b.id !== f.ride.fromId;
          if (f.built.get(b) && target) drawRing(b, rt);
        }
      }

      // jobs board: homes on the courier route, and Pip the lost dog
      const job = f.state.job;
      if (job && job.kind === 'courier') {
        for (const row of f.rows) for (const b of row) if (job.stops.includes(b.id)) drawRing(b, rt);
      }
      if (job && job.kind === 'lost') {
        const dog = getSprite('dog');
        const hop = Math.sin(rt / 1000 * Math.PI * 2 * 1.5) > 0 ? -1 : 0;
        blit(dog, job.x * TILE + Math.floor((TILE - dog.width) / 2), job.y * TILE + 3 + hop);
      }
      if (reach) {
        const side = (reach.r * 2 + 1) * TILE;
        const ax = (reach.x - reach.r) * TILE, ay = (reach.y - reach.r) * TILE;
        ctx.globalAlpha = 0.16; ctx.fillStyle = '#fff6c8';
        ctx.fillRect(toDevX(ax), toDevY(ay), side * scale, side * scale);
        drawOutline(ax, ay, side, side, '#fff6c8', 0.9);
        ctx.globalAlpha = 1;
      }
      if (selection && inMap(selection.x, selection.y)) drawSelection(selection, rt);

      // status bubbles, always at full brightness so they read at night too
      const bubble = getSprite('bubble');
      for (const row of f.rows) for (const b of row) {
        const icon = f.bubbles.get(b);
        if (!icon) continue;
        const by = bubbleTop(b) + bobOf(b, rt);
        const ic = getSprite(icon === 'parcel' ? 'box' : icon);
        // Gentle hints (vacancy, open job) are a small badge on the building's own corner,
        // so a busy town doesn't fill with bubbles and nothing covers the lot behind.
        if (icon === 'key' || icon === 'briefcase') {
          blit(getSprite(icon === 'key' ? 'hint_home' : 'hint_job'), b.x * TILE + 11, b.y * TILE + bobOf(b, rt));
          continue;
        }
        if (icon === 'trouble') {             // a shop problem: same corner as sold out, tap the shop to see it
          blit(getSprite('hint_trouble'), b.x * TILE, b.y * TILE + bobOf(b, rt));
          continue;
        }
        if (icon === 'box') {                 // sold out: a bigger badge on the other corner, one tap restocks
          blit(getSprite('hint_stock'), b.x * TILE, b.y * TILE + bobOf(b, rt));
          continue;
        }
        blit(bubble, b.x * TILE + (TILE - bubble.width) / 2, by);
        blit(ic, b.x * TILE + Math.floor((TILE - ic.width) / 2), by + Math.max(0, Math.floor((12 - ic.height) / 2)) + 1);
      }
    }

    drawEffects(rt);
  }

  // ---------- hit testing ----------

  function hitTest(ax, ay) {
    const state = getState ? getState() : null;
    if (!state) return null;
    const now = getNow ? getNow() : Date.now();
    const tx = Math.floor(ax / TILE), ty = Math.floor(ay / TILE);
    const at = (x, y) => (inMap(x, y) ? safe(() => tileAt(state, x, y), null) : null);
    const hit = (b) => ({ x: b.x, y: b.y, building: b });

    // 1. status bubbles (drawn on top of everything): the building one or two rows below
    const f = frameInfo(state, now);
    for (const dy of [1, 2, 0]) {
      const b = at(tx, ty + dy);
      const kind = b ? f.bubbles.get(b) : null;
      if (kind !== 'taxi' && kind !== 'parcel') continue;
      const top = bubbleTop(b) + bobOf(b, clock());
      if (ax >= b.x * TILE + 1 && ax < b.x * TILE + 15 && ay >= top - 1 && ay < top + 13) return { ...hit(b), activity: kind };
    }
    // 2. the tall sprite of the building just below pokes 8 px into this tile
    const below = at(tx, ty + 1);
    if (below) {
      const id = f.built.get(below) ? below.type : 'site';
      const py = ay - (below.y * TILE - OVERLAP);
      if (py >= 0 && py < OVERLAP && spriteOpaque(id, ax - below.x * TILE, py)) return hit(below);
    }
    // 3. the tapped tile itself
    const parcel = parcelAt(tx, ty);
    if (parcel && !OWNED.has(parcel.id)) return { x: tx, y: ty, building: null, parcel: parcel.id };   // land for sale
    // Pip the lost dog can sit on a road, which is otherwise not tappable
    if (state.job && state.job.kind === 'lost' && state.job.x === tx && state.job.y === ty) return { x: tx, y: ty, building: null };
    if (!inMap(tx, ty) || !safe(() => isLot(state, tx, ty), true)) return null;
    return { x: tx, y: ty, building: at(tx, ty) || null };
  }

  // ---------- input ----------

  const pointers = new Map();          // pointerId → { x, y } in device px
  let gesture = null;                  // { kind: 'pan' | 'pinch', ... }
  let tapCandidate = null;

  function devPoint(e) {
    const r = canvas.getBoundingClientRect();
    const k = r.width ? canvas.width / r.width : ratio;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    gesture = {
      kind: 'pinch', startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), startScale: scale,
      artX: (mx - ox) / scale, artY: (my - oy) / scale,
    };
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = devPoint(e);
    pointers.set(e.pointerId, p);
    safe(() => canvas.setPointerCapture(e.pointerId));
    if (pointers.size === 1) {
      gesture = { kind: 'pan', lastX: p.x, lastY: p.y };
      tapCandidate = { id: e.pointerId, x: p.x, y: p.y, time: clock(), moved: false };
    } else if (pointers.size === 2) {
      tapCandidate = null;
      startPinch();
    }
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const q = devPoint(e);
    p.x = q.x; p.y = q.y;
    if (pointers.size >= 2 && gesture && gesture.kind === 'pinch') {
      const [a, b] = [...pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const next = clamp(Math.round(gesture.startScale * dist / gesture.startDist), minScale, maxScale);
      scale = next;
      ox = mx - gesture.artX * scale;
      oy = my - gesture.artY * scale;
      clampView();
      userMoved = true;
    } else if (gesture && gesture.kind === 'pan' && pointers.size === 1) {
      if (tapCandidate && !tapCandidate.moved) {
        if (Math.hypot(q.x - tapCandidate.x, q.y - tapCandidate.y) > TAP_MOVE_PX * ratio) tapCandidate.moved = true;
        else return;                         // don't jitter the map under a tap
      }
      ox += q.x - gesture.lastX; oy += q.y - gesture.lastY;
      gesture.lastX = q.x; gesture.lastY = q.y;
      clampView();
      userMoved = true;
    }
    if (e.cancelable) e.preventDefault();
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const q = e.type === 'pointerup' ? devPoint(e) : p;
    pointers.delete(e.pointerId);
    safe(() => canvas.releasePointerCapture(e.pointerId));
    const tc = tapCandidate;
    if (pointers.size === 1) {
      // one finger left after a pinch: carry on panning from where it is, never a tap
      const rest = [...pointers.values()][0];
      gesture = { kind: 'pan', lastX: rest.x, lastY: rest.y };
      tapCandidate = null;
      return;
    }
    if (pointers.size === 0) gesture = null;
    if (e.type !== 'pointerup' || !tc || tc.id !== e.pointerId) { tapCandidate = null; return; }
    tapCandidate = null;
    const moved = tc.moved || Math.hypot(q.x - tc.x, q.y - tc.y) > TAP_MOVE_PX * ratio;
    if (moved || clock() - tc.time > TAP_MS) return;
    const res = hitTest((tc.x - ox) / scale, (tc.y - oy) / scale);
    if (res) for (const fn of tapFns.slice()) fn(res);
  }

  let wheelAcc = 0;
  function onWheel(e) {
    e.preventDefault();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    const step = wheelAcc < 0 ? 1 : -1;
    wheelAcc = 0;
    const p = devPoint(e);
    setScale(scale + step, p.x, p.y);
    userMoved = true;
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function onTap(fn) {
    if (typeof fn !== 'function') return () => {};
    tapFns.push(fn);
    return () => { const i = tapFns.indexOf(fn); if (i >= 0) tapFns.splice(i, 1); };
  }

  function setSelection(tile) {
    selection = tile && Number.isFinite(tile.x) && Number.isFinite(tile.y) ? { x: tile.x, y: tile.y } : null;
  }

  function setReach(area) {
    reach = area && Number.isFinite(area.x) && Number.isFinite(area.y) && area.r > 0 ? { x: area.x, y: area.y, r: area.r } : null;
  }

  function focusTile(tile) {
    ox = W / 2 - (tile.x + 0.5) * TILE * scale;
    oy = H / 2 - (tile.y + 0.5) * TILE * scale;
    userMoved = true;
    clampView();
  }

  resize();

  return {
    resize, draw, onTap, floatText, burst, driveTaxi, setSelection, setReach, focusTile, tileToScreen,
    // extras beyond the spec
    gameClock,
    resetView() { userMoved = false; scale = fitScale; clampView(); },
    getView: () => ({ scale, ox, oy, fitScale, maxScale, ratio, width: W, height: H }),
  };
}
