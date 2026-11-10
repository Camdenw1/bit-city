// Renders tools/preview.png (contact sheet, 6x), tools/scene.png (mock town, 4x) and the app icons.
// Run: node tools/preview-sprites.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { PALETTE, SPRITE_IDS, spritePixels, personPixels } from '../js/sprites.js';

const require = createRequire('/opt/npm-tools/node_modules/');
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

function canvas(w, h, hex) {
  const data = new Uint8ClampedArray(w * h * 4);
  const [r, g, b] = rgb(hex);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
  return { w, h, data };
}
function blit(dst, src, x0, y0, scale = 1) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const si = (y * src.w + x) * 4;
    if (src.data[si + 3] === 0) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const X = x0 + x * scale + dx, Y = y0 + y * scale + dy;
      if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
      const di = (Y * dst.w + X) * 4;
      dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]; dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = 255;
    }
  }
}
function upscale(src, s) {
  const out = { w: src.w * s, h: src.h * s, data: new Uint8ClampedArray(src.w * s * src.h * s * 4) };
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const si = ((Math.floor(y / s)) * src.w + Math.floor(x / s)) * 4, di = (y * out.w + x) * 4;
    out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
  }
  return out;
}
async function writePng(img, file) {
  await sharp(Buffer.from(img.data.buffer), { raw: { width: img.w, height: img.h, channels: 4 } }).removeAlpha().png().toFile(file);
  console.log('wrote', path.relative(root, file), img.w + 'x' + img.h);
}

// ------------------------------------------------------------ contact sheet (1x layout, then 6x)
{
  const groups = [
    ['tent', 'cabin', 'apartment', 'house', 'site', 'lot'],
    ['diner', 'bakery', 'market', 'bookshop', 'well'],
    ['barber', 'farm', 'orchard', 'studio', 'music'],
    ['grass0', 'grass1', 'grass2', 'road0', 'road1', 'road2', 'road3', 'road4'],
    ['road5', 'road6', 'road7', 'road8', 'road9', 'road10', 'road11', 'road12'],
    ['road13', 'road14', 'road15', 'taxi_e', 'taxi_w', 'taxi_n', 'taxi_s', 'bubble'],
    ['coin', 'gem', 'box', 'taxi', 'star', 'key', 'hammer', 'heart', 'person', 'briefcase'],
    ['cat_food', 'cat_retail', 'cat_service', 'cat_farming', 'cat_creative'],
  ];
  const listed = new Set(groups.flat());
  const missing = SPRITE_IDS.filter((id) => !listed.has(id));
  if (missing.length) groups.push(missing);
  const pad = 4;
  let W = 0, H = pad;
  const rowsH = groups.map((ids) => Math.max(...ids.map((id) => spritePixels(id).h)));
  groups.forEach((ids, i) => {
    W = Math.max(W, pad + ids.reduce((a, id) => a + spritePixels(id).w + pad, 0));
    H += rowsH[i] + pad;
  });
  const peopleRows = 4;
  H += peopleRows * (12 + pad);
  W = Math.max(W, pad + 16 * (8 + 3));
  const sheet = canvas(W, H, PALETTE.grass);
  let y = pad;
  groups.forEach((ids, i) => {
    let x = pad;
    for (const id of ids) {
      const p = spritePixels(id);
      blit(sheet, p, x, y + rowsH[i] - p.h);
      x += p.w + pad;
    }
    y += rowsH[i] + pad;
  });
  // people: every hairstyle x skin, varied hair/shirt, both frames
  let n = 0;
  for (let r = 0; r < peopleRows; r++) {
    for (let c = 0; c < 16; c++) {
      const look = { skin: (c >> 1) % 5, hair: (n >> 1) % 6, hairStyle: r, shirt: (c >> 1) % 8 };
      blit(sheet, personPixels(look, c % 2), pad + c * 11, y);
      n++;
    }
    y += 12 + pad;
  }
  await writePng(upscale(sheet, 6), path.join(here, 'preview.png'));
}

