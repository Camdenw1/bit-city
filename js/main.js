// Bit City — app wiring. Connects the game rules (sim), the map (render),
// the menus (ui), sound, and saving.
import * as config from './config.js';
import * as store from './state.js';
import * as sim from './sim.js';
import * as sprites from './sprites.js';
import * as render from './render.js';
import { createUI, formatCoins } from './ui.js';
import * as audio from './audio.js';

const AWAY_MIN_MS = 2 * 60 * 1000;   // show "while you were away" after 2 minutes
const SAVE_EVERY_MS = 10 * 1000;

let timeOffset = 0;                  // test hook only (window.bitcity.skip)
const getNow = () => Date.now() + timeOffset;

let state = store.load() || store.newGame(getNow());
const getState = () => state;

sprites.initSprites();

const canvas = document.getElementById('map');
const renderer = render.createRenderer(canvas, { getState, getNow });
if (!renderer.gameClock && render.gameClock) renderer.gameClock = render.gameClock;

let ui = null;
let quiet = true;                    // suppress celebrations while catching up on away time
let saveFailed = false;

function persist() { saveFailed = !store.save(state); }

function act(name, ...args) {
  const res = sim[name](state, ...args, getNow());
  persist();
  ui?.refresh();
  return res;
}

const api = {
  getState, getNow, sim, config, sprites, renderer, act,
  saveFailed: () => saveFailed,
  exportSave: () => store.exportSave(state),
  importSave: (str) => {
    state = store.importSave(str);
    state.lastTick = Math.min(state.lastTick ?? getNow(), getNow());
    catchUp(true);
    persist();
    ui.refresh();
  },
  resetGame: () => {
    state = store.newGame(getNow());
    persist();
    ui.hideRide();
    ui.refresh();
  },
  toast: (text) => ui?.toast(text),
};

ui = createUI(document.getElementById('ui'), api);

// ---------- game events -> sights and sounds ----------
const tileOf = (id) => {
  const b = id != null ? sim.buildingById(state, id) : null;
  return b ? { x: b.x, y: b.y } : null;
};
const COIN = '#f2c14e';

sim.events.on('coins', ({ amount, buildingId, reason }) => {
  if (quiet || amount <= 0) return;
  const t = tileOf(buildingId);
  if (t && (reason === 'sales' || reason === 'refund')) renderer.floatText(t.x, t.y, `+${Math.round(amount)}`, COIN);
});
sim.events.on('built', ({ building }) => {
  if (quiet) return;
  renderer.burst(building.x, building.y, 'dust');
  audio.play('build');
});
sim.events.on('opened', ({ building }) => {
  if (quiet) return;
  renderer.burst(building.x, building.y, 'stars');
  audio.play('open');
  ui.toast(`${sim.buildingName(building)} is ready!`);
});
sim.events.on('demolished', ({ x, y }) => { if (!quiet) renderer.burst(x, y, 'dust'); });
sim.events.on('moveIn', ({ tenant }) => {
  if (quiet) return;
  const t = tileOf(tenant.homeId);
  if (t) renderer.burst(t.x, t.y, 'hearts');
  audio.play('movein');
});
sim.events.on('job', ({ tenant, building, dream }) => {
  if (quiet || !building) return;
  if (dream) {
    renderer.burst(building.x, building.y, 'stars');
    audio.play('dream');
    ui.celebrateDream(tenant, building);
  } else {
    renderer.burst(building.x, building.y, 'hearts');
    audio.play('tap');
  }
});
sim.events.on('restocked', ({ building, auto }) => {
  if (quiet) return;
  renderer.burst(building.x, building.y, 'stars');
  if (!auto) audio.play('restock');
});
sim.events.on('problem', ({ building, problem }) => {
  if (quiet) return;
  audio.play('oops');
  ui.toast(`${config.PROBLEMS[problem.kind].name} at the ${config.BUILDINGS[building.type].name}${problem.fixAt != null ? '. Help is on the way!' : '. Tap it to help.'}`);
});
sim.events.on('problemFixed', ({ building, auto }) => {
  if (quiet || !building) return;
  renderer.burst(building.x, building.y, 'stars');
  if (auto) ui.toast(`All fixed at the ${config.BUILDINGS[building.type].name}!`);
});
sim.events.on('rideRequest', () => { if (!quiet) audio.play('ride'); });
sim.events.on('rideGone', () => ui.hideRide());
sim.events.on('rent', ({ amount }) => {
  if (quiet) return;                 // away sheet covers rent earned while closed
  audio.play('rent');
  ui.toast(`Rent collected · +${formatCoins(amount)} coins`);   // hourly now, so a toast and not a full-screen card
});
sim.events.on('goal', ({ goal }) => {
  if (quiet) return;
  audio.play('goal');
  const r = goal.reward || {};
  const bits = [r.coins ? `+${r.coins} coins` : '', r.gems ? `+${r.gems} gem${r.gems > 1 ? 's' : ''}` : ''].filter(Boolean);
  ui.toast(`Goal done: ${goal.text}${bits.length ? ' · ' + bits.join(', ') : ''}`);
});
sim.events.on('land', ({ name }) => {
  audio.play('goal');
  ui.toast(`${name} is yours! Roads are already in.`);
});
sim.events.on('upgraded', ({ building }) => {
  renderer.burst(building.x, building.y, 'stars');
  audio.play('open');
  ui.toast(`${sim.buildingName(building)} is now level ${building.level}!`);
});
sim.events.on('order', ({ order }) => {
  audio.play('goal');
  ui.toast(`${order.town} says thanks! +${order.coins} coins, +${order.gems} gem`);
});
sim.events.on('ad', () => { audio.play('open'); ui.toast('Your ad is up! Sales pay more for 2 hours.'); });
sim.events.on('recipe', ({ recipe }) => {
  if (quiet) return;
  audio.play('goal');
  ui.toast(`New recipe: ${recipe.name}! Food shops earn more.`);
});
sim.events.on('lesson', ({ tenant, category, value }) => {
  if (quiet) return;
  ui.toast(`${tenant.name} learned something new: ${category} skill is now ${value}`);
});
sim.events.on('unlock', ({ type, name }) => {
  if (quiet) return;
  ui.toast(type ? `New building unlocked: ${config.BUILDINGS[type]?.name ?? type}!` : `New kind of building unlocked: ${name}!`);
});

