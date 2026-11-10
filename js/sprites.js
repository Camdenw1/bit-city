// Bit City — sprites. All pixel art is authored in code.
//
// Layout of this module:
//   1. PALETTE + single-character keys used by the art
//   2. Grid: a tiny char-grid drawing surface (works in Node, no canvas)
//   3. The art: tiles, buildings, vehicles, icons, people
//   4. Core exports: SPRITE_IDS, spritePixels(id), personPixels(look, frame)
//   5. Thin browser-only canvas wrappers: initSprites, getSprite, spriteURL, getPerson, personURL
//
// Nothing here touches `document` at import time.

import { BUILDINGS } from './config.js';

// ---------------------------------------------------------------- 1. palette

export const PALETTE = {
  ink: '#3b2f4a',        // outlines (dark plum, never pure black)
  inkSoft: '#5d4a66',    // soft shadow / dark interiors
  white: '#fff6e0',      // cream white
  paper: '#f0dfb8',
  sand: '#dcc090',
  tan: '#c49a6c',
  brown: '#96664a',
  brownDark: '#6e4838',
  red: '#d9574a',
  redDark: '#a63d44',
  orange: '#e8804a',     // food
  orangeDark: '#b85a3a',
  yellow: '#f2c14e',     // coin yellow
  yellowLight: '#fbe391',
  green: '#5bb450',      // farming
  greenDark: '#3d8848',
  leafLight: '#bfe08c',
  grass: '#a3cf72',
  grassDark: '#86bb62',
  blue: '#4a90d9',       // retail
  blueDark: '#35629e',
  sky: '#8ed1ec',
  skyLight: '#cdeff5',
  purple: '#9a6fd0',     // service
  purpleDark: '#6a4a9c',
  pink: '#e85d8a',       // creative
  pinkLight: '#f7adc0',
  orangeLight: '#f8cfb0', // shopfront tints, one per category
  purpleLight: '#d9c8f2',
  blueLight: '#c4dcf6',
  gray: '#8b8696',       // asphalt
  grayDark: '#6c6779',
  grayLight: '#b8b4bc',
  stone: '#d8d2c6',
  skin0: '#fbdcb8',
  skin1: '#f0c090',
  skin2: '#d9a06c',
  skin3: '#b07848',
  skin4: '#7c5236',
};

// One character per palette color. '.' is transparent.
const KEY = {
  k: 'ink', K: 'inkSoft', w: 'white', p: 'paper', s: 'sand', t: 'tan', b: 'brown', B: 'brownDark',
  r: 'red', R: 'redDark', o: 'orange', O: 'orangeDark', y: 'yellow', Y: 'yellowLight',
  g: 'green', G: 'greenDark', l: 'leafLight', m: 'grass', M: 'grassDark',
  u: 'blue', U: 'blueDark', c: 'sky', C: 'skyLight', v: 'purple', V: 'purpleDark',
  q: 'orangeLight', x: 'purpleLight', z: 'blueLight',
  i: 'pink', I: 'pinkLight', a: 'gray', A: 'grayDark', e: 'grayLight', E: 'stone',
  0: 'skin0', 1: 'skin1', 2: 'skin2', 3: 'skin3', 4: 'skin4',
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const RGB = {};
for (const ch of Object.keys(KEY)) RGB[ch] = hexToRgb(PALETTE[KEY[ch]]);

// ---------------------------------------------------------------- 2. grid

class Grid {
  constructor(w, h, fill = '.') {
    this.w = w; this.h = h;
    this.d = new Array(w * h).fill(fill);
  }
  static from(rows) {
    const h = rows.length, w = rows[0].length;
    const g = new Grid(w, h);
    for (let y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error('sprite row ' + y + ' has width ' + rows[y].length + ', expected ' + w + ': ' + rows[y]);
      for (let x = 0; x < w; x++) g.d[y * w + x] = rows[y][x];
    }
    return g;
  }
  get(x, y) { return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? '.' : this.d[y * this.w + x]; }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c; return this; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); return this; }
  hl(x0, x1, y, c) { return this.rect(x0, y, x1, y, c); }
  vl(x, y0, y1, c) { return this.rect(x, y0, x, y1, c); }
  // pts('c', x,y, x,y, ...)
  pts(c, ...xy) { for (let i = 0; i < xy.length; i += 2) this.set(xy[i], xy[i + 1], c); return this; }
  // Stamp string rows; ' ' leaves the pixel alone, '.' erases it.
  stamp(x0, y0, rows) {
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c !== ' ') this.set(x0 + x, y0 + y, c);
    }
    return this;
  }
  blit(src, x0, y0) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.d[y * src.w + x];
      if (c !== '.') this.set(x0 + x, y0 + y, c);
    }
    return this;
  }
  // 1px outline on every transparent pixel that touches an opaque one (4-neighbour: gives soft corners).
  outline(c = 'k') {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y) !== '.') continue;
      if (this.get(x - 1, y) !== '.' || this.get(x + 1, y) !== '.' || this.get(x, y - 1) !== '.' || this.get(x, y + 1) !== '.') add.push(x, y);
    }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
    return this;
  }
  flipH() {
    const g = new Grid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.d[y * this.w + x] = this.d[y * this.w + (this.w - 1 - x)];
    return g;
  }
  flipV() {
    const g = new Grid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.d[y * this.w + x] = this.d[(this.h - 1 - y) * this.w + x];
    return g;
  }
  toPixels() {
    const data = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.d.length; i++) {
      const c = this.d[i];
      if (c === '.') continue;
      const rgb = RGB[c];
      if (!rgb) throw new Error('unknown palette key "' + c + '"');
      data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255;
    }
    return { w: this.w, h: this.h, data };
  }
}

