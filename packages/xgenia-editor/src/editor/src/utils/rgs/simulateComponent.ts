// Simulate a DEPLOYED Math Component — on the RGS platform, not here.
//
// The editor used to hold a full copy of the batch simulator
// (`utils/rgs/simulationEngine.ts`, since removed): it compiled a component in
// the renderer and measured the result in-process. That answered a question
// nobody was asking — the RTP of a script that had never been near RGS. What
// runs now is the row `rgs-fn` serves, through the platform's own
// `_shared/script-sandbox`, so a simulation and a live call cannot disagree
// about what the maths does. Which is also why Simulate is offered on the
// Deployed tab only: an undeployed component has nothing on the platform to
// measure.
//
// ─── THE CHUNK LOOP ───────────────────────────────────────────
//
// A Supabase edge isolate is CPU-killed near 2s, and the round loop is
// synchronous, so no single call can run a large simulation. `simulate-component`
// runs what fits its budget, hands back an opaque `carry` of raw aggregates, and
// this function feeds that straight back until the run reports `complete`.
// Splitting a run does not change its answer — see the chunk-boundary tests in
// XRGS `tests/unit/component-simulation.test.ts`.
//
// Everything statistical lives server-side. This file merges nothing: it
// concatenates the series arrays and keeps the last response's `stats`, which is
// already cumulative over every chunk.

import { XRGS_URL, rgsHeaders } from './rgsClient';

/** Ceiling the platform enforces on one run. Mirrored here to bound the UI's input. */
export const MAX_SIMULATION_ROUNDS = 10_000_000;

/** One point on the RTP / hit-frequency / volatility convergence curves. */
export interface SimulationSeriesPoint {
  /** Rounds completed when this point was sampled. */
  round: number;
  /** Running RTP to that round, as a percentage. */
  rtp: number;
  /** Running hit frequency to that round, as a percentage. */
  hitRate: number;
  /** Running standard deviation of the per-round win/bet ratio. */
  volatility: number;
}

/** The finished measurement, as the platform derived it. */
export interface ComponentSimulationStats {
  rounds: number;
  /** evaluate() calls, free/feature rounds included — always ≥ `rounds`. */
  roundsEvaluated: number;
  rtp: number;
  rtpPercent: string;
  baseRtp: number;
  bonusRtp: number;
  hitRate: number;
  volatility: number;
  volatilityClass: string;
  maxMultiplier: number;
  totalBet: number;
  totalWin: number;
  totalBaseWin: number;
  totalBonusWin: number;
  houseEdge: string;
  bonusTriggers: number;
  bonusFrequency: string;
  avgBonusWin: number;
  /** Free rounds played across the whole run. */
  bonusRoundsPlayed: number;
  /**
   * Features the platform had to cut short at its 500-free-round backstop.
   *
   * Non-zero means the component never clears `state.in_feature`, so its bonus
   * does not end on its own — worth saying out loud, because every figure below
   * was then measured against a feature the runner had to break out of.
   */
  featureCapHits: number;
  /** Round-loop time on the platform, summed across chunks — excludes network. */
  elapsedMs: number;
  roundsPerSecond: number;
  portTotals: Record<string, number>;
}

export interface ComponentSimulationResult {
  stats: ComponentSimulationStats;
  series: SimulationSeriesPoint[];
  /**
   * The bet/win mapping the run ACTUALLY used. The platform nulls a port the
   * component does not declare, rather than silently falling back — so a stale
   * name shows up as "no mapping" instead of as an RTP measured against
   * something nobody chose.
   */
  betInputPort: string | null;
  winOutputPort: string | null;
  /** True when `shouldCancel` stopped the loop; `stats` then covers the rounds run so far. */
  cancelled: boolean;
  /** How many round-trips the run took — worth showing when it was slow. */
  chunks: number;
}

export interface SimulationProgress {
  rounds: number;
  totalRounds: number;
  chunks: number;
}

export interface SimulateComponentOptions {
  apiKey: string;
  /** The Server Version holding this component. Also what scopes the call to a game you own. */
  deploymentId: string;
  functionSlug: string;
  totalRounds: number;
  /** Stake for a component whose ports name no bet input. */
  betAmount?: number;
  /** Fixed values, by input port name. */
  inputOverrides?: Record<string, any>;
  /** Input ports redrawn from a uniform integer range each round. */
  rngPorts?: Record<string, { min: number; max: number }>;
  /** Input ports redrawn as a 50/50 boolean each round. */
  boolRngPorts?: string[];
  /** Input ports filled with a random name each round. */
  strRngPorts?: string[];
  betInputPort?: string | null;
  winOutputPort?: string | null;
  seriesPoints?: number;
  onProgress?: (progress: SimulationProgress) => void;
  /** Polled between chunks — the only place a run can be stopped, and it costs nothing. */
  shouldCancel?: () => boolean;
}