// ---------- the ride (Uber) mini-game ----------
function startDrive() {
  const ride = state.ride;
  const from = tileOf(ride.fromId);
  const to = tileOf(ride.toId);
  ui.hideRide();
  const finish = () => {
    if (state.ride !== ride || ride.state !== 'driving') return;
    const res = act('completeRide');
    if (res?.ok && to) {
      renderer.floatText(to.x, to.y, `+${res.fare}`, COIN);
      renderer.burst(to.x, to.y, 'coins');
      audio.play('coin');
      if (ride.kind === 'delivery') ui.toast(`Delivered · +${formatCoins(res.fare)} coins`);
    }
  };
  if (from && to) renderer.driveTaxi(from, to, finish, ride.kind === 'delivery'); else finish();
}

function resumeRide() {
  const ride = state.ride;
  if (!ride) return;
  if (ride.state === 'driving') act('completeRide');        // app was closed mid-drive: just pay out
  else if (ride.state === 'choosing') {
    if (ride.kind === 'delivery') renderer.focusTile(tileOf(ride.toId));
    ui.showRide(ride);
  }
}

// ---------- map taps ----------
renderer.onTap(({ x, y, building, parcel, activity }) => {
  audio.unlock();
  if (ui.isModalOpen()) return;
  if (parcel) { if (state.ride?.state !== 'choosing') { audio.play('tap'); ui.openLand(parcel); } return; }
  const now = getNow();
  const ride = state.ride;

  if (ride?.state === 'choosing') {
    if (!building || !sim.isBuilt(building, now) || building.id === ride.fromId) return;
    const res = act('chooseDestination', building.id);
    if (!res?.ok) return;
    if (res.correct) { audio.play('coin'); startDrive(); }
    else if (ride.kind !== 'delivery') { audio.play('oops'); ui.toast('Try another building'); }
    return;
  }

  if (ride?.state === 'waiting' && building?.id === ride.fromId && (ride.kind !== 'delivery' || activity === 'parcel')) {
    const res = act('acceptRide');
    if (res?.ok) {
      audio.play('ride');
      if (ride.kind === 'delivery') renderer.focusTile(res.destination);
      ui.showRide(ride);
    }
    return;
  }

  if (!building) { audio.play('tap'); ui.openLot(x, y); return; }

  // One tap on an out-of-stock shop refills it. No menu, no chore.
  const def = config.BUILDINGS[building.type];
  if (def?.kind === 'biz' && sim.bizStatus(state, building, now) === 'out-of-stock') {
    const res = act('restock', building.id);
    if (res?.ok) { if (res.cost > 0) renderer.floatText(building.x, building.y, `-${Math.round(res.cost)}`, '#fff6e0'); return; }
  }
  audio.play('tap');
  ui.openBuilding(building);
});

// ---------- time ----------
function catchUp(silent) {
  quiet = true;
  let summary;
  try { summary = sim.advance(state, getNow(), { live: false }); }
  finally { quiet = false; }
  if (!silent && summary && summary.elapsedMs >= AWAY_MIN_MS) ui.showAway(summary);
  resumeRide();
  return summary;
}

let lastSave = 0;
function tick() {
  if (document.hidden) return;
  const now = getNow();
  if (now - state.lastTick >= AWAY_MIN_MS) catchUp(false);   // phone slept with the app open
  else sim.advance(state, now, { live: true, active: true });   // the game is open: shops pay the play boost
  if (now - lastSave >= SAVE_EVERY_MS) { persist(); lastSave = now; }
  ui.refresh();
}

function frame() {
  renderer.draw(getNow());
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
  else { catchUp(false); ui.refresh(); }
});
window.addEventListener('pagehide', persist);
window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => renderer.resize());
document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
document.addEventListener('gesturestart', (e) => e.preventDefault());   // stop iOS page zoom

// ---------- start ----------
audio.setSoundEnabled(state.settings?.sound !== false);
renderer.resize();
catchUp(false);
persist();
ui.refresh();
setInterval(() => {
  audio.setSoundEnabled(state.settings?.sound !== false);
  tick();
}, 1000);
requestAnimationFrame(frame);

// Ask the browser to keep the save data even when the phone is low on space.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Handy for testing from the console: bitcity.skip(60) jumps ahead one hour.
window.bitcity = {
  get state() { return state; },
  sim, config, ui, renderer, act,
  skip(minutes) { timeOffset += minutes * 60000; tick(); },
  give(coins = 1000, gems = 0) { state.coins += coins; state.gems += gems; ui.refresh(); },
};
