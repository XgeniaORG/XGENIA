/**
 * Ranking dial settings for a Stake game (2026-11-09) — the pure half of `stake variations`.
 *
 * XRGS `stake-variations` plays each setting of the maths' inputs on the SAME books in every Stake mode and
 * returns each pair's RTP. This turns that into what the AI acts on: per setting, every mode's RTP, how far the
 * worst mode is from the target, whether every mode sits in Stake's band and within 0.5% of base — and which
 * setting is best. A setting that reached Stake's band on 100,000 books is a candidate, not a result: the AI
 * confirms it with `stake measure` after making it the input's default.
 *
 * Dependency-free: tested in tests/deploy/stakeVariationsFormat.test.ts.
 */

export const STAKE_RTP_TARGET = 0.9635;
const BAND = { min: 0.96, max: 0.967, spread: 0.005 };

export interface VariationPair {
  variation: number;
  label: string;
  mode: string;
  stats: { rtp: number; hit_rate: number; books: number; max_multiplier: number; feature_books: number; truncated_books?: number };
}

export interface RankedVariation {
  label: string;
  inputs: Record<string, unknown>;
  modes: { mode: string; rtp: number; hitRate: number; featureShare: number; maxWin: number }[];
  /** The largest |RTP − target| across modes, in RTP points (0.004 = 0.4%). */
  worstMiss: number;
  /** Every mode in 96.0–96.7% and within 0.5% of base. */
  inBand: boolean;
  problems: string[];
}

export function rankVariations(
  variations: { label: string; inputs: Record<string, unknown> }[],
  pairs: VariationPair[],
  modeCosts: Record<string, number>,
  target = STAKE_RTP_TARGET
): { ranked: RankedVariation[]; best: RankedVariation | null } {
  const ranked: RankedVariation[] = variations.map((v, vi) => {
    const mine = pairs.filter((p) => p.variation === vi);
    const modes = mine.map((p) => ({
      mode: p.mode,
      rtp: p.stats.rtp,
      hitRate: p.stats.hit_rate,
      featureShare: p.stats.books ? p.stats.feature_books / p.stats.books : 0,
      maxWin: p.stats.max_multiplier
    }));
    const base = modes.find((m) => modeCosts[m.mode] === 1) ?? null;
    const problems: string[] = [];
    for (const m of modes) {
      if (m.rtp < BAND.min || m.rtp > BAND.max) problems.push(`${m.mode} RTP ${(m.rtp * 100).toFixed(2)}% is outside 96.00–96.70%`);
      if (base && m !== base && Math.abs(m.rtp - base.rtp) > BAND.spread) problems.push(`${m.mode} is ${(Math.abs(m.rtp - base.rtp) * 100).toFixed(2)}% from base (max 0.50%)`);
    }
    for (const p of mine) if ((p.stats.truncated_books ?? 0) > 0) problems.push(`${p.mode}: ${p.stats.truncated_books} books cut mid-feature`);
    const worstMiss = modes.length ? Math.max(...modes.map((m) => Math.abs(m.rtp - target))) : Infinity;
    return { label: v.label, inputs: v.inputs, modes, worstMiss, inBand: modes.length > 0 && problems.length === 0, problems };
  });
  const order = [...ranked].sort((a, b) => Number(b.inBand) - Number(a.inBand) || a.worstMiss - b.worstMiss);
  return { ranked, best: order[0] ?? null };
}

/**
 * Where to look next for one dial: given settings of a single number and each one's RTP in a mode, the value
 * that should land on the target, by straight-line interpolation between the two settings that straddle it
 * (null when none do — the AI widens the range instead).
 */
export function interpolateDial(points: { value: number; rtp: number }[], target = STAKE_RTP_TARGET): number | null {
  const sorted = [...points].filter((p) => Number.isFinite(p.value) && Number.isFinite(p.rtp)).sort((a, b) => a.value - b.value);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if ((a.rtp - target) * (b.rtp - target) <= 0 && a.rtp !== b.rtp) return a.value + ((target - a.rtp) * (b.value - a.value)) / (b.rtp - a.rtp);
  }
  return null;
}