// ------------------------------------------------------------ mock town scene (4x)
{
  const MW = 11, MH = 9, T = 16;
  const isRoad = (x, y) => x % 4 === 3 || y % 3 === 2;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < 14;
  const scene = canvas(MW * T, MH * T, PALETTE.grass);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (isRoad(x, y)) {
      const r = (xx, yy) => (inMap(xx, yy) && isRoad(xx, yy) ? 1 : 0);
      const mask = r(x, y - 1) * 1 + r(x + 1, y) * 2 + r(x, y + 1) * 4 + r(x - 1, y) * 8;
      blit(scene, spritePixels('road' + mask), x * T, y * T);
    } else {
      blit(scene, spritePixels('grass' + ((x * 7 + y * 13) % 3)), x * T, y * T);
    }
  }
  const town = {
    '0,0': 'house', '1,0': 'apartment', '2,0': 'cabin', '4,0': 'diner', '5,0': 'bakery', '6,0': 'lot', '8,0': 'well', '9,0': 'barber', '10,0': 'tent',
    '0,1': 'tent', '1,1': 'cabin', '2,1': 'lot', '4,1': 'market', '5,1': 'bookshop', '6,1': 'house', '8,1': 'farm', '9,1': 'orchard', '10,1': 'farm',
    '0,3': 'studio', '1,3': 'music', '2,3': 'site', '4,3': 'apartment', '5,3': 'apartment', '6,3': 'house', '8,3': 'orchard', '9,3': 'lot', '10,3': 'well',
    '0,4': 'bakery', '1,4': 'diner', '2,4': 'barber', '4,4': 'tent', '5,4': 'lot', '6,4': 'cabin', '8,4': 'bookshop', '9,4': 'market', '10,4': 'studio',
    '0,6': 'farm', '1,6': 'farm', '2,6': 'orchard', '4,6': 'music', '5,6': 'house', '6,6': 'diner', '8,6': 'site', '9,6': 'cabin', '10,6': 'apartment',
    '0,7': 'well', '1,7': 'house', '2,7': 'market', '4,7': 'barber', '5,7': 'studio', '6,7': 'bakery', '8,7': 'tent', '9,7': 'lot', '10,7': 'music',
  };
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const id = town[x + ',' + y];
    if (!id) continue;
    const p = spritePixels(id);
    blit(scene, p, x * T, y * T + T - p.h);
  }
  // people on roads
  const people = [[10, 37], [30, 35], [52, 30], [70, 84], [100, 82], [140, 36], [118, 60], [54, 100], [150, 84], [20, 132], [90, 130], [118, 20], [160, 131]];
  people.forEach(([px, py], i) => {
    blit(scene, personPixels({ skin: i % 5, hair: i % 6, hairStyle: i % 4, shirt: i % 8 }, i % 2), px, py - 2);
  });
  // taxis
  blit(scene, spritePixels('taxi_e'), 72, 35);
  blit(scene, spritePixels('taxi_w'), 132, 133);
  blit(scene, spritePixels('taxi_n'), 51, 60);
  blit(scene, spritePixels('taxi_s'), 115, 104);
  // bubbles
  const bubbles = [[4, 0, 'box'], [0, 1, 'key'], [1, 3, 'briefcase'], [6, 3, 'taxi'], [9, 4, 'star'], [5, 6, 'heart'], [8, 1, 'coin'], [2, 4, 'gem']];
  for (const [bx, by, icon] of bubbles) {
    const id = town[bx + ',' + by];
    const tall = ['tent', 'farm', 'orchard'].includes(id) ? 4 : 12;
    const X = bx * T, Y = by * T - tall - 4;
    blit(scene, spritePixels('bubble'), X, Y);
    blit(scene, spritePixels(icon), X + 3, Y + 1);
  }
  await writePng(upscale(scene, 4), path.join(here, 'scene.png'));
}

// ------------------------------------------------------------ app icons
{
  fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
  // art canvas N px, shown at `scale`; sprites inside are drawn at 2x art px
  const makeIcon = (N, scale) => {
    const art = canvas(N, N, PALETTE.sky);
    const ground = N - Math.round(N * 0.2);
    // grass band + lighter rim
    const grass = rgb(PALETTE.grass), rim = rgb(PALETTE.leafLight);
    for (let y = ground; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4, c = y < ground + 2 ? rim : grass;
      art.data[i] = c[0]; art.data[i + 1] = c[1]; art.data[i + 2] = c[2];
    }
    // clouds
    const cloud = (cx, cy) => {
      const w = rgb(PALETTE.white);
      for (const [dx, dy, len] of [[2, 0, 6], [0, 1, 11], [0, 2, 11], [1, 3, 8]]) for (let k = 0; k < len; k++) {
        const i = ((cy + dy) * N + cx + dx + k) * 4;
        art.data[i] = w[0]; art.data[i + 1] = w[1]; art.data[i + 2] = w[2];
      }
    };
    cloud(Math.round(N * 0.12), Math.round(N * 0.16));
    cloud(Math.round(N * 0.66), Math.round(N * 0.1));
    const house = spritePixels('house');
    const total = 32 + 2 + 16;
    const x0 = Math.round((N - total) / 2);
    blit(art, house, x0, ground + 4 - 48, 2);
    blit(art, personPixels({ skin: 1, hair: 1, hairStyle: 0, shirt: 1 }, 0), x0 + 34, ground + 6 - 24, 2);
    return upscale(art, scale);
  };
  await writePng(makeIcon(60, 3), path.join(root, 'icons', 'icon-180.png'));
  await writePng(makeIcon(64, 3), path.join(root, 'icons', 'icon-192.png'));
  await writePng(makeIcon(64, 8), path.join(root, 'icons', 'icon-512.png'));
}
