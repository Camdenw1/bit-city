# Mini Mayor — project notes for Claude Code

Mini Mayor (formerly Bit City). A personal phone game for Camden: a cute pixel-art town builder inspired by Tiny Tower.
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
- Hosting: GitHub Pages from `main` (root) of the public repo Camdenw1/bit-city, live at
  https://camdenw1.github.io/bit-city/ (set up 2026-11-10; Camden chose public). Commit after
  each finished batch; push only when Camden says so. A push redeploys in about a minute and
  the phone picks it up on the second launch (bump `CACHE` in `sw.js`).
- Art: simple pixel art drawn in code in `js/sprites.js` from one shared palette.
  Camden left art direction to our judgement, then asked for "clean, easy to understand".
- Map art rules (map cleanup pass): every building sprite is 16x16 and fits its own lot,
  so nothing hides the lot behind. Shops have a flat roof in their category colour and one
  big picture of what they sell (`EMBLEM`); the second shop of a category has a striped
  roof. Homes have pitched neutral roofs. Farms look like fields. Ground stays plain.
- The map opens zoomed in 1.5x on the town (about 48pt lots); pinch out for the whole map.
  A pinch follows the fingers at any scale, then eases to a whole scale so pixels stay crisp;
  a swipe glides on after the finger lifts. The map draws under the iPhone status bar and
  camera (`black-translucent`); the renderer measures that height (`safeTop`) for its edges.
- Time: one real hour = one cosmetic game day (day/night tint only).
- Rent: a 24th of `rentPerDay` (+ happy bonus) at the top of every clock hour
  (`state.lastRentHour`, fractions kept in `state.rentCarry`). Live rent is a toast, not a
  full-screen card. Balance numbers are still written per day.
- Play boost: `advance(state, now, { active: true })` multiplies coins per sale by
  `TUNING.activeBoost` (10). Only the game loop and the bot pass it; stock sells at the same
  speed, so it adds no restocking. The HUD and shop sheets show the boosted rate.
- Taxi pickup (Camden, 2026-11-10: "I don't like choosing where they go"): tapping the taxi calls
  `pickupRide`, which keeps the rider's destination, marks it with a big red pin and sets off.
  The tip now rewards a quick pickup (`pickupTipFastMs` 10 s for the full x2, none after 60 s).
  Deliveries still wait for a tap on the marked home. `chooseDestination` stays for deliveries.
- Rides: fare x (1 + `rideDistanceBonus` per lot driven). A rider asks for a kind of place,
  so any building of that type and category is a right answer and the ride goes to the one
  tapped (a farther twin pays more).
- Shops are bought as a surprise: one card per category plus Government (`buildRandom`);
  homes, parks and the Trading Post are direct picks. The reveal is a toast.
- Saving: localStorage with a backup copy, plus an export/import backup code in Menu.
  Saves must never be lost: any change to the state shape needs a step in `migrate()`
  in `js/state.js`.
- Premium currency (gems) is earned only by playing. No purchases.
- Name: Mini Mayor (Camden, 2026-11-10; was Bit City, which is a NimbleBit game). The only
  other "Mini Mayor" found was a small 2025 itch.io jam game, none on the App Store. Internal
  names stay as they were so saves and links keep working: the folder, the repo and URL
  (camdenw1.github.io/bit-city), `SAVE_KEY`, the `BITCITY1:` backup prefix, `window.bitcity`.
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
- Entry road (2026-11-10, Camden's ask): one road leads in from the edge of the world to the
  first town (`entryRoute` in sim). It follows the town's own streets (so it never takes a lot
  or clashes with a save), is a road even on unowned land, and runs on past the world's edge.
  Residents' walkers stay on town roads. The welcome drive starts at its town end. Visitors
  should arrive on it; more entrances are a planned upgrade.
- Trade trucks (Camden: "trucks should not only be for show"): every sale, import and order
  sends a truck (`state.trucks`). A sale or order pays when its truck leaves town; an import
  lands in the barn when it reaches the Trading Post. Trip = route length / `truckSpeed`,
  clamped 8-25 s, so a Trading Post near the entry road trades faster. One truck per
  Trading Post level (`trucksPerLevel`, Camden chose this over unlimited); with all out, the next trade waits a few seconds.
  Trucks finish in `advance()` by time, so closing the app never loses one.