// ---------------------------------------------------------------- 3a. tiles
// The ground is deliberately quiet so buildings are the only busy thing on screen.

function grassTile(variant) {
  const g = new Grid(16, 16, 'm');
  if (variant === 1) g.pts('M', 4, 5, 11, 11);
  else if (variant === 2) g.pts('I', 5, 8).pts('w', 11, 5);   // two tiny flowers
  return g;
}

function lotTile() {
  // A soft, lighter square: "you can build here".
  const g = new Grid(16, 16, 'm');
  g.rect(2, 2, 13, 13, 'l');
  g.pts('m', 2, 2, 13, 2, 2, 13, 13, 13);
  return g;
}

// ---- landscape around the town ----

function sandTile() {
  const g = new Grid(16, 16, 'p');
  g.pts('s', 3, 4, 11, 7, 6, 12);
  return g;
}

// mask bits: N=1, E=2, S=4, W=8 (set when that neighbour is land): a pale foam line on those edges
function waterTile(mask) {
  const g = new Grid(16, 16, 'c');
  g.hl(3, 5, 5, 'C').hl(9, 11, 11, 'C');                  // two small ripples
  if (mask & 1) g.hl(0, 15, 0, 'C');
  if (mask & 4) g.hl(0, 15, 15, 'C');
  if (mask & 8) g.vl(0, 0, 15, 'C');
  if (mask & 2) g.vl(15, 0, 15, 'C');
  return g;
}

function mountainTile() {
  const g = new Grid(16, 16, 'm');
  for (let y = 2; y <= 13; y++) {
    const half = 1 + Math.floor((y - 2) * 0.55);
    g.hl(8 - half, 7, y, y <= 4 ? 'w' : 'e').hl(8, 7 + half, y, y <= 4 ? 'E' : 'a');
  }
  return g;
}

function treeTile() {
  const g = new Grid(16, 16, 'm');
  g.rect(4, 3, 11, 9, 'g').hl(5, 10, 2, 'g').hl(5, 10, 10, 'G').vl(11, 4, 9, 'G');
  g.pts('m', 4, 3, 11, 3, 4, 9, 11, 9);
  g.rect(7, 11, 8, 13, 'b');
  return g;
}

// The town square: pale paving with a planter in the middle of each slab.
function plazaTile() {
  const g = new Grid(16, 16, 'E');
  g.hl(0, 15, 0, 'e').vl(0, 0, 15, 'e').hl(0, 15, 8, 'e').vl(8, 0, 15, 'e');
  g.rect(11, 3, 13, 5, 'g').pts('i', 12, 3).pts('G', 13, 5);
  return g;
}

function lotSandTile() {
  const g = new Grid(16, 16, 'p');
  g.rect(2, 2, 13, 13, 'w');
  g.pts('p', 2, 2, 13, 2, 2, 13, 13, 13);
  return g;
}

// "For sale": a wooden sign with a coin on it.
function signTile() {
  const g = new Grid(16, 16);
  g.rect(2, 2, 13, 9, 'p').rect(7, 10, 8, 14, 'b');
  g.rect(6, 4, 9, 7, 'y').pts('Y', 6, 4, 7, 4).pts('O', 9, 7, 8, 7);
  g.outline();
  return g;
}

// mask bits: N=1, E=2, S=4, W=8 (set when that neighbour is also road)
function roadTile(mask) {
  const g = new Grid(16, 16, 'a');
  const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;
  // a one-pixel kerb on closed sides, and on the inside corners of junctions
  if (!N) g.hl(0, 15, 0, 'e');
  if (!S) g.hl(0, 15, 15, 'e');
  if (!W) g.vl(0, 0, 15, 'e');
  if (!E) g.vl(15, 0, 15, 'e');
  if (N && W) g.set(0, 0, 'e');
  if (N && E) g.set(15, 0, 'e');
  if (S && W) g.set(0, 15, 'e');
  if (S && E) g.set(15, 15, 'e');
  // one faint centre dash on straight stretches; junctions stay plain
  if (N && S && !E && !W) g.rect(7, 5, 8, 10, 'e');
  if (E && W && !N && !S) g.rect(5, 7, 10, 8, 'e');
  return g;
}

// ---------------------------------------------------------------- 3b. buildings (16x16, one lot each)
// Rules that keep the town readable:
//   - every building fits inside its own lot, so nothing hides the lot behind it
//   - shops: flat roof in the category colour + one big picture of what they sell
//   - the second shop of a category has a striped roof
//   - homes: pitched roofs in neutral colours, bigger with each tier
//   - farms look like fields, not shops

const B_W = 16, B_H = 16;

