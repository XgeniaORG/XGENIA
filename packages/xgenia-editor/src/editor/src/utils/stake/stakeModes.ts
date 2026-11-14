/**
 * The Stake bet modes a game declares in its maths graph (2026-11-09).
 *
 * WHY. A Stake package needs one mode per way to bet (base, ante, each buy), each with its price. An editor game
 * says this with the Bet Mode node (private/xgenia-pro-nodes slot-games/features/bet-mode.js: `mode` input
 * "base" / "ante" / "bonus_buy", Bonus Buy Multiplier default 100, Ante Multiplier default 1.25, Custom
 * Multipliers { name: multiplier }). Nothing carried that to the platform — `game_edge_functions.bet_options`
 * is never written by the editor — so every editor game exported `base` alone and its buy never reached Stake.
 * The Stake export now sends what this returns as `stake_modes`; XRGS uses it when the component has no priced
 * options of its own (stake-books.ts editorStakeOptions), and its auto-setup finds the request that enters each
 * mode by trying the mode's id on the `mode` input (stake-plan.ts valuesFor).
 *
 * Only a Bet Mode whose `mode` is wired from the Math Component's inputs counts: otherwise the game cannot ask
 * for the mode at all (stake readiness reports BET_MODE_NOT_AN_INPUT).
 *
 * Pure: project JSON in, list out. Tested in tests/deploy/stakeModes.test.ts.
 */

export interface DeclaredStakeMode {
  /** The value the game sends on the Bet Mode's `mode` input. */
  id: string;
  kind: 'buy' | 'special';
  /** Price as a multiple of the base bet. */
  cost: number;
  label: string;
}

const MATHS_PREFIX = '/#__maths__/';
/** A custom multiplier this high is a bought feature, not a bet booster. */
const BUY_FROM = 10;

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function declaredStakeModes(project: any): DeclaredStakeMode[] {
  const out = new Map<string, DeclaredStakeMode>();
  for (const comp of project?.components || []) {
    if (typeof comp?.name !== 'string' || !comp.name.startsWith(MATHS_PREFIX)) continue;
    for (const m of componentStakeModes(comp)) out.set(m.id, m);
  }
  return [...out.values()];
}

/** The modes ONE Math Component declares (its own wired Bet Mode nodes), from its JSON. */
export function componentStakeModes(comp: any): DeclaredStakeMode[] {
  const out = new Map<string, DeclaredStakeMode>();
  const roots: any[] = [];
  const walk = (ns: any[]) => {
    for (const n of ns || []) {
      roots.push(n);
      walk(n?.children);
    }
  };
  walk(comp?.graph?.roots);
  const inputs = roots.find((n) => (n?.type ?? n?.typename) === 'Component Inputs');
  const conns: any[] = comp?.graph?.connections || [];
  for (const n of roots) {
    if ((n?.type ?? n?.typename) !== 'Bet Mode') continue;
    const fed = conns.some((c) => c.toId === n.id && c.toProperty === 'mode' && (!inputs || c.fromId === inputs.id));
    if (!fed) continue;
    const p = n.parameters || {};
    out.set('bonus_buy', { id: 'bonus_buy', kind: 'buy', cost: num(p.bonusBuyMultiplier, 100), label: 'Bonus buy' });
    out.set('ante', { id: 'ante', kind: 'special', cost: num(p.anteMultiplier, 1.25), label: 'Ante bet' });
    let custom: unknown = p.customMultipliers;
    if (typeof custom === 'string') {
      try {
        custom = JSON.parse(custom);
      } catch {
        custom = null;
      }
    }
    if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
      for (const [name, mult] of Object.entries(custom as Record<string, unknown>)) {
        const cost = num(mult, NaN);
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(name) || !Number.isFinite(cost) || name === 'base') continue;
        out.set(name, { id: name, kind: cost >= BUY_FROM ? 'buy' : 'special', cost, label: name.replace(/_/g, ' ') });
      }
    }
  }
  return [...out.values()];
}

