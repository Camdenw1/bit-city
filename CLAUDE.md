# Bit City — project notes for Claude Code

A personal phone game for Camden: a cute pixel-art town builder inspired by Tiny Tower.
He is the landlord of a community of homes and shops. He plays it on his iPhone as a
home-screen web app. It is for him only; there is no store release, no accounts, no ads.

Phase 1 (the core loop) is built. `SPEC.md` is the phase 1 contract and `README.md`
covers running and publishing. This file holds the design decisions and the roadmap.

## How Camden wants to work

- Explain what you are about to build and why before writing code.
- Honest assessments over encouraging ones. Say when an idea will hurt the game.
- Keep usage lean: small focused changes, no unnecessary sub-agents or rewrites.
- He decides which ideas go in. Offer options; don't add unrequested features.
- Claude is the interim tester (his call, 2026-11-10): he wants the game built out, refined
  and tested before he spends time playing. Don't wait on him to play between phases. Test
  with `node tools/playtest.mjs` (a bot that plays three days and prints pacing) and in the
  browser preview at phone size, then report what was found and changed.

## Design pillars (his words, treat as rules)

- "Really easy, really simple." "Cute, simple."
- Mild penalties are allowed (Camden dropped "never penalties" on 2026-11-10). His words:
  "the penalties shouldn't be too big, they should more be to help guide you into creating
  a more robust and thriving city". So: small, clearly explained, always fixable by the
  player, and never able to wipe out progress or a save.
- "I don't want chores." Restocking is one tap on the shop. If a mechanic becomes
  upkeep, redesign it.
- Take a lot from Tiny Tower: tenants with skill ratings in five job categories, dream
  jobs, and the satisfaction of knowing "this is as good as I can get for this worker".
- Real-time idle, but with enough to do that active play makes real progress.
- Income shape (changed by Camden 2026-11-10): rent is paid at the top of every hour;
  shops give steady passive income and pay 10x while the game is open; mini-games like
  the Uber ride are the great active way to earn extra.
- The player's job: keep happiness high and provide the most-wanted things.
- Goal: grow the town as fast as possible with the smartest citizens. End state is a
  thriving town; prestige then gives fun permanent boosts that fund the biggest changes.

## Decisions already made

- Layout: top-down town map, tap-to-place, every building is one lot. Roads are fixed
  (`isRoad` in `js/config.js`); the player never draws roads.
- Platform: home-screen web app (PWA). Plain ES modules, canvas map, HTML menus,
  no build step, no dependencies, no network calls. The folder is the game.
- Hosting plan: GitHub Pages (not set up yet). Local git repo on `main`, no remote yet.
  Commit after each finished batch so any tool's work can be reviewed with `git diff`.
- Art: simple pixel art drawn in code in `js/sprites.js` from one shared palette.
  Camden left art direction to our judgement, then asked for "clean, easy to understand".
- Map art rules (map cleanup pass): every building sprite is 16x16 and fits its own lot,
  so nothing hides the lot behind. Shops have a flat roof in their category colour and one
  big picture of what they sell (`EMBLEM`); the second shop of a category has a striped
  roof. Homes have pitched neutral roofs. Farms look like fields. Ground stays plain.
- The map opens zoomed in 1.5x on the town (about 48pt lots); pinch out for the whole map.
- Time: one real hour = one cosmetic game day (day/night tint only).
- Rent: a 24th of `rentPerDay` (+ happy bonus) at the top of every clock hour
  (`state.lastRentHour`, fractions kept in `state.rentCarry`). Live rent is a toast, not a
  full-screen card. Balance numbers are still written per day.
- Play boost: `advance(state, now, { active: true })` multiplies coins per sale by
  `TUNING.activeBoost` (10). Only the game loop and the bot pass it; stock sells at the same
  speed, so it adds no restocking. The HUD and shop sheets show the boosted rate.
- Rides: fare x (1 + `rideDistanceBonus` per lot driven). A rider asks for a kind of place,
  so any building of that type and category is a right answer and the ride goes to the one
  tapped (a farther twin pays more).
- Shops are bought as a surprise: one card per category plus Government (`buildRandom`);
  homes, parks and the Trading Post are direct picks. The reveal is a toast.
- Saving: localStorage with a backup copy, plus an export/import backup code in Menu.
  Saves must never be lost: any change to the state shape needs a step in `migrate()`
  in `js/state.js`.
- Premium currency (gems) is earned only by playing. No purchases.
- Name: Bit City.
- Prices: each copy of a building you already own costs x1.35 more (`costOf` in sim).
  This is what pushes variety. Demolish refunds 75% of what was actually paid (`b.paid`).
- A shop can't be built before the first home (it would leave a new player stuck).
- Landscape: sea, beach, mountains, forest, a river and a lake are generated around the
  town from `state.worldSeed` (`js/terrain.js`, pure). The first town is always all grass.