const EMBLEM = {
  diner: [        // burger
    ' ttttt ',
    'ttttttt',
    'ggggggg',
    'BBBBBBB',
    'yyyyyyy',
    'ttttttt',
    ' ttttt ',
  ],
  bakery: [       // cupcake
    '   r   ',
    '  III  ',
    ' IIIII ',
    'IIIIIII',
    'ttttttt',
    ' ttttt ',
    ' ttttt ',
  ],
  market: [       // shopping bag
    '  B B  ',
    ' B   B ',
    'uuuuuuu',
    'uuuuuuu',
    'uuwwuuu',
    'uuuuuuu',
    'uuuuuuu',
  ],
  bookshop: [     // books on a shelf
    '    uu ',
    'rr  uu ',
    'rryyuu ',
    'rryyuu ',
    'rryyuu ',
    'rryyuu ',
    'BBBBBBB',
  ],
  well: [         // water drop
    '   u   ',
    '   u   ',
    '  uuu  ',
    ' uuuuu ',
    ' uwuuu ',
    ' uuuuu ',
    '  uuu  ',
  ],
  barber: [       // barber pole
    '  AAA  ',
    ' KrrwK ',
    ' KrwwK ',
    ' KwwuK ',
    ' KwuuK ',
    ' KuurK ',
    '  AAA  ',
  ],
  studio: [       // paint palette
    '  ttt  ',
    ' trttt ',
    'ttttutt',
    'tyttttt',
    'tttt tt',
    ' ttgtt ',
    '  ttt  ',
  ],
  music: [        // music note
    '  kkkkk',
    '  kkkkk',
    '  k   k',
    '  k   k',
    ' kk  kk',
    'kkk kkk',
    'kk  kk ',
  ],
};

Object.assign(EMBLEM, {
  clinic: [       // red cross
    '  rrr  ',
    '  rrr  ',
    'rrrrrrr',
    'rrrrrrr',
    'rrrrrrr',
    '  rrr  ',
    '  rrr  ',
  ],
  school: [       // an apple for the teacher
    '   G   ',
    '  rGr  ',
    ' rrrrr ',
    'rrwrrrr',
    'rrrrrrr',
    ' rrrrr ',
    '  r r  ',
  ],
  trade: [        // shipping crate
    'ttttttt',
    'tBtttBt',
    'ttBtBtt',
    'tttBttt',
    'ttBtBtt',
    'tBtttBt',
    'ttttttt',
  ],
  library: [      // open book
    '       ',
    'UU   UU',
    'UwU UwU',
    'UwwUwwU',
    'UwwUwwU',
    'UUUUUUU',
    '       ',
  ],
});

Object.assign(EMBLEM, {
  noodle:   [' k   k ', '  k k  ', 'yyyyyyy', 'rwrrrrr', 'rrrrrrr', ' rrrrr ', '  RRR  '],
  pizza:    ['ttttttt', ' yryyy ', ' yyyry ', '  yry  ', '  yyy  ', '   y   ', '   y   '],
  taco:     ['       ', '  ggr  ', ' gyyyg ', 'ttttttt', 'ttttttt', ' ttttt ', '       '],
  sushi:    ['       ', ' KKKKK ', 'KwwwwwK', 'KwoowwK', 'KwoowwK', 'KwwwwwK', ' KKKKK '],
  hoops:    ['  oko  ', ' ookoo ', 'oookooo', 'kkkkkkk', 'oookooo', ' ookoo ', '  oko  '],   // basketball
  venue:    ['  aaa  ', ' aAaAa ', ' aaAaa ', '  aaa  ', '   k   ', '   k   ', '  kkk  '],   // microphone
  bikes:    [' B   kk', ' rrrrk ', ' r  r  ', 'kkk kkk', 'k k k k', 'kkk kkk', '       '],   // bicycle
  ski:      ['   u   ', ' u u u ', '  uuu  ', 'uuuuuuu', '  uuu  ', ' u u u ', '   u   '],   // snowflake
  surf:     ['       ', '  uuu  ', ' uu  u ', 'uu     ', 'uuu   c', 'uuuuucc', 'ccccccc'],   // wave
  university: ['   k   ', ' kkkkk ', 'kkkkkkk', ' kkkkk ', '  kkk y', '  kkk y', '      y'], // graduation cap
  icecream: ['  III  ', ' IIIII ', ' IwIII ', '  ttt  ', '  ttt  ', '   t   ', '   t   '],
  cafe:     ['  e e  ', '       ', 'BBBBB  ', 'BBBBBBB', 'BBBBB B', 'BBBBBB ', ' BBB   '],
  toys:     ['  ryu  ', ' rryuu ', 'rrryuuu', 'rrryuuu', 'rrryuuu', ' rryuu ', '  ryu  '],
  clothes:  ['uu   uu', 'uuuuuuu', 'uuuuuuu', ' uuuuu ', ' uuuuu ', ' uuuuu ', ' uuuuu '],
  florist:  ['  iii  ', ' iiyii ', '  iii  ', '   g   ', '  gg   ', '   g   ', '   g   '],
  pets:     [' B B B ', ' B B B ', '       ', '  BBB  ', ' BBBBB ', ' BBBBB ', '  B B  '],
  hardware: [' AAAAA ', ' AAAAA ', '   b   ', '   b   ', '   b   ', '   b   ', '   b   '],
  laundry:  ['AAAAAAA', 'AeeeeeA', 'AeuuueA', 'AeuCueA', 'AeuuueA', 'AeeeeeA', 'AAAAAAA'],
  bank:     ['   y   ', '  AAA  ', ' AAAAA ', 'AAAAAAA', ' A A A ', ' A A A ', 'AAAAAAA'],
  gym:      ['       ', 'K     K', 'KK   KK', 'KKKKKKK', 'KK   KK', 'K     K', '       '],
  post:     ['RRRRRRR', 'RrwwwrR', 'RwrwrwR', 'RwwrwwR', 'RwwwwwR', 'RRRRRRR', '       '],
  cinema:   [' y y y ', 'yyyyyyy', 'rwrwrwr', 'rwrwrwr', 'rwrwrwr', ' wrwrw ', ' wrwrw '],
  arcade:   ['   r   ', '  rrr  ', '   r   ', '   K   ', '   K   ', ' KKKKK ', 'KKKyKKK'],
  theatre:  [' yyyyy ', 'yyyyyyy', 'yKyyyKy', 'yyyyyyy', 'yKyyyKy', 'yyKKKyy', ' yyyyy '],
  photo:    ['  KK   ', 'KKKKKKK', 'KKeeeKK', 'KKeCeKK', 'KKeeeKK', 'KKKKKKK', '       '],
  police:   ['   u   ', '   u   ', 'uuuuuuu', ' uuyuu ', '  uuu  ', ' uu uu ', 'uu   uu'],
  fire:     ['   r   ', '  rr   ', '  rrr  ', ' rroor ', ' rooyr ', ' royyr ', '  ooo  '],
  mystery:  ['  KKK  ', ' K   K ', '     K ', '   KK  ', '   K   ', '       ', '   K   '],
});

