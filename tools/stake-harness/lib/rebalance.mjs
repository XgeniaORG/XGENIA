/**
 * Put a mode's RTP exactly on target by reweighting its lookup table — the books are untouched.
 *
 * ── WHY (2026-11-09) ──────────────────────────────────────────────────────────────────────────────
 * An XGENIA export writes every weight as 1, so the RTP Stake pays is the sample mean of the books:
 * it lands wherever the simulation happened to land, and Stake's verifier wants 96.0–96.7 % on every
 * mode and every mode within 0.5 % of base. Stake's math-sdk solves this with an optimiser over the
 * weights; this is the smallest honest version of that idea.
 *
 * Two weights: books paying below the target mean get weight wL, the rest wH, solved so the
 * weighted mean is exactly the target:
 *     T = rtp × 100 × cost
 *     wL = wH × (ΣH − T·nH) / (T·nL − ΣL)
 * It needs at least one book on each side of T. It CHANGES the hit rate and the feature frequency
 * (both are re-reported by the validator) — that is the price of moving RTP with weights alone. A
 * real optimiser shapes those too; this one only refuses to guess.
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadPackage, writeLookupTable } from './package.mjs';

export function rebalanceRows(rows, cost, rtp) {
  const T = rtp * 100 * cost;
  let sumH = 0;
  let nH = 0;
  let sumL = 0;
  let nL = 0;
  for (const r of rows) {
    if (r.payout >= T) {
      sumH += r.payout;
      nH++;
    } else {
      sumL += r.payout;
      nL++;
    }
  }
  if (nH === 0 || nL === 0) {
    throw new Error(`cannot reach ${(rtp * 100).toFixed(2)}% by weights: every book pays ${nH === 0 ? 'below' : 'at or above'} the target mean ${T / 100}×.`);
  }
  // Large wH so wL keeps ~7 significant digits after rounding to an integer.
  let wH = 1_000_000;
  let ratio = (sumH - T * nH) / (T * nL - sumL);
  if (!(ratio > 0)) ratio = 0;
  while (ratio * wH < 10_000_000 && wH < 1e13) wH *= 10;
  const wL = Math.max(1, Math.round(ratio * wH));
  const out = rows.map((r) => ({ id: r.id, weight: BigInt(r.payout >= T ? wH : wL), payout: r.payout }));
  const achieved = (wH * sumH + wL * sumL) / (100 * cost * (wH * nH + wL * nL));
  return { rows: out, achieved, wH, wL };
}

/** Rebalance every mode of a package in place (or into outDir, copying the rest). */
export function rebalancePackage(dir, rtp, outDir = null) {
  const pkg = loadPackage(dir);
  const target = outDir ? path.resolve(outDir) : pkg.dir;
  if (outDir) {
    fs.mkdirSync(target, { recursive: true });
    for (const f of fs.readdirSync(pkg.dir)) fs.copyFileSync(path.join(pkg.dir, f), path.join(target, f));
  }
  const report = [];
  for (const m of pkg.modes) {
    const r = rebalanceRows(m.lut.rows, m.cost, rtp);
    writeLookupTable(path.join(target, path.basename(m.lutFile)), r.rows);
    report.push({ mode: m.name, achieved: r.achieved, wH: r.wH, wL: r.wL });
  }
  return { dir: target, modes: report };
}