- Land: the first town is the 'home' parcel at (0,0) and never moves. Eight parcels around
  it (`PARCELS`) can be bought, each x2 the price of the last; land west and north has
  negative coordinates, so never assume x, y >= 0 or index by `y * MAP_W + x`. Bought land
  keeps its terrain: water and mountains can't be built on, roads cross water as bridges,
  and a home next to water gets +10% rent (this also applies to the first town's edge).
- Trade: farms fill a barn (`state.goods`) as well as the lifetime `state.crops`. The
  Trading Post sells the barn at a price that changes each local day, imports at a fixed
  2.5x the usual price (always dearer than selling, so no buy-low-sell-high loop), and
  holds two neighbour orders that never expire. Selling never touches recipe progress.
- Shop pricing: Bargain / Normal / Premium trade selling speed against coins per item.
  Camden was warned this is the item most at odds with "really simple"; remove it if it
  feels like fiddling.
- Ads: a paid 2-hour boost (+25% per sale, applicants twice as fast). Optional, no upkeep.
- Milestones are extra entries in `GOALS`; a building can need one via `unlockGoal`
  (Library: Town IQ 100, Fountain: 90% happy).
- Upgrades: every building has levels 1-3 (`b.level`), each +50% rent / sales and stock /
  reach. Upgraded buildings show gold stars on the roof; there is no redrawn art per level.
- Happiness is per resident and worked out from the town as it is (nothing stored, nothing
  decays): the share of `NEEDS` that resident has (`townMood`, `residentMood` in sim). Jobs:
  have one. Shop needs: each staffed shop serves `needServes` residents, longest-standing
  first. Town buildings serve their nearest residents whose home is within `reachOf(b)` lots
  (`TUNING.reach` 5, +1 per level). An empty shelf never lowers it. Town happiness is the
  average. Rent per resident runs in a straight line from -20% at 0% happy to +50% at 100%.
- Each resident's card shows their happiness and a plain reason for every need they miss.
- Shop problems (`state.problems`, `PROBLEMS`): only start while playing, at 10+ residents,
  one at a time plus one per 12 shops. A problem cuts that shop's sales 25%. A police or fire
  station (or clinic, for health ones) within reach fixes it free in 3 minutes; otherwise the
  player pays `problemFee`. The Mayor's desk (from the Town sheet) lists problems, the
  unhappiest residents with reasons, and what each government building serves.
- A town building's sheet shows its reach as a square on the map.
- Jobs board (fourth bottom-bar button, `jobBoard` in sim, `TOWN_JOBS` in config): Taxi Ride,
  Package Delivery, Lunch Rush, Odd Jobs, Lost & Found, Courier Route. Pay is `minutes` of the
  town's base shop income with a small floor; each job rests for its `cooldownMs` after it is
  taken (skipping clears the rest). Board taxi and delivery pay exactly like street rides.
  Lunch Rush and Odd Jobs are played in a sheet; Pip the dog and the courier homes are tapped
  on the map, with a banner in the ride banner's spot. One job or ride at a time.
- Roads are not tappable, except the one tile Pip is sitting on (`hitTest` in render).
- Camden's own places are marked `fav: true` in `BUILDINGS` and do 25% more (`TUNING.favBonus`:
  sales for shops, residents served for town buildings) and turn up a little more often in
  draws: Taco Shop, Ice Cream Shop, Gym, Music Shop, Basketball Gym, Concert Venue, Bike Shop,
  Ski Lodge, School, University, Running Track, Hiking Trail.
- Land-bound buildings (`near: [...]`, checked by `nearOk`, within `TUNING.nearRadius` 2 lots):
  Ski Lodge needs mountains, Surf Shop water, Hiking Trail woods or mountains. A surprise draw
  only offers them on a lot that qualifies, and then favours them. Keep these rare.
- A new shop is one `biz(...)` line in config plus a 7x7 `EMBLEM` in sprites; a new park-type
  building needs its own `BUILD.<id>` sprite.
- Town buildings (`kind` 'civic' or 'park': Tree, Clinic, School, Park, Library, Fountain)
  have no workers and no stock, on purpose. Parks boost rent of homes within 2 lots.
- Crops are lifetime totals that only go up (`state.crops`); staffed farms grow them.
  Recipes unlock from those totals and each adds a star and +20% sales to its restaurant.
- School and library teach skill points over time (job skill first). Skills cap at 9.

## Camden's idea list (2026-11-10)

Done from it: hourly rent and rent/hour display, 10x play boost, distance fares, any-tent rides,
range for town buildings, per-resident happiness with reasons, happiness moving rent both ways,
shop problems the government solves, the Mayor's desk, his own places, land-bound buildings,
and a jobs board with six ways to earn.
Suggested order for the rest (he has not confirmed it): visitors and a social feed; moving
buildings and terrain-only buildings; raw materials and a construction crew; prestige trees.
His calls on the contested ideas (2026-11-10), still to build:
- Demolition costs coins instead of refunding 75%.
- The stock market can lose coins.
- Hold-the-gas driving is an optional bonus: rides still finish on their own, holding the gas
  is faster and tips more, and car upgrades raise the speed.
