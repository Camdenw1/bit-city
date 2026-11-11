// Mini Mayor — UI layer (HUD, bottom sheets, celebrations, toasts).
// Owns everything inside #ui. Never imports sim/config/sprites: it only uses `api`.
// Every state change goes through api.act(name, ...args).

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const CAT_FALLBACK = { food: '#e8804a', retail: '#4a90d9', service: '#9a6fd0', farming: '#5bb450', creative: '#e85d8a' };
const CAT_LABEL = { food: 'Food', retail: 'Retail', service: 'Service', farming: 'Farming', creative: 'Creative' };
const TIP_MS = 10000;
const CELEBRATE_MS = 4200;

/* ---------- small pure helpers ---------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 1,250 -> "1,250"; 12,500 -> "12.5k"; 1,200,000 -> "1.2M" (never rounds up past what you have). */
export function formatCoins(n) {
  n = Math.floor(Math.max(0, Number(n) || 0));
  const short = (v) => (v >= 100 ? String(Math.floor(v)) : String(Math.floor(v * 10) / 10));
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return short(n / 1e3) + 'k';
  if (n < 1e9) return short(n / 1e6) + 'M';
  return short(n / 1e9) + 'B';
}

function formatDuration(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return s + 's';
  let m = Math.floor(s / 60); s %= 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  let h = Math.floor(m / 60); m %= 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24); h %= 24;
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** Minimal DOM morph: makes `from`'s children match `to`'s without recreating unchanged nodes
 *  (keeps scroll position, running CSS animations, focus and typed text; no image flicker). */
function morphChildren(from, to) {
  let f = from.firstChild;
  let t = to.firstChild;
  while (t) {
    const tNext = t.nextSibling;
    if (!f) {
      from.appendChild(t);
    } else if (f.nodeType !== t.nodeType || f.nodeName !== t.nodeName ||
               (f.nodeType === 1 && f.getAttribute('data-key') !== t.getAttribute('data-key'))) {
      const fNext = f.nextSibling;
      from.replaceChild(t, f);
      f = fNext;
    } else {
      if (f.nodeType === 1) {
        for (const a of Array.from(f.attributes)) {
          if (!t.hasAttribute(a.name) && !(f.nodeName === 'DETAILS' && a.name === 'open')) f.removeAttribute(a.name);
        }
        for (const a of Array.from(t.attributes)) if (f.getAttribute(a.name) !== a.value) f.setAttribute(a.name, a.value);
        if (f.nodeName !== 'TEXTAREA' || f.hasAttribute('readonly')) morphChildren(f, t);
        if (f.nodeName === 'TEXTAREA' && f.hasAttribute('readonly') && f.value !== t.textContent) f.value = t.textContent;
      } else if (f.nodeValue !== t.nodeValue) {
        f.nodeValue = t.nodeValue;
      }
      f = f.nextSibling;
    }
    t = tNext;
  }
  while (f) { const n = f.nextSibling; from.removeChild(f); f = n; }
}

/* ---------- createUI ---------- */