- Trade: farms fill a barn (`state.goods`) as well as the lifetime `state.crops`. The
  Trading Post sells the barn at a price that changes each local day, imports at a fixed
  2.5x the usual price (always dearer than selling, so no buy-low-sell-high loop), and
  holds two neighbour orders that never expire. Selling never touches recipe progress.
- Shop pricing: Bargain / Normal / Premium trade selling speed against coins per item.
  Camden was warned this is the item most at odds with "really simple"; remove it if it
  feels like fiddling.
- Ads: a paid 2-hour boost (+25% per sale, applicants twice as fast). Optional, no upkeep.
- Goal progress (2026-11-10): goals with a number show it on the goal chip ("12/30", `goalProgress`
  in sim). Camden likes goals as the guide through the game. The recipe goal now says it means
  growing 30 veggies at 10 an hour per farmer; he had staffed a farm and thought it was broken.
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
- Jobs pop up on the map (Camden, 2026-11-10: "like the Tiny Tower jobs"): each ready job is a
  gold-rimmed bubble on a building that fits it (`jobSpots`: Lunch Rush on a staffed food shop,
  Odd Jobs on a home, Courier at a Post Office...), at most `TUNING.jobSpots` (2), none while
  busy, map-only jobs before taxi and parcels. Tapping that building starts the job
  (`ui.startJob`). A toast says when one pops up. There is no Jobs list any more.
- Bottom bar (2026-11-10): Upgrades, People, Menu. Camden removed the Build button (it only
  said "tap an empty lot"); building is tapping a lot, and the first goal says so.
- Upgrades tab (bottom-bar button, replaces Jobs; badge = upgrades you can afford): the
  car (`CARS`) plus `UPGRADES` ladders: Construction crew (-12% build time a level, 4 levels),
  Faster trucks (+25%), Interviews (newcomer ranges 1 narrower a level, exact at 3), Welcome
  center (arrivals -20%), Repair team (problem fee -20%, stations 20% faster), Marketing (ads
  +30 min). Levels in `state.upgrades` (migrated, clamped). Prestige upgrades belong here later.
- Construction Yard (`yard`, kind 'yard', 1,500 coins, opens at 8 residents, reach 4): anything
  built within reach takes half the time (`buildFactor` = crew x yard). Its sheet shows the reach.
- Jobs board rules (the old fourth button, `jobBoard` in sim, `TOWN_JOBS` in config): Taxi Ride,
  Package Delivery, Lunch Rush, Odd Jobs, Lost & Found, Courier Route. Pay is `minutes` of the
  town's base shop income with a small floor; each job rests for its `cooldownMs` after it is
  taken (skipping clears the rest). Board taxi and delivery pay exactly like street rides.
  Lunch Rush and Odd Jobs are played in a sheet; Pip the dog and the courier homes are tapped
  on the map, with a banner in the ride banner's spot. One job or ride at a time.