// Colour coding, Tiny Tower style: the whole front of a shop wears its category's colour.
// roof = strong colour, dark = trim and door, tint = wall.
const CAT_STYLE = {
  food:     { roof: 'o', dark: 'O', tint: 'q' },
  retail:   { roof: 'u', dark: 'U', tint: 'z' },
  service:  { roof: 'v', dark: 'V', tint: 'x' },
  farming:  { roof: 'g', dark: 'G', tint: 'l' },
  creative: { roof: 'i', dark: 'R', tint: 'I' },
  gov:      { roof: 'y', dark: 'O', tint: 'Y' },
  trade:    { roof: 'b', dark: 'B', tint: 's' },
};

function shop(id, cat) {
  const c = CAT_STYLE[cat] || CAT_STYLE.food;
  const g = new Grid(B_W, B_H);
  g.rect(1, 5, 14, 14, c.tint);                           // coloured wall
  g.rect(1, 1, 14, 4, c.roof).hl(1, 14, 4, c.dark);       // deep roof in the strong colour
  g.hl(1, 14, 1, 'w');                                    // a pale edge so roofs read against the road
  g.rect(1, 5, 9, 13, 'w');                               // sign board...
  g.stamp(2, 6, EMBLEM[id] || EMBLEM.mystery);            // ...showing what they sell
  g.hl(1, 9, 14, c.dark);                                 // coloured step under the sign
  g.rect(10, 8, 13, 14, c.dark).rect(11, 9, 12, 10, 'c').set(12, 12, 'y');   // door
  g.outline();
  return g;
}

// A field: soil with rows of leaves and a dot of colour for what grows there.
function field(leaf, leafDark, dot) {
  const g = new Grid(B_W, B_H);
  g.rect(1, 1, 14, 14, 'b');
  for (const y of [2, 6, 10]) {
    g.hl(2, 13, y, leaf).hl(2, 13, y + 1, leafDark);
    if (dot) for (let x = 3; x <= 13; x += 3) g.set(x, y + 2, dot);
  }
  g.outline();
  return g;
}

// Pitched roof: `inset` px narrower at the top, widening 1px per row to x0..x1.
function roof(g, x0, x1, y0, y1, inset, base, lo) {
  for (let y = y0; y <= y1; y++) {
    const ins = Math.max(0, inset - (y - y0));
    g.hl(x0 + ins, x1 - ins, y, base);
  }
  g.hl(x0, x1, y1, lo);
  return g;
}

const BUILD = {};

BUILD.tent = () => {
  const g = new Grid(B_W, B_H);
  for (let y = 5; y <= 14; y++) {
    const half = 1 + Math.round((y - 5) * 0.6);
    g.hl(8 - half, 7, y, 'p').hl(8, 7 + half, y, 's');
  }
  for (let y = 10; y <= 14; y++) { const h = Math.ceil((y - 9) / 2); g.hl(8 - h, 7 + h, y, 'K'); }   // door flap
  g.vl(7, 2, 4, 'b').pts('r', 8, 2, 9, 2, 8, 3);                                                     // pennant
  g.outline();
  return g;
};

BUILD.cabin = () => {
  const g = new Grid(B_W, B_H);
  g.rect(2, 9, 13, 14, 't');
  g.hl(2, 13, 10, 'b').hl(2, 13, 12, 'b').hl(2, 13, 14, 'b');   // logs
  roof(g, 1, 14, 4, 8, 3, 'b', 'B');
  g.rect(4, 10, 6, 14, 'B').set(6, 12, 'y');                    // door
  g.rect(9, 10, 11, 12, 'c').set(9, 10, 'C');                   // window
  g.outline();
  return g;
};

BUILD.apartment = () => {
  const g = new Grid(B_W, B_H);
  g.rect(1, 3, 14, 14, 's').vl(14, 3, 14, 't');
  g.hl(1, 14, 1, 'e').hl(1, 14, 2, 'A');                        // flat roof
  for (const y of [4, 8]) for (const x of [3, 7, 11]) g.rect(x, y, x + 1, y + 1, 'c').set(x, y, 'C');
  g.rect(3, 11, 4, 12, 'c').rect(11, 11, 12, 12, 'c');
  g.rect(7, 11, 8, 14, 'B');                                    // door
  g.outline();
  return g;
};

