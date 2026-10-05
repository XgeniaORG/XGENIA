// Regenerates cascade-the-reels.goldens.json. Run from packages/xgenia-runtime:
//   node test/slot-features/cascade-the-reels.goldens.gen.js
//
// (2026-10-04) The refill rule changed from "one LCG stream seeded by Seeds[0]" to "cell k in refill
// order takes Seeds[k], scaled as base[floor(v * n / 1e12)]" (certification: every outcome straight
// from the certified RNG). The 30 boards, cleared positions, weights and refillFrom are kept from the
// recorded set; only `seeds` (now one ISAAC value per cell, rows x columns of them, as a correctly
// sized ISAAC node gives) and `out` are new. `out` comes from the plain reference below, written from
// the rule and NOT from either shipped copy, so the test checks the editor node and the RGS core
// against the rule rather than against each other. Seeds alternate between the two shapes ISAAC
// produces: editor integers floor(x / 2^32 * 1e12) and RGS floats x / 2^32 * 1e12 (unfloored).
// Deterministic: running it twice writes the same file.
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'cascade-the-reels.goldens.json');
const SEED_RANGE = 1e12;

/** The cells a pass clears: valid [row, col] / {row, col} positions, de-duplicated. */
function clearedCells(reels, winningLinesDetails) {
  const cols = reels.length;
  const rows = reels[0].length;
  const clear = new Set();
  for (const item of winningLinesDetails) {
    for (const p of item.positions || []) {
      const [row, col] = Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.row), Number(p.col)];
      if (Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < rows && col < cols) clear.add(col + ':' + row);
    }
  }
  return clear;
}

/** The rule, as plainly as it can be written. */
function reference({ reels, winningLinesDetails, symbolWeights, seeds, refillFrom }) {
  const rows = reels[0].length;
  const clear = clearedCells(reels, winningLinesDetails);
  const base = [];
  if (symbolWeights.length && symbolWeights.every((w) => typeof w === 'number' && w > 0)) {
    const min = Math.min(...symbolWeights);
    symbolWeights.forEach((w, i) => { for (let r = 0; r < Math.ceil(w / min); r++) base.push(i + 1); });
  } else {
    for (const col of reels) for (const s of col) if (typeof s === 'number' && s > 0 && !base.includes(s)) base.push(s);
  }
  if (seeds.length < clear.size) throw new Error('golden needs ' + clear.size + ' seeds, has ' + seeds.length);
  let k = 0;
  return reels.map((col, c) => {
    const kept = col.filter((_, r) => !clear.has(c + ':' + r));
    const fill = [];
    while (kept.length + fill.length < rows) {
      const v = seeds[k++];
      fill.push(base[Math.min(base.length - 1, Math.floor((v * base.length) / SEED_RANGE))]);
    }
    return refillFrom === 'bottom' ? kept.concat(fill) : fill.concat(kept);
  });
}

function xorshift32(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
}

const goldens = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const out = goldens.map((g, i) => {
  const { reels, winningLinesDetails } = g.in;
  const next = xorshift32(0x5eed0000 + i);
  const asFloat = i % 4 === 0; // the RGS shape on every 4th board, the editor's integers elsewhere
  let seeds = Array.from({ length: reels.length * reels[0].length }, () => {
    const u = next() / 4294967296;
    return asFloat ? u * SEED_RANGE : Math.floor(u * SEED_RANGE);
  });
  if (i === 1) seeds[0] = 0; // the bottom edge of the range
  if (i === 2) seeds[0] = SEED_RANGE - 1; // the top edge: must map to the last symbol, never past it
  // exactly as many values as cells to refill: enough, nothing spare
  if (i === 5 || i === 9) seeds = seeds.slice(0, clearedCells(reels, winningLinesDetails).size);
  const input = { ...g.in, seeds };
  return { in: input, out: reference(input) };
});

fs.writeFileSync(FILE, JSON.stringify(out));
console.log('wrote ' + out.length + ' goldens to ' + path.relative(process.cwd(), FILE));