- Driving a new resident home is an optional welcome bonus; tapping Move still works at once.
The tests "nothing ever takes coins away" and the 75% refund test encode the old rule and
change when these are built.

## Architecture rules

- `js/config.js`, `js/state.js`, `js/sim.js` are pure: no DOM, time passed in as `now`,
  randomness from the seeded PRNG in state (no `Math.random`, no `Date.now` in sim).
- All balance numbers live in `js/config.js` (`BUILDINGS`, `TUNING`, `GOALS`).
- `js/ui.js` never imports sim directly; it goes through the `api` object from `main.js`.
- Sim functions return `{ ok: false, reason }` with a friendly sentence instead of throwing.
- Bump `CACHE` in `sw.js` when shipping changes, and add any new file to its list,
  or the phone keeps serving the old version.
- Tests: `node --test` from the project root (43 passing).
  `node --test tests/` does not work on Node 22.
- Browser console helpers: `bitcity.skip(minutes)`, `bitcity.give(coins, gems)`.

## Known gaps at handoff

- Never run on a real iPhone yet. Tested in a 390x844 headless Chrome with touch.
- ChatGPT (Codex) finished the surprise-shop menu and added deliveries and restock-all. It
  also wrote jobs-board rules with no screens; the screens were built on 2026-11-10.
- Removing a surprise shop refunds 75%, so a reroll costs 25%. Left as is.
- `bitcity.skip()` of more than about a minute counts as time away (no play boost). The skip
  is forgotten on reload, so a save made after skipping sits frozen until real time catches up.
- After an update the preview (and the phone) can need two loads before new files show.
- `tools/preview-sprites.mjs` needs the `sharp` package, which is not installed; look at art in
  the browser preview instead.
- Three of the four build agents were cut off early, so art and menus had one polish
  pass, not several. Expect rough edges.
- Balance was retuned from bot playtests (2026-11-10). Before: the whole map filled in
  13 hours and rent was 4-7% of income. Now a keen player owns every building type in
  about 2.5 days (a casual one has 13 of 14 after three), and rent is a fifth to a quarter
  of income, paid as one lump. The bot only runs three days, so nothing past that has been
  measured; the map is under half full at that point.
- Menus open on pointer-up from a map tap; `ui.js` ignores clicks for 350 ms after a
  sheet opens to swallow the browser's follow-up click. Keep that if you touch it.
- Vacancy, open-job and sold-out hints on the map are small corner badges on the building,
  not bubbles, on purpose (bubbles covered the town). Only the taxi keeps a full bubble,
  drawn on its own building.

## Roadmap

Camden approved every item below. Each phase should be playable on his phone before
the next begins. He was asked to play phase 1 for a day before phase 2 starts, so
balance changes come from how it feels.

### Phase 1 — core loop (done)
Map, building, four housing tiers, ten shops across five categories, tenants with five
skills and a dream job, applicant list to pick move-ins from, hiring, dream-job
celebration and bonus, one-tap restock (dream-job workers restock free), Uber rides,
midnight rent, onboarding goals, unlocks by population, day/night, sounds, saving.

### Phase 2 — needs and food (done)
Nine needs unlocking with population (jobs, food, water & care, shopping, fresh produce,
health, fun, learning, green space), the happiness meter and Town sheet, most-wanted list,
happy rent bonus, a wish line per tenant, crops and six recipes with restaurant stars,
school and library lessons with a Town IQ score, and Tree / Park / Fountain rent boosts.
Simplified from the original list: "farm level" is the lifetime harvest, and tenant
personality is only a happy line picked per person.

### Phase 3 — money and trade (done, except per-level art)
Land with terrain, upgrades, Trading Post with daily prices and imports, neighbour orders,
ad campaigns, shop pricing, town numbers on the Town sheet, and eleven milestones.
Left over: a proper look change per upgrade level (stars only for now). A keen bot clears
all 23 goals in a week, so more milestones are worth adding as later phases land.

### Phase 4 — depth
- Deliveries: carry a package between two buildings.
- Pop-up tasks: catch a lost dog, water a wilting garden, find a named tenant.
- VIP visitors (food critic, investor, celebrity) to escort to the right building.
- Vehicle upgrades so rides and deliveries are faster and pay more.
- Town festivals triggered at max happiness for a timed boost.
- Families form; kids grow into workers with inherited skills.
- Collection book of every tenant, building and recipe discovered.
- Daily login gift and streak.
- Cosmetic weather.

### Phase 5 — prestige
Found a new town with permanent boosts once one is maxed. Last, because it needs a
finished town to reset.

### Explicitly rejected
- Tap-to-collect rent coins. Rent auto-collects at midnight.
- Restocking as a timer or mini-game. It is one tap.
