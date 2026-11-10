# Mini Mayor — build spec (phase 1)

A cute, simple, positive-reinforcement town builder for one player on an iPhone
(portrait, home-screen web app). Inspired by Tiny Tower. You are the landlord.
No penalties, no chores: nothing in the game ever takes something away from the player.

## Tech rules (every module)

- Plain ES modules in `js/`, no build step, no dependencies, no network requests.
  Must run by serving the folder statically. Import with relative paths and `.js` suffix.
- `js/config.js`, `js/state.js`, `js/sim.js` are PURE (no DOM, no window, no localStorage
  except inside the save/load functions of state.js which must guard `typeof localStorage`).
  They must run under Node 22 (`node --test`).
- Time is always passed in as `now` (ms epoch). Never call `Date.now()` inside sim logic.
- Target: iPhone Safari, portrait, ~390x844 CSS px, safe-area insets, touch only.
- Each agent ONLY writes the files it owns (listed below). Do not edit other files.
  If you need something from another module that this spec doesn't give you, code
  against the spec as written and list the gap in your final report.

## File ownership

| File | Owner |
|---|---|
| `js/sprites.js`, `tools/preview-sprites.mjs`, `icons/*.png` | ART agent |
| `js/config.js`, `js/state.js`, `js/sim.js`, `tests/*.test.mjs` | ENGINE agent |
| `js/render.js` | RENDER agent |
| `js/ui.js`, `styles.css` | UI agent |
| `index.html`, `js/main.js`, `js/audio.js`, `sw.js`, `manifest.webmanifest` | lead (not agents) |

## World

- Grid `MAP_W = 11` columns x `MAP_H = 14` rows. Tile = 16x16 art pixels.
- `isRoad(x, y)` = `x % 4 === 3 || y % 3 === 2`  (roads at columns 3, 7 and rows 2, 5, 8, 11).
- Every non-road tile is a building lot. Every building occupies exactly one lot.
- Building sprites are 16 wide x 24 tall, anchored to the bottom of their tile
  (the top 8 px overlap the tile above). Draw rows top to bottom.

## Job categories

`CATEGORIES = ['food', 'retail', 'service', 'farming', 'creative']`
Category colors (use everywhere): food `#e8804a`, retail `#4a90d9`, service `#9a6fd0`,
farming `#5bb450`, creative `#e85d8a`.

## Buildings (config.js `BUILDINGS`, keyed by type id)

Housing (`kind: 'home'`): `tent` (cap 1), `cabin` (cap 2), `apartment` (cap 4), `house` (cap 3, highest rent).
Businesses (`kind: 'biz'`, 2 job slots each):

| id | name | category |
|---|---|---|
| `diner` | Diner | food |
| `bakery` | Bakery | food |
| `market` | General Store | retail |
| `bookshop` | Bookshop | retail |
| `well` | Water Works | service |
| `barber` | Barber | service |
| `farm` | Veggie Farm | farming |
| `orchard` | Orchard | farming |
| `studio` | Art Studio | creative |
| `music` | Music Shop | creative |

Each config entry:
```js
{ id, name, kind: 'home'|'biz', category|null, cost, buildSecs, unlockAt (population needed, 0 = from start),
  // home:
  capacity, rentPerTenant,        // coins per tenant per REAL day
  // biz:
  slots: 2, baseRate,             // coins per real minute at factor 1
  stockMax,                       // coins worth of goods when full
  restockCost,                    // coins to refill from empty (pro-rated by how empty)
  blurb }                         // one short friendly line
```
Balance targets (ENGINE agent tunes): start with 250 coins and 2 gems. A new player can
afford a tent + one business immediately and has ~6 buildings after 15 active minutes.
A full stock lasts roughly 2–6 real hours. The midnight rent payout should feel big:
about 4–6 hours of total business income. Costs grow ~1.6x per unlock tier.
Unlocks by population: tent, diner, market, well from the start; then one or two new
types every ~2 residents until everything is open by ~16 residents.

## State (plain JSON, must survive `JSON.parse(JSON.stringify(state))`)

```js
state = {
  v: 1, createdAt, lastTick,            // ms epoch
  lastRentDay: 'YYYY-MM-DD',            // LOCAL calendar day of the last rent payout
  coins, gems, nextId,
  stats: { earned, rides, dreamJobs, rentCollected, restocks },
  buildings: [{ id, type, x, y, readyAt,     // under construction while now < readyAt
                stock,                        // biz only, 0..stockMax (coins worth)
                dreamStars }],                // biz only, count of dream-job workers currently here
  tenants:   [{ id, name, look: { skin, hair, hairStyle, shirt },   // small ints, see sprites
                skills: { food, retail, service, farming, creative },  // each 0..9
                dream,                        // a biz type id
                homeId, jobId }],             // jobId null when unemployed
  applicants: [ /* up to 3 tenant-shaped objects, homeId/jobId null */ ],
  nextApplicantAt,
  ride: null | { tenantId, fromId, toId, state: 'waiting'|'choosing'|'driving',
                 requestedAt, acceptedAt, fare, tries },
  nextRideAt,
  goalsDone: [goalId, ...],
  settings: { sound: true }
}
```
`look` ranges: `skin` 0..4, `hair` 0..5 (color), `hairStyle` 0..3, `shirt` 0..7.

