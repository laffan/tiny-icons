#!/usr/bin/env node
// Renders every icon in ./icons into a three-column preview grid (preview.png),
// showing each icon at 15x15 and 30x30 next to its name.
//
// Usage: node scripts/render-preview.mjs [--out preview.png] [--scale 2]
//   --scale  device pixel ratio of the PNG (2 = crisp on retina; 1 = true pixels)

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/)),
);
const out = path.resolve(root, args.out ?? 'preview.png');
const scale = Number(args.scale ?? 2);
const COLUMNS = 3;

const files = (await readdir(path.join(root, 'icons'))).filter((f) => f.endsWith('.svg')).sort();
const icons = await Promise.all(
  files.map(async (f) => ({
    name: f.replace(/\.svg$/, ''),
    svg: (await readFile(path.join(root, 'icons', f), 'utf8')).trim(),
  })),
);

const sized = (svg, px) => svg.replace(/\swidth="[^"]*"/, ` width="${px}"`).replace(/\sheight="[^"]*"/, ` height="${px}"`);

const cells = icons
  .map(
    ({ name, svg }) => `
    <div class="cell">
      <div class="i15">${sized(svg, 15)}</div>
      <div class="i30">${sized(svg, 30)}</div>
      <span>${name}</span>
    </div>`,
  )
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #fff; font: 13px/1 ui-monospace, "DejaVu Sans Mono", Menlo, monospace; color: #1f2328; }
  #sheet { display: inline-block; padding: 24px 28px; background: #fff; }
  h1 { font-size: 13px; font-weight: 600; margin-bottom: 18px; color: #59636e; }
  .grid { display: grid; grid-template-columns: repeat(${COLUMNS}, 230px); column-gap: 16px; }
  .cell { display: flex; align-items: center; gap: 14px; height: 46px; border-bottom: 1px solid #eef0f2; }
  .i15, .i30 { display: flex; align-items: center; justify-content: center; color: #1f2328; }
  .i15 { width: 15px; } .i30 { width: 30px; }
  svg { display: block; }
  span { color: #424a53; }
</style></head><body><div id="sheet">
  <h1>tiny-icons · ${icons.length} icons · 15px / 30px</h1>
  <div class="grid">${cells}</div>
</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 1000, height: 800 } });
  await page.setContent(html);
  await page.locator('#sheet').screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(`Rendered ${icons.length} icons -> ${path.relative(root, out)} (@${scale}x)`);