BUILD.house = () => {
  const g = new Grid(B_W, B_H);
  g.rect(11, 1, 12, 4, 'E');                                    // chimney
  g.rect(2, 8, 13, 14, 'w').vl(13, 8, 14, 'p');
  roof(g, 1, 14, 2, 7, 4, 'r', 'R');
  g.rect(7, 10, 8, 14, 'b').set(8, 12, 'y');                    // door
  g.rect(3, 10, 5, 12, 'c').set(3, 10, 'C');
  g.rect(10, 10, 12, 12, 'c').set(10, 10, 'C');
  g.hl(3, 5, 13, 'i').hl(10, 12, 13, 'i');                      // flower boxes
  g.outline();
  return g;
};

// Every shop and government building uses the shopfront above, coloured by its category.
// A shop that fits several categories gets one sprite per category: 'bakery' and 'bakery@retail'.
const FIELDS = {
  farm: () => field('g', 'G', 'o'),
  pumpkin: () => { const g = field('G', 'G', null); for (const y of [3, 8, 12]) for (const x of [3, 7, 11]) g.rect(x, y, x + 1, y + 1, 'o'); return g; },
  berry: () => field('g', 'G', 'v'),
  herbs: () => field('l', 'g', null),
  vineyard: () => field('G', 'b', 'v'),
};
const SHOP_SPRITES = [];
for (const d of Object.values(BUILDINGS)) {
  if (d.kind === 'biz' && d.id !== 'orchard') {
    BUILD[d.id] = FIELDS[d.id] || (() => shop(d.id, d.category));
    if (!FIELDS[d.id]) for (const cat of d.categories.slice(1)) SHOP_SPRITES.push([`${d.id}@${cat}`, () => shop(d.id, cat)]);
  } else if (d.gov) {
    BUILD[d.id] = () => shop(d.id, 'gov');
  }
}
BUILD.trade = () => shop('trade', 'trade');
for (const cat of Object.keys(CAT_STYLE)) SHOP_SPRITES.push([`mystery_${cat}`, () => shop('mystery', cat)]);

BUILD.tree = () => {
  const g = new Grid(B_W, B_H);
  g.rect(3, 2, 12, 9, 'g').hl(4, 11, 1, 'g').hl(4, 11, 10, 'G').vl(12, 3, 9, 'G');
  g.pts('.', 3, 2, 12, 2, 3, 9, 12, 9).pts('l', 5, 3, 6, 3, 5, 4);
  g.rect(7, 11, 8, 14, 'b');
  g.outline();
  return g;
};

BUILD.park = () => {
  const g = new Grid(B_W, B_H);
  g.rect(1, 1, 14, 14, 'l');
  g.rect(7, 1, 8, 14, 'p');                                     // path
  g.rect(2, 2, 5, 5, 'g').hl(2, 5, 5, 'G').rect(3, 6, 4, 7, 'b'); // little tree
  g.hl(10, 13, 10, 'b').pts('b', 10, 11, 13, 11);               // bench
  g.pts('i', 11, 3, 12, 5, 3, 11, 4, 12).pts('y', 10, 4, 3, 12);  // flowers
  g.outline();
  return g;
};

BUILD.track = () => {
  const g = new Grid(B_W, B_H);
  g.rect(1, 1, 14, 14, 'l');
  g.rect(2, 3, 13, 12, 'r').pts('l', 2, 3, 13, 3, 2, 12, 13, 12);   // red oval track
  g.rect(4, 5, 11, 10, 'g').pts('r', 4, 5, 11, 5, 4, 10, 11, 10);   // infield
  g.hl(5, 10, 4, 'w').hl(5, 10, 11, 'w');                           // lane lines
  g.outline();
  return g;
};

BUILD.trail = () => {
  const g = new Grid(B_W, B_H);
  g.rect(1, 1, 14, 14, 'l');
  for (let y = 5; y <= 9; y++) g.hl(9 - (y - 5), 10 + (y - 5) > 14 ? 14 : 10 + (y - 5), y, 'a');   // a little peak
  g.pts('w', 9, 5, 10, 5, 9, 6).pts('e', 8, 6, 11, 6);                                           // snow cap
  g.pts('p', 2, 14, 3, 13, 4, 12, 5, 12, 6, 11, 7, 10, 3, 14, 4, 13, 5, 13, 6, 12, 7, 11);       // winding path
  g.rect(2, 3, 4, 5, 'g').hl(2, 4, 5, 'G').set(3, 6, 'b').set(3, 7, 'b');                        // pine
  g.vl(12, 11, 14, 'b').hl(11, 13, 11, 'y');                                                     // signpost
  g.outline();
  return g;
};

BUILD.fountain = () => {
  const g = new Grid(B_W, B_H);
  g.rect(2, 5, 13, 13, 'E').pts('.', 2, 5, 13, 5, 2, 13, 13, 13);   // stone basin
  g.rect(3, 6, 12, 12, 'c').pts('E', 3, 6, 12, 6, 3, 12, 12, 12);   // water
  g.rect(7, 3, 8, 9, 'e');                                          // pillar
  g.pts('C', 7, 1, 8, 1, 6, 2, 9, 2, 5, 4, 10, 4, 5, 8, 10, 8);     // spray
  g.outline();
  return g;
};