/** The Math Component input that feeds a Bet Mode's `mode` (the port the game sends its mode on), or null. */
export function stakeModeInput(project: any): string | null {
  for (const comp of project?.components || []) {
    if (typeof comp?.name !== 'string' || !comp.name.startsWith(MATHS_PREFIX)) continue;
    const port = componentModeInput(comp);
    if (port) return port;
  }
  return null;
}

/** The input of ONE Math Component that feeds a Bet Mode's `mode`, or null. */
export function componentModeInput(comp: any): string | null {
  const roots: any[] = [];
  const walk = (ns: any[]) => {
    for (const n of ns || []) {
      roots.push(n);
      walk(n?.children);
    }
  };
  walk(comp?.graph?.roots);
  const inputs = roots.find((n) => (n?.type ?? n?.typename) === 'Component Inputs');
  if (!inputs) return null;
  for (const bm of roots.filter((n) => (n?.type ?? n?.typename) === 'Bet Mode')) {
    const c = (comp?.graph?.connections || []).find((x: any) => x.toId === bm.id && x.toProperty === 'mode' && x.fromId === inputs.id);
    if (c) return String(c.fromProperty);
  }
  return null;
}

/**
 * What Publish tells the RGS about ONE Math Component's ways to bet: its priced options, and the input the
 * server must write the bet mode into. The server, not the page, decides the mode of every round (the option
 * that was paid for, or the base value), so a page cannot ask for a feature it did not pay for.
 * `betOptions` is null when the component sells nothing; `modeInputPort` is null when it has no wired Bet Mode
 * or the input is not in the request (the RGS then decides how to treat it).
 */
export function publishBetOptions(
  comp: any,
  payloadExample: Record<string, unknown> | undefined
): {
  betOptions: { feature_buys: BetOption[]; special_bets: BetOption[] } | null;
  modeInputPort: string | null;
  modeBaseValue: string;
} {
  const modes = componentStakeModes(comp);
  const toOption = (m: DeclaredStakeMode): BetOption => ({ id: m.id, label: m.label, cost_multiplier: m.cost });
  const feature_buys = modes.filter((m) => m.kind === 'buy').map(toOption);
  const special_bets = modes.filter((m) => m.kind === 'special').map(toOption);
  const port = componentModeInput(comp);
  return {
    betOptions: feature_buys.length || special_bets.length ? { feature_buys, special_bets } : null,
    modeInputPort: port && payloadExample && Object.prototype.hasOwnProperty.call(payloadExample, port) ? port : null,
    modeBaseValue: 'base'
  };
}

export interface BetOption {
  id: string;
  label: string;
  cost_multiplier: number;
}

/**
 * The Math Component ports a Pick Bonus uses (2026-11-09): the input that carries the clicked tile into
 * `pickIndex` and the output `revealed` is shown on. The Book Connector needs both to show each prize under the
 * tile the player clicked (stake-book-session.js, "Picks"). null when the game has no wired Pick Bonus.
 */
export function stakePickPorts(project: any): { pickField: string; revealedField: string } | null {
  for (const comp of project?.components || []) {
    if (typeof comp?.name !== 'string' || !comp.name.startsWith(MATHS_PREFIX)) continue;
    const roots: any[] = [];
    const walk = (ns: any[]) => {
      for (const n of ns || []) {
        roots.push(n);
        walk(n?.children);
      }
    };
    walk(comp.graph?.roots);
    const typeOf = (n: any) => n?.type ?? n?.typename;
    const inputs = roots.find((n) => typeOf(n) === 'Component Inputs');
    const outputs = roots.find((n) => typeOf(n) === 'Component Outputs');
    if (!inputs || !outputs) continue;
    const conns: any[] = comp.graph?.connections || [];
    for (const pb of roots.filter((n) => typeOf(n) === 'Pick Bonus')) {
      const pick = conns.find((c) => c.toId === pb.id && c.toProperty === 'pickIndex' && c.fromId === inputs.id);
      const shown = conns.find((c) => c.fromId === pb.id && c.fromProperty === 'revealed' && c.toId === outputs.id);
      if (pick && shown) return { pickField: String(pick.fromProperty), revealedField: String(shown.toProperty) };
    }
  }
  return null;
}
