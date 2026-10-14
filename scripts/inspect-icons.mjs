#!/usr/bin/env node
// Design aid: renders icons as a review sheet (default inspect.png, git-ignored) with, per icon:
//   1. the true 15px @1x rasterisation, enlarged 10x with nearest-neighbour (shows blur / halos)
//   2. the vector at 150px over the 15x15 pixel grid (shows alignment)
//   3. the icon at real 15px and 30px
//
// Usage: node scripts/inspect-icons.mjs [name ...] [--out inspect.png]

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const out = path.resolve(root, outIdx >= 0 ? argv.splice(outIdx, 2)[1] : 'inspect.png');
const names = argv;

let files = (await readdir(path.join(root, 'icons'))).filter((f) => f.endsWith('.svg')).sort();
if (names.length) files = files.filter((f) => names.includes(f.replace(/\.svg$/, '')));
if (!files.length) throw new Error(`no icons match: ${names.join(', ')}`);
const icons = await Promise.all(
  files.map(async (f) => ({ name: f.replace(/\.svg$/, ''), svg: await readFile(path.join(root, 'icons', f), 'utf8') })),
);
const sized = (svg, px) => svg.replace(/width="15"/, `width="${px}"`).replace(/height="15"/, `height="${px}"`);

const browser = await chromium.launch();
try {
  // 1. rasterise each icon at exactly 15x15 device pixels
  const raster = await browser.newPage({ deviceScaleFactor: 1 });
  await raster.setContent(
    `<body style="margin:0;background:#fff"><style>svg{display:block}</style>${icons
      .map((i) => `<div style="width:15px;height:15px;color:#000">${i.svg}</div>`)
      .join('')}</body>`,
  );
  const shots = [];
  for (let k = 0; k < icons.length; k++) {
    shots.push((await raster.locator('body > div').nth(k).screenshot()).toString('base64'));
  }

  // 2. compose the review sheet
  const grid = Array.from({ length: 16 }, (_, i) => `<line x1="${i}" y1="0" x2="${i}" y2="15"/><line x1="0" y1="${i}" x2="15" y2="${i}"/>`).join('');
  const cells = icons
    .map(
      (i, k) => `<div><div class="name">${i.name}</div><div class="row">
        <img src="data:image/png;base64,${shots[k]}">
        <div class="vec">${sized(i.svg, 150)}<svg class="grid" width="150" height="150" viewBox="0 0 15 15">${grid}</svg></div>
        <div class="real">${i.svg}${sized(i.svg, 30)}</div></div></div>`,
    )
    .join('');
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1400, height: 800 } });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; background: #fff; font: 12px monospace; }
    #s { display: inline-grid; grid-template-columns: repeat(${Math.min(4, icons.length)}, 330px); gap: 12px; padding: 12px; }
    .row { display: flex; gap: 6px; align-items: flex-end; margin-top: 4px; }
    img { width: 150px; height: 150px; image-rendering: pixelated; outline: 1px solid #ccc; }
    .vec { position: relative; width: 150px; height: 150px; outline: 1px solid #ccc; }
    .vec svg { display: block; }
    .grid { position: absolute; inset: 0; stroke: #f0a; stroke-width: .03; opacity: .5; }
    .real { display: flex; flex-direction: column; gap: 6px; }
  </style><div id="s">${cells}</div>`);
  await page.locator('#s').screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(`Inspected ${icons.length} icon(s) -> ${path.relative(root, out)}`);