## Engine API

### `js/config.js` exports
`MAP_W, MAP_H, TILE (16), CATEGORIES, CATEGORY_COLORS, BUILDINGS, BUILD_ORDER (array of type ids in menu order),
GOALS (ordered array of { id, text, reward: { coins?, gems? } }), FIRST_NAMES, DAY_LENGTH_MS (3600000),
isRoad(x, y)`

### `js/state.js` exports
- `SAVE_KEY = 'bitcity.save.v1'`
- `newGame(now)` → fresh state (3 applicants pre-rolled, no buildings).
- `save(state)` → writes `SAVE_KEY`; before overwriting copies the previous value to `SAVE_KEY + '.bak'`. Returns true/false, never throws.
- `load()` → state or null. Falls back to the `.bak` copy if the main one is missing or corrupt. Runs `migrate`.
- `exportSave(state)` → string (base64 of JSON, prefixed `BITCITY1:`).
- `importSave(str)` → state, or throws `Error` with a friendly message.
- `localDay(now)` → `'YYYY-MM-DD'` in the device's local timezone.

### `js/sim.js` exports
Mutating functions change `state` in place and return a result object. They never throw
for a normal player action; they return `{ ok: false, reason: 'short friendly text' }`.

- `events` — tiny emitter: `events.on(type, fn)`, `events.off(type, fn)`, `events.emit(type, payload)`.
- `advance(state, now, { live = true } = {})` → `{ elapsedMs, coinsEarned, rentPaid, rentDays, finished: [buildingId], ranOut: [buildingId] }`.
  Runs the simulation from `state.lastTick` to `now` in steps of at most 60 s (cap total at 14 days),
  then sets `lastTick = now`. In each step: finished construction opens; each staffed, stocked business sells
  (`coins += sold`, `stock -= sold`); applicants refresh; rent is paid for every local midnight crossed
  (all of them, no cap below 14 days); goals are checked. Ride requests are only created when `live` is true.
  A business with a dream-job worker restocks itself for free when it runs out.