export async function simulateDeployedComponent(
  opts: SimulateComponentOptions
): Promise<ComponentSimulationResult> {
  const totalRounds = Math.max(1, Math.min(Math.floor(opts.totalRounds), MAX_SIMULATION_ROUNDS));

  const request = {
    action: 'simulate-component',
    deployment_id: opts.deploymentId,
    function_slug: opts.functionSlug,
    total_rounds: totalRounds,
    bet_amount: opts.betAmount ?? 1,
    input_overrides: opts.inputOverrides ?? {},
    rng_ports: opts.rngPorts ?? {},
    bool_rng_ports: opts.boolRngPorts ?? [],
    str_rng_ports: opts.strRngPorts ?? [],
    bet_input_port: opts.betInputPort ?? null,
    win_output_port: opts.winOutputPort ?? null,
    series_points: opts.seriesPoints ?? 60
  };

  const series: SimulationSeriesPoint[] = [];
  let carry: any = undefined;
  let last: any = null;
  let chunks = 0;
  let lastEvaluated = 0;

  for (;;) {
    if (opts.shouldCancel?.()) {
      // Nothing to tear down: each chunk is a finished request, and the carry we
      // are holding is simply not sent on.
      if (!last) throw new Error('Simulation cancelled before it started');
      return { ...toResult(last, series, chunks), cancelled: true };
    }

    const res = await fetch(`${XRGS_URL}/maths-deployer`, {
      method: 'POST',
      headers: rgsHeaders(opts.apiKey),
      body: JSON.stringify({ ...request, carry })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const serverError = (data && data.error) || '';
      // A stale RGS backend — deployed before this action existed — answers with
      // "Invalid action. Use: …". Say what to do about it rather than dumping the
      // action list at someone who pressed Simulate.
      if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes('simulate-component')) {
        throw new Error(
          'XGENIA RGS backend is out of date — it cannot simulate components yet. ' +
            'Redeploy the `maths-deployer` function to the RGS project, then try again.'
        );
      }
      throw new Error(serverError || `Simulation failed (HTTP ${res.status})`);
    }

    chunks++;
    last = data;
    for (const p of data.series || []) {
      series.push({ round: p.round, rtp: p.rtp, hitRate: p.hit_rate, volatility: p.volatility });
    }

    if (data.complete) break;

    // A chunk that advanced nothing would loop for ever. The platform runs at
    // least one round per call, so this only fires if the contract is broken —
    // but an editor that hangs on a spinner is a worse way to find that out.
    //
    // Measured on evaluate() CALLS, not on requested rounds: a free round does
    // not consume a requested round, so a component with a long feature can
    // legitimately spend a whole 1.4s chunk inside one and report rounds_run: 0.
    // Watching the requested count would abort a perfectly healthy run and
    // blame the platform for it.
    const evaluated = data.stats?.rounds_evaluated ?? 0;
    if (!(evaluated > lastEvaluated)) {
      throw new Error('The platform returned no progress for this simulation — stopping rather than retrying for ever.');
    }
    lastEvaluated = evaluated;

    carry = data.carry;
    opts.onProgress?.({ rounds: data.stats?.rounds ?? 0, totalRounds, chunks });
  }

  return { ...toResult(last, series, chunks), cancelled: false };
}

function toResult(
  data: any,
  series: SimulationSeriesPoint[],
  chunks: number
): Omit<ComponentSimulationResult, 'cancelled'> {
  const s = data.stats || {};
  return {
    stats: {
      rounds: s.rounds ?? 0,
      roundsEvaluated: s.rounds_evaluated ?? 0,
      rtp: s.rtp ?? 0,
      rtpPercent: s.rtp_percent ?? '0.0000%',
      baseRtp: s.base_rtp ?? 0,
      bonusRtp: s.bonus_rtp ?? 0,
      hitRate: s.hit_rate ?? 0,
      volatility: s.volatility ?? 0,
      volatilityClass: s.volatility_class ?? 'low',
      maxMultiplier: s.max_multiplier ?? 0,
      totalBet: s.total_bet ?? 0,
      totalWin: s.total_win ?? 0,
      totalBaseWin: s.total_base_win ?? 0,
      totalBonusWin: s.total_bonus_win ?? 0,
      houseEdge: s.house_edge ?? '0.0000%',
      bonusTriggers: s.bonus_triggers ?? 0,
      bonusFrequency: s.bonus_frequency ?? '1 in ∞',
      avgBonusWin: s.avg_bonus_win ?? 0,
      bonusRoundsPlayed: s.bonus_rounds_played ?? 0,
      featureCapHits: s.feature_cap_hits ?? 0,
      elapsedMs: s.elapsed_ms ?? 0,
      roundsPerSecond: s.rounds_per_second ?? 0,
      portTotals: s.port_totals ?? {}
    },
    series,
    betInputPort: data.bet_input_port ?? null,
    winOutputPort: data.win_output_port ?? null,
    chunks
  };
}
