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
- "I don't want chores." Shops never run out (v48: stock and restocking were removed). If a mechanic becomes
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

- Layout: top-down town map, tap-to-place, every building is one lot. Roads are fixed and the
  player never draws them: new towns use a street plan cut from `worldSeed` (`streetPlan` in
  `js/terrain.js`, `state.streets = 'plan'`); towns founded before that keep the even grid
  (`isRoad` in config, `streets = 'grid'`). Tests use the grid.
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
- Updates (2026-11-11, Camden: "the changes don't seem to go live on my app"): two causes.
  GitHub Pages sends max-age=600, so a new service worker's addAll could store 10-minute-old
  copies (a mix of old and new files); and iOS resumes the app rather than relaunching, so a
  new version waited. Now install fetches with `cache: 'reload'`, background refreshes use
  `no-cache`, main.js reloads once on `controllerchange` (saving first) and calls
  `reg.update()` whenever the app comes to the front. Menu shows "version N": bump `VERSION`
  in config.js together with `CACHE` in sw.js. Phones on an older version need one more launch
  to pick up this fix; after that, updates apply the same time the app is opened.
- Saving: localStorage with a backup copy, plus an export/import backup code in Menu.
  Saves must never be lost: any change to the state shape needs a step in `migrate()`
  in `js/state.js`.
- Premium currency (gems) is earned only by playing. No purchases.
- Name: Mini Mayor (Camden, 2026-11-10; was Bit City, which is a NimbleBit game). The only
  other "Mini Mayor" found was a small 2025 itch.io jam game, none on the App Store. Internal
  names stay as they were so saves and links keep working: the folder, the repo and URL
  (camdenw1.github.io/bit-city), `SAVE_KEY`, the `BITCITY1:` backup prefix, `window.bitcity`.
- Prices: each copy of a building you already own costs x1.35 more (`costOf` in sim).
  This is what pushes variety. Moving costs two-thirds of construction and upgrade spending
  (`b.paid`), and demolition costs one-third. Round fees to whole coins. Moving keeps the
  building ID, occupants, workers, stock and upgrades. Choose an empty legal lot, preview
  the placement, and confirm. Keep enough coins for a Tent if demolition would leave no homes.
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
- Trade contracts (2026-11-10, Camden: make trade "a far bigger thing"; he picked contracts):
  the first `contractTowns` (4) neighbours each offer one standing contract (`contractTerms`):
  `contractQty` crops of one kind every hour for `contractMinutes` (3) of the town's shop income,
  +25% per friendship level (deliveries 5/15/40 -> levels 1-3, bigger quantities). Sign or end
  for free on the Trading Post sheet; slots = 1 + trucks (Trading Post levels). At the top of
  each hour (`runContracts`, offline too) a neighbour truck takes the crops and pays on arrival;
  a short barn just skips that hour. Contract trucks don't count against your own trucks. Bot:
  contracts are ~10% of income (trade was 1-3%).
- Mayor level and prestige (2026-11-11, both in the Upgrades tab, Camden approved):
  `MAYOR_XP`: goal 2, VIP 2, festival 3, collection page 3. Level L needs 5+10+...+5L XP; each
  level is a perk point for `TOWN_PERKS` (Landlord rent, Shopkeeper sales, Open doors arrivals,
  Good tipper fares, Quick builder, Lead foot taxi speed), kept in `state.mayor`, reset by a new
  town. "Found a new town" opens at `prestigePop` (100) residents: prestige points =
  floor(sqrt(city value / 5000)), city value = everything paid for buildings and land
  (`cityValue`). `foundNewTown` returns a fresh state (main swaps it in) keeping `legacy`
  (points, `PERM_PERKS`, towns founded), the collection book and settings. `PERM_PERKS`: Turbo
  taxi (Camden wanted taxi speed in both trees), Head start coins, Master builders, Famous town
  sales, Guest list VIPs, Night shift (away sales +10%/rank: the "away income" open item).
  Taxi speed is `carSpeed(state)`; fares go through `farePay`.
