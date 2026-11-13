/**
 * The last Stake RTP measurement of each deployed Math Component (2026-11-11).
 *
 * WHY. The Stake page said "Ready to build for Stake" with three green ticks — connected, deployed, rules — while
 * nothing had checked the one limit games most often fail: every mode's RTP inside 96.0–96.7%. A measurement
 * (the AI's `stake measure`, or the page's Measure button: both run stakeCommands' measure job) is kept here per
 * game + component, with the deployment it measured, so the page can show it — and show it as out of date once
 * the maths is deployed again. Kept in localStorage so a reload does not forget it; storage failing only means
 * measuring again.
 */
import type { StakeLimitsReport } from './stakeMathsFormat';

export interface StakeMeasureRecord {
  deploymentId: string;
  at: number;
  ok: boolean;
  modes: Array<{ name: string; rtp: number; rtpMargin: number; books: number }>;
  problems: Array<{ level: string; code: string; mode: string | null; message: string }>;
}

const KEY = 'xgenia_stake_measures_v1';
const listeners = new Set<() => void>();

function readAll(): Record<string, StakeMeasureRecord> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return memory;
  }
}
let memory: Record<string, StakeMeasureRecord> = {};

const keyOf = (gameId: string, slug: string) => `${gameId}|${slug}`;

export function rememberStakeMeasure(gameId: string, component: { slug: string; deploymentId: string }, limits: StakeLimitsReport) {
  const all = readAll();
  all[keyOf(gameId, component.slug)] = {
    deploymentId: component.deploymentId,
    at: Date.now(),
    ok: limits.ok,
    modes: limits.modes.map((m) => ({ name: m.name, rtp: m.rtp, rtpMargin: m.rtpMargin, books: m.books })),
    problems: limits.problems.map((p) => ({ level: p.level, code: p.code, mode: p.mode, message: p.message }))
  };
  memory = all;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* kept in memory for this session */
  }
  listeners.forEach((l) => l());
}

export function lastStakeMeasure(gameId: string | undefined, slug: string | undefined): StakeMeasureRecord | null {
  if (!gameId || !slug) return null;
  return readAll()[keyOf(gameId, slug)] || null;
}

export function onStakeMeasure(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