- `tileAt(state, x, y)` → building or null.  `buildingById(state, id)`.  `tenantById(state, id)`.
- `isBuilt(b, now)` → boolean.
- `population(state)`, `capacity(state)`, `vacancies(state)` → numbers.
- `homesWithVacancy(state, now)` → [building].
- `residentsOf(state, homeId)` → [tenant].  `workersOf(state, bizId)` → [tenant].
- `isUnlocked(state, type)` → boolean.
- `canBuild(state, type, x, y)` → `{ ok, reason }`.
- `build(state, type, x, y, now)` → `{ ok, reason, building }`.
- `hurry(state, buildingId, now)` → `{ ok, reason }` (costs 1 gem, finishes construction now).
- `demolish(state, buildingId, now)` → `{ ok, reason, refund }` (75% refund; homes must be empty; workers become unemployed).
- `ratePerMin(state, b)` → current coins per real minute for a business (0 if unstaffed, out of stock or unbuilt).
  Formula: `baseRate * staff * skill * dream`, staff = 1 for one worker, 1.6 for two;
  skill = 1 + (sum of the workers' skill in this category) / 18; dream = 1 + 0.5 * dreamStars.
- `townRatePerMin(state, now)`, `rentPerDay(state)` → numbers.
- `bizStatus(state, b, now)` → `'building' | 'needs-workers' | 'out-of-stock' | 'open'`.
- `restock(state, buildingId, now)` → `{ ok, reason, cost }` (instant; cost pro-rated; if the player can't afford it, restock for free up to what they can pay but at least 25% — never block the player).
- `moveIn(state, applicantIndex, homeId, now)` → `{ ok, reason, tenant }`. A fresh applicant replaces the one taken.
- `assignJob(state, tenantId, bizId | null, now)` → `{ ok, reason, dream: boolean }`. Moves the tenant out of any current job.
  If `bizId` is their dream type: `dream: true`, the first time each tenant lands a dream job the player gets +1 gem.
- `jobFit(state, tenant, b)` → `{ skill (0..9), dream: boolean, open: boolean }`.
- `bestJobs(state, tenantId, now)` → up to 3 `{ building, skill, dream, open }` sorted best first (dream first, then skill).
- `unemployed(state)` → [tenant].
- Rides (the Uber mini-game). At most one at a time. Created during live `advance` when `now >= nextRideAt`,
  at least 3 built buildings exist and at least 1 tenant exists: picks a random tenant, `fromId` = their home,
  `toId` = a random other built building, `state: 'waiting'`. A waiting ride that is ignored for 90 s quietly disappears.
  - `acceptRide(state, now)` → `{ ok, tenant, destination }` — state becomes `'choosing'`.
  - `chooseDestination(state, buildingId, now)` → `{ ok, correct, fare }`. Wrong picks just increment `tries`
    (no penalty beyond a smaller tip). Correct pick: computes `fare`, state becomes `'driving'`.
    `fare = round(max(15, townRatePerMin * 8) * tip)`, tip = 2.0 if picked within 3 s and first try,
    sliding to 1.0 at 10 s; each wrong try -0.2 (floor 1.0).
  - `completeRide(state, now)` → `{ ok, fare }` — called by the app when the car animation ends. Pays the fare, clears `ride`,
    schedules `nextRideAt` 40–80 s later.
- `nextGoal(state)` → goal or null.

### Events emitted (payloads)
`'coins'` `{ amount, buildingId|null, reason: 'sales'|'rent'|'ride'|'goal'|'refund' }` (sales: emit at most once per business per advance call),
`'spend'` `{ amount, reason }`, `'gem'` `{ amount }`, `'built'` `{ building }` (construction started),
`'opened'` `{ building }`, `'demolished'` `{ id, x, y }`, `'moveIn'` `{ tenant }`, `'job'` `{ tenant, building|null, dream }`,
`'outOfStock'` `{ building }`, `'restocked'` `{ building, auto }`, `'rideRequest'` `{ ride }`, `'rideGone'` `{}`,
`'rideStart'` `{ ride, fare }`, `'rideDone'` `{ fare }`, `'rent'` `{ amount, days }`, `'goal'` `{ goal }`, `'unlock'` `{ type }`.

## Sprites API (`js/sprites.js`, browser only; uses canvas)

- `PALETTE` — the shared named colors used for all art.
- `initSprites()` — builds everything once (sync). Safe to call twice.
- `getSprite(id)` → `HTMLCanvasElement` at 1x art pixels, or a visible magenta placeholder for unknown ids.
- `spriteURL(id, scale = 2)` → PNG data URL, nearest-neighbour scaled (for `<img>` in menus). Cached.
- `getPerson(look, frame)` → canvas, 8x12 px, `frame` 0|1 (two-frame walk).  `personURL(look, scale = 3)`.
- Ids:
  - tiles (16x16): `grass0`, `grass1`, `grass2` (flowers), `road0`..`road15` where the number is a bitmask of
    which neighbours are also road: N=1, E=2, S=4, W=8 (with lane markings / crosswalks as appropriate).
  - buildings (16x24): every type id in the table above, plus `tent`, `cabin`, `apartment`, `house`;
    `site` (construction site with scaffolding), `lot` (subtle empty-lot marker, 16x16).
  - vehicle: `taxi_e`, `taxi_w`, `taxi_n`, `taxi_s` (about 14x10 horizontal, 10x14 vertical).
  - icons (10x10): `coin`, `gem`, `box` (out of stock), `taxi`, `star` (dream job), `key` (move-in), `hammer`,
    `heart`, `person`, `briefcase`, plus one per category: `cat_food`, `cat_retail`, `cat_service`, `cat_farming`, `cat_creative`.
  - `bubble` (16x16 speech bubble, white with dark outline, icon is drawn on top by the renderer).
- Art direction: warm, friendly, slightly desaturated palette (think cozy handheld game), 1px dark-but-not-black
  outlines on buildings, light from top-left, each building instantly readable at 2x on a phone: the diner has a
  striped awning, the well has a water tower, the farm has crop rows, etc. Category color appears on each
  business (awning / sign) so the five categories read at a glance. Homes use neutral warm tones.

## Render API (`js/render.js`)

`createRenderer(canvas, { getState, getNow })` → object with:
- `resize()` — fit canvas to its CSS box × devicePixelRatio, integer art scale, `imageSmoothingEnabled = false`.
  Default view shows the whole map centred. One-finger drag pans, pinch zooms (integer scales 1–5 art px per CSS px*dpr,
  clamped so the map can't leave the screen).
- `draw(now)` — full frame: tiles, roads, buildings (site sprite + progress bar while under construction),
  status bubbles above buildings (`box` when out of stock, `key` on homes with a vacancy, `briefcase` on businesses
  with an empty slot AND an unemployed tenant existing, `taxi` on the ride's `fromId` while `waiting`), bobbing gently;
  little residents walking along the roads (cosmetic, count = min(population, 14), using each tenant's `look`);
  the taxi; floating texts; highlight ring on destination candidates while a ride is `'choosing'`;
  a soft day/night tint (period `DAY_LENGTH_MS`, never darker than ~35% so it stays readable; warm window glow at night is a bonus).
- `onTap(fn)` — `fn({ x, y, building })` for a tap (not a drag) on a map tile; `building` is null for an empty lot;
  road taps are ignored. Taps on a status bubble count as taps on that building.
- `floatText(x, y, text, color)` — tile coords; rises and fades over ~1.2 s (e.g. `+25`).
- `burst(x, y, kind)` — small pixel particle burst at a tile: `'coins' | 'stars' | 'hearts' | 'dust'`.
- `driveTaxi(fromTile, toTile, onDone)` — animate the taxi along roads (BFS over road tiles from the road tile
  nearest each building), ~6 tiles/sec, min 1.2 s, then call `onDone`.
- `setSelection(tile | null)` — outline one tile.
- `tileToScreen(x, y)` → `{ x, y }` in CSS px relative to the canvas (centre of tile), for anchoring DOM popups.

## UI API (`js/ui.js` + `styles.css`)

`createUI(root, api)` where `root` is `#ui` (an absolutely positioned layer over the canvas; it must let touches
through to the canvas except on its own controls: `pointer-events: none` on the layer, `auto` on controls).
`api` gives the UI everything; the UI never imports sim directly:
```js
api = { getState, getNow, sim, config, sprites,   // modules
        act(name, ...args),      // runs sim[name](state, ...args, now), saves, then calls ui.refresh(); returns the result
        renderer,                // for setSelection / floatText / burst
        exportSave(), importSave(str), resetGame(), toast(text) }
```
Returns `{ refresh(), openLot(x, y), openBuilding(building), showAway(summary), showRent(amount, days),
showRide(ride), hideRide(), celebrateDream(tenant, building), toast(text), isModalOpen() }`.

Screens (all bottom sheets, one thumb, big tap targets ≥ 44 px, dismiss by tapping outside or a ✕):
1. **HUD** (always visible): top bar with coins, gems, population `n/cap`, income per hour, and the game clock
   (day/night icon); a one-line "next goal" chip under it; bottom bar with 3 buttons: Build, People, Menu.
2. **Build sheet** (`openLot` or Build button → then tap a lot): grid of building cards with sprite, name, cost,
   category dot; locked ones show "Unlocks at N residents"; unaffordable ones are dimmed but show the price.
3. **Building sheet** (`openBuilding`):
   - under construction: progress + "Hurry (1 gem)".
   - home: residents list (sprite, name, job or "Looking for work"), rent per day, a "Move someone in" button when
     there is a vacancy → **Applicants sheet**: 3 cards each with person sprite, name, five skill bars (category colors,
     0–9), and their dream job (sprite + name); tap a card to move them in.
   - business: status, income per hour, stock bar, "Restock" button when not full, the two job slots (worker or
     "Hire" → **Hire sheet**: unemployed tenants sorted by fit for this business, showing their skill here and a ★ if it's
     their dream job; also lets you pick employed tenants, marked with where they work now), demolish in a small secondary link.
4. **People sheet**: every tenant with sprite, name, home, job, their top skill; a ★ if they're in their dream job;
   a "Best job" hint line when `bestJobs` says a better open job exists, with a one-tap "Move" button.
5. **Ride banner** (`showRide`): slides in at the top: "<Name> wants a ride to the <Building name>" with the building
   sprite and a small countdown shimmer for the tip; the player then taps the building on the map. `hideRide()` removes it.
6. **Away sheet** (`showAway(summary)`): "While you were away" — coins earned, rent collected, buildings finished,
   shops that ran out (with a "Restock all" button). Only shown if away ≥ 2 minutes.
7. **Rent celebration** (`showRent`): big friendly "Rent day!" card with the amount counting up.
8. **Dream job celebration** (`celebrateDream`): "<Name> landed their dream job!" with stars, +1 gem.
9. **Menu sheet**: sound toggle, "Back up my town" (shows the export string in a textarea + Copy button),
   "Restore a backup" (paste + confirm), "Start over" (double confirm), tiny stats block.

Visual style: pixel font feel without loading fonts (use `ui-monospace, Menlo, monospace` with bold weights and
`image-rendering: pixelated` on all sprite `<img>`), chunky rounded panels with a 2px dark outline and a hard 0 3px
drop shadow, cream panel background `#fff6e0`, ink `#3b2f4a`, accent green `#5bb450`, coin yellow `#f2c14e`.
Buttons depress on touch. No hover states. Respect `env(safe-area-inset-*)`. No text smaller than 12px.
Prevent double-tap zoom and text selection (`touch-action: manipulation; user-select: none`), except in the backup textarea.
