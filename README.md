# Bit City

A small pixel-art town builder for your phone. You're the landlord: build homes and
shops, move people in, match them to jobs (and dream jobs), give rides for tips, and
collect rent at the top of every hour.

No build step. The folder is the game.

## Play it on your Mac

```
cd "/Users/camdenweber/Developer/Bit City"
python3 -m http.server 8000
```
Open http://localhost:8000 and shrink the window to phone shape.

## Put it on your iPhone (free, about 5 minutes)

1. Create a new repository on github.com (private repos need a paid plan for Pages; public is free).
2. From this folder: `git init && git add . && git commit -m "Bit City" && git branch -M main`
   then `git remote add origin <your repo url> && git push -u origin main`.
3. On GitHub: Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
4. Open the Pages URL in Safari on your phone → Share → Add to Home Screen.

After that it opens full screen and works offline. To update the game, push again;
the phone picks up the new version the second time you open it.

## Your save

The town saves on the phone automatically. Menu → "Back up my town" gives you a code you
can paste back in with "Restore a backup" (new phone, cleared Safari data, or moving
from the Mac to the phone). Keep a copy somewhere if you care about the town.

## Where things live

| File | What it is |
|---|---|
| `js/config.js` | Every number in the game: prices, rents, timers, unlocks, goals |
| `js/sim.js` | The rules: building, selling, rent, jobs, rides |
| `js/state.js` | New game, saving, backup codes |
| `js/sprites.js` | All pixel art, drawn in code |
| `js/render.js` | The map: drawing, panning, taps, taxi |
| `js/ui.js`, `styles.css` | Menus and the top/bottom bars |
| `js/main.js` | Connects everything |
| `tests/` | Rule tests: `node --test` |
| `SPEC.md` | The phase 1 design spec |

Testing shortcut in the browser console: `bitcity.skip(60)` jumps ahead an hour,
`bitcity.give(1000, 5)` adds coins and gems.