export function createUI(root, api) {
  const sim = api.sim || {};
  const config = api.config || {};
  const PLAY_BOOST = config.TUNING?.activeBoost || 1;   // shops pay this many times more while the game is open
  const sprites = api.sprites || {};
  const BUILDINGS = config.BUILDINGS || {};
  const CATEGORIES = config.CATEGORIES || Object.keys(CAT_FALLBACK);
  const CAT_COLORS = config.CATEGORY_COLORS || CAT_FALLBACK;
  const buildCategories = { ...config.SHOP_CATS, gov: config.GOV };
  const DAY_MS = config.DAY_LENGTH_MS || 3600000;

  const S = () => api.getState();
  const N = () => api.getNow();
  const call = (name, ...a) => { try { return typeof sim[name] === 'function' ? sim[name](...a) : undefined; } catch (e) { return undefined; } };

  /* ----- sprite helpers (never throw) ----- */
  const sprURL = (id, s) => { try { return sprites.spriteURL(id, s) || BLANK; } catch (e) { return BLANK; } };
  const perURL = (look, s) => { try { return sprites.personURL(look || {}, s) || BLANK; } catch (e) { return BLANK; } };
  const img = (src, w, h, cls) => `<img class="spr${cls ? ' ' + cls : ''}" alt="" draggable="false" width="${w}" height="${h}" src="${src}">`;
  const icon = (id, s = 2, cls = '') => img(sprURL(id, s), 10 * s, 10 * s, cls);
  const bld = (type, s = 2, cls = '') => img(sprURL(type, s), 16 * s, 16 * s, cls);
  const buildingArt = (b, s, cls) => bld(sprites.buildingSpriteId(b), s, cls);
  const person = (look, s = 3, cls = '') => img(perURL(look, s), 8 * s, 12 * s, cls);

  /* ----- data helpers ----- */
  const def = (type) => BUILDINGS[type] || { id: type, name: type, kind: 'biz', category: null, cost: 0, slots: 2 };
  const bName = (b) => (b ? call('buildingName', b) || def(b.type).name : '');
  const categoryOf = (b) => call('catOf', b) || def(b.type).category;
  const catColor = (c) => CAT_COLORS[c] || CAT_FALLBACK[c] || '#8a7f96';
  const built = (b) => { const r = call('isBuilt', b, N()); return r === undefined ? !(b.readyAt > N()) : r; };
  const byId = (id) => (id == null ? null : (call('buildingById', S(), id) || S().buildings.find((b) => b.id === id) || null));
  const tenantById = (id) => (id == null ? null : (call('tenantById', S(), id) || S().tenants.find((t) => t.id === id) || null));
  const residentsOf = (id) => call('residentsOf', S(), id) || S().tenants.filter((t) => t.homeId === id);
  const workersOf = (id) => call('workersOf', S(), id) || S().tenants.filter((t) => t.jobId === id);
  const fit = (t, b) => call('jobFit', S(), t, b) ||
    { skill: (t.skills && t.skills[categoryOf(b)]) || 0, dream: t.dream === b.type, open: workersOf(b.id).length < slotsOf(b) };
  const slotsOf = (b) => call('slotsOf', b) || def(b.type).slots || 2;
  /** ★ to ★★★ for how well a person suits a job, with a short plain reason. */
  const fitChip = (t, b) => {
    const n = call('fitStars', t, b) || 1;
    const why = t.dream === b.type ? 'dream job' : n === 3 ? 'great fit' : n === 2 ? 'good fit' : 'weak fit';
    return `<span class="fit fit-${n}" title="${why}">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
  };
  const topSkill = (t) => {
    let best = CATEGORIES[0]; let v = -1;
    for (const c of CATEGORIES) { const s = (t.skills && t.skills[c]) || 0; if (s > v) { v = s; best = c; } }
    return { cat: best, value: Math.max(0, v) };
  };
  const restockCostOf = (b) => call('restockCostOf', b) || 0;
  let wishBuild = null;
  let movingId = null;
  let vipSending = false;
  let nightWas = null;      // was the night market open at the last refresh? (null = not checked yet)   // after "Send", the next building tapped is where the VIP goes
  let moveOutAsk = null;   // tenant id waiting for a yes on "Ask to move out"
  /** On move-in you learn the real skills and any trait. */
  function revealToast(t) {
    const ts = topSkill(t); const tr = t.trait && (config.TRAITS || {})[t.trait];
    toast(`${t.name} moved in! Best at ${(CAT_LABEL[ts.cat] || ts.cat).toLowerCase()}: ${ts.value}.` +
      (tr ? ` Turns out: ${tr.name}! ${tr.up}, but ${tr.down}.` : ' No surprises.'));
  }
  /** Best open job that beats what the tenant has now, or null. */
  const betterJob = (t) => {
    const list = call('bestJobs', S(), t.id, N()) || [];
    const cur = t.jobId != null ? byId(t.jobId) : null;
    const curFit = cur ? fit(t, cur) : null;
    if (curFit && curFit.dream) return null;
    for (const j of list) {
      if (!j || !j.building || !j.open || j.building.id === t.jobId) continue;
      if (!curFit) return j;
      if (j.dream || j.skill > curFit.skill) return j;
    }
    return null;
  };

  /* ----- skeleton ----- */
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-bar panel">
        <div class="stat stat-coins">${icon('coin', 2)}<div class="stat-col"><b class="v" data-h="coins">0</b><span class="sub" data-h="rate">+0/h</span></div></div>
        <div class="stat">${icon('gem', 2)}<b class="v" data-h="gems">0</b></div>
        <div class="stat">${icon('person', 2)}<b class="v" data-h="pop">0/0</b></div>
        <button class="stat stat-happy" data-act="nav-town" aria-label="Town happiness">${icon('heart', 2)}<b class="v" data-h="happy">–</b></button>
        <div class="stat stat-clock"><i class="sky" data-h="sky"></i><b class="v" data-h="clock" hidden>12:00pm</b></div>
      </div>
      <div role="status" data-h="saveWarning" hidden><button class="save-warning panel" data-act="open-backup">Couldn’t save · Back up town</button></div>
      <button class="goal-chip" data-h="goal" data-act="nav-town" hidden></button>
      <div class="ride-wrap" data-h="ride"></div>
    </div>
    <button class="gas" data-h="gas" hidden aria-label="Hold for gas"><b>GAS</b><span>hold</span></button>
    <div class="toasts" data-h="toasts" aria-live="polite"></div>
    <nav class="bottom-bar">
      <button class="bar-btn" data-act="nav-feed">${icon('bubble', 2)}<span>Feed</span><i class="bar-dot bar-count" data-h="feedCount" hidden></i></button>
      <button class="bar-btn" data-act="nav-upgrades">${icon('star', 2)}<span>Upgrades</span><i class="bar-dot bar-count" data-h="jobsCount" hidden></i></button>
      <button class="bar-btn" data-act="nav-people">${icon('person', 2)}<span>People</span><i class="bar-dot" data-h="peopleDot" hidden></i></button>
      <button class="bar-btn" data-act="nav-menu">${icon('heart', 2)}<span>Menu</span></button>
    </nav>
    <div class="backdrop" data-act="close"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-hidden="true">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head"></header>
      <div class="sheet-body"></div>
    </section>
    <div class="celebrate" data-act="celebrate-close" aria-live="polite"></div>`;

  const $ = (sel) => root.querySelector(sel);
  const h = {};
  root.querySelectorAll('[data-h]').forEach((el) => { h[el.getAttribute('data-h')] = el; });
  // The gas pedal: held down, the car goes much faster and the fare gets a bonus.
  const gas = (on) => { h.gas.classList.toggle('down', on); try { api.renderer.setGas(on); } catch (e) { /* cosmetic */ } };
  h.gas.addEventListener('pointerdown', (e) => { e.preventDefault(); try { h.gas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } gas(true); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) h.gas.addEventListener(type, () => gas(false));
  h.gas.addEventListener('contextmenu', (e) => e.preventDefault());
  const els = { backdrop: $('.backdrop'), sheet: $('.sheet'), head: $('.sheet-head'), body: $('.sheet-body'), celebrate: $('.celebrate') };
  const tpl = document.createElement('template');
  const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  const setHTML = (el, html, cacheKey) => {
    if (cache[cacheKey] === html) return false;
    cache[cacheKey] = html;
    tpl.innerHTML = html;
    morphChildren(el, tpl.content);
    return true;
  };
  const cache = {};

  /* ----- toasts ----- */
  function toast(text) {
    if (!text) return;
    const box = h.toasts;
    const last = box.lastElementChild;
    if (last && last.textContent === String(text) && !last.classList.contains('out')) return; // no spam
    while (box.children.length >= 3) box.removeChild(box.firstChild);
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = String(text);
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2300);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2700);
  }

  /** Run a sim action through the app; friendly toast when it says no. */
  function act(name, ...args) {
    let r;
    try { r = api.act(name, ...args); } catch (e) { r = { ok: false, reason: 'Hmm, that didn’t work. Try again!' }; }
    if (r && r.ok === false && r.reason) toast(r.reason);
    return r || { ok: false };
  }

  /* ----- HUD ----- */
  let coinShown = null; let coinTarget = 0; let coinRaf = 0; let coinFrom = 0; let coinT0 = 0;
  function coinStep(ts) {
    const k = Math.min(1, (ts - coinT0) / 450);
    coinShown = coinFrom + (coinTarget - coinFrom) * (1 - (1 - k) * (1 - k));
    setText(h.coins, formatCoins(Math.round(coinShown)));
    coinRaf = k < 1 ? requestAnimationFrame(coinStep) : 0;
  }
  function setCoins(v) {
    if (coinShown === null) { coinShown = coinTarget = v; setText(h.coins, formatCoins(v)); return; }
    if (v === coinTarget) return;
    const delta = v - coinTarget;
    coinFrom = coinShown; coinTarget = v; coinT0 = performance.now();
    if (!coinRaf) coinRaf = requestAnimationFrame(coinStep);
    if (delta >= Math.max(10, v * 0.02)) {
      const el = h.coins.closest('.stat');
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
  }

  function clockInfo(now) {
    const r = api.renderer;
    try {
      const g = r && typeof r.gameClock === 'function' ? r.gameClock(now) : null;
      if (g && typeof g.label === 'string') return { label: g.label, night: !!(g.night || g.isNight) };
    } catch (e) { /* fall through */ }
    const frac = (((now % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
    const mins = Math.floor(frac * 144) * 10; // 10-minute steps keep the label calm
    const hr = Math.floor(mins / 60); const mn = mins % 60;
    const h12 = hr % 12 === 0 ? 12 : hr % 12;
    return { label: `${h12}:${mn < 10 ? '0' + mn : mn}${hr < 12 ? 'am' : 'pm'}`, night: hr < 6 || hr >= 19 };
  }

  const jobRest = new Map();   // job kind → ms it was still resting at the last refresh
  function refreshHUD() {
    const s = S(); const now = N();
    h.saveWarning.hidden = !api.saveFailed();
    const driving = !!(s.ride && s.ride.state === 'driving');
    if (h.gas.hidden === driving) { h.gas.hidden = !driving; if (!driving) h.gas.classList.remove('down'); }
    setCoins(Math.floor(s.coins || 0));
    setText(h.gems, formatCoins(s.gems || 0));
    const pop = call('population', s); const cap = call('capacity', s);
    setText(h.pop, `${pop === undefined ? s.tenants.length : pop}/${cap === undefined ? 0 : cap}`);
    const rate = (call('townRatePerMin', s, now) || 0) * 60 * PLAY_BOOST +
      ((call('rentPerDay', s, now) || 0) + (call('rentBonusPerDay', s, now) || 0)) / 24;   // shops while you play + rent
    setText(h.rate, `+${formatCoins(Math.round(rate))}/h`);
    const c = clockInfo(now);
    setText(h.clock, c.label);
    const skyCls = c.night ? 'sky moon' : 'sky sun';
    if (h.sky.className !== skyCls) h.sky.className = skyCls;

    const happy = call('happiness', s, now);
    setText(h.happy, s.tenants.length && happy !== undefined ? `${happy}%` : '–');

    const goal = rideView ? null : call('nextGoal', s);
    // once the starter goals are done, the chip shows what the town wants most
    const want = goal || rideView ? null : (call('mostWanted', s, now) || [])[0];
    if (vipSending && !s.vip) vipSending = false;          // they left
    h.goal.dataset.act = vipSending ? 'vip-cancel' : movingId == null ? 'nav-town' : 'move-cancel';
    if (vipSending) {
      const vd = (config.VIPS || {})[s.vip.kind] || {};
      setHTML(h.goal, `${icon(vd.icon || 'star', 1, 'i12')}<span class="goal-text">${esc(vd.name || 'VIP')}: ${esc(vd.ask || 'tap a building')} · Cancel</span>`, 'goal');
      h.goal.hidden = false;
    } else if (movingId != null) {
      setHTML(h.goal, `${icon('hammer', 1, 'i12')}<span class="goal-text">Choose an empty lot · Cancel</span>`, 'goal');
      h.goal.hidden = false;
    } else if (wishBuild && !rideView) {
      setHTML(h.goal, `${icon('hammer', 1, 'i12')}<span class="goal-text">Pick a lot · ${esc(wishBuild.title)}</span><span aria-hidden="true">×</span>`, 'goal');
      h.goal.hidden = false;
    } else if (goal) {
      const rw = goal.reward || {};
      h.goal.dataset.act = 'nav-goals';                     // the chip opens the full list of goals
      const gp = call('goalProgress', s, goal, now);
      const html = `${icon('star', 1, 'i12')}<span class="goal-text">${esc(goal.text)}${gp ? ` <b class="goal-prog">${formatCoins(gp.have)}/${formatCoins(gp.need)}</b>` : ''}</span>` +
        `<span class="goal-reward">${rw.coins ? `+${formatCoins(rw.coins)}${icon('coin', 1, 'i12')}` : ''}${rw.gems ? `+${rw.gems}${icon('gem', 1, 'i12')}` : ''}</span>`;
      setHTML(h.goal, html, 'goal');
      h.goal.hidden = false;
    } else if (want) {
      setHTML(h.goal, `${icon(want.icon, 1, 'i12')}<span class="goal-text">Most wanted: <b>${esc(want.title)}</b></span>`, 'goal');
      h.goal.hidden = false;
    } else if (!h.goal.hidden) {
      h.goal.hidden = true;
    }

    // A gentle dot on People when someone could be in a better job right now.
    let nudge = false;
    for (const t of s.tenants) { if (betterJob(t)) { nudge = true; break; } }
    if (h.peopleDot.hidden === nudge) h.peopleDot.hidden = !nudge;

    // the night market: a toast when it opens (game hours 19-23)
    const nm = !!call('nightMarket', s, now);
    if (nightWas === false && nm) toast('🌙 The night market is open: food and fun shops sell 25% more until 11pm.');
    nightWas = nm;
    // Feed: how many posts you haven't read
    const unread = call('unreadPosts', s) || 0;
    setText(h.feedCount, unread > 9 ? '9+' : String(unread));
    if (h.feedCount.hidden === (unread > 0)) h.feedCount.hidden = unread === 0;
    // Upgrades: a count of upgrades you can afford right now.
    const ups = Object.keys(config.UPGRADES || {}).filter((id) => { const c = call('upgradeNextCost', s, id); return c > 0 && c <= s.coins; }).length
      + (call('nextCar', s) && call('nextCar', s).cost <= s.coins ? 1 : 0);
    setText(h.jobsCount, String(ups));
    if (h.jobsCount.hidden === (ups > 0)) h.jobsCount.hidden = ups === 0;
    // jobs pop up on the map; a toast says when a resting one is back
    const board = call('jobBoard', s, now) || [];
    const back = board.filter((j) => j.ok && (jobRest.get(j.kind) || 0) > 0);
    if (jobRest.size && back.length) {
      toast(back.length === 1 ? `${back[0].name} popped up on the map · ${formatCoins(back[0].pay)} coins` : `${back.length} jobs popped up on the map`);
    }
    jobRest.clear();
    for (const j of board) jobRest.set(j.kind, j.readyIn);
  }

  /* ----- sheets ----- */
  let sheet = null;         // { kind, ...params, back }
  let closeTimer = 0;
  let openedAt = 0;         // map taps open sheets on pointerup; the browser's follow-up click must not close them

  function openSheet(d) {
    clearTimeout(closeTimer);
    if (!sheet) openedAt = performance.now();
    const sameKind = sheet && sheet.kind === d.kind;
    sheet = d;
    cache.head = cache.body = null;
    if (!renderSheet()) return;
    if (!sameKind) els.body.scrollTop = 0;
    els.sheet.classList.add('on');
    els.backdrop.classList.add('on');
    els.sheet.setAttribute('aria-hidden', 'false');
    select(d.tile || null);
    api.renderer.setMovePreview(d.kind === 'move' ? { tile: d.tile, building: byId(d.id) } : null);
  }
  function closeSheet() {
    if (!sheet) return;
    sheet = null;
    els.sheet.classList.remove('on');
    els.backdrop.classList.remove('on');
    els.sheet.setAttribute('aria-hidden', 'true');
    select(byId(movingId));
    api.renderer.setMovePreview(null);
  }
  function goBack() { if (sheet && sheet.back) openSheet(sheet.back); else closeSheet(); }
  function select(tile) {
    try {
      if (api.renderer && api.renderer.setSelection) api.renderer.setSelection(tile);
      // a town building shows the area it serves while its sheet is open
      const b = tile && sheet && sheet.kind === 'building' ? byId(sheet.id) : null;
      const reach = b && (def(b.type).provides || def(b.type).kind === 'yard') ? { x: b.x, y: b.y, r: call('reachOf', b) || 0 } : null;
      if (api.renderer && api.renderer.setReach) api.renderer.setReach(reach);
    } catch (e) { /* cosmetic */ }
  }
  // Who has what, worked out once per screen update and shared by every row.
  let moodCache = null;
  function mood() {
    if (!moodCache) { moodCache = call('townMood', S(), N()) || null; queueMicrotask(() => { moodCache = null; }); }
    return moodCache;
  }
  function moodOf(t) { return call('residentMood', S(), t, N(), mood()) || { score: 100, missing: [] }; }
  function moodChip(score) {
    return `<span class="tag ${score >= 75 ? 'tag-ok' : score >= 40 ? 'tag-mid' : 'tag-low'}">${icon('heart', 1, 'i12')}${score}%</span>`;
  }

  function renderSheet() {
    if (!sheet) return false;
    const view = VIEWS[sheet.kind] ? VIEWS[sheet.kind](sheet) : null;
    if (!view) { closeSheet(); return false; }
    const head = `${sheet.back ? `<button class="icon-btn" data-act="back" aria-label="Back">‹</button>` : '<span class="icon-gap"></span>'}` +
      `<h2>${view.title}</h2><button class="icon-btn" data-act="close" aria-label="Close">✕</button>`;
    setHTML(els.head, head, 'head');
    const top = els.body.scrollTop;
    if (setHTML(els.body, view.html, 'body') && els.body.scrollTop !== top) els.body.scrollTop = top;
    return true;
  }

  /* ----- shared bits of markup ----- */
  const coinAmt = (n, s = 1) => `<span class="amt">${icon('coin', s, s === 1 ? 'i12' : '')}${formatCoins(n)}</span>`;
  const skillBadge = (cat, value, big) =>
    `<span class="skill${big ? ' big' : ''}" style="--c:${catColor(cat)}">${icon('cat_' + cat, 1, 'i12')}<b>${value}</b></span>`;
  const needOf = (d) => (config.NEEDS || []).find((n) => d.provides && n.id === d.provides.need) || (d.kind === 'trade' ? { icon: 'coin', name: 'Trade' } : d.kind === 'yard' ? { icon: 'hammer', name: 'Faster building' } : { icon: 'star', name: 'Town' });
  const cropName = (crop) => ((config.CROPS || {})[crop] || crop).toLowerCase();

  /** Everything the Trading Post does: sell, import, and neighbour orders. */
  function tradePanel(s, now) {
    const prices = call('tradePrices', s, now) || {};
    const rows = Object.keys(prices).map((crop) => {
      const p = prices[crop]; const have = Math.floor((s.goods && s.goods[crop]) || 0);
      const worth = Math.floor(have * p.price); const importQty = 50; const importCost = Math.ceil(importQty * p.importPrice);
      return `<div class="trade-row" data-key="crop-${crop}">
        <div class="trade-head"><b>${formatCoins(have)} ${esc(cropName(crop))}</b>
          <span>${icon('coin', 1, 'i12')}${p.price} each today ${p.good ? '<span class="tag tag-dream">Good deal today!</span>' : `<small>(usually ${p.usual})</small>`}</span></div>
        <div class="row">
          <button class="btn btn-small ${have > 0 ? 'btn-coin' : 'btn-quiet'}" data-act="sell-goods" data-crop="${crop}">Sell all · +${formatCoins(worth)}</button>
          <button class="btn btn-small btn-quiet" data-act="buy-goods" data-crop="${crop}" data-qty="${importQty}">Import ${importQty} · ${formatCoins(importCost)}</button>
        </div></div>`;
    }).join('');
    const orders = (s.orders || []).map((o) => {
      const have = Math.floor((s.goods && s.goods[o.crop]) || 0); const ready = have >= o.qty;
      return `<div class="trade-row" data-key="order-${o.id}">
        <div class="trade-head"><b>${esc(o.town)} wants ${formatCoins(o.qty)} ${esc(cropName(o.crop))}</b>
          <span>Pays ${formatCoins(o.coins)} ${icon('coin', 1, 'i12')} + ${o.gems} ${icon('gem', 1, 'i12')} · you have ${formatCoins(Math.min(have, o.qty))}/${formatCoins(o.qty)}</span></div>
        <button class="btn btn-small ${ready ? 'btn-go' : 'btn-quiet'}" data-act="fill-order" data-id="${o.id}">${ready ? 'Deliver' : 'Not enough yet'}</button></div>`;
    }).join('');
    const out = (s.trucks || []).filter((t) => t.arriveAt > now && t.kind !== 'contract').sort((a, b) => a.arriveAt - b.arriveAt);
    const fleet = call('truckCount', s, now) || 1;
    const what = (t) => t.kind === 'contract' ? `${formatCoins(t.qty)} ${esc(cropName(t.crop))} to ${esc(t.town)}` : t.kind === 'import' ? `${formatCoins(t.qty)} ${esc(cropName(t.crop))} coming in` :
      t.kind === 'order' ? `${formatCoins(t.qty)} ${esc(cropName(t.crop))} to ${esc(t.town || 'a neighbour')}` : `${formatCoins(t.qty)} ${esc(cropName(t.crop))} going to market`;
    const trucks = `<div class="trade-row" data-key="trucks"><div class="trade-head"><b>Trucks: ${fleet - out.length} of ${fleet} free</b>
      <span>${out.length ? out.map((t) => `${what(t)} · ${Math.max(1, Math.ceil((t.arriveAt - now) / 1000))}s`).join('<br>') : 'Ready to go.'}</span></div></div>`;
    // standing contracts with neighbour towns
    const offers = call('contractOffers', s, now) || [];
    const slots = call('contractSlots', s, now) || 0; const signed = offers.filter((o) => o.signed).length;
    const hearts = (lvl) => '♥'.repeat(lvl) + '♡'.repeat(3 - lvl);
    const contractRows = offers.map((o) => {
      const c = (s.contracts || []).find((x) => x.town === o.town);
      const have = Math.floor((s.goods && s.goods[o.crop]) || 0);
      return `<div class="trade-row" data-key="ct-${o.town}"><div class="trade-head"><b>${esc(o.town)} <span class="hearts">${hearts(o.level)}</span></b>
          <span>${formatCoins(o.qty)} ${esc(cropName(o.crop))} every hour · pays ${formatCoins(o.pay)} ${icon('coin', 1, 'i12')}${o.next ? ` · ${o.deliveries}/${o.next} to the next ♥` : ''}</span>
          ${c ? `<span>${have >= o.qty ? `${icon('box', 1, 'i12')}Ready for the next pickup` : `Barn has ${formatCoins(have)}/${formatCoins(o.qty)}: short hours are skipped`} · ${c.done} delivered</span>` : ''}</div>
        ${c ? `<button class="btn btn-small btn-quiet" data-act="contract-cancel" data-town="${esc(o.town)}">End contract</button>`
          : `<button class="btn btn-small ${signed < slots ? 'btn-go' : 'btn-quiet'}" data-act="contract-sign" data-town="${esc(o.town)}">Sign contract</button>`}</div>`;
    }).join('');
    const contracts = `<h3 class="sec">Contracts · ${signed} of ${slots}</h3>${contractRows}
      <p class="note">Neighbours collect at the top of every hour with their own trucks, even while you're away. Every delivery builds friendship (♥): bigger contracts that pay more. Upgrade the Trading Post for more contracts.</p>`;
    return `${contracts}<h3 class="sec">Trucks</h3>${trucks}<p class="note">Trade drives in and out on the road from out of town. Sales pay when the truck leaves town; imports land when it arrives. A Trading Post near the entry road makes shorter trips; each level adds a truck.</p>
      <h3 class="sec">Your harvest</h3>${rows}<p class="note">Staffed farms fill the barn. Prices change every day.</p>
      <h3 class="sec">Orders from neighbours</h3>${orders || '<p class="note">Orders arrive soon.</p>'}<p class="note">Orders never run out of time.</p>`;
  }
  const dreamTag = (text = 'Dream job') => `<span class="tag tag-dream">${icon('star', 1, 'i12')}${text}</span>`;
  const empty = (iconId, text) => `<div class="empty">${icon(iconId, 4)}<p>${text}</p></div>`;

  function skillBars(t) {
    return `<div class="bars">${CATEGORIES.map((c) => {
      const v = Math.max(0, Math.min(9, (t.skills && t.skills[c]) || 0));
      return `<div class="bar-row" style="--c:${catColor(c)}">${icon('cat_' + c, 1, 'i12')}` +
        `<span class="bar"><i style="width:${Math.round((v / 9) * 100)}%"></i></span><b>${v}</b></div>`;
    }).join('')}</div>`;
  }

  const arrivalText = (s) => { const ms = Math.max(0, (s.nextApplicantAt || 0) - N()); return ms > 0 ? `in ${formatDuration(Math.max(1000, ms))}` : 'soon'; };
  const newcomerNote = (s) => `<p class="note">“Not now” is free; someone new drives in a minute later.${(s.slowArrivalsUntil || 0) > N() ? ' Newcomers are slower for a while: someone was asked to move out.' : ''}</p>`;
  /** A newcomer's skills as ranges: you only learn the real numbers when they move in. */
  function rangeBars(t) {
    return `<div class="bars">${CATEGORIES.map((c) => {
      const [lo, hi] = (t.seen && t.seen[c]) || [t.skills[c], t.skills[c]];
      return `<div class="bar-row" style="--c:${catColor(c)}">${icon('cat_' + c, 1, 'i12')}` +
        `<span class="bar range"><i style="margin-left:${Math.round((lo / 9) * 100)}%;width:${Math.max(6, Math.round(((hi - lo) / 9) * 100))}%"></i></span><b class="rng">${lo === hi ? lo : `${lo}-${hi}`}</b></div>`;
    }).join('')}</div>`;
  }
  const traitLine = (t) => {
    const tr = t.trait && (config.TRAITS || {})[t.trait];
    return tr ? `<div class="p-trait"><b>${esc(tr.name)}</b>: ${esc(tr.up)}, but ${esc(tr.down)}</div>` : '';
  };
  /** A newcomer at the Welcome sign. With a home given, the card moves them in there. */
  function newcomerCard(t, i, home) {
    const dd = def(t.dream);
    const inTown = S().buildings.some((b) => b.type === t.dream);
    const hint = (config.HINTS || {})[t.hint] || '';
    const go = home
      ? `<button class="btn btn-small btn-go" data-act="move-in" data-i="${i}" data-id="${home.id}">${icon('key', 1, 'i12')} Move in here</button>`
      : `<button class="btn btn-small btn-go" data-act="pick-home" data-i="${i}">${icon('key', 1, 'i12')} Pick a home</button>`;
    return `<div class="app-card${t.star ? ' is-star' : ''}" data-key="a${t.id}">
      <div class="app-who"><span class="avatar big">${person(t.look, 5)}</span><b>${esc(t.name)}</b>${t.star ? `<span class="tag tag-dream">${icon('star', 1, 'i12')}Star</span>` : ''}</div>
      <div>${rangeBars(t)}<p class="app-hint">“${esc(hint)}”</p></div>
      <div class="app-dream">${bld(t.dream, 2)}<span class="tiny">${icon('star', 1, 'i12')}Dream</span><b>${esc(dd.name)}</b>
        ${inTown ? '<span class="tag tag-ok">In town ✓</span>' : ''}</div>
      <div class="app-actions"><button class="btn btn-small btn-quiet" data-act="send-away" data-i="${i}">Not now</button>${go}</div></div>`;
  }

  /** One tenant row used by the People sheet and home sheets. */
  function personRow(t) {
    const home = byId(t.homeId); const job = byId(t.jobId);
    const ts = topSkill(t);
    const jf = job ? fit(t, job) : null;
    const perfect = !!(jf && jf.dream);
    const better = perfect ? null : betterJob(t);
    const dreamDef = def(t.dream);
    const tm = home ? moodOf(t) : { score: 100, missing: [] };
    let foot;
    if (perfect) {
      foot = `<div class="p-foot perfect">${icon('star', 2)}<span><b>Perfect fit!</b> Dream job at the ${esc(bName(job))}</span></div>`;
    } else if (better) {
      foot = `<div class="p-foot hint">${buildingArt(better.building, 1, 'mini')}<span>${better.dream ? '<b>Dream job open!</b> ' : 'Best job: '}` +
        `${esc(bName(better.building))} ${skillBadge(categoryOf(better.building), better.skill)}</span>` +
        `<button class="btn btn-small btn-go" data-act="move-job" data-id="${t.id}" data-biz="${better.building.id}">Move</button></div>`;
    } else {
      foot = `<div class="p-foot dream">${bld(t.dream, 1, 'mini')}<span>Dreams of the ${esc(dreamDef.name)}</span>` +
        `${job ? `<span class="tag tag-ok">✓ Best open job</span>` : ''}</div>`;
    }
    return `<div class="p-row${perfect ? ' is-perfect' : ''}" data-key="t${t.id}">
      <div class="p-main">
        <span class="avatar">${person(t.look, 4)}</span>
        <div class="p-info">
          <div class="p-name"><b>${esc(t.name)}</b>${skillBadge(ts.cat, ts.value)}${home ? moodChip(tm.score) : ''}</div>
          <div class="p-sub">${home ? esc(bName(home)) : 'New in town'} · ${job
            ? `${esc(bName(job))} ${skillBadge(categoryOf(job), jf.skill)} ${fitChip(t, job)}`
            : '<span class="looking">Looking for work</span>'}</div>
          ${traitLine(t)}
          ${home ? `<div class="p-wish">“${esc(call('tenantWish', S(), t, N(), mood()) || '')}”</div>` : ''}
          ${home && tm.missing.length ? `<div class="p-why">${tm.missing.slice(0, 3).map((m) => `<span>${icon(m.icon, 1, 'i12')}${esc(m.why)}</span>`).join('')}${tm.missing.length > 3 ? `<span>+${tm.missing.length - 3} more</span>` : ''}</div>` : ''}
        </div>
      </div>${foot}</div>`;
  }

  const VIEWS = {
    /* --- Town: happiness, what people want most, and the hourly rent --- */
    town() {
      const s = S(); const now = N();
      const happy = call('happiness', s, now) || 0;
      const rent = call('rentPerDay', s, now) || 0; const bonus = call('rentBonusPerDay', s, now) || 0;
      const wanted = call('mostWanted', s, now) || [];
      const needs = call('needsStatus', s, now) || [];
      const wishes = wanted.map((w) => {
        const action = w.buildingId != null || w.cat || w.type;
        const body = `${icon(w.icon, 2)}<span class="wish-copy"><b>${esc(w.title)}</b>
          <span>${w.want ? `${w.have}/${w.want} served · ` : ''}${esc(w.hint)}</span></span>`;
        return action
          ? `<button class="want-row wish-button" data-act="follow-wish" data-id="${w.id}" data-key="${w.id}">${body}<span aria-hidden="true">›</span></button>`
          : `<div class="want-row" data-key="${w.id}">${body}</div>`;
      }).join('');
      return {
        title: 'Town',
        html: `<div class="happy-card">
            <div class="happy-head">${icon('heart', 3)}<b>${s.tenants.length ? `${happy}% happy` : 'No residents yet'}</b></div>
            <div class="meter"><i style="width:${happy}%"></i></div>
            <p class="happy-rent">Rent every hour: <b>${formatCoins(Math.round((rent + bonus) / 24))}</b> ${icon('coin', 1, 'i12')}
              ${bonus > 0 ? `<span class="tag tag-ok">+${formatCoins(Math.round(bonus / 24))} happy bonus</span>` : bonus < 0 ? `<span class="tag tag-low">−${formatCoins(Math.round(-bonus / 24))} unhappy residents</span>` : ''}</p>
            <p class="note">Next rent in ${formatDuration(Math.max(60000, 3600000 - (now % 3600000)))}.</p>
          </div>
          <button class="btn btn-quiet btn-wide" data-act="open-mayor">${icon('key', 2)} Mayor's desk${(s.problems || []).length ? ` · ${(s.problems || []).length} to sort out` : ''}</button>
          <h3 class="sec">Most wanted</h3>
          ${wishes || `<p class="note">${s.tenants.length ? 'Everyone has what they need.' : 'Move someone in to see their wishes.'}</p>`}
          <details class="sheet-details" data-key="town-details"><summary>Town details</summary>
          <h3 class="sec">Advertising</h3>
          ${call('adActive', s, now)
            ? `<div class="want-row plain">${icon('star', 2)}<div><b>Your ad is running: ${formatDuration(Math.max(0, (s.adUntil || 0) - now))} left</b><span>Every sale pays +${Math.round((config.TUNING?.adSalesBonus ?? 0.25) * 100)}% and new faces arrive twice as fast.</span></div></div>`
            : `<button class="btn ${(call('adCost', s, now) || 0) <= s.coins ? 'btn-coin' : 'btn-quiet'} btn-wide" data-act="run-ad">Run an ad for 2 hours · ${formatCoins(call('adCost', s, now) || 0)} ${icon('coin', 2)}</button>
               <p class="note">Every sale pays +${Math.round((config.TUNING?.adSalesBonus ?? 0.25) * 100)}% and new faces arrive twice as fast.</p>`}
          <h3 class="sec">Town numbers</h3>
          <div class="stats">
            <div class="stat-cell">${icon('coin', 2)}<b>${formatCoins(Math.round((call('townRatePerMin', s, now) || 0) * 60 * PLAY_BOOST))}</b><span>shops / hour${PLAY_BOOST > 1 ? ` (×${PLAY_BOOST} while you play)` : ''}</span></div>
            <div class="stat-cell">${icon('key', 2)}<b>${formatCoins(Math.round((rent + bonus) / 24))}</b><span>rent / hour</span></div>
            <div class="stat-cell">${icon('person', 2)}<b>${s.tenants.length}/${call('capacity', s) || 0}</b><span>residents</span></div>
            <div class="stat-cell">${icon('hammer', 2)}<b>${s.buildings.length}</b><span>buildings</span></div>
            <div class="stat-cell">${icon('star', 2)}<b>${call('townIQ', s) || 0}</b><span>Town IQ</span></div>
            <div class="stat-cell">${icon('heart', 2)}<b>${(s.land || []).length}/${(config.PARCELS || []).length}</b><span>land owned</span></div>
          </div>
          <h3 class="sec">Kitchen and classroom</h3>
          <div class="want-row plain">${icon('cat_farming', 2)}<div><b>${formatCoins(Math.floor(s.crops?.veggies || 0))} veggies · ${formatCoins(Math.floor(s.crops?.fruit || 0))} fruit grown</b>
            <span>${(() => { const n = call('nextRecipe', s); return n
              ? `Next recipe: ${esc(n.recipe.name)} (${n.progress.map((p) => `${p.have}/${p.want} ${esc((config.CROPS || {})[p.crop] || p.crop).toLowerCase()}`).join(', ')})`
              : 'Every recipe discovered!'; })()}</span></div></div>
          <h3 class="sec">What people need</h3>
          <div class="bars needs">${needs.map((n) => `<div class="bar-row" style="--c:${n.score >= 1 ? '#5bb450' : '#f2c14e'}">${icon(n.icon, 1, 'i12')}
            <span class="need-name">${esc(n.name)}</span><span class="bar"><i style="width:${Math.round(n.score * 100)}%"></i></span><b>${n.score >= 1 ? '✓' : ''}</b></div>`).join('')}</div></details>`,
      };
    },

/* --- Land for sale --- */
    land(d) {
      const s = S();
      const info = call('parcelInfo', s, d.id);
      if (!info || info.owned) return null;
      const words = { water: 'water', sand: 'beach', mountain: 'mountains', forest: 'woods' };
      const feats = info.features.map((k) => words[k]).filter(Boolean);
      return {
        title: esc(info.name),
        html: `<div class="happy-card">
            <p class="lead">${icon('key', 2)} <b>${info.lots} new lots</b>${feats.length ? ` with ${esc(feats.join(', '))}` : ''}.</p>
            ${info.waterfront ? `<p class="note">${icon('coin', 1, 'i12')}${info.waterfront} of them are by the water: homes there pay +${Math.round((config.TUNING?.waterfrontBoost ?? 0.1) * 100)}% rent.</p>` : ''}
            <p class="note">Roads are already laid. Water and mountains can't be built on.</p>
          </div>
          ${!info.reachable ? `<p class="note">Buy the land next to your town first.</p>`
            : `<button class="btn ${info.canBuy ? 'btn-coin' : 'btn-quiet'} btn-wide" data-act="buy-land" data-id="${info.id}">Buy this land · ${formatCoins(info.price)} ${icon('coin', 2)}</button>
               ${info.canBuy ? '' : `<p class="note">You need ${formatCoins(Math.ceil(info.price - s.coins))} more coins. Each piece of land costs more than the last.</p>`}`}`,
      };
    },

    /* --- 2. Build --- */
    build(d) {
      const s = S();
      const order = (config.BUILD_ORDER || Object.keys(BUILDINGS)).filter((id) => BUILDINGS[id]);
      const pop = call('population', s) || 0;
      const card = (id) => {
        const b = BUILDINGS[id];
        const unlocked = call('isUnlocked', s, id);
        const locked = unlocked === undefined ? (b.unlockAt || 0) > pop : !unlocked;
        if (locked) {
          return `<button class="card is-locked" data-act="build-locked" data-type="${id}" data-key="${id}">
            ${bld(id, 3, 'shadowed')}<b class="card-name">???</b>
            <span class="card-note">${esc(call('unlockHint', s, id) || `Unlocks at ${b.unlockAt} residents`)}</span></button>`;
        }
        const cost = call('costOf', s, id) ?? b.cost;
        const short = cost > s.coins;
        return `<button class="card${short ? ' is-short' : ''}" data-act="build-pick" data-type="${id}" data-key="${id}">
          ${bld(id, 3)}<b class="card-name">${esc(b.name)}</b>
          <span class="card-meta">${b.kind === 'home'
            ? `${icon('person', 1, 'i12')}×${b.capacity}`
            : b.provides ? `${icon('person', 1, 'i12')}Serves ${b.provides.serves}`
            : `${icon(needOf(b).icon, 1, 'i12')}${esc(needOf(b).name)}`}</span>
          ${b.near && !call('nearOk', s, id, d.x, d.y) ? `<span class="card-note">${esc(call('nearHint', id) || '')}</span>` : ''}
          <span class="price">${icon('coin', 1, 'i12')}${formatCoins(cost)}</span></button>`;
      };
      const mystery = (cat) => {
        const d = buildCategories[cat];
        const locked = !call('categoryUnlocked', s, cat);
        const cost = call('categoryCost', s, cat);
        const style = locked ? ' is-locked' : cost > s.coins ? ' is-short' : '';
        return `<button class="card${style}" data-act="build-category" data-cat="${cat}" data-key="category-${cat}">
          ${bld('mystery_' + cat, 3, locked ? 'shadowed' : '')}<b class="card-name">${esc(d.name)}</b>
          ${locked ? `<span class="card-note">Unlocks at ${d.unlockAt} residents</span>`
            : `<span class="price">${icon('coin', 1, 'i12')}${formatCoins(cost)}</span>`}</button>`;
      };
      const homes = order.filter((id) => BUILDINGS[id].kind === 'home');
      const town = order.filter((id) => !BUILDINGS[id].gov && ['park', 'trade', 'yard'].includes(BUILDINGS[id].kind));
      const unlocked = (id) => call('isUnlocked', s, id);
      const openCat = (cat) => call('categoryUnlocked', s, cat);
      if (d.wish) {
        const w = d.wish;
        const options = w.cat ? mystery(w.cat) : (w.id === 'beauty'
          ? town.filter((id) => BUILDINGS[id].kind === 'park' && unlocked(id)) : [w.type]).map(card).join('');
        return { title: esc(w.title), html: `<div class="grid">${options}</div>
          <button class="link" data-act="all-buildings">All buildings</button>` };
      }
      const upcoming = [...homes, ...town].filter((id) => !unlocked(id)).map(card).join('') +
        [...CATEGORIES, 'gov'].filter((cat) => !openCat(cat)).map(mystery).join('');
      return {
        title: 'Build',
        html: `<h3 class="sec">Homes</h3><div class="grid">${homes.filter(unlocked).map(card).join('')}</div>` +
              `<h3 class="sec">Surprise shops</h3><div class="grid">${CATEGORIES.filter(openCat).map(mystery).join('')}</div>` +
              (openCat('gov') || town.some(unlocked) ? `<h3 class="sec">Town</h3><div class="grid">${openCat('gov') ? mystery('gov') : ''}${town.filter(unlocked).map(card).join('')}</div>` : '') +
              (upcoming ? `<details class="sheet-details" data-key="upcoming"><summary>Upcoming unlocks</summary><div class="grid">${upcoming}</div></details>` : ''),
      };
    },

    move(d) {
      const b = byId(d.id);
      if (!b) return null;
      const check = call('canMoveBuilding', S(), b.id, d.tile.x, d.tile.y, N());
      const cost = call('buildingWorkFee', b, 'move').toLocaleString('en-US');
      return {
        title: `Move ${esc(bName(b))}`,
        html: `<div class="hero">${buildingArt(b, 3)}<p class="lead">Move here for ${cost} coins?</p></div>
          ${check.ok ? '<button class="btn btn-coin btn-wide" data-act="move-confirm">Confirm move</button>'
            : `<p class="note">${esc(check.reason)}</p>`}`,
      };
    },

    /* --- 3. Building --- */
    building(d) {
      const s = S(); const now = N();
      const b = byId(d.id);
      if (!b) return null;
      const c = def(b.type);
      const name = bName(b);
      const buildingActions = (canRemove) => (d.confirmDemolish
        ? `<div class="confirm"><span>Remove ${esc(name)} for ${call('buildingWorkFee', b, 'demolish').toLocaleString('en-US')} coins?</span>
            <div class="row"><button class="btn btn-quiet" data-act="demolish-cancel">Keep it</button>
            <button class="btn btn-warn" data-act="demolish-yes" data-id="${b.id}">Confirm demolition</button></div></div>`
        : `<div class="row"><button class="link" data-act="move-start">Move building</button>
            ${canRemove ? '<button class="link" data-act="demolish-ask">Demolish</button>' : ''}</div>`);

      // level stars and the upgrade button, shared by every kind of building
      const level = b.level || 1; const maxLevel = config.TUNING?.maxLevel ?? 3;
      const upCost = call('upgradeCost', s, b) || 0;
      const gives = c.kind === 'home' ? 'rent' : c.kind === 'biz' ? 'sales and stock' : 'reach';
      const upPct = Math.round((config.TUNING?.levelBonus ?? 0.5) * 100);
      const upgradeBlock = `<div class="up-row"><span class="up-level">${icon('star', 1, 'i12').repeat(level)} Level ${level}</span>${level >= maxLevel
        ? '<span class="tag tag-ok">Fully upgraded</span>'
        : `<button class="btn btn-small ${upCost > s.coins ? 'btn-quiet' : 'btn-coin'}" data-act="upgrade" data-id="${b.id}">Upgrade · ${formatCoins(upCost)} ${icon('coin', 1, 'i12')}</button>`}</div>
        ${level >= maxLevel ? '' : `<p class="note up-note">Level ${level + 1}: ${c.kind === 'trade' ? 'one more truck and contract' : `+${upPct}% ${gives}${c.kind === 'biz' && level + 1 === (config.TUNING?.slotAtLevel ?? 3) ? ' and one more job' : ''}`}</p>`}`;

      if (!built(b)) {
        const total = Math.max(1, (c.buildSecs || 1) * 1000);
        const left = Math.max(0, b.readyAt - now);
        const pct = Math.max(0, Math.min(100, Math.round((1 - left / total) * 100)));
        return {
          title: esc(name),
          html: `<div class="hero">${buildingArt(b, 4)}<div class="hero-info">
              <p class="lead">Building… <b>${formatDuration(left)}</b> to go</p>
              <div class="meter"><i style="width:${pct}%"></i></div></div></div>
            <button class="btn btn-gem btn-wide" data-act="hurry" data-id="${b.id}">Hurry ${icon('gem', 2)} 1</button>
            ${buildingActions(true)}`,
        };
      }

      if (c.kind === 'home') {
        const res = residentsOf(b.id);
        const free = Math.max(0, (c.capacity || 0) - res.length);
        const beds = [];
        for (let i = 0; i < free; i++) beds.push(`<div class="slot-empty" data-key="bed${i}">${icon('key', 2)}<span>Room for a friend</span></div>`);
        return {
          title: esc(name),
          html: `<div class="hero">${buildingArt(b, 4)}<div class="hero-info">
              <div class="facts">
                <span class="fact">${icon('person', 2)}<b>${res.length}/${c.capacity}</b></span>
                <span class="fact">${icon('coin', 2)}<b>+${formatCoins(Math.round(res.length * (c.rentPerTenant || 0) * (config.levelMult ? config.levelMult(b.level) : 1) * (1 + (call('homeBoost', s, b) || 0))))}</b><small>rent/day</small></span>
              </div>
              <p class="note">${icon('coin', 1, 'i12')}${formatCoins(c.rentPerTenant || 0)} per resident each day, paid a little every hour</p>
              ${(call('homeBoost', s, b) || 0) > 0 ? `<p class="note">${icon('cat_farming', 1, 'i12')}+${Math.round(call('homeBoost', s, b) * 100)}% from ${call('isWaterfront', s, b.x, b.y) ? 'the waterfront and parks' : 'parks'} nearby</p>` : ''}</div></div>
            ${free > 0 ? `<button class="btn btn-go btn-wide" data-act="open-applicants" data-id="${b.id}">${icon('key', 2)} Move someone in</button>` : ''}
            <div class="list">${res.map((t) => personRow(t) + (moveOutAsk === t.id
              ? `<div class="confirm" data-key="mo${t.id}"><span>Ask ${esc(t.name)} to move out? It's free, but newcomers will take twice as long for 10 minutes.</span>
                  <div class="row"><button class="btn btn-quiet" data-act="move-out-no">Keep them</button><button class="btn btn-warn" data-act="move-out-yes" data-t="${t.id}">Move out</button></div></div>`
              : `<button class="link" data-act="move-out-ask" data-t="${t.id}" data-key="mo${t.id}">Ask ${esc(t.name)} to move out</button>`)).join('')}${beds.join('')}</div>
            ${upgradeBlock}${buildingActions(res.length === 0)}`,
        };
      }

      const favPct = Math.round((config.TUNING?.favBonus ?? 0.25) * 100);
      // town buildings: nothing to staff or stock, they just help
      if (c.kind !== 'biz') {
        const lines = [];
        if (c.provides) {
          const reach = call('reachOf', b) || 0;
          lines.push(`${icon(needOf(c).icon, 1, 'i12')}${esc(needOf(c).name)} for homes within ${reach} lots · serving ${mood()?.served.get(b.id) || 0} now`);
          const fixes = Object.values(config.PROBLEMS || {}).some((p) => p.fixer === c.provides.need);
          if (c.gov && fixes) lines.push(`${icon('star', 1, 'i12')}Fixes shop problems within ${reach} lots for free`);
        }
        if (c.fav) lines.push(`${icon('heart', 1, 'i12')}A mayor's favourite: ${c.provides ? 'serves' : 'does'} ${favPct}% more`);
        if (c.kind === 'yard') lines.push(`${icon('hammer', 1, 'i12')}Anything built within ${call('reachOf', b) || 0} lots goes up twice as fast`);
        if (c.lessons) lines.push(`${icon('star', 1, 'i12')}Teaches ${c.lessons} skill ${c.lessons === 1 ? 'point' : 'points'} an hour`);
        if (c.rentBoost) {
          const near = s.buildings.filter((h) => def(h.type).kind === 'home' && Math.max(Math.abs(h.x - b.x), Math.abs(h.y - b.y)) <= (config.TUNING?.parkRadius ?? 2)).length;
          lines.push(`${icon('coin', 1, 'i12')}+${Math.round(c.rentBoost * 100)}% rent for homes within 2 lots (${near} now)`);
        }
        return {
          title: esc(name),
          html: `<div class="hero">${buildingArt(b, 4)}<div class="hero-info">
              <p class="lead">${esc(c.blurb || '')}</p>${lines.map((l) => `<p class="note">${l}</p>`).join('')}</div></div>
            ${upgradeBlock}${c.kind === 'trade' ? tradePanel(s, now) : ''}${buildingActions(true)}`,
        };
      }

      // business
      const cat = categoryOf(b);
      const known = call('recipesFor', s, b) || [];
      const menu = cat === 'food'
        ? `<p class="note">${icon('star', 1, 'i12').repeat(1 + known.length)} ${known.length ? esc(known.map((r) => r.name).join(', ')) : 'Grow crops to discover recipes'}</p>` : '';
      const grown = c.crop ? `<p class="note">${icon('cat_farming', 1, 'i12')}${formatCoins(Math.floor((s.crops && s.crops[c.crop]) || 0))} ${esc((config.CROPS || {})[c.crop] || c.crop).toLowerCase()} grown so far</p>` : '';
      const status = call('bizStatus', s, b, now) || 'open';
      const prob = call('problemOf', s, b.id);
      const cut = Math.round((config.TUNING?.problemSalesCut ?? 0.25) * 100);
      const fee = prob ? call('problemFee', s, now) || 0 : 0;
      const helper = prob && byId(prob.fixerId);
      const trouble = !prob ? '' : `<div class="trouble">
          <p><b>${esc((config.PROBLEMS || {})[prob.kind]?.name || 'A problem')}!</b> Selling ${cut}% less until it is fixed.</p>
          ${prob.fixAt != null
            ? `<p class="note">${icon('star', 1, 'i12')}${helper ? esc(bName(helper)) : 'Help'} is on the way · ${formatDuration(Math.max(1000, prob.fixAt - now))}</p>`
            : `<button class="btn ${fee <= s.coins ? 'btn-coin' : 'btn-quiet'} btn-wide" data-act="fix-problem" data-id="${b.id}">Fix it now ${coinAmt(fee, 2)}</button>
               <p class="note">A ${(config.PROBLEMS || {})[prob.kind]?.fixer === 'health' ? 'clinic' : 'police or fire station'} within reach would fix this for free.</p>`}</div>`;
      const rate = (call('ratePerMin', s, b) || 0) * 60;
      const workers = workersOf(b.id);
      const stockMax = call('stockMaxOf', b) || c.stockMax || 1;
      const pct = Math.max(0, Math.min(100, Math.round(((b.stock || 0) / stockMax) * 100)));
      const full = (b.stock || 0) >= stockMax - 0.5;
      const cost = restockCostOf(b);
      const selfStock = workers.some((t) => t.dream === b.type);
      const chip = {
        open: `<span class="chip chip-open">Open</span>`,
        'needs-workers': `<span class="chip chip-wait">Needs a worker</span>`,
        'out-of-stock': `<span class="chip chip-wait">${icon('box', 1, 'i12')}Sold out</span>`,
        building: `<span class="chip chip-wait">Building</span>`,
      }[status] || '';
      const slots = [];
      const team = call('teamOf', s, b, now);
      const nSlots = Math.max(slotsOf(b), workers.length);
      const addsOf = (t) => { const w = team && team.workers.find((x) => x.tenant.id === t.id); return w && w.adds != null ? Math.round(w.adds * 100) : null; };
      const hireBest = workers.length < slotsOf(b) ? call('bestHire', s, b.id, now) : null;
      for (let i = 0; i < nSlots; i++) {
        const t = workers[i];
        if (t) {
          const f = fit(t, b);
          const adds = addsOf(t);
          slots.push(`<div class="slot${f.dream ? ' is-perfect' : ''}" data-key="w${t.id}">
            <span class="avatar">${person(t.look, 4)}</span>
            <div class="p-info"><div class="p-name"><b>${esc(t.name)}</b>${skillBadge(cat, f.skill)}${fitChip(t, b)}</div>
              <div class="p-sub">${f.dream ? `${dreamTag('Perfect fit!')}` : `Dreams of the ${esc(def(t.dream).name)}`}${adds != null ? ` · <b>+${adds}%</b> sales` : ''}</div></div>
            <button class="btn btn-small btn-quiet" data-act="open-hire" data-id="${b.id}" data-swap="${t.id}">Swap</button></div>`);
        } else {
          slots.push(`<button class="slot slot-hire" data-act="open-hire" data-id="${b.id}" data-key="hire${i}">
            <span class="avatar ghost">${icon('briefcase', 3)}</span><b>Hire someone</b><span class="plus">+</span></button>`);
        }
      }
      const prices = Object.entries(config.PRICE_MODES).map(([mode, price]) => {
        const active = (b.price || 'normal') === mode;
        const forecast = call('priceForecast', s, b, mode);
        const minutes = Math.ceil((forecast?.selloutMs || 0) / 60000);
        const time = minutes > 0 ? formatDuration(minutes * 60000) + ' left' : 'Sold out';
        return `<button class="seg-btn${active ? ' on' : ''}" aria-pressed="${active}" data-act="set-price" data-id="${b.id}" data-mode="${mode}">
          <b>${esc(price.name)}</b>
          ${workers.length ? `<span>${formatCoins(Math.round((forecast?.coinsPerHour || 0) * PLAY_BOOST))} coins/h</span><span>${selfStock ? 'Auto refill' : time}</span>` : ''}
        </button>`;
      }).join('');
      return {
        title: esc(name),
        html: `<div class="hero">${buildingArt(b, 4)}<div class="hero-info">
            <div class="facts">${chip}
              <span class="fact">${icon('coin', 2)}<b>+${formatCoins(Math.round(rate * PLAY_BOOST))}</b><small>/h${PLAY_BOOST > 1 ? ' while you play' : ''}</small></span></div>
            <div class="stock"><span class="stock-label">${icon('box', 1, 'i12')}Stock</span>
              <div class="meter meter-stock${pct === 0 ? ' is-empty' : ''}"><i style="width:${pct}%"></i></div></div>
            ${selfStock ? `<p class="note">${icon('star', 1, 'i12')}Restocks itself — dream worker!</p>` : ''}${menu}${grown}
            ${c.fav ? `<p class="note">${icon('heart', 1, 'i12')}A mayor's favourite: sells ${favPct}% more</p>` : ''}
            ${b.criticUntil > now ? `<p class="note">${icon('star', 1, 'i12')}Rave review: sells ${Math.round((config.TUNING?.criticBoost ?? 0.5) * 100)}% more for ${formatDuration(b.criticUntil - now)}</p>` : ''}
            ${b.buzzUntil > now ? `<p class="note">${icon('heart', 1, 'i12')}Celebrity buzz: sells double for ${formatDuration(b.buzzUntil - now)}</p>` : ''}
          </div></div>
          ${trouble}${full ? '' : `<button class="btn btn-coin btn-wide" data-act="restock" data-id="${b.id}">${icon('box', 2)} Restock ${coinAmt(Math.min(cost, Math.max(0, Math.floor(s.coins))), 2)}</button>`}
          <div class="seg" role="group" aria-label="Prices">${prices}</div>
          <p class="note seg-note">${workers.length ? 'Estimated sales while stocked, before ad bonuses.' : 'Hire a worker to compare sales and stock.'}</p>
          <h3 class="sec">${icon('cat_' + cat, 1, 'i12')} ${CAT_LABEL[cat] || ''} jobs · ${workers.length} of ${slotsOf(b)}</h3>
          ${team ? `<div class="team" data-key="team"><div class="team-head"><b>Team</b><span class="team-stars">${'★'.repeat(team.stars)}${'☆'.repeat(3 - team.stars)}</span><span class="team-pct">${Math.round(team.pct * 100)}%</span></div>
            <div class="meter meter-team"><i style="width:${Math.round(team.pct * 100)}%"></i></div>
            <p class="note">${team.serves ? `Keeps ${team.serves} residents happy with ${esc((CAT_LABEL[cat] || '').toLowerCase())}. ` : ''}${esc(team.tip || 'The best team this shop can have!')}</p></div>` : ''}
          ${hireBest ? `<button class="btn btn-go btn-wide" data-act="hire-pick" data-id="${b.id}" data-t="${hireBest.id}">${icon('briefcase', 2)} Hire best: ${esc(hireBest.name)} ${skillBadge(cat, (hireBest.skills && hireBest.skills[cat]) || 0)}</button>` : ''}
          <div class="list">${slots.join('')}</div>
          ${upgradeBlock}${buildingActions(true)}`,
      };
    },

    /* --- Applicants --- */
    applicants(d) {
      const s = S();
      const home = byId(d.id);
      if (!home) return null;
      const list = s.applicants || [];
      const cards = list.map((t, i) => (t ? newcomerCard(t, i, home) : '')).join('');
      return {
        title: 'Who moves in?',
        html: (cards ? `${cards}${newcomerNote(s)}` : empty('person', `Nobody is waiting right now. Someone new drives in ${arrivalText(s)}.`)),
      };
    },

    /* --- The Welcome sign: newcomers waiting on the entry road --- */
    newcomers() {
      const s = S();
      const list = s.applicants || [];
      const cards = list.map((t, i) => (t ? newcomerCard(t, i, null) : '')).join('');
      return {
        title: 'Newcomers',
        html: `<p class="note">They drove in on the road from out of town. Skills show as a range; you find out the real numbers, and any trait, when they move in.</p>
          ${cards || empty('person', `Nobody is waiting right now. Someone new drives in ${arrivalText(s)}.`)}${cards ? newcomerNote(s) : ''}`,
      };
    },

    /* --- Pick a home for a newcomer --- */
    pickHome(d) {
      const s = S(); const t = s.applicants[d.i];
      if (!t) return null;
      const homes = s.buildings.filter((b) => def(b.type).kind === 'home' && built(b) && residentsOf(b.id).length < (def(b.type).capacity || 0));
      const rows = homes.map((h) => `<div class="move-row" data-key="h${h.id}">${buildingArt(h, 2, 'mini')}
          <span class="move-copy"><b>${esc(bName(h))}</b><small>${residentsOf(h.id).length}/${def(h.type).capacity} · ${formatCoins(def(h.type).rentPerTenant)} rent a day</small></span>
          <button class="btn btn-small btn-go" data-act="move-in" data-i="${d.i}" data-id="${h.id}">Move in</button></div>`).join('');
      return {
        title: `A home for ${esc(t.name)}`,
        html: rows || empty('key', 'Every home is full. Build a home first, then come back.'),
      };
    },

    /* --- Hire --- */
    hire(d) {
      const s = S();
      const b = byId(d.id);
      if (!b) return null;
      const cat = categoryOf(b);
      const rows = s.tenants.filter((t) => t.jobId !== b.id).map((t) => ({ t, f: fit(t, b), busy: t.jobId != null }));
      rows.sort((a, z) => (a.busy - z.busy) || (z.f.dream - a.f.dream) || (z.f.skill - a.f.skill) || String(a.t.name).localeCompare(String(z.t.name)));
      const row = ({ t, f, busy }) => {
        const job = busy ? byId(t.jobId) : null;
        const happy = job && job.type === t.dream;
        return `<button class="pick${f.dream ? ' is-perfect' : ''}${busy ? ' is-busy' : ''}" data-act="hire-pick" data-id="${b.id}" data-t="${t.id}" data-key="t${t.id}">
          <span class="avatar">${person(t.look, 4)}</span>
          <div class="p-info"><div class="p-name"><b>${esc(t.name)}</b>${f.dream ? dreamTag() : ''}</div>
            <div class="p-sub">${busy ? `${happy ? icon('star', 1, 'i12') : ''}Works at the ${esc(bName(job))}` : 'Looking for work'}</div></div>
          ${skillBadge(cat, f.skill, true)}</button>`;
      };
      const freeRows = rows.filter((r) => !r.busy); const busyRows = rows.filter((r) => r.busy);
      const swap = d.swap != null ? tenantById(d.swap) : null;
      let html = `<div class="hire-head">${buildingArt(b, 2)}<p>Big number = great at <b style="color:${catColor(cat)}">${CAT_LABEL[cat] || ''}</b>.
        ${icon('star', 1, 'i12')} = dream job!</p></div>`;
      if (!rows.length) html += empty('key', s.tenants.length ? 'Everyone already works here!' : 'No one lives in town yet. Build a home and move someone in!');
      if (freeRows.length) html += `<div class="list">${freeRows.map(row).join('')}</div>`;
      if (busyRows.length) html += `<h3 class="sec">Already working</h3><div class="list">${busyRows.map(row).join('')}</div>`;
      if (swap && swap.jobId === b.id) html += `<button class="link" data-act="unassign" data-t="${swap.id}">Give ${esc(swap.name)} a break instead</button>`;
      return { title: swap ? `Swap ${esc(swap.name)}` : `Hire for the ${esc(bName(b))}`, html };
    },

    /* --- 4. People --- */
    people() {
      const s = S();
      if (!s.tenants.length) return { title: 'People', html: empty('person', 'No one lives here yet. Build a home, then move someone in!') };
      const perfect = s.tenants.filter((t) => { const j = byId(t.jobId); return j && j.type === t.dream; }).length;
      const sorted = s.tenants.slice().sort((a, z) => (!!betterJob(z) - !!betterJob(a)) || ((a.jobId != null) - (z.jobId != null)));
      const moves = call('jobSuggestions', s, N()) || [];
      const moveRows = moves.map((m) => `<div class="move-row" data-key="mv${m.tenant.id}">
          <span class="avatar">${person(m.tenant.look, 3)}</span>
          <span class="move-copy"><b>${esc(m.tenant.name)}</b> ${m.from ? `${esc(bName(m.from))} →` : 'No job →'} ${esc(bName(m.to))}
            <small>${m.dream ? 'Dream job!' : `Skill ${m.skill} there`} ${fitChip(m.tenant, m.to)}</small></span>
          <button class="btn btn-small btn-go" data-act="move-job" data-id="${m.tenant.id}" data-biz="${m.to.id}">Move</button></div>`).join('');
      const better = moves.length ? `<h3 class="sec">${icon('briefcase', 1, 'i12')} Better jobs</h3>${moveRows}
          ${moves.length > 1 ? `<button class="btn btn-go btn-wide" data-act="move-all" data-n="${moves.length}">Do all ${moves.length} moves</button>` : ''}
          <p class="note">Suggestions only: nobody moves until you tap. ★★★ is a dream job or skill 7+.</p>` : '';
      return {
        title: 'People',
        html: `<div class="summary">${icon('person', 2)}<b>${s.tenants.length}</b> residents<span class="sp"></span>${icon('star', 2)}<b>${perfect}</b> in dream jobs<span class="sp"></span>${icon('heart', 2)}<b>${call('happiness', s, N(), mood()) || 0}%</b></div>
          ${better}<h3 class="sec">Everyone</h3><div class="list">${sorted.map(personRow).join('')}</div>`,
      };
    },

    /* --- Jobs board: ways to earn right now --- */
    jobs() {
      const s = S(); const now = N();
      const rows = (call('jobBoard', s, now) || []).map((j) => {
        const note = j.readyIn > 0 ? `Ready in ${formatDuration(j.readyIn)}` : j.why || j.hint;
        return `<button class="want-row wish-button plain job-row${j.ok ? '' : ' is-off'}" data-act="start-job" data-kind="${j.kind}" data-key="${j.kind}">${icon(j.icon, 2)}
          <span class="wish-copy"><b>${esc(j.name)}</b><span>${esc(note)}</span></span>
          <span class="price">${icon('coin', 1, 'i12')}${j.kind === 'taxi' || j.kind === 'odd' ? 'from ' : ''}${formatCoins(j.pay)}</span></button>`;
      }).join('');
      const car = call('carOf', s) || { name: 'Taxi', speed: 1, pay: 1 }; const next = call('nextCar', s);
      const carRow = `<div class="up-row"><span class="up-level">${icon('taxi', 2)} <b>${esc(car.name)}</b></span>
          ${next ? `<button class="btn btn-small ${next.cost <= s.coins ? 'btn-coin' : 'btn-quiet'}" data-act="upgrade-car">${esc(next.name)} · ${formatCoins(next.cost)} ${icon('coin', 1, 'i12')}</button>` : `<span class="tag tag-ok">Best car</span>`}</div>
        <p class="note up-note">${next ? `${esc(next.name)}: ${Math.round((next.speed / car.speed - 1) * 100)}% faster, fares +${Math.round((next.pay / car.pay - 1) * 100)}%. ` : ''}Hold GAS while driving to go faster and earn up to +${Math.round((config.TUNING?.gasBonus ?? 0.5) * 100)}%.</p>`;
      return { title: 'Jobs', html: `<p class="note">Jobs pay more as your town grows. Each one rests a little after you do it.</p>${rows}${carRow}` };
    },

    /* --- Goals: the guide through the game --- */
    goals() {
      const s = S(); const now = N(); const done = new Set(s.goalsDone || []);
      const next = call('nextGoal', s);
      const rows = (config.GOALS || []).map((g) => {
        const isDone = done.has(g.id); const isNext = next && next.id === g.id;
        const gp = isDone ? null : call('goalProgress', s, g, now);
        const rw = g.reward || {};
        return `<div class="goal-row${isDone ? ' is-done' : ''}${isNext ? ' is-next' : ''}" data-key="g-${g.id}">
          <span class="goal-mark">${isDone ? '✓' : isNext ? '★' : '·'}</span>
          <span class="goal-copy">${esc(g.text)}${gp ? ` <b>${formatCoins(gp.have)}/${formatCoins(gp.need)}</b>` : ''}</span>
          <span class="goal-reward">${rw.coins ? `${formatCoins(rw.coins)}${icon('coin', 1, 'i12')}` : ''}${rw.gems ? ` ${rw.gems}${icon('gem', 1, 'i12')}` : ''}</span></div>`;
      }).join('');
      return { title: `Goals · ${done.size}/${(config.GOALS || []).length}`, html: `<p class="note">Goals finish by themselves when you get there, and pay out right away.</p>${rows}` };
    },

    /* --- The collection book --- */
    collection() {
      const s = S(); const pages = call('collectionPages', s) || [];
      const html = pages.map((p) => `<h3 class="sec">${esc(p.name)} · ${p.have}/${p.total}${p.done ? ' ✓' : ''}</h3>
        <div class="coll">${p.entries.map((e) => `<span class="coll-item${e.found ? '' : ' is-missing'}" data-key="c-${p.id}-${e.id}">${p.id === 'buildings' ? bld(e.id, 2, e.found ? '' : 'shadowed') : icon(p.id === 'vips' ? ((config.VIPS || {})[e.id]?.icon || 'star') : p.id === 'recipes' ? 'cat_food' : 'person', 2)}<small>${e.found ? esc(e.name) : '???'}</small></span>`).join('')}</div>`).join('');
      return { title: 'Collection book', html: `<p class="note">Everything your town has had. Finish a page for ${config.TUNING?.collectionGems ?? 5} gems.</p>${html}` };
    },

    /* --- A VIP waiting on the entry road --- */
    vip() {
      const s = S(); const v = s.vip;
      if (!v) return { title: 'VIP', html: empty('star', 'They already left. Another VIP will come by.') };
      const vd = (config.VIPS || {})[v.kind] || {};
      return { title: `VIP: ${esc(vd.name || '')}`, html: `<div class="hero"><span class="avatar big">${person(v.look, 6)}</span><div class="hero-info">
          <p class="lead"><b>${esc(v.name)}</b>, the ${esc(vd.name || 'VIP')}</p>
          <p class="note">${icon(vd.icon || 'star', 1, 'i12')}${esc(vd.does || '')}</p>
          <p class="note">Waiting for another ${formatDuration(Math.max(1000, v.leaveAt - N()))}. No rush: if they leave, another VIP comes later.</p></div></div>
        <button class="btn btn-go btn-wide" data-act="vip-send">${icon('star', 2)} Send them · ${esc(vd.ask || 'tap a building')}</button>` };
    },

    /* --- Feed: what residents and visitors are saying --- */
    feed() {
      const s = S(); const now = N();
      const posts = (s.feed || []).slice().reverse().map((p) => {
        const ago = Math.max(0, now - p.at);
        const when = ago < 60000 ? 'now' : formatDuration(ago).split(' ')[0];
        return `<div class="post post-${p.tone || 'hint'}" data-key="p${p.id}">
          <span class="avatar">${person(p.look || {}, 3)}</span>
          <div class="post-body"><div class="post-head"><b>${esc(p.name)}</b><span>@${esc(String(p.name).toLowerCase().replace(/[^a-z]/g, ''))}${p.who === 'visitor' ? ' · visitor' : ''} · ${esc(when)}</span></div>
            <p>${esc(p.text)}</p></div></div>`;
      }).join('');
      return { title: 'Town feed', html: posts
        ? `<p class="note">What residents and visitors are saying. Complaints are a hint at what to build next.</p>${posts}`
        : empty('heart', 'Nothing yet. Once the town has a few residents, visitors start dropping by and everyone chats here.') };
    },

    /* --- Upgrades: the car and short ladders that make the town run better --- */
    upgrades() {
      const s = S();
      const car = call('carOf', s) || { name: 'Taxi', speed: 1, pay: 1 }; const next = call('nextCar', s);
      const carRow = `<div class="up-card" data-key="car"><div class="up-head">${icon('taxi', 2)}<b>${esc(car.name)}</b>
          ${next ? `<button class="btn btn-small ${next.cost <= s.coins ? 'btn-coin' : 'btn-quiet'}" data-act="upgrade-car">${esc(next.name)} · ${formatCoins(next.cost)} ${icon('coin', 1, 'i12')}</button>` : '<span class="tag tag-ok">Best car</span>'}</div>
        <p class="note">${next ? `Next: ${Math.round((next.speed / car.speed - 1) * 100)}% faster and fares +${Math.round((next.pay / car.pay - 1) * 100)}%.` : 'The fastest car in town.'} Hold GAS while driving for up to +${Math.round((config.TUNING?.gasBonus ?? 0.5) * 100)}%.</p></div>`;
      const rows = Object.entries(config.UPGRADES || {}).map(([id, u]) => {
        const lvl = call('upLevel', s, id) || 0; const max = u.costs.length; const cost = call('upgradeNextCost', s, id) || 0;
        return `<div class="up-card" data-key="u-${id}"><div class="up-head">${icon(u.icon, 2)}<b>${esc(u.name)}</b><span class="up-pips">${'●'.repeat(lvl)}${'○'.repeat(max - lvl)}</span>
            ${cost ? `<button class="btn btn-small ${cost <= s.coins ? 'btn-coin' : 'btn-quiet'}" data-act="buy-upgrade" data-id="${id}">${formatCoins(cost)} ${icon('coin', 1, 'i12')}</button>` : '<span class="tag tag-ok">Max</span>'}</div>
          <p class="note">${lvl ? `Now: ${esc(u.says(lvl))}.` : 'Not bought yet.'}${cost ? ` Next: ${esc(u.says(lvl + 1))}.` : ''}</p></div>`;
      }).join('');
      const adOn = call('adActive', s, N()); const adCost = call('adCost', s, N()) || 0;
      const adRow = `<div class="up-card" data-key="ad"><div class="up-head">${icon('star', 2)}<b>Run an ad</b>
          ${adOn ? `<span class="tag tag-ok">${formatDuration(Math.max(0, (s.adUntil || 0) - N()))} left</span>`
            : `<button class="btn btn-small ${adCost <= s.coins ? 'btn-coin' : 'btn-quiet'}" data-act="run-ad">${formatCoins(adCost)} ${icon('coin', 1, 'i12')}</button>`}</div>
        <p class="note">An ad makes every sale pay +${Math.round((config.TUNING?.adSalesBonus ?? 0.25) * 100)}% and brings newcomers twice as fast, for ${formatDuration(call('adLengthMs', s) || 7200000)}. Marketing (below) makes ads last longer.</p></div>`;
      return { title: 'Upgrades', html: `<h3 class="sec">Your car</h3>${carRow}<h3 class="sec">Advertising</h3>${adRow}<h3 class="sec">Running the town</h3>${rows}
        <p class="note">Jobs now pop up on the map as gold bubbles: tap one to play. A Construction Yard (in Build) makes anything built near it go up twice as fast.</p>` };
    },

    /* --- A job played inside a sheet: Lunch Rush and Odd Jobs --- */
    job() {
      const s = S(); const j = s.job;
      if (!j || !['rush', 'odd'].includes(j.kind)) return VIEWS.jobs();
      const skip = `<button class="link" data-act="skip-job">Skip this job</button>`;
      if (j.kind === 'rush') {
        const menu = (config.RUSH_MENUS || {})[j.menu] || [];
        const want = menu[j.orders[j.index]] || ['?', ''];
        const shop = byId(j.shopId);
        return {
          title: 'Lunch Rush',
          html: `<p class="lead center">${shop ? esc(bName(shop)) : 'The shop'} · order ${j.index + 1} of ${j.orders.length}</p>
            <div class="rush-want" data-key="o${j.index}"><span>${want[0]}</span><b>${esc(want[1])}, please!</b></div>
            <div class="rush-row">${menu.map((m, i) => `<button class="card rush-btn" data-act="serve" data-i="${i}" data-key="c${i}"><span class="rush-pic">${m[0]}</span><b class="card-name">${esc(m[1])}</b></button>`).join('')}</div>
            <p class="note center">Serve all ${j.orders.length} for ${formatCoins(j.pay)} coins.</p>${skip}`,
        };
      }
      const cat = j.category;
      const rows = j.candidates.map(tenantById).filter(Boolean).map((t) =>
        `<button class="want-row wish-button plain" data-act="send-helper" data-id="${t.id}" data-key="h${t.id}"><span class="avatar">${person(t.look, 3)}</span>
          <span class="wish-copy"><b>${esc(t.name)}</b><span>${CAT_LABEL[cat] || ''} skill</span></span>${skillBadge(cat, t.skills[cat] || 0)}</button>`).join('');
      return {
        title: 'Odd Jobs',
        html: `<p class="lead center">${esc((config.ODD_JOBS || {})[cat] || 'Lend a hand')}</p>
          <p class="note center">Who should go? Better ${(CAT_LABEL[cat] || '').toLowerCase()} skill earns more.</p>${rows}${skip}`,
      };
    },

    /* --- Mayor's desk: problems, unhappy residents, and what each town building covers --- */
    mayor() {
      const s = S(); const now = N(); const m = mood();
      const probs = (s.problems || []).map((p) => {
        const b = byId(p.buildingId); if (!b) return '';
        const helper = byId(p.fixerId);
        return `<button class="want-row wish-button trouble-row" data-act="goto-building" data-id="${b.id}" data-key="p${b.id}">${buildingArt(b, 1, 'mini')}
          <span class="wish-copy"><b>${esc((config.PROBLEMS || {})[p.kind]?.name || 'Problem')} · ${esc(bName(b))}</b>
          <span>${p.fixAt != null ? `${helper ? esc(bName(helper)) : 'Help'} is on the way · ${formatDuration(Math.max(1000, p.fixAt - now))}` : `Fix it for ${formatCoins(call('problemFee', s, now) || 0)} coins`}</span></span><span aria-hidden="true">›</span></button>`;
      }).join('');
      const sad = s.tenants.map((t) => ({ t, m: moodOf(t) })).filter((x) => x.m.missing.length)
        .sort((a, z) => a.m.score - z.m.score || a.t.id - z.t.id).slice(0, 5).map(({ t, m: tm }) => {
          const home = byId(t.homeId);
          return `<button class="want-row wish-button plain" data-act="goto-building" data-id="${home ? home.id : ''}" data-key="s${t.id}"><span class="avatar">${person(t.look, 2)}</span>
            <span class="wish-copy"><b>${esc(t.name)} ${moodChip(tm.score)}</b><span>${esc(tm.missing.slice(0, 2).map((x) => x.why).join(' · '))}</span></span><span aria-hidden="true">›</span></button>`;
        }).join('');
      const services = s.buildings.filter((b) => def(b.type).provides && def(b.type).gov).map((b) => {
        const c = def(b.type);
        return `<button class="want-row wish-button plain" data-act="goto-building" data-id="${b.id}" data-key="g${b.id}">${buildingArt(b, 1, 'mini')}
          <span class="wish-copy"><b>${esc(bName(b))}</b><span>${esc(needOf(c).name)} · serving ${m?.served.get(b.id) || 0} · reach ${call('reachOf', b) || 0} lots</span></span><span aria-hidden="true">›</span></button>`;
      }).join('');
      return {
        title: "Mayor's desk",
        html: `<h3 class="sec">Problems</h3>${probs || `<p class="note">Nothing to sort out. The town is running smoothly.</p>`}
          <h3 class="sec">Residents who need something</h3>${sad || `<p class="note">${s.tenants.length ? 'Everyone has what they need.' : 'No residents yet.'}</p>`}
          <h3 class="sec">Town services</h3>${services || `<p class="note">No government buildings yet. They keep people healthy, safe and learning, and fix shop problems nearby.</p>`}
          <p class="note">Happy residents pay up to +${Math.round((config.TUNING?.happyRentBonus ?? 0.5) * 100)}% rent. Unhappy ones pay up to ${Math.round((config.TUNING?.unhappyRentCut ?? 0.2) * 100)}% less.</p>`,
      };
    },

    /* --- 6. Away --- */
    away(d) {
      const s = S(); const sum = d.summary || {};
      const finished = (sum.finished || []).map(byId).filter(Boolean);
      const soldOut = call('soldOutShops', s, N()) || [];
      const total = soldOut.reduce((a, b) => a + restockCostOf(b), 0);
      const rows = [];
      if (sum.coinsEarned > 0) rows.push(`<div class="away-row">${icon('coin', 3)}<span>Shops earned</span><b>+${formatCoins(sum.coinsEarned)}</b></div>`);
      if (sum.rentPaid > 0) rows.push(`<div class="away-row">${icon('key', 3)}<span>Rent collected</span><b>+${formatCoins(sum.rentPaid)}</b></div>`);
      if (finished.length) rows.push(`<div class="away-row">${icon('hammer', 3)}<span>Finished building</span><span class="sprites">${finished.slice(0, 5).map((b) => buildingArt(b, 1, 'mini')).join('')}${finished.length > 5 ? `<b>+${finished.length - 5}</b>` : ''}</span></div>`);
      if (soldOut.length) {
        rows.push(`<div class="away-row">${icon('box', 3)}<span>${soldOut.length} sold out</span><span class="sprites">${soldOut.slice(0, 5).map((b) => buildingArt(b, 1, 'mini')).join('')}${soldOut.length > 5 ? `<b>+${soldOut.length - 5}</b>` : ''}</span></div>`);
      } else if (d.hadSoldOut) {
        rows.push(`<div class="away-row">${icon('box', 3)}<span>All restocked ✓</span></div>`);
      }
      return {
        title: 'While you were away',
        html: `<p class="lead center">Your town kept busy for <b>${formatDuration(sum.elapsedMs || 0)}</b></p>
          <div class="away">${rows.join('') || `<div class="away-row">${icon('heart', 3)}<span>Everyone missed you!</span></div>`}</div>
          ${soldOut.length ? `<button class="btn btn-coin btn-wide" data-act="restock-all">${icon('box', 2)} Restock all ${coinAmt(Math.min(total, Math.max(0, Math.floor(s.coins))), 2)}</button>` : ''}
          <button class="btn btn-go btn-wide" data-act="close">Nice!</button>`,
      };
    },

    /* --- 9. Menu --- */
    menu(d) {
      const s = S(); const st = s.stats || {};
      const soundOn = !(s.settings && s.settings.sound === false);
      const days = Math.max(1, Math.ceil((N() - (s.createdAt || N())) / 86400000));
      const stat = (ic, label, v) => `<div class="stat-cell">${icon(ic, 2)}<b>${v}</b><span>${label}</span></div>`;
      return {
        title: 'Menu',
        html: `<button class="menu-row" data-act="toggle-sound" role="switch" aria-checked="${soundOn}">
            <span>Sound</span><i class="switch${soundOn ? ' on' : ''}"><i></i></i></button>
          <button class="menu-row" data-act="nav-goals"><span>Goals</span><b class="chev">${(s.goalsDone || []).length}/${(config.GOALS || []).length} ›</b></button>
          <button class="menu-row" data-act="nav-collection"><span>Collection book</span><b class="chev">${(call('collectionPages', s) || []).filter((p) => p.done).length}/${(call('collectionPages', s) || []).length} pages ›</b></button>
          <button class="menu-row" data-act="open-backup"><span>Back up my town</span><b class="chev">›</b></button>
          <button class="menu-row" data-act="open-restore"><span>Restore a backup</span><b class="chev">›</b></button>
          <h3 class="sec">My town · day ${days}</h3>
          <div class="stats">
            ${stat('coin', 'earned', formatCoins(st.earned || 0))}
            ${stat('key', 'rent', formatCoins(st.rentCollected || 0))}
            ${stat('taxi', 'rides', formatCoins(st.rides || 0))}
            ${stat('star', 'dream jobs', formatCoins(st.dreamJobs || 0))}
            ${stat('box', 'restocks', formatCoins(st.restocks || 0))}
            ${stat('person', 'residents', s.tenants.length)}
          </div>
          ${d.reset === 2
            ? `<div class="confirm"><span>Really start a brand new town? This one will be gone for good.</span>
                <div class="row"><button class="btn btn-quiet" data-act="reset-cancel">Keep my town</button>
                <button class="btn btn-warn" data-act="reset-yes">Yes, start over</button></div></div>`
            : d.reset === 1
              ? `<div class="confirm"><span>Start over with an empty town?</span>
                <div class="row"><button class="btn btn-quiet" data-act="reset-cancel">Keep my town</button>
                <button class="btn btn-warn" data-act="reset-ask2">Start over</button></div></div>`
              : `<button class="link" data-act="reset-ask">Start over</button>`}`,
      };
    },

    backup(d) {
      return {
        title: 'Back up my town',
        html: `<p class="lead">Copy this code and keep it somewhere safe, like your Notes.</p>
          <textarea class="code" id="bc-export" readonly rows="5" spellcheck="false">${esc(d.code)}</textarea>
          <button class="btn btn-go btn-wide" data-act="copy-backup">${d.copied ? 'Copied ✓' : 'Copy'}</button>`,
      };
    },

    restore(d) {
      return {
        title: 'Restore a backup',
        html: `<p class="lead">Paste a backup code here. It replaces the town on this phone.</p>
          <textarea class="code" id="bc-import" rows="5" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" placeholder="BITCITY1:…"></textarea>
          ${d.confirm
            ? `<div class="confirm"><span>Replace this town with the backup?</span>
                <div class="row"><button class="btn btn-quiet" data-act="restore-cancel">Not now</button>
                <button class="btn btn-go" data-act="restore-yes">Yes, restore</button></div></div>`
            : `<button class="btn btn-go btn-wide" data-act="restore-ask">Restore</button>`}`,
      };
    },
  };

  /* ----- ride banner ----- */
  let rideView = null;  // { ride, mode, delay }
  let welcomeOffer = null;   // { id, until }: a resident who just moved in and can be driven home for a bonus
  function welcomeBanner() {
    const s = S(); const o = welcomeOffer;
    if (!o) return '';
    const t = tenantById(o.id);
    const fare = t ? call('welcomeFare', s, o.id, N()) || 0 : 0;
    if (!t || !fare || s.ride || s.job || N() > o.until) { if (!t || !fare || N() > o.until) welcomeOffer = null; return ''; }
    return `<div class="ride panel" data-key="welcome-${o.id}"><span class="avatar">${person(t.look, 4)}</span>
      <div class="ride-mid"><p><b>${esc(t.name)}</b> is at the edge of town.</p><p class="note">Drive them home? +${formatCoins(fare)} ${icon('coin', 1, 'i12')}</p></div>
      <button class="btn btn-small btn-go" data-act="welcome-drive">Drive</button>
      <button class="icon-btn" data-act="welcome-skip" aria-label="No thanks">✕</button></div>`;
  }
  function jobBanner() {
    const s = S(); const j = s.job;
    if (!j) return '';
    const d = (config.TOWN_JOBS || {})[j.kind] || {};
    let text = ''; let open = '';
    if (j.kind === 'lost') { const shop = byId(j.shopId); text = `Pip was seen ${esc(j.direction)} of the ${shop ? esc(bName(shop)) : 'shops'}. Tap Pip!`; }
    else if (j.kind === 'courier') text = `${j.stops.length} ${j.stops.length === 1 ? 'home' : 'homes'} left · +${formatCoins(j.pay)} each. Tap the glowing homes.`;
    else if (j.kind === 'rush') { text = `Order ${j.index + 1} of ${j.orders.length}`; open = `<button class="btn btn-small btn-go" data-act="open-job">Open</button>`; }
    else { text = 'Choose a helper'; open = `<button class="btn btn-small btn-go" data-act="open-job">Open</button>`; }
    return `<div class="ride panel" data-key="job-${j.kind}">${icon(d.icon || 'star', 3)}
      <div class="ride-mid"><p><b>${esc(d.name || 'Job')}</b></p><p class="note">${text}</p></div>${open}
      <button class="icon-btn" data-act="skip-job" aria-label="Skip job">✕</button></div>`;
  }
  function renderRide() {
    if (!rideView) {
      const banner = sheet && sheet.kind === 'job' ? '' : jobBanner() || welcomeBanner();
      if (cache.ride !== banner) setHTML(h.ride, banner, 'ride');
      return;
    }
    const s = S();
    const live = s.ride || rideView.ride;
    const t = tenantById(live.tenantId);
    const to = byId(live.toId);
    if (live.kind === 'delivery') {
      setHTML(h.ride, `<div class="ride panel">
        ${icon('box', 3)}<div class="ride-mid"><p><b>Deliver to ${esc(t?.name || bName(to))}</b></p>
        <p class="note">Tap marked home · +${formatCoins(live.fare)} ${icon('coin', 1, 'i12')}</p></div>
        <button class="icon-btn" data-act="skip-delivery" aria-label="Skip delivery">✕</button>
      </div>`, 'ride');
      return;
    }
    const mode = (s.ride && s.ride.state) || rideView.ride.state || 'choosing';
    if (mode === 'choosing' && rideView.mode !== 'choosing') {
      const since = live.acceptedAt ? Math.max(0, Math.min(TIP_MS, N() - live.acceptedAt)) : 0;
      rideView.delay = -Math.round(since);
    }
    rideView.mode = mode;
    const name = t ? esc(t.name) : 'Someone';
    let text; let extra = '';
    if (mode === 'driving') {
      text = `<b>${name}</b> is on the way!`;
      extra = `<div class="ride-fare">${icon('coin', 2)}<b>+${formatCoins(live.fare || 0)}</b></div>`;
    } else if (mode === 'waiting') {
      text = `<b>${name}</b> needs a ride! Tap the taxi.`;
    } else {
      text = `<b>${name}</b> → <b>${esc(bName(to))}</b><small class="ride-hint">Any one will do. Farther pays more!</small>`;
      extra = `<div class="tip"><span>Tip</span><div class="tip-bar"><i style="animation-delay:${rideView.delay || 0}ms"></i></div></div>`;
    }
    const html = `<div class="ride panel" data-key="${mode}">
      <span class="avatar">${t ? person(t.look, 4) : icon('taxi', 3)}</span>
      <div class="ride-mid"><p>${text}</p>${extra}</div>
      ${to ? `<span class="ride-dest">${buildingArt(to, 2)}</span>` : ''}</div>`;
    setHTML(h.ride, html, 'ride');
  }
  function showRide(ride) {
    if (!ride) return;
    rideView = { ride: Object.assign({}, ride), mode: null, delay: 0 };
    cache.ride = null;
    h.ride.textContent = '';
    renderRide();
    refreshHUD();
  }
  function hideRide() {
    if (!rideView) return;
    rideView = null;
    renderRide();
    refreshHUD();
  }

  /* ----- celebrations ----- */
  const queue = [];
  let celeb = null; let celebTimer = 0; let celebRaf = 0; let celebAt = 0;
  const lastDream = { id: null, at: 0 };

  function confetti(n) {
    let out = '';
    for (let i = 0; i < n; i++) out += `<i style="--i:${i};--x:${(i * 37) % 100};--d:${(i * 53) % 9}"></i>`;
    return `<div class="confetti" aria-hidden="true">${out}</div>`;
  }
  function nextCelebration() {
    clearTimeout(celebTimer); cancelAnimationFrame(celebRaf);
    celeb = queue.shift() || null;
    if (!celeb) { els.celebrate.classList.remove('on'); els.celebrate.innerHTML = ''; return; }
    els.celebrate.innerHTML = celeb.html;
    els.celebrate.classList.add('on');
    celebAt = performance.now();
    if (celeb.countTo != null) {
      const el = els.celebrate.querySelector('[data-count]');
      const t0 = performance.now(); const target = celeb.countTo;
      const step = (ts) => {
        const k = Math.min(1, (ts - t0) / 1300);
        if (el) el.textContent = '+' + formatCoins(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) celebRaf = requestAnimationFrame(step);
      };
      celebRaf = requestAnimationFrame(step);
    }
    celebTimer = setTimeout(nextCelebration, CELEBRATE_MS);
  }
  function celebrate(c) { queue.push(c); if (!celeb) nextCelebration(); }


  const gemLine = (awarded) => (awarded === false
    ? `${icon('star', 3)}<b>Perfect fit</b>`
    : `${icon('gem', 3)}<b>+1 gem</b>`);
  function dreamHTML(tenant, building, awarded) {
    let stars = '';
    for (let i = 0; i < 8; i++) stars += `<i style="--i:${i}">${icon('star', 2)}</i>`;
    return `<div class="cele-card panel dream">${confetti(14)}
      <div class="cele-pair"><div class="starburst" aria-hidden="true">${stars}</div>
        <span class="avatar big">${person(tenant.look, 6)}</span>${buildingArt(building, 4)}</div>
      <h2>Dream job!</h2>
      <p><b>${esc(tenant.name)}</b> landed their dream job at the <b>${esc(bName(building))}</b>!</p>
      <div class="cele-amount small" data-gemline>${gemLine(awarded)}</div>
      <span class="cele-tap">Tap to continue</span></div>`;
  }
  /** `gemAwarded` is optional: pass false to hide the "+1 gem" line (repeat dream placements). */
  function celebrateDream(tenant, building, gemAwarded) {
    if (!tenant) return;
    const now = performance.now();
    if (lastDream.id === tenant.id && now - lastDream.at < 3000) return; // called by both the UI and the app
    lastDream.id = tenant.id; lastDream.at = now;
    building ||= { type: tenant.dream };
    celebrate({ tenantId: tenant.id, tenant, building, html: dreamHTML(tenant, building, gemAwarded) });
  }
  /** Once the UI knows whether a gem was really paid, make the open/queued card say the truth. */
  function setDreamGem(tenantId, awarded) {
    for (const c of [celeb, ...queue]) {
      if (!c || c.tenantId !== tenantId) continue;
      c.html = dreamHTML(c.tenant, c.building, awarded);
      if (c === celeb) { const el = els.celebrate.querySelector('[data-gemline]'); if (el) el.innerHTML = gemLine(awarded); }
    }
  }

  /* ----- public: open things ----- */
  function openLand(id) { openSheet({ kind: 'land', id }); }
  /** Start a job from the map (its bubble's building) or a list. */
  function startJob(kind, anchorId) {
    const s = S();
    if (kind === 'taxi' || kind === 'delivery') {
      const r = act('startBoardRide', kind, anchorId ?? null);
      if (!r.ok) { if (r.reason) toast(r.reason); return; }
      closeSheet();
      if (r.driving) { try { api.startDrive(); } catch (e) { /* the ride still pays when it ends */ } return; }
      try { if (kind === 'delivery' && r.destination) api.renderer.focusTile(r.destination); } catch (e) { /* cosmetic */ }
      showRide(S().ride);
      return;
    }
    const shops = (call('townJobOptions', s, N()) || {}).shops || [];
    const shop = shops.find((b) => b.id === anchorId) || shops[Math.floor(Math.random() * shops.length)];
    const r = act('startTownJob', kind, shop ? shop.id : null);
    if (!r.ok) { if (r.reason) toast(r.reason); return; }
    if (kind === 'rush' || kind === 'odd') { openSheet({ kind: 'job' }); return; }
    closeSheet();
    // Lost & Found is a search: the map stays where you are (Camden). Other jobs show their shop.
    if (kind !== 'lost') { try { const at = byId(r.job.shopId) || r.job; if (at) api.renderer.focusTile({ x: at.x, y: at.y }); } catch (e) { /* cosmetic */ } }
  }
  function openNewcomers() { openSheet({ kind: 'newcomers' }); }
  /** While sending a VIP: the tapped building is where they go. Returns true if the tap was used. */
  function pickVipTarget(x, y, building) {
    if (!vipSending) return false;
    const vd = (config.VIPS || {})[S().vip?.kind] || {};
    if (!building) { toast(`${vd.name || 'The VIP'}: ${vd.ask || 'tap a building'}.`); return true; }
    const r = act('sendVip', building.id);
    if (r && r.ok) { vipSending = false; toast(r.text); refreshHUD(); }
    else if (r && r.reason) toast(r.reason);
    return true;
  }
  function openVip() { if (S().vip) openSheet({ kind: 'vip' }); }
  function pickMoveLot(x, y) {
    if (movingId == null) return false;
    // tapping a building (or any taken spot) means you've moved on: leave move mode and act normally
    if (call('tileAt', S(), x, y)) { movingId = null; api.renderer.setMovePreview(null); refreshHUD(); return false; }
    const check = call('canMoveBuilding', S(), movingId, x, y, N());
    if (check.ok) openSheet({ kind: 'move', id: movingId, tile: { x, y } });
    else toast(check.reason);
    return true;
  }
  function openLot(x, y) {
    const existing = call('tileAt', S(), x, y);
    if (existing) { openBuilding(existing); return; }
    const wish = wishBuild;
    wishBuild = null;
    openSheet({ kind: 'build', x, y, tile: { x, y }, wish });
    refreshHUD();
  }
  function openBuilding(b) {
    if (!b) return;
    openSheet({ kind: 'building', id: b.id, tile: { x: b.x, y: b.y } });
  }
  function showAway(summary) {
    if (!summary) return;
    if (summary.elapsedMs != null && summary.elapsedMs < 120000) return;
    const hadSoldOut = !!call('soldOutShops', S(), N())?.length;
    openSheet({ kind: 'away', summary, hadSoldOut });
  }

  /* ----- actions (event delegation) ----- */
  const buildingSheet = (id) => { const b = byId(id); return b ? { kind: 'building', id: b.id, tile: { x: b.x, y: b.y } } : null; };

  function assign(tenantId, bizId) {
    const before = S().gems;
    const r = act('assignJob', tenantId, bizId);
    const gem = r && typeof r.firstDream === 'boolean' ? r.firstDream : S().gems > before;
    if (r && r.ok !== false) {
      const t = tenantById(tenantId); const b = byId(bizId);
      if (r.dream && t) { celebrateDream(t, b, gem); setDreamGem(t.id, gem); }
      else if (t && b) toast(`${t.name} now works at the ${bName(b)}!`);
    }
    return r;
  }

  const ACTIONS = {
    close: closeSheet,
    back: goBack,
    'celebrate-close': () => { if (performance.now() - celebAt > 350) nextCelebration(); },

    'nav-build': () => { wishBuild = null; closeSheet(); refreshHUD(); toast('Tap an empty lot'); },
    'nav-people': () => openSheet({ kind: 'people' }),
    'open-mayor': () => openSheet({ kind: 'mayor', back: { kind: 'town' } }),
    'goto-building': (el) => {
      const b = byId(Number(el.dataset.id));
      if (!b) return;
      try { api.renderer.focusTile({ x: b.x, y: b.y }); } catch (e) { /* cosmetic */ }
      openSheet({ kind: 'building', id: b.id, tile: { x: b.x, y: b.y }, back: { kind: 'mayor', back: { kind: 'town' } } });
    },
    'fix-problem': (el) => {
      const r = act('fixProblem', Number(el.dataset.id));
      toast(r && r.ok ? 'All fixed!' : (r && r.reason) || '');
    },
    'nav-menu': () => openSheet({ kind: 'menu', reset: 0 }),
    'nav-upgrades': () => openSheet({ kind: 'upgrades' }),
    'contract-sign': (el) => { const r = act('signContract', el.dataset.town); toast(r && r.ok ? `Signed with ${el.dataset.town}! Their truck comes every hour.` : (r && r.reason) || ''); },
    'contract-cancel': (el) => { const r = act('cancelContract', el.dataset.town); if (r && r.ok) toast(`Contract with ${el.dataset.town} ended.`); },
    'vip-send': () => { vipSending = true; movingId = null; closeSheet(); refreshHUD(); },
    'vip-cancel': () => { vipSending = false; refreshHUD(); },
    'nav-feed': () => { openSheet({ kind: 'feed' }); act('readFeed'); },
    'buy-upgrade': (el) => {
      const r = act('buyUpgrade', el.dataset.id);
      const u = (config.UPGRADES || {})[el.dataset.id];
      toast(r && r.ok ? `${u.name} level ${r.level}! ${u.says(r.level)}.` : (r && r.reason) || '');
    },
    'nav-jobs': () => openSheet(S().job && ['rush', 'odd'].includes(S().job.kind) ? { kind: 'job' } : { kind: 'jobs' }),
    'open-job': () => openSheet({ kind: 'job' }),
    'welcome-skip': () => { welcomeOffer = null; renderRide(); },
    'welcome-drive': () => {
      if (!welcomeOffer) return;
      const r = act('startWelcome', welcomeOffer.id);
      if (!r.ok) return;
      welcomeOffer = null;
      closeSheet();
      try { api.renderer.focusTile(r.ride.from); api.startDrive(); } catch (e) { /* the ride still pays when it ends */ }
      refresh();
    },
    'upgrade-car': () => { const r = act('upgradeCar'); if (r.ok) toast(`New car: the ${r.car.name}!`); },
    'start-job': (el) => startJob(el.dataset.kind, null),
    'skip-job': () => { act('skipTownJob'); closeSheet(); },
    serve: (el) => {
      const j = S().job; if (!j) return;
      const r = act('serveOrder', j.index, Number(el.dataset.i));
      if (r.ok && r.done) { toast(`Lunch Rush done! +${formatCoins(r.pay)} coins`); closeSheet(); }
    },
    'send-helper': (el) => {
      const r = act('sendHelper', Number(el.dataset.id));
      if (r.ok) { toast(`Job done! +${formatCoins(r.pay)} coins`); closeSheet(); }
    },
    'nav-town': () => { wishBuild = null; openSheet({ kind: 'town' }); refreshHUD(); },
    'nav-goals': () => { openSheet({ kind: 'goals' }); setTimeout(() => { try { els.body.querySelector('.is-next')?.scrollIntoView({ block: 'center' }); } catch (e) { /* cosmetic */ } }, 60); },
    'nav-collection': () => openSheet({ kind: 'collection' }),
    'follow-wish': (el) => {
      const wish = call('mostWanted', S(), N())?.find((w) => w.id === el.dataset.id);
      if (!wish) return;
      const shop = byId(wish.buildingId);
      if (shop) {
        openSheet({ kind: 'hire', id: shop.id, tile: shop, back: { kind: 'town' } });
      } else if (wish.cat || wish.type) {
        if (rideView) { toast('Finish or skip the activity first'); return; }
        wishBuild = wish;
        closeSheet();
        refreshHUD();
      }
    },
    'all-buildings': () => openSheet({ ...sheet, wish: null }),
    'skip-delivery': () => act('skipDelivery'),

    'build-locked': (el) => {
      toast(call('unlockHint', S(), el.dataset.type));
    },
    'build-pick': (el) => {
      const type = el.dataset.type; const b = def(type); const s = S();
      if (!sheet || sheet.kind !== 'build') return;
      const cost = call('costOf', s, type) ?? b.cost;
      if (cost > s.coins) { toast(`${formatCoins(Math.ceil(cost - s.coins))} more coins for the ${b.name}`); return; }
      const { x, y } = sheet;
      const r = act('build', type, x, y);
      if (r && r.ok !== false) { closeSheet(); toast(`Building the ${b.name}!`); }
    },
    'build-category': (el) => {
      if (sheet?.kind !== 'build') return;
      const r = act('buildRandom', el.dataset.cat, sheet.x, sheet.y);
      if (!r.ok) return;
      const name = bName(r.building);
      openBuilding(r.building);
      toast(`It's ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}!`);
    },

    hurry: (el) => {
      if ((S().gems || 0) < 1) { toast('1 gem needed — goals and dream jobs give gems!'); return; }
      const r = act('hurry', Number(el.dataset.id));
      if (r && r.ok !== false) toast('All done!');
    },
    restock: (el) => {
      const r = act('restock', Number(el.dataset.id));
      if (r.ok) toast(r.partial ? 'Shelves topped up!' : 'Shelves are full!');
    },
    'restock-all': () => {
      if (!sheet || sheet.kind !== 'away') return;
      const r = act('restockAll');
      if (r.ok) toast(r.count ? 'Every sold-out shop has stock again!' : 'No shops are sold out.');
    },
    'buy-land': (el) => {
      const r = act('buyLand', el.dataset.id);
      if (r && r.ok !== false) closeSheet(); else if (r && r.reason) toast(r.reason);
    },
    'set-price': (el) => { act('setPrice', Number(el.dataset.id), el.dataset.mode); },
    'sell-goods': (el) => {
      const r = act('sellGoods', el.dataset.crop);
      toast(r && r.ok !== false ? `Truck's off with ${formatCoins(r.qty)} ${cropName(el.dataset.crop)} · +${formatCoins(r.coins)} coins when it leaves town` : (r && r.reason) || '');
    },
    'buy-goods': (el) => {
      const r = act('buyGoods', el.dataset.crop, Number(el.dataset.qty));
      toast(r && r.ok !== false ? `${el.dataset.qty} ${cropName(el.dataset.crop)} on the way · here in ${Math.ceil((r.truck.arriveAt - r.truck.leaveAt) / 1000)}s` : (r && r.reason) || '');
    },
    'fill-order': (el) => {
      const r = act('fillOrder', Number(el.dataset.id));
      toast(r && r.ok !== false ? `Truck's off to ${r.truck.town} · they pay when it leaves town` : (r && r.reason) || '');
    },
    'run-ad': () => { const r = act('runAd'); if (r && r.ok === false && r.reason) toast(r.reason); },
    upgrade: (el) => {
      const r = act('upgrade', Number(el.dataset.id));
      if (r && r.ok === false && r.reason) toast(r.reason);
    },
    'move-start': () => {
      if (sheet?.kind !== 'building') return;
      movingId = sheet.id;
      wishBuild = null;
      closeSheet();
      refreshHUD();
    },
    'move-cancel': () => {
      const b = byId(movingId);
      movingId = null;
      if (b) openBuilding(b);
      else select(null);
      refreshHUD();
    },
    'move-confirm': () => {
      if (sheet?.kind !== 'move') return;
      const r = act('moveBuilding', sheet.id, sheet.tile.x, sheet.tile.y);
      if (!r.ok) return;
      movingId = null;
      openBuilding(r.building);
      refreshHUD();
      toast(`Moved · ${r.cost.toLocaleString('en-US')} coins`);
    },
    'demolish-ask': () => {
      if (sheet?.kind !== 'building') return;
      const check = call('canDemolish', S(), sheet.id, N());
      if (!check.ok) { toast(check.reason); return; }
      sheet.confirmDemolish = true;
      renderSheet();
      els.body.scrollTop = els.body.scrollHeight;
    },
    'demolish-cancel': () => { if (sheet) { sheet.confirmDemolish = false; renderSheet(); } },
    'demolish-yes': (el) => {
      const r = act('demolish', Number(el.dataset.id));
      if (r && r.ok !== false) { closeSheet(); toast(`Demolished · ${r.cost.toLocaleString('en-US')} coins`); }
      else if (sheet) { sheet.confirmDemolish = false; renderSheet(); }
    },

    'open-applicants': (el) => openSheet({ kind: 'applicants', id: Number(el.dataset.id), back: buildingSheet(Number(el.dataset.id)), tile: sheet && sheet.tile }),
    'move-in': (el) => {
      const homeId = Number(el.dataset.id);
      const r = act('moveIn', Number(el.dataset.i), homeId);
      if (r && r.ok !== false) {
        if (r.tenant) { revealToast(r.tenant); welcomeOffer = { id: r.tenant.id, until: N() + 90000 }; }
        const back = buildingSheet(homeId);
        if (back) openSheet(back); else closeSheet();
      } else if (r && r.reason) toast(r.reason);
    },
    'pick-home': (el) => openSheet({ kind: 'pickHome', i: Number(el.dataset.i), back: { kind: 'newcomers' } }),
    'send-away': (el) => { const r = act('sendAway', Number(el.dataset.i)); if (r && r.ok) toast('They drive on. Someone new arrives in a minute.'); },
    'move-out-ask': (el) => { moveOutAsk = Number(el.dataset.t); refresh(); },
    'move-out-no': () => { moveOutAsk = null; refresh(); },
    'move-out-yes': (el) => {
      const t = tenantById(Number(el.dataset.t)); moveOutAsk = null;
      const r = act('moveOut', Number(el.dataset.t));
      if (r && r.ok && t) toast(`${t.name} moved out. Newcomers will be slower for 10 minutes.`);
    },

    'open-hire': (el) => openSheet({
      kind: 'hire', id: Number(el.dataset.id), swap: el.dataset.swap != null ? Number(el.dataset.swap) : null,
      back: buildingSheet(Number(el.dataset.id)), tile: sheet && sheet.tile,
    }),
    'hire-pick': (el) => {
      const bizId = Number(el.dataset.id); const tenantId = Number(el.dataset.t);
      const b = byId(bizId);
      const swap = sheet && sheet.kind === 'hire' && sheet.swap != null ? tenantById(sheet.swap) : null;
      const isFull = b && workersOf(bizId).length >= slotsOf(b);
      if (swap && swap.jobId === bizId && isFull) api.act('assignJob', swap.id, null);
      const r = assign(tenantId, bizId);
      if (r && r.ok === false && swap && isFull) api.act('assignJob', swap.id, bizId); // put them back
      if (r && r.ok !== false) { const back = buildingSheet(bizId); if (back) openSheet(back); else closeSheet(); }
    },
    unassign: (el) => {
      const t = tenantById(Number(el.dataset.t));
      const r = act('assignJob', Number(el.dataset.t), null);
      if (r && r.ok !== false) { if (t) toast(`${t.name} is taking a break`); goBack(); }
    },
    'move-job': (el) => { assign(Number(el.dataset.id), Number(el.dataset.biz)); },
    'move-all': (el) => {
      // the list is worked out again before each move, so every move still fits; never more than the button said
      let n = 0;
      for (let i = 0; i < Number(el.dataset.n || 20); i++) {
        const m = (call('jobSuggestions', S(), N(), 1) || [])[0];
        if (!m) break;
        const r = act('assignJob', m.tenant.id, m.to.id);
        if (!r || r.ok === false) break;
        n++;
      }
      if (n) toast(`${n} ${n === 1 ? 'person' : 'people'} moved to better jobs`);
    },

    'toggle-sound': () => {
      const s = S();
      const next = !(s.settings && s.settings.sound !== false);
      if (typeof api.setSound === 'function') api.setSound(next);
      else if (typeof sim.setSound === 'function') api.act('setSound', next);
      else { s.settings = s.settings || {}; s.settings.sound = next; }
      toast(next ? 'Sound on' : 'Sound off');
      refresh();
    },
    'open-backup': () => {
      let code = '';
      try { code = api.exportSave() || ''; } catch (e) { toast('Couldn’t make a backup just now. Try again!'); return; }
      openSheet({ kind: 'backup', code, copied: false, back: { kind: 'menu', reset: 0 } });
    },
    'copy-backup': () => {
      if (!sheet || sheet.kind !== 'backup') return;
      const ta = root.querySelector('#bc-export');
      const done = () => { if (sheet && sheet.kind === 'backup') { sheet.copied = true; renderSheet(); } toast('Copied! Paste it somewhere safe.'); };
      const fallback = () => {
        try {
          ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
          if (document.execCommand && document.execCommand('copy')) done();
          else toast('Selected! Now tap Copy.');
        } catch (e) { toast('Press and hold the code to copy it.'); }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sheet.code).then(done, fallback);
        else fallback();
      } catch (e) { fallback(); }
    },
    'open-restore': () => openSheet({ kind: 'restore', confirm: false, back: { kind: 'menu', reset: 0 } }),
    'restore-ask': () => {
      const ta = root.querySelector('#bc-import');
      if (!ta || !ta.value.trim()) { toast('Paste your backup code first'); return; }
      sheet.confirm = true; renderSheet(); els.body.scrollTop = els.body.scrollHeight;
    },
    'restore-cancel': () => { sheet.confirm = false; renderSheet(); },
    'restore-yes': () => {
      const ta = root.querySelector('#bc-import');
      const str = ta ? ta.value.trim() : '';
      try {
        api.importSave(str);
        movingId = null;
        closeSheet();
        toast('Welcome back! Your town is restored.');
        coinShown = null;
        refresh();
      } catch (e) {
        toast((e && e.message) || 'That code didn’t work. Check it and try again.');
        if (sheet && sheet.kind === 'restore') { sheet.confirm = false; renderSheet(); }
      }
    },
    'reset-ask': () => { sheet.reset = 1; renderSheet(); els.body.scrollTop = els.body.scrollHeight; },
    'reset-ask2': () => { sheet.reset = 2; renderSheet(); els.body.scrollTop = els.body.scrollHeight; },
    'reset-cancel': () => { sheet.reset = 0; renderSheet(); },
    'reset-yes': () => {
      try { api.resetGame(); } catch (e) { toast('Hmm, that didn’t work. Try again!'); return; }
      movingId = null;
      closeSheet();
      coinShown = null;
      toast('A fresh new town!');
      refresh();
    },
  };

  root.addEventListener('click', (e) => {
    if (performance.now() - openedAt < 350) return;
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || !root.contains(el)) return;
    const fn = ACTIONS[el.getAttribute('data-act')];
    if (!fn) return;
    e.preventDefault();
    try { fn(el, e); } catch (err) { if (typeof console !== 'undefined') console.error('[ui]', err); }
  });
  // Keep sheet scrolling from ever dragging the page / map underneath.
  els.backdrop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  /* ----- refresh ----- */
  function refresh() {
    try {
      refreshHUD();
      if (rideView) {
        if (!S().ride) { rideView = null; renderRide(); refreshHUD(); } else renderRide();
      } else renderRide();   // keeps the job banner current
      if (sheet) renderSheet();
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[ui] refresh', err);
    }
  }

  refresh();

  return {
    refresh, openLot, openLand, openNewcomers, startJob, openVip, pickVipTarget, openBuilding, pickMoveLot, showAway, showRide, hideRide, celebrateDream, toast,
    isModalOpen: () => !!sheet || !!celeb || queue.length > 0,
  };
}