- Job alerts (Camden: notify me, don't make me open the list): the Jobs button shows a count of
  jobs you can start now, and a toast says when a resting job is ready again (`jobRest` in ui).
  In-app only: the game makes no network calls, so there are no phone notifications while closed.
- Taps (Camden: "the click is a little off" on iOS, 2026-11-10): the maths was exact (1,149
  synthetic taps on every lot at three zooms all landed right), so taps were made forgiving:
  a tap up to `TAP_SNAP` (5 art px) off a lot, on a road or on land not yet bought, counts as
  that lot; a finger may drift 12 CSS px and a tap may last 650 ms. Land for sale opens only
  from a tap clearly on it. Zoomed out, lots are only about 21-32 pt, under Apple's 44 pt.
- Roads are not tappable, except the one tile Pip is sitting on (`hitTest` in render).
- Driving: the car moves by itself at `TUNING.carBaseSpeed` lots a second and always arrives.
  Camden found it fast on the phone and wants it to start really slow and speed up through
  upgrades (cars now, prestige later): base 0.75 lots/s, gas x2.5, cars x1 / 1.6 / 2.4 / 3.5.
  A big GAS button shows during any drive; holding it multiplies speed by `gasSpeed` and the
  view follows the car. The share of the trip with gas held (`rideGas`) adds up to `gasBonus`
  (+50%) to the fare in `completeRide`. Never make the pedal required.
- Cars (`CARS` in config, `state.car`): four, bought on the Jobs sheet, each faster and paying
  more on every ride, delivery and welcome drive.
- Newcomers (2026-11-10): up to 3 wait at the Welcome spot on the entry road just outside town
  (`welcomeSpot`; key bubble, tap it). They never leave on their own; a free spot fills
  `arriveMs` (60 s) after it opens (half during an ad, double for `moveOutSlowMs` after a
  move-out). Cards show skills as ranges (`seen`, width 3, a star's 1), the dream place and a
  hint. Pick a home or "Not now" (`sendAway`, free). The real skills and trait show on move-in.
  Stars (5%) have two strong skills and a gold card. Traits (40%, `TRAITS` in config) are
  trade-offs, never simply bad, because Camden noted nobody would accept a known bad tenant:
  Genius (+2 skills / shop problems x2), Go-getter (learns x2 / -10% rent), Party animal (+30%
  rent / next-door homes -10%), Homebody (rent as if fully happy / learns at half speed). The
  hint 'sharp' or 'friendly' fits two traits or none; 'Seems nice' means no trait.
  "Ask X to move out" on a home sheet is free but slows newcomers for 10 minutes (`moveOut`).
- Welcome drive: moving in is still instant. For 90 seconds afterwards a banner offers to drive
  the new resident home from a road at the edge of the first town (`startWelcome`, a ride of
  kind 'welcome' with `from` as a tile and no `fromId`). Once per resident, never required.
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
- Teams (batch 1, 2026-11-10): shops have 1 to 4 jobs (`slots` in `BUILDINGS`, Camden: "really
  small shops hold 1 person and big shops hold up to 5"); level 3 adds one (`slotsOf`). Diner and
  Water Works stay at 2. Sales use `staffFactor` [0, 1.25, 1.85, 2.35, 2.75, 3.05] (retuned so early
  pacing matched the bot runs before teams) times 1 + average skill / 13.5. Small shops are cheap
  to staff, big ones earn more per lot; stock and restock cost scale with size so a full team
  doesn't sell out sooner. The team meter (`teamOf`) is today's team against the best possible
  (every job filled at skill 9), 1-3 stars at 40/70/95%, with one tip. A shop serves
  `needServes` x team size x skill residents (`shopServes`), so good staffing also lifts happiness.
  Help: "Hire best" on a shop (`bestHire`), "Better jobs" with "Do all" on People
  (`jobSuggestions`), and ★-★★★ fit on every worker (`fitStars`). Nothing moves without a tap.
  Workers in a shop that shrank keep their jobs until moved.
- Crops are lifetime totals that only go up (`state.crops`); staffed farms grow them.
  Recipes unlock from those totals and each adds a star and +20% sales to its restaurant.
- School and library teach skill points over time (job skill first). Skills cap at 9.

## Camden's idea list (2026-11-10)

Done from it: hourly rent and rent/hour display, 10x play boost, distance fares, any-tent rides,
range for town buildings, per-resident happiness with reasons, happiness moving rent both ways,
shop problems the government solves, the Mayor's desk, his own places, land-bound buildings,
a jobs board with six ways to earn, the gas pedal, car upgrades and the welcome drive.
Batch 1 (worker skill and count) and newcomers (arrivals on the entry road, traits, stars,
moving out) are done. The game is now called Mini Mayor. Still open from the visitors idea:
visitors who spend money and a social feed.
Suggested order for the rest (he has not confirmed it): visitors and a social feed; moving
buildings and terrain-only buildings; raw materials and a construction crew; prestige trees.
His calls on the contested ideas (2026-11-10), still to build:
- Demolition costs coins instead of refunding 75%.
- The stock market can lose coins.
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
- Tests: `node --test` from the project root (52 passing). `node --check js/x.js` does not
  catch module syntax errors here; copy to a .mjs file and check that, or import it in node.
  `node --test tests/` does not work on Node 22.
- Browser console helpers: `bitcity.skip(minutes)`, `bitcity.give(coins, gems)`.

## Known gaps at handoff

- Live on GitHub Pages since 2026-11-10. Camden's first phone report: taps, text and edges
  fine; zoom and scrolling not smooth, blue strip under the camera, taxi too fast (all three
  addressed the same day, not yet rechecked on the phone). Sound and away time not checked.
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