- Seasons (2026-11-11): `SEASONS` loop every `seasonDays` (2) local days (`seasonOf`). Spring:
  veggies +25%; summer: fruit +25%, visitors +25%; autumn: crops +10%; winter: crops -20%,
  contracts pay +25%. The map shows it (blossom, orange woods, snow on land and empty lots; the
  ground cache key includes the season). A toast at each change (`state.season`), and a line
  on the Town sheet.
- Rival towns (2026-11-11): the four `RIVALS` grow from `createdAt` (start + (cap - start) x
  (1 - e^(-days/d))). The Town sheet ranks the Region (you, rivals, sister towns); rivals post
  when they pass 25/50/100/150/200. Goals "Overtake a neighbour town" (one of 25+) and "Be the
  biggest town in the region" (from 100 residents). First version paid both within the hour
  (rivals started at 3): the bot jumped 136 -> 172 residents; fixed with starts of 8-20 and those limits.
- City infrastructure (2026-11-11, revised the same day: Camden wants infrastructure to "not
  require a spot and provide good benefits"): the Upgrades tab's City section, for the whole town,
  no lots (`UPGRADES` with `group: 'city'` and `unlockPop`): Bus network (5 levels: +4% rent for
  every home and +15% visitors each; a red bus loops the town's corner roads), Road improvements
  (5: taxis and trucks +10% faster, rides +5%), Bike lanes (5: +3% rent, green curb strips),
  Pedestrian streets (3: visitors spend +15%, square streets paved), Trade network (3: +1
  contract and +10% contract pay each), Train station (3: visitors +30%, newcomers 15% sooner, a
  4th Welcome spot), Port (3: visitor spend +25%, +1 contract), Airport (3: visitors +50%, VIPs
  +20%, stars +50%). Operations ladders got longer. The cheapest buyable row shows "Best value".
  Saves with placed bus stops, stations, ports or airports convert them to levels and free the
  lots (in `migrate`, before unknown types are dropped).
- More places (2026-11-11): High-rise (home, 8 residents, 60k, 50 residents) and five shops:
  Bowling Alley, Climbing Gym, Bubble Tea, Pharmacy, Electronics.
- Less writing (Camden, 2026-11-11: "too much writing"): the newcomer card is one compact row
  (face, name, two best skill ranges, dream, likely job, ✕ and Welcome!), and long notes on
  Upgrades, the Trading Post and the Stock Exchange were cut to a line. Keep new text short.
- Landmarks (2026-11-11, the end game): one of each (kind 'landmark'), three stages; stages 2 and 3
  need `landmarkMats` (80 / 200 wood and stone, half that in bricks) as well as coins
  (`landmarkNeeds`, checked in `upgrade`). City Hall (30 residents: +25% mayor XP and +10% goal
  coins a stage), Grand Park (40: +5% rent for every home), Stadium (60: +25% visitors), Skyscraper
  HQ (100: +5% shop sales). Own sprites; no awning or flag dressing, stars only. Build menu
  section "Landmarks". Bot, one week: 321 residents at day 6.5 (was about 210), mostly
  high-rises and city tiers; happiness dips to ~65% at that size.
- The mayor's daily promises (Camden: "mayor's speech can be the daily goals"): three a day from
  `PROMISES` (rides, restocks, newcomers, town jobs, visitors, a VIP, coins earned), counted
  from `state.stats` since the day began (`state.daily`); all three kept pays
  `promiseRewardMinutes` (20) of play income, 3 gems and 5 mayor XP, once. Top of the Goals page.
- Parade (Camden picked it): during a festival a float and four marchers go round the town loop
  (`paradeRoute`: through the roads nearest the four corners of your roads, also the bus's
  loop); shops next to the route get the festival boost twice. Automatic: drawing a route by
  hand was judged too fiddly on a phone.
- Ribbon cutting (Camden picked it): a building that finishes gets a ribbon for `ribbonMs` (60 s,
  `state.ribbons`); tapping the building cuts it for `ribbonMinutes` (0.5) of play income,
  confetti and a feed post (`cutRibbon`). Uncut ribbons just go.
- Names: the town starts with a name from the map's seed (`townNameFromSeed`, e.g. "Maple
  Brook"), renamed from Menu (`renameTown`); it heads the Town sheet, the Region list and becomes
  the sister-town name on prestige. Streets are named from their row or column; a building's
  sheet shows its address under the title (`addressOf`, e.g. "13 Oak Street").
- City tiers (`TIERS`, `cityTier`): Village, Town (20 residents, +5% sales, sidewalks), City (60,
  +10%, street lamps that glow at night), Metropolis (120, +15%, zebra crossings), with a toast.
  Upgraded buildings show it: level 2 a striped awning and flower boxes, level 3 gold trim and a
  flag (drawn in `drawBuilding`), plus the gold stars.
- Moving in (2026-11-11): each newcomer card says their likely job (judged only from what you can
  see, `likelyJob`) and "Welcome!" moves them into the best free home and the best open job in
  one tap (`welcomeNewcomer`); "Choose a home" stays as a link. Tents retire from
  `tentRetirePop` (20) residents (Camden: "at a certain point the tent should never be bought");
  the Cabin dropped to 450 so small budgets still grow (bot: casual 42 -> 57 residents at day 2.5).
- Residents never stroll aimlessly (Camden): with no job they go shopping, moving between the 4
  nearest shops; lunch and evening rotate between nearby places (`routineGoal`, `turn`).
- Sister towns (2026-11-11, Camden's idea that old towns stay in the game; he chose (a)+(b)):
  `foundNewTown` saves the town you leave in `legacy.oldTowns` ({ name from `SISTER_NAMES`, pop,
  income per hour }). Sister towns join the contract list (`tradeTowns`) as best friends (♥♥♥,
  bigger, better-paid contracts), some visitors' posts say they came from one, and once a local
  day each sends a care truck worth `careHours` (1) of its old shop income (`sendCare`, starting
  the day after you found the new town; one per day even after days away). Visiting old towns
  as a frozen map (option c) was offered and left for later.
- (Removed in v48: migrate refunds them as coins.) Building materials (2026-11-11, the light version; made optional so nothing new is required,
  per Camden's "seamless additions"): Lumber Yard, Quarry, Brickworks (kind 'source', open at 12
  residents, no workers) make `matPerHour` (8, x level) wood / stone / bricks up to `matCap` 300
  (`state.mats`). Any upgrade to level 3 can be paid as "Upgrade with materials": 30% fewer coins
  plus 30 wood, 30 stone, 15 bricks (`materialUpgrade`, `upgradeWithMaterials`). The button only
  shows once you have some materials. The Trading Post imports 20 at a time at `MATERIALS[k].price`.
- (Removed in v48: migrate refunds the building and shares as coins.) Stock market (2026-11-11, Camden approved the simple design): a Stock Exchange building
  (`exchange`, 5,000 coins, opens at 20 residents) whose sheet is the market. `STOCKS`: Farm Co
  (farming), Shop Ltd (retail, service), Fun Inc (creative, food). At the top of every hour
  (`runMarket`, offline too) each price steps by luck (+-8%) plus a lean of up to +-3% from that
  part's share of your shop income, kept within 20-500. Buy a quarter of your cap per tap, sell
  all at the hour's price; you can lose coins. Invested coins are capped at `stockCapMinutes`
  (60) of the town's base shop income. `state.market` is made when first needed.
- Trade: farms fill a barn (`state.goods`) as well as the lifetime `state.crops`. Since v47 the
  barn sells itself: at the top of each hour `sellSurplus` sells everything beyond three hours of
  your contracts at the day's price. Selling by hand and neighbour orders were cut (0-2% of income;
  contracts do that job); `sellGoods`/`fillOrder` stay in sim for old saves and tests, and no new
  orders are made. Imports stay, at 2.5x the usual price. Selling never touches recipe progress.
- Shop pricing (Bargain / Normal / Premium) was removed in v47 (it changed nothing about growth);
  migrate sets every shop to 'normal'. `setPrice` stays in sim, unused.
- Ads: a paid 2-hour boost (+25% per sale, applicants twice as fast). Optional, no upkeep.
  "Run an ad" sits in the Upgrades tab right above Marketing (Camden couldn't find ads in Town
  details, so Marketing meant nothing); `adLengthMs` = 2 h + Marketing.
- Fixes (2026-11-11): Lost & Found no longer recentres the map (Camden: a search shouldn't show
  you the answer). A taxi or parcel job bubble now starts the ride at the building tapped
  (`startBoardRide(state, kind, fromId, now)`); before, it picked a random home.
- Goal progress (2026-11-10): goals with a number show it on the goal chip ("12/30", `goalProgress`
  in sim). Camden likes goals as the guide through the game. The recipe goal now says it means
  growing 30 veggies at 10 an hour per farmer; he had staffed a farm and thought it was broken.
- Goals (2026-11-10): 40 now (17 added for teams, stars, VIPs, contracts, upgrades, the Yard,
  visitors, friendship, festivals, dream jobs, 100/150 residents, the collection book, all land).
  The goal chip opens the Goals page (scrolled to the next one); Menu also lists it. Goals finish
  by themselves. A keen bot clears 35/40 in three days (it never sends VIPs or throws festivals).
- Collection book (Menu): Buildings (land-bound types excluded), Residents (traits + star), VIPs,
  Recipes. It fills itself (`noteSeen` in `checkGoals`, `state.seen`); a finished page pays
  `collectionGems` (5) once, with a toast. No buttons to press.
- Festivals: from 10 residents at 85%+ happy, a heart bubble on the town square
  (`festivalSpot`: the plaza, or the entry road's town end) starts one with a tap: 30 min of +50%
  sales and visitors twice as often, bunting on the square, then a 6 h rest. Free.
- Night market: game hours 19-23, food and fun shops pay 25% more per sale, with a toast. Like
  festivals it only applies while you play (`playExtras` in the sales step), so offline
  catch-up stays exact.
- Milestones are extra entries in `GOALS`; a building can need one via `unlockGoal`
  (Library: Town IQ 100, Fountain: 90% happy).
- Upgrades: every building has levels 1-5 since v48 (landmarks 1-3, `maxLevelOf`) (`b.level`), each +50% rent / sales and stock /
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
- Visitors (2026-11-10): only while you play, from `visitorUnlockPop` (6) residents, one every
  1-2.5 min (`maybeVisitor`/`visit`). Each wants a shop category; they spend
  `visitorSpendMinutes` (0.2) of the whole town's while-you-play shop income at your best shop of
  that kind (a coin pop), or post what was missing. About 10% extra shop income while playing,
  about 1% of a whole day. In a 70%+ happy town with a free home, 15% ask to move in (they join
  the Welcome sign, dreaming of the shop they loved).
- Feed (bottom-bar button with unread count): Twitter-style posts in `state.feed` (40 kept):
  visitors' reviews and complaints, a resident's wish every `postGapMs` (4 min) while playing,
  first dream jobs, shop problems. Complaints are the hint at what to build.
- Deliveries drive off by themselves too (Camden, 2026-11-10); the pin marks the parcel's home.
- Bottom bar (2026-11-10): Feed, Upgrades, People, Menu. Camden removed the Build button (it only
  said "tap an empty lot"); building is tapping a lot, and the first goal says so.
- Upgrades tab (since v48 drawn as a tree, see below; badge = upgrades you can afford): the
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
- Taps, second report ("the clicking isn't accurate again", after ChatGPT's move feature):
  move mode stayed on after closing its sheet, so every tap tried to place the building. Now a
  tap on any built tile leaves move mode and acts normally. The canvas also re-syncs when its
  size changes (ResizeObserver, visualViewport, and a check on every tap), and taps scale x and
  y separately, so an iOS height change after launch can't skew taps. A faint ring shows where
  each tap landed, so Camden can say which way it is off if it still is.
- Residents with routines (2026-11-10): walkers (render only, up to 20) follow the game clock:
  home 22-6, work 6-11 and 13-17 (no job: stroll), lunch at the nearest food shop 11-13, the
  evening at a fun shop or park; each has a slightly shifted clock. They walk real road paths
  and go inside on arrival. Spending is in the sim (`residentBuy`, every `residentShopGapMs`
  while playing, `residentSpendMinutes` 0.03 of the town's play income, ~9% extra while open):
  the event sends that resident's walker to the shop (`renderer.sendWalker`) with a coin pop.
  `renderer.walkerStats()` reports what they're doing, for testing.
- VIPs (2026-11-10, Tiny Tower style, Camden chose "you send them"): while you play, from 8
  residents, every 8-15 min one waits 15 min on the entry road (`vipSpot`, gold car, star
  bubble). Tap -> sheet -> "Send them" -> the goal chip says what to tap -> tap a building
  (`sendVip`, checked by `vipTargetIssue`). `VIPS` in config: Builder (finish a site), Big Spender
  (10 min of play income at a shop), Food Critic (+50% for a day, `b.criticUntil`), Celebrity
  (x2 for 30 min, `b.buzzUntil`), Inspector (fixes every problem), Recruiter (a star moves into
  a home with room). Ignored VIPs leave quietly. Each posts to the feed.
- Mission pay (Camden: "not close at all"): tuned to about the same coins per second of play.
  Minutes of town shop income: taxi fare 4 (was 8, then x distance x tip x gas, so 4-6x the
  rest), delivery 7, Lunch Rush 12, Odd Jobs 5 (+10%/skill), Lost & Found 10, Courier 6 a stop.
  Bot: rides fell from 30% to 15% of income, missions rose to 21%, pacing unchanged.
- Roads are not tappable, except the one tile Pip is sitting on (`hitTest` in render).
- Driving: the car moves by itself at `TUNING.carBaseSpeed` lots a second and always arrives.
  Camden found it fast on the phone and wants it to start really slow and speed up through
  upgrades (cars now, prestige later): base 0.75 lots/s, gas x2.5, cars x1 / 1.6 / 2.4 / 3.5.
  A big GAS button shows during any drive; holding it multiplies speed by `gasSpeed` and the
  view follows the car. The share of the trip with gas held (`rideGas`) adds up to `gasBonus`
  (+50%) to the fare in `completeRide`. Never make the pedal required.
- Cars (`CARS` in config, `state.car`): four, bought on the Jobs sheet, each faster and paying
  more on every ride, delivery and welcome drive.
- Newcomers (2026-11-10): up to 5 wait (3 until v47; casual towns were capped by it) at the Welcome spot on the entry road just outside town
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

## The analysis batch (2026-11-11, v47; Camden: "Do all of it")
An audit (bot runs, a 130-resident town in the preview, timings) found, and this batch changed:
- Smoothness: the once-a-second HUD refresh took 12-29 ms at 130 residents (the People dot
  checked every resident against every job; mood was recalculated several times). Now the dot
  is checked every 5 s, `townMood` keeps its last answer while a cheap key (time, homes, jobs,
  skills, buildings) is unchanged, and rent sums use one residents-by-home map and the party
  animals' homes worked out once. Worst case 29 -> 16 ms on a Mac.
- Map: level stars only on landmarks; levels show as flower boxes (2) and gold trim (3), shops
  add an awning and a small flag. Coin pops only for amounts over a twentieth of a minute's play
  income (`popFloor` in main). High-rise and Skyscraper HQ use map-only tall sprites
  (`tall_highrise`, `tall_skyscraper`, `TALL` in render) that rise 5-8 px into the lot behind:
  Camden accepted breaking the "fits its own lot" rule for towers only. The population HUD
  shrinks its font past 6 characters.
- Rebuild a home in place (`rebuildOptions`, `rebuildHome`): any bigger home type, a third of
  what the old one cost comes off, level resets to 1, residents stay and keep paying while it is
  rebuilt. The home sheet offers the two biggest (copies make small homes as dear as big ones).
- Economy: rent per resident doubled (tent 500 ... high-rise 3400): rent is now ~22% of a casual
  player's income and 6-9% of a keen one's, and it is the money that comes in while away. City
  value (prestige) now counts coins in the bank, so a late town's savings are never wasted. The
  Goals page shows "Ready for a new town · +N points" and a toast says when it first opens.
- "Welcome everyone who fits" on the Newcomers sheet (`welcomeAll`, best skills first).
- Mayor's desk: "Show on the map who needs what" (`renderer.setOverlay`, 45 s or until the next
  map tap): a red square on each home missing a need, with a bubble of what to build (clinic,
  police, school, park at half size, or the shop category icon).
- Six late goals (48 now): landmark, rebuild a home, mayor level 5, landmark stage 3, all four
  landmarks, 250 residents.
- Bot (`tools/playtest.mjs` now builds landmarks and rebuilds homes when out of lots): keen 155 ->
  171 residents at 3 days; casual 56-58 -> 53-63 (noisy; the newcomer sign was the cap); one week
  341 residents, happiness 57% (civic coverage, the overlay is the player's tool for it). Late
  keen towns are capped by newcomer arrivals, not lots or coins, so the bot never rebuilt.

## The formative batch (2026-11-11, v48; Camden: "do the core 3 plus all 5 ... all at once")
Camden asked for one universal restock button, Upgrade first on building sheets, an upgrade tree, and
said big changes that reset what he has are fine if the game gets better. All of it:
- No stock (his restock ask, taken further): shops sell forever, also while away. `restock`,
  `restockAll`, `soldOutShops`, `restockCostOf` stay as no-ops for old callers. The sold-out
  badge, tap-to-restock, stock bar and away-card restock are gone. Goal id 'restock' is now
  "Build a shop next to homes"; the 'restocks' promise is gone (migrate drops an old daily).
- Fewer systems: the Stock Exchange and materials (Lumber Yard, Quarry, Brickworks) are cut;
  migrate refunds buildings (`paid`), shares (at the saved price) and materials (old import price).
  Landmark stages cost coins only. VIPs: tapping one goes straight to picking a building (no sheet)
  and a waiting VIP takes one of the `jobSpots` bubbles (one stream of map bubbles).
- Neighbours (`spotBonus`, `neighbourBonus`, `TUNING.neighbours`, radius 2): shops +4% per home (to
  +20%), +8% per same-kind shop (to +16%, "shopping street"), +10% green space; homes +3% per shop
  (to +12%, added in `homeBoost`). Shown on the sheet, on each surprise-shop card and the Homes
  heading of the build menu ("+N% here"), and in the move preview. Never a penalty.
- Levels 1-5 (`TUNING.maxLevel` 5, `upgradeCost` [0,2,5,12,25]): levels 4 and 5 grow a floor each
  (render `grownSprite`: wall with two windows under the roof, roof rises 5 px into the lot behind),
  level 5 adds gold edges. No floors on towers, landmarks, tents, farms, parks or trees.
- Families: at the top of each hour a home with two grown-ups and a free room has a `familyChance`
  (12%) of a kid (`runFamilies`). Kids (`t.kid`, `grownAt`, `parents`) live at home, pay no rent,
  don't need or take jobs, then grow up after `growUpMs` (6 h) with their parents' average skills
  +-1 and one parent's dream. Goal family1. Bots that fill every room see almost none (keen 0,
  casual 0-2 in three days): families need a player who leaves a room free.
- Upgrade tree (`TREE` in config): five branches (Homes, Shops, Transport, Services, Building) from
  the town hall; a node needs the one above bought (`treeIssue`). 'car' is the car ladder and opens
  Transport. New nodes: Architects (upgrades -10%/level, replaces materials), Town planning
  (neighbour bonuses +25%/level), Outreach (town buildings reach +1/level; `reachOf(b, state)`).
  Tap a node for its detail panel; mayor and new-town perks use the same node look in purple/teal.
- Upgrade first: every building sheet opens with the level row and Upgrade button.
- Bot (v47 -> v48, the bot now also buys cars so Transport opens): keen 3 days 171 -> 188
  residents, happy 75 -> 84%; casual 53-63 -> 67-73; one week 341 -> 362, happy 57 -> 69%. Shop income is about 1.6-2x (no restock cost, no sell-outs
  while away, neighbours); pacing is still capped by newcomers, not coins.

## The follow-up batch (2026-11-11, v49; Camden: "Yes, do 1-10")
- Late growth: the Welcome sign gets one more spot per `spotsPerPop` (50) residents, up to
  `spotsFromPopMax` (4) (`maxApplicants`). Two Homes-branch tree nodes after Town planning: Recruiters
  (newcomers 20% sooner a level, from 30 residents) and Open house (+2 spots a level, from 40). The map
  draws at most 9 waiting newcomers. This is the coin sink for late towns.
- Families: a home sheet with two grown-ups says "Room for a family" (free room) or "Leave a room
  free and they may start a family". New-town perk Big families (`kin`): kids 25% more often a rank.
- Taller art everywhere: `floorsFor`, `getGrown`, `grownURL` moved to sprites.js; sheets show the
  extra floors too (`buildingArt` in ui; the mini icons stay flat).
- Skipping a Lunch Rush no longer shows the "popped up on the map" toast (`jobRest` set to 0).
- Sports places (Claude picked them, Camden didn't name any): Tennis Club, Skate Park, Soccer Field,
  Swimming Pool, from 40 residents. First version had no unlock and 3-4 jobs: early creative/service
  draws gave big shops and the keen bot fell from 188 to 146 residents at day 3; unlockAt 40 and
  smaller teams put it back at 180.
- New-town perks are a tree too (`PERM_TREE`: Money, Speed, People; `permTreeIssue`).
- Weather, looks only (render `weatherAt`/`drawWeather`): per real hour from the map seed; snow on
  about half of winter's hours, rain one hour in six otherwise, fog some mornings. Sized per CSS px.
  `bitcity.renderer.setWeather('rain'|'snow'|'fog'|null)` forces it for testing.
- Visiting old towns: `foundNewTown` stores `map` (seed, streets, land, built buildings) on the
  sister town. The sister-town row in Upgrades has Visit; main swaps a frozen copy in for the renderer
  only (`visiting`; taps ignored; the HUD still shows your town) and a bar at the top goes home.
  Towns founded before v49 have no map and no Visit button.
- Bot after v49: keen 3 days 180 residents (85% happy), casual 61-80, one week 363 (69%). The extra
  Welcome spots barely moved the one-week town (362 -> 363) and it still never rebuilds a home: late
  growth is not only the sign. Worth finding what caps it next (lots? homes? coins on levels?).
- Fresh start checked in the preview at phone size: the first goals run in order and the new
  neighbours goal (id 'restock') completes on the first shop next to the tent.

## The growth batch (2026-11-11, v50; Camden: "Yes, do 1-5")
- What capped late towns (found with the bot's new evening lines: empty rooms, waiting, free lots,
  land, and which needs residents miss): not newcomers (the sign was always full) but price curves.
  Homes x1.35 a copy (20th High-rise 24M) and government x1.8 a copy (15th 5.6M) meant big towns could
  neither house nor serve people. Now `homeCopyGrowth` 1.22 for homes, parks and trees, and `GOV.growth`
  1.4. Shops stay x1.8 a category (`SHOP_COST_GROWTH`): trying 1.5 sent income to 15M/h and filled
  the map by day 2.5. Homes at 1.12 gave 765 residents in a week at 29% happy.
- Bot v49 -> v50: keen 3 days 180 -> 289 residents (85 -> 70% happy); casual 61-80 -> 90-94 (about
  74%); one week 363 -> 528 (69 -> 55%), the map fills on day 6.5 and Rebuild starts being used. Late
  happiness is now limited by shops and jobs as much as services (the bot builds one service per
  check-in; a player has the needs overlay). Kids: a few per run.
- Upgrades sheet has three tabs (Town: ad and tree; Mayor: level and perks; New town: prestige,
  sister towns, perk tree). `sheet.tab`, act 'up-tab'.
- Seven goals (55 now): hood30, level5, sports1, kids3, tree10 (counts car levels), visit1
  (`noteVisit`, `stats.visits`), placed through the list by difficulty.
- Text trims: upgrade preview "Next: +50% sales, a new floor" (only where a floor grows), family
  lines, the new-town confirm, the mayor XP line.

## Camden's idea list (2026-11-10)

Done from it: hourly rent and rent/hour display, 10x play boost, distance fares, any-tent rides,
range for town buildings, per-resident happiness with reasons, happiness moving rent both ways,
shop problems the government solves, the Mayor's desk, his own places, land-bound buildings,
a jobs board with six ways to earn, the gas pedal, car upgrades and the welcome drive.
Batch 1 (worker skill and count) and newcomers (arrivals on the entry road, traits, stars,
moving out) are done. The game is now called Mini Mayor. Visitors and the feed are done.
Also done on 2026-11-10 from his phone feedback: the entry road and trade trucks, the taxi and
deliveries picking their own destination (red pin), jobs as map bubbles, the Upgrades tab and
Construction Yard, goal progress, forgiving taps, the name Mini Mayor, the Build button removed.

Still to build, in his order (he approved the designs on 2026-11-11):
2. (done) A stock market that can lose coins, kept simple.
3. (done, light version) Raw materials: three, optional, for cheaper upgrades.
4. (done) Prestige with mayor level.
Claude's ideas are all built: bus line, seasons, rival towns, mayor level (in prestige), night market.
Also open: more "other sports" places if he names them, away income (shops only earn the 10x
boost while open), more goals (he likes goals as the guide; a keen bot clears all 23 in a week)
and maybe a Goals list in Menu (offered, not asked for).
His calls on the next batch (2026-11-10, answers to a question card):
- Residents with routines: home -> work -> lunch at a food shop -> evening at a park or fun
  place -> home. They also spend (a small coin pop at the shop), not just look busy.
- Trade much bigger through contracts with neighbour towns: standing hourly deliveries that run
  by themselves, with friendship levels. (Shop exports were offered; he chose contracts.)
- VIPs like Tiny Tower, and he sends them: tap the VIP, then tap the building (Builder, Big
  Spender, Critic, Celebrity, Inspector, Recruiter).
- Mission payouts made comparable (done). Taps fixed again (done).
- Added to the list: more goals plus a Goals page, festivals at high happiness, a collection book
  (all three done). Not chosen: daily gift and streak.
- Then he said yes to all five of Claude's ideas (bus line, seasons, mayor level, rival towns,
  night market) with one rule: "make sure when we add things we aren't over complicating things
  for the user. it comes in seamless additions." Night market is done.

## How a session usually goes (what Camden expects)

- He sends short asks from playing on his phone. Make each a batch: explain the plan in a few
  lines first, build, then `node --test`, `node tools/playtest.mjs` (compare with the last run),
  and a check in the browser preview at phone size. Report what was verified and what wasn't.
- Commit each batch with CLAUDE.md updated. Then ask "push?"; he answers "Yes, push". Push,
  wait for the Pages build (`gh run watch`), and confirm the live `sw.js` has the new CACHE.
- Preview tips: the preview server is `python3 -m http.server 8000` in this folder
  (`.claude/launch.json`, often already running). Before trusting it, unregister the service
  worker, delete caches, re-fetch changed files with `{cache:'reload'}` and load twice. The local
  pane can't register the service worker ("unknown error when fetching the script"); the live
  site can. When the pane is hidden, animation frames don't run: call `bitcity.renderer.draw()`.
  Taking a screenshot can count as leaving and returning, which tidies away a waiting ride.
- New sim functions are reachable in the console as `bitcity.sim.*`; `import('/js/state.js')`
  gives the same state module the game uses.

## Architecture rules

- `js/config.js`, `js/state.js`, `js/sim.js` are pure: no DOM, time passed in as `now`,
  randomness from the seeded PRNG in state (no `Math.random`, no `Date.now` in sim).
- All balance numbers live in `js/config.js` (`BUILDINGS`, `TUNING`, `GOALS`).
- `js/ui.js` never imports sim directly; it goes through the `api` object from `main.js`.
- Sim functions return `{ ok: false, reason }` with a friendly sentence instead of throwing.
- Bump `CACHE` in `sw.js` and `VERSION` in config.js together when shipping changes, and add any new file to its list,
  or the phone keeps serving the old version.
- Tests: `node --test` from the project root (70 passing). `node --check js/x.js` does not
  catch module syntax errors here; copy to a .mjs file and check that, or import it in node.
  `node --test tests/` does not work on Node 22.
- Browser console helpers: `bitcity.skip(minutes)`, `bitcity.give(coins, gems)`.

## Known gaps at handoff

- Live on GitHub Pages since 2026-11-10 (v29 at this handoff). Fixed from his phone reports:
  smooth zoom and glide, map under the camera, slower taxi, forgiving taps. He has not yet
  reported on: sound, away time, the newcomers, the feed, visitors, the Upgrades tab.
- Skipping a Lunch Rush also shows the "popped up on the map" toast (skipping clears the rest).
  Harmless; offered to quiet it.
- ChatGPT (Codex) finished the surprise-shop menu and added deliveries and restock-all. It
  also wrote jobs-board rules with no screens; the screens were built on 2026-11-10.
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
- Restocking as a timer or mini-game. (Since v48 there is no stock at all.)
