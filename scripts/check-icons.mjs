#!/usr/bin/env node
// Lints every icon in ./icons against the house style (see README "Guide for agents").
// Static checks: root attributes, allowed elements, no fills, no Z-closed paths, no <rect>.
// Geometry check (Chromium): painted extent (geometry + half the stroke) must stay inside
// the 15x15 canvas; anything outside the 1px safe margin is reported as a warning.
//
// Usage: node scripts/check-icons.mjs        exit code 1 on any error

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_ATTRS = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: '15',
  height: '15',
  viewBox: '0 0 15 15',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};
const ALLOWED = new Set(['path', 'circle', 'ellipse', 'line', 'polyline']);
const CHILD_ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'transform']);

const errors = [];
const warnings = [];
const files = (await readdir(path.join(root, 'icons'))).filter((f) => f.endsWith('.svg')).sort();
const icons = [];

for (const file of files) {
  const name = file.replace(/\.svg$/, '');
  const svg = await readFile(path.join(root, 'icons', file), 'utf8');
  icons.push({ name, svg });
  const err = (msg) => errors.push(`${file}: ${msg}`);

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) err('file name must be kebab-case');
  const open = svg.match(/<svg\b([^>]*)>/);
  if (!open) { err('no <svg> root'); continue; }
  const attrs = Object.fromEntries([...open[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  for (const [k, v] of Object.entries(ROOT_ATTRS)) if (attrs[k] !== v) err(`root ${k}="${attrs[k]}" (expected "${v}")`);
  for (const k of Object.keys(attrs)) if (!(k in ROOT_ATTRS)) err(`unexpected root attribute ${k}`);

  for (const [, tag, rest] of svg.replace(/<svg\b[^>]*>|<\/svg>/g, '').matchAll(/<(\w+)\b([^>]*)>/g)) {
    if (!ALLOWED.has(tag)) err(`<${tag}> not allowed (use ${[...ALLOWED].join(', ')})`);
    for (const [, k, v] of rest.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (!CHILD_ATTRS.has(k)) err(`<${tag}> has disallowed attribute ${k} (style lives on the root)`);
      if (k === 'd' && /[Zz]/.test(v)) err('path uses Z/z; end the subpath on its start point instead');
      if (k === 'transform' && !/^rotate\([^)]*\)$/.test(v)) err('only rotate(...) transforms are allowed');
    }
  }
}

// Geometry: measure each icon at 10x so sub-pixel extents are visible.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(
    `<body style="margin:0">${icons
      .map(({ name, svg }) => `<div data-name="${name}" style="width:150px;height:150px">${svg.replace(/width="15"/, 'width="150"').replace(/height="15"/, 'height="150"')}</div>`)
      .join('')}</body>`,
  );
  const extents = await page.evaluate(() =>
    [...document.querySelectorAll('div[data-name]')].map((div) => {
      const svg = div.querySelector('svg');
      const o = svg.getBoundingClientRect();
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const el of svg.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        x0 = Math.min(x0, (r.left - o.left) / 10);
        y0 = Math.min(y0, (r.top - o.top) / 10);
        x1 = Math.max(x1, (r.right - o.left) / 10);
        y1 = Math.max(y1, (r.bottom - o.top) / 10);
      }
      // add half the stroke width to get the painted extent
      return { name: div.dataset.name, box: [x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5] };
    }),
  );
  const eps = 0.05;
  for (const { name, box } of extents) {
    const [x0, y0, x1, y1] = box.map((v) => Math.round(v * 100) / 100);
    const where = `painted extent ${x0},${y0} → ${x1},${y1}`;
    if (x0 < -eps || y0 < -eps || x1 > 15 + eps || y1 > 15 + eps) errors.push(`${name}.svg: ${where} leaves the 15x15 canvas`);
    else if (x0 < 1 - eps || y0 < 1 - eps || x1 > 14 + eps || y1 > 14 + eps) warnings.push(`${name}.svg: ${where} enters the 1px margin`);
  }
} finally {
  await browser.close();
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(`${icons.length} icons checked: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