BUILD.orchard = () => {
  const g = new Grid(B_W, B_H);
  g.rect(1, 1, 14, 14, 'l');
  for (const y of [1, 8]) for (const x of [1, 8]) {
    g.rect(x + 1, y + 1, x + 5, y + 3, 'g').hl(x + 2, x + 4, y, 'g').hl(x + 1, x + 5, y + 4, 'G');
    g.pts('r', x + 2, y + 1, x + 4, y + 3);                     // apples
    g.vl(x + 3, y + 5, y + 6, 'b');                             // trunk
  }
  g.outline();
  return g;
};

BUILD.site = () => {
  const g = new Grid(B_W, B_H);
  g.rect(1, 11, 14, 14, 't');                                   // dirt (the progress bar sits here)
  g.rect(4, 5, 11, 10, 's').hl(4, 11, 7, 't').hl(4, 11, 9, 't'); // wall going up
  g.vl(2, 2, 10, 'y').vl(13, 2, 10, 'y').hl(2, 13, 2, 'y').hl(2, 13, 6, 'y');   // scaffolding
  g.outline();
  return g;
};

const BUILDING_IDS = [...Object.keys(BUILDINGS), 'site'];


// Small corner badges for the gentle hints (open job / room to rent).
const HINT_JOB = [
  '.kkk.',
  'kyyyk',
  'kyyyk',
  'kyyyk',
  '.kkk.',
];
const HINT_STOCK = [
  '.kkkkk.',
  'kwwwwwk',
  'kwooowk',
  'kwotowk',
  'kwooowk',
  'kwwwwwk',
  '.kkkkk.',
];
const HINT_TROUBLE = [
  '.kkkkk.',
  'krrwrrk',
  'krrwrrk',
  'krrwrrk',
  'krrrrrk',
  'krrwrrk',
  '.kkkkk.',
];
const HINT_HOME = [
  '.kkk.',
  'kwgwk',
  'kgggk',
  'kwgwk',
  '.kkk.',
];

// ---------------------------------------------------------------- 3d. taxi

const TAXI_E = [
  '.....kkkkkk...',
  '....kyyyyyyk..',
  '...kyCckCccyk.',
  '.kkyyCckCccyyk',
  'kyyyyyyyyyyyyk',
  'kykwkwkwkwkwYk',
  'kryyyyyyyyyyyk',
  'kkAAkkkkkkAAkk',
  '.kAAk....kAAk.',
  '..kk......kk..',
];

const TAXI_N = [
  '..kkkkkk..',
  '.kyyyyyyk.',
  'kyyyyyyyyk',
  'AyCCCCCCyA',
  'AyCccccCyA',
  'kyyyyyyyyk',
  'kyykwkwyyk',
  'kyywkwkyyk',
  'kyyyyyyyyk',
  'AyccccccyA',
  'AyyyyyyyyA',
  'kryyyyyyrk',
  '.kkkkkkkk.',
  '..........',
];

const TAXI_S = [
  '..kkkkkk..',
  '.kyyyyyyk.',
  'kyyyyyyyyk',
  'AyccccccyA',
  'AyyyyyyyyA',
  'kyykwkwyyk',
  'kyywkwkyyk',
  'kyyyyyyyyk',
  'AyCCCCCCyA',
  'AyCccccCyA',
  'kyyyyyyyyk',
  'kYyyyyyyYk',
  '.kkkkkkkk.',
  '..........',
];

// ---------------------------------------------------------------- 3e. icons (10x10)

