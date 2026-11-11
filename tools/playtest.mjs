// Bot playtest: plays Mini Mayor the way a person would and prints pacing numbers.
// Run: node tools/playtest.mjs            (pure sim, no browser)
// It plays an active first session, then short check-ins through three days.
import * as config from '../js/config.js';
import * as store from '../js/state.js';
import * as sim from '../js/sim.js';

const { BUILDINGS, BUILD_ORDER, CATEGORIES } = config;
const MIN = 60000, HOUR = 60 * MIN;

function play({ label, firstSessionMin, checkinEveryMin, checkinMin, days, seedTime, detail = true }) {
  let now = seedTime;
  const s = store.newGame(now);
  const income = { sales: 0, ride: 0, delivery: 0, job: 0, rent: 0, goal: 0, trade: 0, order: 0, visitor: 0, resident: 0, contract: 0, vip: 0 };
  const onCoins = sim.events.on('coins', ({ amount, reason }) => { if (income[reason] != null) income[reason] += amount; });
  let manualRestocks = 0; let rebuilds = 0; let fixes = 0; let problems = 0;
  const onProblem = sim.events.on('problem', () => { problems++; });
  const marks = [];
  const mark = (text) => marks.push(`${fmt(now - seedTime).padStart(7)}  ${text}`);
  const seen = new Set();
  const popMarks = [2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 40];

  const freeLot = () => {
    for (let y = config.WORLD.y0; y <= config.WORLD.y1; y++) for (let x = config.WORLD.x0; x <= config.WORLD.x1; x++) if (sim.isLot(s, x, y) && !sim.tileAt(s, x, y)) return [x, y];
    return null;
  };
  const tryBuild = (type, random = false) => {
    const lot = freeLot();
    if (!lot) return false;
    const r = random ? sim.buildRandom(s, type, ...lot, now) : sim.build(s, type, ...lot, now);
    if (r.ok && !seen.has(r.building.type)) {
      seen.add(r.building.type);
      mark(`first ${sim.buildingName(r.building)}`);
    }
    return r.ok;
  };

  function act() {
    manualRestocks += sim.restockAll(s, now).count;
    for (const p of [...s.problems]) if (p.fixAt == null) { if (sim.fixProblem(s, p.buildingId, now).ok) fixes++; }
    // Move in a good match for an open job, or the best available skill.
    for (let guard = 0; guard < 20; guard++) {
      const home = sim.homesWithVacancy(s, now)[0];
      if (!home || !s.applicants.length) break;
      let best = 0, score = -1;
      s.applicants.forEach((a, i) => {
        const match = s.buildings.some((b) => b.type === a.dream && sim.isBuilt(b, now) && sim.jobFit(s, a, b).open);
        const v = (match ? 10 : 0) + Math.max(...Object.values(a.skills));
        if (v > score) { score = v; best = i; }
      });
      if (!sim.moveIn(s, best, home.id, now).ok) break;
    }
    // jobs
    for (const t of s.tenants) {
      const j = sim.bestJobs(s, t.id, now).find((o) => o.open);
      if (j && (t.jobId == null || j.dream)) sim.assignJob(s, t.id, j.building.id, now);
    }
    if (!s.buildings.some((b) => b.type === 'trade') && sim.isUnlocked(s, 'trade') && s.coins >= sim.costOf(s, 'trade')) tryBuild('trade');
    // trade: sell on good days (or when the barn is very full), fill any order that is ready
    if (sim.hasTrade(s, now)) {
      // sign every contract there is room for (they run by themselves)
      for (const o of sim.contractOffers(s, now)) if (!o.signed && s.contracts.length < sim.contractSlots(s, now)) sim.signContract(s, o.town, now);
      const prices = sim.tradePrices(s, now);
      for (const o of [...s.orders]) if ((s.goods[o.crop] || 0) >= o.qty) sim.fillOrder(s, o.id, now);
      for (const crop of Object.keys(prices)) {
        const reserved = s.orders.filter((o) => o.crop === crop).reduce((n, o) => n + o.qty, 0);
        if ((s.goods[crop] || 0) > reserved * 2 && (prices[crop].good || s.goods[crop] > reserved * 4)) sim.sellGoods(s, crop, now);
      }
    }
    // land when it is affordable, then the cheapest upgrade
    for (const p of config.PARCELS) { const info = sim.parcelInfo(s, p.id); if (info.canBuy && s.coins >= info.price * 1.2) { sim.buyLand(s, p.id, now); mark(`bought ${info.name} (${info.lots} lots) for ${info.price}`); } }
    const ups = s.buildings.filter((b) => sim.isBuilt(b, now) && sim.upgradeCost(s, b) > 0).sort((a, b) => sim.upgradeCost(s, a) - sim.upgradeCost(s, b));
    if (ups.length && s.coins >= sim.upgradeCost(s, ups[0]) * 3) sim.upgrade(s, ups[0].id, now);
    // the Upgrades tab: the cheapest ladder step when it costs under a third of the bank; one Construction Yard
    const tab = Object.keys(config.UPGRADES).map((id) => [id, sim.upgradeNextCost(s, id)]).filter(([, c]) => c > 0).sort((a, b) => a[1] - b[1])[0];
    if (tab && s.coins >= tab[1] * 3) { sim.buyUpgrade(s, tab[0], now); mark(`upgrade ${tab[0]} to ${sim.upLevel(s, tab[0])}`); }
    if (!s.buildings.some((b) => b.type === 'yard') && sim.isUnlocked(s, 'yard') && s.coins >= sim.costOf(s, 'yard') * 3) tryBuild('yard');
    const wanted = sim.mostWanted(s, now);
    // Buy at most one government or green space project at a time.
    const civic = wanted.find((w) => w.cat === 'gov' || BUILDINGS[w.type]?.kind === 'park');
    if (civic && !s.buildings.some((b) => (BUILDINGS[b.type].gov || BUILDINGS[b.type].kind === 'park') && !sim.isBuilt(b, now))) {
      if (civic.cat === 'gov' && s.coins >= sim.categoryCost(s, 'gov')) tryBuild('gov', true);
      else if (civic.type && s.coins >= sim.costOf(s, civic.type)) tryBuild(civic.type);
    }
    // spend: keep one home vacancy and one open job ahead of the town
    for (let guard = 0; guard < 6; guard++) {
      const unlocked = BUILD_ORDER.filter((id) => sim.isUnlocked(s, id));
      const homes = unlocked.filter((id) => BUILDINGS[id].kind === 'home').reverse();
      const shops = s.buildings.filter((b) => BUILDINGS[b.type].kind === 'biz');
      const openJobs = shops.reduce((n, b) => n + BUILDINGS[b.type].slots - sim.workersOf(s, b.id).length, 0);
      const needHome = sim.vacancies(s) === 0;
      const needShop = openJobs < Math.max(1, sim.unemployed(s).length);
      const priorities = new Set([...wanted.map((w) => w.cat), ...CATEGORIES]);
      const wantShop = [...priorities].find((cat) => cat && cat !== 'gov' && sim.categoryUnlocked(s, cat) && s.coins >= sim.categoryCost(s, cat));
      const wantHome = homes.find((id) => s.coins >= sim.costOf(s, id));
      if (!s.buildings.length) { if (tryBuild('tent')) continue; break; }
      if (s.tenants.length && needShop && wantShop && tryBuild(wantShop, true)) continue;
      if (needHome && wantHome && tryBuild(wantHome)) continue;
      // no lot left: rebuild the smallest home as the biggest one it can afford
      if (needHome && !freeLot()) {
        const small = s.buildings.filter((b) => BUILDINGS[b.type].kind === 'home' && sim.isBuilt(b, now)).sort((a, b) => BUILDINGS[a.type].capacity - BUILDINGS[b.type].capacity)[0];
        const opt = small && sim.rebuildOptions(s, small.id, now).filter((o) => o.ok).pop();
        if (opt && sim.rebuildHome(s, small.id, opt.type, now).ok) { rebuilds++; continue; }
      }
      break;
    }
    // landmarks: one of each once there is plenty to spare
    for (const id of ['cityhall', 'grandpark', 'stadium', 'skyscraper']) {
      if (!s.buildings.some((b) => b.type === id) && sim.isUnlocked(s, id) && s.coins >= sim.costOf(s, id) * 2 && tryBuild(id)) mark(`landmark ${id}`);
    }
  }

  function step(ms) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 5000);
      sim.advance(s, now, { live: true, active: true });
      act();
      if (s.ride?.state === 'waiting' && now + 6000 <= end) {
        now += 4000; sim.advance(s, now, { live: true, active: true });   // a few seconds to notice and tap the taxi
        if (sim.pickupRide(s, now).ok && s.ride?.state === 'choosing') sim.chooseDestination(s, s.ride.toId, now);   // deliveries: tap the home
        sim.rideGas(s, 0.7, now);                       // a player who mostly holds the pedal
        now += 2000; sim.advance(s, now, { live: true, active: true });
        sim.completeRide(s, now);
      }
      // one job from the board per step when nothing else is going on (each takes a few seconds)
      if (!s.ride && !s.job && now + 8000 <= end) {
        const j = sim.jobBoard(s, now).find((x) => x.ok && x.kind !== 'taxi' && x.kind !== 'delivery');
        if (j && sim.startTownJob(s, j.kind, sim.townJobOptions(s, now).shops[0]?.id ?? null, now).ok) {
          now += 6000; sim.advance(s, now, { live: true, active: true });
          const job = s.job;
          if (job?.kind === 'rush') while (s.job) sim.serveOrder(s, s.job.index, s.job.orders[s.job.index]);
          else if (job?.kind === 'odd') sim.sendHelper(s, job.candidates[0]);
          else if (job?.kind === 'lost') sim.findDog(s, job.x, job.y);
          else if (job?.kind === 'courier') for (const id of [...job.stops]) sim.deliverStop(s, id);
        }
      }
      for (const p of popMarks) if (s.tenants.length >= p && !seen.has('pop' + p)) { seen.add('pop' + p); mark(`${p} residents`); }
    }
  }

  step(firstSessionMin * MIN);
  mark(`end of first session: ${Math.round(s.coins)} coins, ${s.buildings.length} buildings, shops ${Math.round(sim.townRatePerMin(s, now) * 60)}/h, rent ${sim.rentPerDay(s)}/day`);
  const endAt = seedTime + days * 24 * HOUR;
  while (now < endAt) {
    now = Math.min(endAt, now + checkinEveryMin * MIN);
    sim.advance(s, now, { live: false });
    const hour = new Date(now).getHours();
    if (hour >= 23 || hour < 7) continue;            // asleep
    step(Math.min(endAt - now, checkinMin * MIN));
    if (new Date(now).getHours() >= 21 && !seen.has('day' + new Date(now).getDate())) {
      seen.add('day' + new Date(now).getDate());
      mark(`evening: pop ${s.tenants.length}, ${s.buildings.length} buildings, ${Math.round(s.coins)} coins, shops ${Math.round(sim.townRatePerMin(s, now) * 60)}/h, rent ${sim.rentPerDay(s)}/day, happy ${sim.happiness(s, now)}%, IQ ${sim.townIQ(s)}, recipes ${s.recipes.length}/${config.RECIPES.length}`);
    }
  }
  sim.events.off('coins', onCoins); sim.events.off('problem', onProblem);
  const total = Object.values(income).reduce((a, b) => a + b, 0) || 1;
  console.log(`\n=== ${label} ===`);
  if (detail) console.log(marks.join('\n'));
  console.log(`rebuilt homes ${rebuilds}`);
  console.log(`population ${s.tenants.length}, happy ${sim.happiness(s, now)}%, IQ ${sim.townIQ(s)}, manual restocks ${manualRestocks}, problems ${problems} (${fixes} paid for)`);
  console.log('income mix: ' + Object.entries(income).map(([k, v]) => `${k} ${Math.round(v)} (${Math.round(100 * v / total)}%)`).join(', '));
  console.log(`goals done ${s.goalsDone.length}/${config.GOALS.length}, dream jobs ${s.stats.dreamJobs}, rides ${s.stats.rides}, types owned ${new Set(s.buildings.map((b) => b.type)).size}/${Object.keys(BUILDINGS).length}`);
}

function fmt(ms) {
  const m = Math.floor(ms / MIN);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${Math.floor(m / 1440)}d${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}h`;
}

const start = new Date(2026, 0, 5, 9, 0, 0).getTime();
play({ label: 'Keen: 30 min first session, 5 min every 2 h', firstSessionMin: 30, checkinEveryMin: 120, checkinMin: 5, days: 3, seedTime: start });
play({ label: 'Casual: 10 min first session, 2 min every 4 h', firstSessionMin: 10, checkinEveryMin: 240, checkinMin: 2, days: 3, seedTime: start });
play({ label: 'Keen, one week', firstSessionMin: 30, checkinEveryMin: 120, checkinMin: 5, days: 7, seedTime: start });
for (const day of [6, 7]) {
  const seedTime = new Date(2026, 0, day, 9).getTime();
  play({ label: `Casual, alternate seed ${day - 5}`, firstSessionMin: 10, checkinEveryMin: 240, checkinMin: 2, days: 3, seedTime, detail: false });
}
