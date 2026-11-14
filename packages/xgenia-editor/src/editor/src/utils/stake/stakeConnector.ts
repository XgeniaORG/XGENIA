/**
 * Stake build wiring for the Book Connector (2026-11-09).
 *
 * A Stake build swaps every Math Component instance for an Aggregator, exactly as Publish does for XRGS
 * (rgs/deployMathsComponents.ts swapDeployedMathsInstances), but with transport "stake": the node does not POST
 * anywhere, it plays the component from the Stake book through the runtime's Stake Book Session
 * (xgenia-runtime .../std-library/data/stake-book-session.js). The frontend graph built for XRGS ships unchanged.
 *
 * Kept free of editor-model imports so it can be tested outside the editor (tests/deploy/stakeConnectorWiring).
 */

import type { DeclaredStakeMode } from './stakeModes';

const MATHS_PREFIX = '/#__maths__/';

/** What the runtime's Stake Book Session needs to answer a Math Component's triggers from a Stake book. */
export interface StakeConnectorConfig {
  /** The bet (in the maths' bet-port units) the books were played at: money in a book's data is scaled from it. */
  exportBet: number;
  /** The component's bet input: the game's bet, sent to /wallet/play. */
  betField: string;
  /** The component's win output: set from each round's winMultiplier × the player's bet. */
  winField?: string;
  /** Other money outputs, scaled by bet ÷ exportBet. */
  moneyFields?: string[];
  /** The input carrying the game's bet mode, and how its values map to Stake mode names. */
  modeField?: string;
  modes?: Record<string, string>;
  /** Triggers that set the game up (Init, Load…): answered without a play. */
  startupTriggers?: string[];
  /** Game money units per currency unit (1 when the game counts dollars, 100 for cents). */
  gameUnitsPerCurrencyUnit?: number;
  /** Pick Bonus: the input carrying the clicked tile, and the output listing revealed tiles ({ index, … }). */
  pickField?: string;
  revealedField?: string;
}

export const STAKE_BOOK_URL = 'stake:book';

/**
 * Endpoints for a Stake build: every Math Component of the project, played from the book. `configFor` returns a
 * component's config, or null to leave it — and the build must then refuse, because a Math Component left in a
 * Stake build runs its maths in the player's browser, unrelated to what Stake pays.
 */
export function stakeMathsEndpoints(
  project: any,
  configFor: (componentName: string) => StakeConnectorConfig | null
): Record<string, { slug: string; url: string; stake: StakeConnectorConfig }> {
  const out: Record<string, { slug: string; url: string; stake: StakeConnectorConfig }> = {};
  for (const comp of project?.components || []) {
    const name = comp?.name;
    if (typeof name !== 'string' || !name.startsWith(MATHS_PREFIX)) continue;
    const cfg = configFor(name);
    if (!cfg) continue;
    out[name] = { slug: name.split('/').pop() || name, url: STAKE_BOOK_URL, stake: cfg };
  }
  return out;
}

/** The Aggregator parameters for a Stake endpoint: the same ports, transport "stake", no cents conversion. */
export function stakeAggregatorParameters(args: {
  url: string;
  dataInputs: string[];
  triggers: string[];
  outputs: string[];
  signalOutputs?: string[];
  targetComponent: string;
  stake: StakeConnectorConfig;
}): Record<string, string | number> {
  const signalOutputs = args.signalOutputs || [];
  return {
    url: args.url,
    transport: 'stake',
    stakeConfig: JSON.stringify(args.stake),
    dataInputs: args.dataInputs.join(', '),
    triggers: args.triggers.join(', '),
    outputs: [...args.outputs, ...signalOutputs].join(', '),
    signalOutputs: signalOutputs.join(', '),
    targetComponent: args.targetComponent
  };
}

/** Math Component instances still in a build after the swap: a Stake build with any is refused. */
export function leftoverMathsInstances(project: any): string[] {
  const left = new Set<string>();
  for (const comp of project?.components || []) {
    if (typeof comp?.name === 'string' && comp.name.startsWith(MATHS_PREFIX)) continue;
    const walk = (nodes: any[]) => {
      for (const n of nodes || []) {
        if (typeof n?.typename === 'string' && n.typename.startsWith(MATHS_PREFIX)) left.add(n.typename);
        walk(n?.children);
      }
    };
    walk(comp?.graph?.roots);
  }
  return [...left].sort();
}

/** Stake's mode name for a declared mode (XRGS stake-books.ts stakeModeName). */
export function stakeModeNameFor(m: Pick<DeclaredStakeMode, 'id' | 'kind'>): string {
  const slug = m.id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'option';
  return `${m.kind}_${slug}`;
}

/**
 * The Book Connector's settings for a component: its bet and win ports (from the platform), the bet the books
 * are played at, and — when the game has a Bet Mode — which input carries the mode and how its values map to
 * the Stake mode names the export writes.
 */
export function stakeConnectorConfigFor(args: {
  betInputPort: string | null;
  winOutputPort: string;
  exportBet: number;
  modes: DeclaredStakeMode[];
  modeInput: string | null;
  picks?: { pickField: string; revealedField: string } | null;
  gameUnitsPerCurrencyUnit?: number;
}): StakeConnectorConfig {
  if (!args.betInputPort) {
    throw new Error('The Math Component declares no bet input, so the game cannot tell Stake what it bets. Mark its bet input in Maths and deploy it again.');
  }
  const cfg: StakeConnectorConfig = {
    exportBet: args.exportBet,
    betField: args.betInputPort,
    winField: args.winOutputPort || undefined,
    gameUnitsPerCurrencyUnit: args.gameUnitsPerCurrencyUnit ?? 1
  };
  if (args.modes.length && args.modeInput) {
    cfg.modeField = args.modeInput;
    cfg.modes = { base: 'base', ...Object.fromEntries(args.modes.map((m) => [m.id, stakeModeNameFor(m)])) };
  }
  if (args.picks) {
    cfg.pickField = args.picks.pickField;
    cfg.revealedField = args.picks.revealedField;
  }
  return cfg;
}