const ICONS = {
  coin: [
    '..kkkkkk..',
    '.kyyyyyyk.',
    'kyYYyyyyOk',
    'kyYyOOyyOk',
    'kyYyOyyyOk',
    'kyyyOyyyOk',
    'kyyyOOyyOk',
    'kyyyyyyOOk',
    '.kOOOOOOk.',
    '..kkkkkk..',
  ],
  gem: [
    '..........',
    '..kkkkkk..',
    '.kCCccuuk.',
    'kCcccuuuUk',
    'kcccuuuUUk',
    '.kccuuUUk.',
    '..kcuuUk..',
    '...kuUk...',
    '....kk....',
    '..........',
  ],
  box: [
    '..........',
    '.kkkkkkkk.',
    'kssswwsstk',
    'kkkkkkkkkk',
    'ktttwwttbk',
    'ktttttttbk',
    'ktttttttbk',
    'ktttttttbk',
    'kbbbbbbbbk',
    '.kkkkkkkk.',
  ],
  taxi: [
    '....kk....',
    '..kkyykk..',
    '.kyyyyyyk.',
    '.kyCCCCyk.',
    'kkyCcccykk',
    'kyyyyyyyyk',
    'kYykwkwyYk',
    'kyyyyyyyyk',
    'kkAkkkkAkk',
    '.kk....kk.',
  ],
  star: [
    '....kk....',
    '...kYyk...',
    '...kYyk...',
    'kkkyYyykkk',
    'kYYYyyyyOk',
    '.kyyyyyOk.',
    '..kyyyyk..',
    '.kyyyOyyk.',
    '.kyOkkOyk.',
    '.kkk..kkk.',
  ],
  key: [
    '..........',
    '.kkkk.....',
    'kyYYyk....',
    'kYkkyykkkk',
    'kYk.kyyyyk',
    'kykkyOkyky',
    'kyyyyOkkkk',
    '.kOOOk....',
    '..kkk.....',
    '..........',
  ],
  hammer: [
    '..........',
    '.kkkkkkkk.',
    'kEeeeeeeAk',
    'keeeeeeAAk',
    '.kkktbkkk.',
    '...ktbk...',
    '...ktbk...',
    '...ktbk...',
    '...ktbk...',
    '...kkkk...',
  ],
  heart: [
    '..........',
    '.kkk..kkk.',
    'kIrrkkrrrk',
    'kIrrrrrrRk',
    'krrrrrrrRk',
    '.krrrrrRk.',
    '..krrrRk..',
    '...krRk...',
    '....kk....',
    '..........',
  ],
  person: [
    '...kkkk...',
    '..kBBBBk..',
    '..kB11Bk..',
    '..k1111k..',
    '...k11k...',
    '.kkkkkkkk.',
    'kuuuuuuuUk',
    'kuuuuuuuUk',
    'kuuuuuuuUk',
    'kkkkkkkkkk',
  ],
  briefcase: [
    '..........',
    '...kkkk...',
    '..kk..kk..',
    '.kkkkkkkk.',
    'kbbbbbbbBk',
    'kbbbbbbbBk',
    'kkkkyykkkk',
    'kbbbyybbBk',
    'kBBBBBBBBk',
    '.kkkkkkkk.',
  ],
  cat_food: [
    '..........',
    '..kkkkkk..',
    '.koYooYok.',
    'kooooYoooO',
    'kglgglgglk',
    'kBBBBBBBBk',
    'kyryyryyrk',
    'kooooooook',
    '.kOOOOOOk.',
    '..kkkkkk..',
  ],
  cat_retail: [
    '...kkkk...',
    '..kk..kk..',
    '.kkkkkkkk.',
    'kuuuuuuuUk',
    'kucuuuuuUk',
    'kucuwwuuUk',
    'kuuuwwuuUk',
    'kuuuuuuuUk',
    'kUUUUUUUUk',
    '.kkkkkkkk.',
  ],
  cat_service: [
    '..........',
    '....kk....',
    '...kvvk...',
    '..kkkkkk..',
    '.kvIvvvVk.',
    'kvIvvvvvVk',
    'kvvvvvvvVk',
    'kkkkkkkkkk',
    'keeeeeeeAk',
    'kkkkkkkkkk',
  ],
  cat_farming: [
    '..........',
    '.kk....kk.',
    'kglk..kglk',
    'kgglkkgggk',
    '.kggggggk.',
    '..kkgGkk..',
    '...kgGk...',
    '..kkgGkk..',
    '.kbbbbbBk.',
    '..kkkkkk..',
  ],
  cat_creative: [
    '..kkkkkk..',
    '.kiIiiiik.',
    'kiiwiiyiik',
    'kiiiiiiiik',
    'kiuiiikkik',
    'kiiiiik.kk',
    'kiigiiikik',
    '.kiiiiiRk.',
    '..kkkkkk..',
    '..........',
  ],
};

const BUBBLE = [
  '..kkkkkkkkkkkk..',
  '.kwwwwwwwwwwwwk.',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwwpk',
  'kwwwwwwwwwwwwppk',
  '.kpppppwwpppppk.',
  '..kkkkkwwkkkkk..',
  '......kwpk......',
  '.......kk.......',
  '................',
];

// ---------------------------------------------------------------- 3f. people (8x12)

// H hair, S skin, e eye, T shirt, P pants, F shoes. Rows 0 and 11 and columns 0 and 7 are left for the outline.
const HAIR_STYLES = [
  // 0 short
  ['..HHHH..', '.HHHHHH.', '.HSSSSH.', '.SeSSeS.'],
  // 1 long (falls onto the shoulders)
  ['..HHHH..', '.HHHHHH.', '.HSSSSH.', '.HeSSeH.'],
  // 2 buzz cut / high forehead
  ['..HHHH..', '.SSSSSS.', '.SSSSSS.', '.SeSSeS.'],
  // 3 side-swept fringe
  ['..HHHH..', '.HHHHHH.', '.HHHSSS.', '.HeSSeS.'],
];
const BODY = [
  ['..TTTT..', '.STTTTS.', '..TTTT..', '..PPPP..', '..P..P..', '..F..F..'],
  ['.STTTTS.', '..TTTT..', '..TTTT..', '..PPPP..', '...PP...', '...FF...'],
];
const SKIN_KEYS = ['0', '1', '2', '3', '4'];
const HAIR_KEYS = ['K', 'B', 'y', 'O', 'e', 'R'];          // dark, brown, blond, ginger, silver, auburn
const SHIRT_KEYS = ['r', 'u', 'g', 'y', 'v', 'i', 'o', 'c'];

function clampInt(v, n) {
  v = Number.isFinite(v) ? Math.floor(v) : 0;
  return ((v % n) + n) % n;
}
function normLook(look) {
  look = look || {};
  return {
    skin: clampInt(look.skin, SKIN_KEYS.length),
    hair: clampInt(look.hair, HAIR_KEYS.length),
    hairStyle: clampInt(look.hairStyle, HAIR_STYLES.length),
    shirt: clampInt(look.shirt, SHIRT_KEYS.length),
  };
}
function lookKey(look, frame) {
  const l = normLook(look);
  return l.skin + '-' + l.hair + '-' + l.hairStyle + '-' + l.shirt + '-' + (frame ? 1 : 0);
}

function personGrid(look, frame) {
  const l = normLook(look);
  const map = { H: HAIR_KEYS[l.hair], S: SKIN_KEYS[l.skin], e: 'k', T: SHIRT_KEYS[l.shirt], P: 'U', F: 'B', '.': '.' };
  const rows = ['........', ...HAIR_STYLES[l.hairStyle], ...BODY[frame ? 1 : 0], '........'];
  if (l.hairStyle === 1) {
    // long hair drapes over the shoulders
    rows[5] = frame ? '.HTTTTH.' : '.HTTTTH.';
  }
  const g = Grid.from(rows.map((r) => r.split('').map((c) => map[c]).join('')));
  g.outline();
  return g;
}

// ---------------------------------------------------------------- 4. core (no DOM)

const GRIDS = new Map();
function def(id, make) { GRIDS.set(id, make); }

def('grass0', () => grassTile(0));
def('grass1', () => grassTile(1));
def('grass2', () => grassTile(2));
for (let m = 0; m < 16; m++) def('road' + m, () => roadTile(m));
for (const id of BUILDING_IDS) def(id, BUILD[id]);
for (const [id, make] of SHOP_SPRITES) def(id, make);
def('lot', lotTile);
def('pip', () => new Grid(7, 7).stamp(1, 1, ['..y..', 'yyyyy', '.yYy.', 'yy.yy', '.....']).outline());
def('plaza', plazaTile);
def('sand', sandTile);
def('lot_sand', lotSandTile);
def('sign', signTile);
def('mountain', mountainTile);
def('tree', treeTile);
for (let m = 0; m < 16; m++) def('water' + m, () => waterTile(m));
def('taxi_e', () => Grid.from(TAXI_E));
def('taxi_w', () => Grid.from(TAXI_E).flipH());
def('taxi_n', () => Grid.from(TAXI_N));
def('taxi_s', () => Grid.from(TAXI_S));
for (const id of Object.keys(ICONS)) def(id, () => Grid.from(ICONS[id]));
def('bubble', () => Grid.from(BUBBLE));
def('hint_job', () => Grid.from(HINT_JOB));
def('hint_home', () => Grid.from(HINT_HOME));
def('hint_stock', () => Grid.from(HINT_STOCK));
def('hint_trouble', () => Grid.from(HINT_TROUBLE));

/** Every sprite id this module can draw. */
export const SPRITE_IDS = Array.from(GRIDS.keys());

export function buildingSpriteId(b) {
  const variant = `${b.type}@${b.cat}`;
  return b.cat && GRIDS.has(variant) ? variant : b.type;
}

const pixelCache = new Map();

function placeholderPixels() {
  const w = 16, h = 16;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const on = ((x >> 2) + (y >> 2)) % 2 === 0;
    data[i] = on ? 255 : 60; data[i + 1] = 0; data[i + 2] = on ? 255 : 60; data[i + 3] = 255;
  }
  return { w, h, data };
}

/** Raw pixels for a sprite id: { w, h, data: Uint8ClampedArray (RGBA) }. Unknown ids give a magenta checker. */
export function spritePixels(id) {
  let p = pixelCache.get(id);
  if (!p) {
    const make = GRIDS.get(id);
    p = make ? make().toPixels() : placeholderPixels();
    pixelCache.set(id, p);
  }
  return p;
}

/** Raw pixels for a person: 8x12, frame 0|1. */
export function personPixels(look, frame = 0) {
  const key = 'person:' + lookKey(look, frame);
  let p = pixelCache.get(key);
  if (!p) {
    p = personGrid(look, frame).toPixels();
    pixelCache.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------- 5. canvas wrappers (browser only)

const canvasCache = new Map();
const urlCache = new Map();
let inited = false;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function pixelsToCanvas(p) {
  const c = makeCanvas(p.w, p.h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(p.w, p.h);
  img.data.set(p.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

function scaledURL(src, scale) {
  scale = Math.max(1, Math.round(scale || 1));
  const c = makeCanvas(src.width * scale, src.height * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/** Build every sprite canvas once. Safe to call more than once. */
export function initSprites() {
  if (inited) return;
  inited = true;
  for (const id of SPRITE_IDS) canvasCache.set(id, pixelsToCanvas(spritePixels(id)));
}

/** 1x canvas for a sprite id (magenta checker placeholder for unknown ids). */
export function getSprite(id) {
  let c = canvasCache.get(id);
  if (!c) {
    c = pixelsToCanvas(spritePixels(id));
    canvasCache.set(id, c);
  }
  return c;
}

/** PNG data URL of a sprite, nearest-neighbour scaled. Cached. */
export function spriteURL(id, scale = 2) {
  const key = id + '@' + scale;
  let u = urlCache.get(key);
  if (!u) {
    u = scaledURL(getSprite(id), scale);
    urlCache.set(key, u);
  }
  return u;
}

/** 8x12 canvas of a person. look = { skin, hair, hairStyle, shirt }, frame 0|1. */
export function getPerson(look, frame = 0) {
  const key = 'person:' + lookKey(look, frame);
  let c = canvasCache.get(key);
  if (!c) {
    c = pixelsToCanvas(personPixels(look, frame));
    canvasCache.set(key, c);
  }
  return c;
}

/** PNG data URL of a person (standing frame), nearest-neighbour scaled. Cached. */
export function personURL(look, scale = 3) {
  const key = 'person:' + lookKey(look, 0) + '@' + scale;
  let u = urlCache.get(key);
  if (!u) {
    u = scaledURL(getPerson(look, 0), scale);
    urlCache.set(key, u);
  }
  return u;
}
