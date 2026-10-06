/**
 * Slot GAME nodes parity test — the editor node vs. the compiled RGS script, in the REAL XRGS sandbox.
 * (2026-10-04)
 *
 * WHY: every core slot-maths node (Weighted Reels, Check Wins, Calculate Winnings, Get Paytable, …)
 * used to exist twice — the editor node in private/xgenia-pro-nodes/src/slot-games/*.js and a
 * hand-kept re-implementation that slot-game-node-converter.ts emitted into the compiled
 * evaluate(ctx) script XRGS runs. Nothing held the two equal, and they drifted: the game a player
 * tested in the editor was not the game the RGS paid. This test is the guard. For every node type
 * in SlotGameNodeRegistry it runs
 *   * the EDITOR node: the module exactly as shipped, on a plain `this` — initialize(), then every
 *     input through its own setter (an array port given a string is evaluated first, as
 *     node.js setInputValue does), then its Do — and reads its output getters, or the refusal it
 *     wrote into inspect data;
 *   * the RGS: a one-node maths component (request -> node.Do, every input wired from the request)
 *     compiled with CloudFunctionConverter.generateRgsScript() and executed by XRGS compileScript;
 * first with every parameter unset (the defaults), then on a few hundred randomized input sets per
 * node (grids, paytables, weights, formulas, edge sizes, free-spin flags, wrong types), then on a set
 * of formulas per formula node — including the ones that used to diverge (^ as power, min / max, %,
 * round of a negative half, implicit multiplication) — and finally with the inputs baked in as
 * side-panel parameters instead of wires. Every output is compared exactly, and refusals too: both
 * refuse, with the same message. A divergence prints a shrunk reproducing input.
 *
 * betAmount: the compiler feeds every slot node's betAmount from the round's stake (ctx.bet), so the
 * RGS has no "unset" betAmount. The editor node is handed the same stake (100 when a case leaves it
 * unset) — parity is defined for a graph whose bet is wired. An editor graph that leaves betAmount
 * unwired plays at the node default instead: 100 for Calculate Winnings, Spin Calculate and Reel Ways
 * Calculate Winnings, 0 for Spin Result and Calculate Free Spins States.
 *
 * Also checked: Generate Reel Strips (the editor fetches its strips from a web service) is reported
 * unsupported by the compiler, with its reason, instead of compiling to strips nobody previewed.
 * Exit code 0 only when nothing diverges.
 *
 * Usage: cd packages/xgenia-runtime && XRGS_SANDBOX=<XRGS>/supabase/functions/_shared/script-sandbox.ts \
 *          npx tsx src/api/test-slot-game-parity.ts [cases-per-node=300] [--only "<node type>"]
 */
import * as path from 'path';
import { CloudFunctionConverter } from './supabase-converter';
import { SlotGameNodeRegistry } from './slot-game-node-converter';

type AnyRec = Record<string, any>;
const HERE = path.dirname(__filename);
const XRGS_SANDBOX = process.env.XRGS_SANDBOX || path.resolve(HERE, '../../../../../XRGS/supabase/functions/_shared/script-sandbox.ts');
const PRO = path.resolve(HERE, '../../../../private/xgenia-pro-nodes/src/slot-games');

/** Editor module per compiled node type. */
const EDITOR_FILE: Record<string, string> = {
  'Check Jackpot': 'check-jackpot.js',
  'Calculate Winnings': 'calculate-winnings.js',
  'Check Wins': 'check-wins.js',
  'Get Paytable': 'get-paytable.js',
  'Generate Symbol Weights': 'generate-symbol-weights.js',
  'Reel Strips Generator': 'reel-strips-generator.js',
  'Calculate Free Spins States': 'calculate-free-spins-states.js',
  'Volatility Estimator': 'volatility-estimator.js',
  'Symbol Frequency Tracker': 'symbol-frequency-tracker.js',
  'Spin Result': 'spin-result.js',
  'Spin Calculate': 'spin-calculate.js',
  'Weighted Reels': 'weighted-reels.js',
  'Reel Ways Check Wins': 'reel-ways-check-wins.js',
  'Init Free Spins': 'init-free-spins.js',
  'Reel Ways Calculate Winnings': 'reel-ways-calculate-winnings.js'
};

// ─── the editor side ─────────────────────────────────────────────────────────────────────────────

interface Outcome { out?: AnyRec; error?: string }

function quietly<T>(fn: () => T): T {
  const saved = [console.log, console.info, console.warn, console.error];
  console.log = console.info = console.warn = console.error = () => {};
  try { return fn(); } finally { [console.log, console.info, console.warn, console.error] = saved; }
}

/** The editor node, as the runtime drives it: initialize, setters, Do, output getters. */
function runEditor(nodeType: string, rawInputs: AnyRec, outputs: string[]): Outcome {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const def = require(path.join(PRO, EDITOR_FILE[nodeType])).node;
  // the stake the RGS will use for betAmount (see the header)
  const inputs = def.inputs.betAmount && rawInputs.betAmount === undefined ? { ...rawInputs, betAmount: DEFAULT_BET } : rawInputs;
  const registered: AnyRec = {};
  const self: AnyRec = { _internal: {}, _reelStripsLocked: false };
  for (const [k, f] of Object.entries(def.prototypeExtensions || {})) self[k] = typeof f === 'function' ? f : (f as AnyRec).value;
  Object.assign(self, {
    flagOutputDirty() {},
    sendSignalOnOutput() {},
    scheduleAfterInputsHaveUpdated(fn: () => void) { fn(); },
    hasInput(name: string) { return !!(def.inputs[name] || registered[name]); },
    registerInput(name: string, port: AnyRec) { registered[name] = port; }
  });
  return quietly(() => {
    try {
      def.initialize.call(self);
      for (const [name, raw] of Object.entries(inputs)) {
        if (raw === undefined) continue; // unset: the editor never calls the setter
        let port = def.inputs[name] || registered[name];
        if (!port && typeof self.registerInputIfNeeded === 'function') { self.registerInputIfNeeded(name); port = registered[name]; }
        if (!port) continue; // the editor has no such port: the value never reaches it
        let value = raw;
        // node.js setInputValue: a string arriving on an array-typed port is evaluated as JS.
        if (port.type === 'array' && typeof value === 'string') {
          // eslint-disable-next-line no-eval
          try { value = (0, eval)(value); } catch (e) { value = []; }
        }
        if (typeof port.set === 'function') port.set.call(self, value);
      }
      const trigger = inputs.freeSpinTrigger === true && def.inputs.freeSpinTrigger ? def.inputs.freeSpinTrigger : def.inputs.Do;
      trigger.valueChangedToTrue.call(self);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const inspect = self._internal.inspectData;
    if (inspect && typeof inspect.error === 'string') return { error: inspect.error };
    const out: AnyRec = {};
    for (const name of outputs) {
      const port = def.outputs[name];
      out[name] = port && typeof port.getter === 'function' ? port.getter.call(self) : '<no such editor output>';
    }
    return { out };
  });
}

// ─── the RGS side ────────────────────────────────────────────────────────────────────────────────

/** Ports wired from the request besides the registry's input ports (the editor's dynamic ports). */
const EXTRA_PORTS: Record<string, string[]> = {
  'Get Paytable': Array.from({ length: 12 }, (_, i) => 'symbolPayout' + (i + 1)),
  'Generate Symbol Weights': Array.from({ length: 12 }, (_, i) => 'symbolWeight' + (i + 1)),
  'Calculate Free Spins States': Array.from({ length: 7 }, (_, i) => 'freeSpinsRewardCount' + (i + 1)),
  'Spin Result': ['hitFrequencyDataSeries', 'RTPDataSeries']
};

function inputPortsOf(nodeType: string): string[] {
  const cfg = SlotGameNodeRegistry.getSlotGameNodeConfig(nodeType)!;
  return Array.from(new Set([...cfg.inputPorts.filter((p) => p !== 'Do'), ...(EXTRA_PORTS[nodeType] || [])]));
}

function oneNodeComponent(nodeType: string, wired: string[], parameters: AnyRec = {}) {
  return {
    name: '/#__maths__/Game parity ' + nodeType,
    id: 'c-' + nodeType,
    graph: {
      roots: [
        {
          id: 'req', typename: 'xgenia.cloud.request', parameters: {},
          dynamicports: [{ name: 'pm-isSpin', displayName: 'isSpin', plug: 'output', group: 'Outputs' },
            ...wired.map((w) => ({ name: 'pm-' + w, displayName: w, plug: 'output', group: 'Outputs' }))]
        },
        { id: 'n1', typename: nodeType, label: 'n1', parameters, dynamicports: [] }
      ],
      connections: [
        { fromId: 'req', fromProperty: 'pm-isSpin', toId: 'n1', toProperty: 'Do' },
        ...wired.map((w) => ({ fromId: 'req', fromProperty: 'pm-' + w, toId: 'n1', toProperty: w }))
      ]
    }
  };
}

type Evaluate = (ctx: AnyRec) => AnyRec;
const compiled = new Map<string, Evaluate>();

function rgsFor(nodeType: string, compileScript: (s: string) => Evaluate): Evaluate {
  if (!compiled.has(nodeType)) {
    const { script, unsupportedNodes } = quietly(() => new CloudFunctionConverter(oneNodeComponent(nodeType, inputPortsOf(nodeType)) as any).generateRgsScript());
    if (unsupportedNodes.length) throw new Error(`${nodeType} compiles as unsupported: ${JSON.stringify(unsupportedNodes)}`);
    compiled.set(nodeType, compileScript(script));
  }
  return compiled.get(nodeType)!;
}

const DEFAULT_BET = 100;

function runRgs(nodeType: string, inputs: AnyRec, outputs: string[], compileScript: (s: string) => Evaluate, baked = false): Outcome {
  let evaluate: Evaluate;
  const config: AnyRec = { isSpin: true };
  if (baked) {
    // the inputs as side-panel parameters (JSON-serialisable values only), nothing wired but Do
    const parameters: AnyRec = {};
    for (const [k, v] of Object.entries(inputs)) if (v !== undefined && k !== 'betAmount') parameters[k] = v;
    const { script, unsupportedNodes } = quietly(() => new CloudFunctionConverter(oneNodeComponent(nodeType, [], parameters) as any).generateRgsScript());
    if (unsupportedNodes.length) throw new Error(`${nodeType} compiles as unsupported: ${JSON.stringify(unsupportedNodes)}`);
    evaluate = compileScript(script);
  } else {
    evaluate = rgsFor(nodeType, compileScript);
    for (const [k, v] of Object.entries(inputs)) if (v !== undefined && k !== 'betAmount') config[k] = v;
  }
  // The compiler feeds every slot-game node's betAmount from the round's stake (ctx.bet).
  const bet = inputs.betAmount !== undefined ? inputs.betAmount : DEFAULT_BET;
  let result: AnyRec;
  try {
    result = quietly(() => evaluate({ bet, rng: Array.from({ length: 100 }, (_, i) => ((i * 7919) % 100) / 100), state: {}, config, round: 1 }));
  } catch (e) {
    const m = (e as Error).message;
    const at = m.indexOf('[n1] ');
    return { error: at >= 0 ? m.slice(at + 5) : m };
  }
  const out: AnyRec = {};
  for (const name of outputs) out[name] = result.data ? result.data[name] : undefined;
  return { out };
}

// ─── comparing ───────────────────────────────────────────────────────────────────────────────────

/** JSON, but NaN / ±Infinity / -0 / undefined stay visible. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === 'number' && !Number.isFinite(x)) return `<${x}>`;
    if (typeof x === 'number' && Object.is(x, -0)) return '<-0>';
    if (x === undefined) return '<undefined>';
    return x;
  }) ?? '<undefined>';
}

function differ(a: Outcome, b: Outcome): string | null {
  if (a.error !== undefined || b.error !== undefined) {
    if (a.error !== undefined && b.error !== undefined) return a.error === b.error ? null : `both refuse, differently:\n     editor ${a.error.slice(0, 220)}\n     rgs    ${b.error.slice(0, 220)}`;
    return a.error !== undefined
      ? `editor refuses (${a.error.slice(0, 200)}) — RGS returns ${canon(b.out).slice(0, 200)}`
      : `RGS refuses (${b.error!.slice(0, 200)}) — editor returns ${canon(a.out).slice(0, 200)}`;
  }
  const lines: string[] = [];
  for (const k of Object.keys(a.out!)) {
    const x = canon(a.out![k]), y = canon(b.out![k]);
    if (x !== y) lines.push(`output ${k}:\n     editor ${x.slice(0, 220)}\n     rgs    ${y.slice(0, 220)}`);
  }
  return lines.length ? lines.join('\n   ') : null;
}

/** Drop inputs (back to unset) while the divergence persists — the smallest reproducing input. */
function shrink(inputs: AnyRec, diverges: (i: AnyRec) => boolean): AnyRec {
  let cur: AnyRec = {};
  for (const k of Object.keys(inputs)) if (inputs[k] !== undefined) cur[k] = inputs[k];
  for (const k of Object.keys(cur)) {
    const next = { ...cur };
    delete next[k];
    if (diverges(next)) cur = next;
  }
  return cur;
}

// ─── random inputs ───────────────────────────────────────────────────────────────────────────────

let rs = 20261004;
function rnd(): number { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; }
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const maybe = <T>(p: number, f: () => T): T | undefined => (chance(p) ? f() : undefined);

function grid(cols: number, rows: number, maxSym: number): number[][] {
  return Array.from({ length: cols }, () => Array.from({ length: rows }, () => int(0, maxSym)));
}
function cleanGrid(maxCols = 7, maxRows = 6, maxSym = 11): number[][] { return grid(int(1, maxCols), int(1, maxRows), maxSym); }
/** A grid, sometimes with the wrong shape or the wrong types in it. */
function anyGrid(maxCols = 7, maxRows = 6, maxSym = 11): unknown {
  if (chance(0.85)) {
    const g: any[] = cleanGrid(maxCols, maxRows, maxSym);
    if (chance(0.08)) g[int(0, g.length - 1)][0] = pick(['3', null, 2.5, '9']);
    if (chance(0.05)) g.push(Array.from({ length: int(0, 3) }, () => int(1, maxSym)));
    if (chance(0.03)) g[int(0, g.length - 1)] = pick([5, 'x', null]);
    return g;
  }
  return pick([[], null, 'x', [[]], JSON.stringify(cleanGrid(5, 3, 9)), 7]);
}
const SYMBOL = (def: number) => (): unknown => pick([undefined, def, def, int(0, 12), int(1, 10), 0, String(def), null, -1, 2.5, NaN, 'abc']);
const COUNT = (def: number) => (): unknown => pick([undefined, def, def, int(0, 8), 0, -2, 2.5, String(def), null, 'x', 1e9 > 0 ? int(1, 6) : 0]);
const BET = (): unknown => pick([undefined, 100, 100, 1, 7, 20, 250, 1000, 999999, 1000000, 2000000, int(1, 5000)]);

function paytable(maxSym = 11): AnyRec {
  const pt: AnyRec = {};
  for (let s = 1; s <= maxSym; s++) {
    if (chance(0.15)) continue;
    pt[s] = {};
    for (let n = 1; n <= 7; n++) if (chance(0.6)) pt[s][n] = pick([int(1, 50), int(1, 500) / 4, 0, 0.3, 2.25 + 0.75 * s, n * (2.25 + 0.75 * s)]);
  }
  return pt;
}
function anyPaytable(): unknown { return chance(0.9) ? paytable() : pick([null, undefined, {}, 'x', [], JSON.stringify(paytable(4))]); }

const DEFAULT_LINES_5x3 = 20;
function payline(cols: number, rows: number): unknown[] {
  const len = int(1, Math.max(1, cols + (chance(0.1) ? 1 : 0)));
  return Array.from({ length: len }, (_, c) => {
    const row = int(0, rows - 1 + (chance(0.05) ? 1 : 0));
    if (chance(0.03)) return { col: c, row };
    if (chance(0.01)) return 'bad';
    return [c, row];
  });
}
function anyPaylines(cols = 5, rows = 3): unknown {
  if (chance(0.85)) return Array.from({ length: int(1, 25) }, () => payline(cols, rows));
  return pick([null, [], 'x', JSON.stringify([[[0, 0], [1, 0], [2, 0]]])]);
}

const FORMULAS = [
  undefined, 'exp(-x / 15)', '2.25 + 0.75 * x', '10 - x', '1 / x', 'x ^ 2', 'sqrt(x)', 'log(x + 1)', 'log10(x)', 'log2(x + 1)',
  'cbrt(x)', 'sign(x - 3) + 2', 'min(x, 5)', 'max(x, 3)', 'min(x, 4, 2 * x)', 'x % 3', '-x % 3', 'x % 3 + 1', 'mod(x, 4)', 'mod(-x, 4)',
  'round(x / 2)', 'round(-x / 2) + 10', 'round(x / 4) + 1', 'floor(x / 3) + 1', 'ceil(x / 3)', 'abs(x - 5) + 1', 'fix(x / 3) + 1', 'x <= 1 ? 0 : (x * (x + 1)) / 2',
  'x > 3 ? 10 : 1', 'x == 3 ? 7 : 1', 'x != 3 ? 2 : 9', 'hypot(x, 3)', 'nthRoot(x, 3)', 'nthRoot(-x, 3) + 5', 'pow(x, 0.5)', '2 ^ x', 'exp(-x / 15) * 100',
  'pi * x', 'e ^ (-x)', 'x * 0.1 + 0.2', '(x + 1) / (x - 0.5)', '0.1 * 3 * x', 'square(x)', 'cube(x) / 10', 'atan2(x, 2)', '-x ^ 2 + 100', 'x ** 2',
  'trunc(x / 2) + 1', '2x', '2 * x!', 'PI * x', 'log(x, 2)', 'round(x / 3, 2)', '1 / (x - 3)', 'sqrt(x - 5)', 'exponential', '', 'x mod 3', '5%', 'x %',
  'factorial(x)', '(x + 1)(x - 1)', 'E * x', 'x = 2', 'random()', 'floor(0.1 * 3 * 10) + x', 'round(-2.5) + x', 'x / 0.1 % 1', 'exp(1000)', '0 * x'
];

function seedsArray(n: number): number[] {
  return Array.from({ length: n }, () => (chance(0.5) ? Math.floor(rnd() * 1e12) : rnd() * 1e12));
}
function normalisedWeights(n: number): number[] {
  const w = Array.from({ length: n }, (_, i) => Math.exp(-(i + 1) / 15) * (chance(0.2) ? int(1, 4) : 1));
  const t = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (x / t) * 100);
}
function anyWeights(): unknown {
  if (chance(0.85)) return chance(0.6) ? normalisedWeights(int(1, 12)) : Array.from({ length: int(1, 8) }, () => int(1, 30));
  return pick([[], null, [1, 0, 2], [3, -1], ['2', 3], 'x', JSON.stringify([5, 3, 1])]);
}
function strips(cols: number, len: number, maxSym: number): number[][] { return Array.from({ length: cols }, () => Array.from({ length: len }, () => int(1, maxSym))); }
function blocked(): unknown { return pick([undefined, '0,4', '0,4', '', '1', '0, 2', '2,3,4', 'a', null, '5', ' ', '0,,4', '-1']); }
function waysLines(): unknown {
  if (chance(0.1)) return pick([null, 'x', [[1, 2]], [[[1], 'x']]]);
  return Array.from({ length: int(0, 8) }, () => {
    const len = int(1, 6);
    const sym = int(1, 10);
    return [Array.from({ length: len }, () => (chance(0.2) ? 9 : chance(0.05) ? int(1, 10) : sym)), Array.from({ length: len }, (_, c) => [int(0, 3), c])];
  });
}
function linesFor(paylinesCount: number): unknown {
  if (chance(0.1)) return pick([null, 'x', [], JSON.stringify([[1, [3, 3, 3]]])]);
  return Array.from({ length: int(0, 6) }, () => {
    const len = int(1, 6);
    const sym = int(1, 11);
    return [int(1, Math.max(1, paylinesCount + (chance(0.05) ? 2 : 0))), Array.from({ length: len }, () => (chance(0.2) ? 9 : chance(0.05) ? int(1, 11) : sym))];
  });
}
function overrides(prefix: string, n: number): AnyRec {
  const o: AnyRec = {};
  for (let i = 1; i <= n; i++) if (chance(0.15)) o[prefix + i] = pick([int(0, 20), int(1, 40) / 4, '5', '', null, 'abc', 0, -3]);
  return o;
}

/** One random input set per call, per node type. Keys are the editor's input ports. */
const GEN: Record<string, () => AnyRec> = {
  'Check Jackpot': () => ({ reels: anyGrid(6, 5, 6), winningSymbol: pick([undefined, 1, 0, 3, '2', null, 'x', 2.5, NaN, int(1, 6)]) }),
  'Check Wins': () => {
    const reels = anyGrid();
    const g = Array.isArray(reels) && Array.isArray(reels[0]) ? reels as unknown[][] : [[0]];
    return {
      reels, wildSymbol: SYMBOL(9)(), freeSpinsSymbol: SYMBOL(10)(), minConsecutiveSymbols: COUNT(3)(),
      customPaylines: chance(0.4) ? undefined : anyPaylines(g.length, Math.max(1, g[0] ? (g[0] as unknown[]).length : 1))
    };
  },
  'Calculate Winnings': () => {
    const paylines = chance(0.3) ? undefined : anyPaylines();
    const n = Array.isArray(paylines) ? paylines.length : DEFAULT_LINES_5x3;
    return { winningLines: linesFor(n), betAmount: BET(), wildSymbol: SYMBOL(9)(), paytable: anyPaytable(), paylines: paylines === undefined ? Array.from({ length: n }, () => payline(5, 3)) : paylines };
  },
  'Get Paytable': () => ({
    numberOfSymbols: pick([undefined, 10, int(1, 12), 0, -2, 3.5, '6', 'x', null]),
    columnSize: pick([undefined, 5, int(2, 7), 0, 2.5, '5', null]),
    minConsecutiveSymbols: pick([undefined, 3, int(1, 6), 0, 7, '2']),
    payoutFormula: pick(FORMULAS), ...overrides('symbolPayout', 12)
  }),
  'Generate Symbol Weights': () => ({
    numberOfSymbols: pick([undefined, 10, int(1, 12), 0, -2, 3.5, '6', 'x', null]),
    weightFormula: pick(FORMULAS), ...overrides('symbolWeight', 12)
  }),
  'Reel Strips Generator': () => ({
    symbolWeights: anyWeights(),
    randomSeeds: chance(0.85) ? seedsArray(int(0, 8)) : pick([null, 'x', [1.5e11, '7'], JSON.stringify([1, 2, 3, 4, 5])]),
    columnSize: pick([undefined, 5, int(1, 7), 0, '5', 2.5, -1])
  }),
  'Calculate Free Spins States': () => ({
    engineReels: anyGrid(6, 4, 11), currentFreeSpins: pick([undefined, 0, 0, 1, 5, '3', -1, 2.5, null]), betAmount: BET(),
    capital: pick([undefined, 0, 1000, -50, '20', 33.3]), totalBets: pick([undefined, 0, 500, '100', -5]), totalFreeSpinsWon: pick([undefined, 0, 3, '2']),
    blockedReels: blocked(), freeSpinsSymbol: SYMBOL(10)(),
    freeSpinsRewardFormula: pick([undefined, 'x <= 1 ? 0 : (x * (x + 1)) / 2', 'x * 2', 'x >= 3 ? 10 : 0', 'x % 2', '2x', 'x!', '', 'max(x - 2, 0) * 5', 'round(-x / 2) + 3']),
    ...overrides('freeSpinsRewardCount', 6)
  }),
  'Volatility Estimator': () => ({
    spinResults: pick([
      undefined, null, { totalPayout: int(0, 500) }, [int(0, 9), { totalPayout: 4 }, [1, 2]], { values: [1, 2, 3, 'x'] }, { RTPDataSeries: [95, 96.5, 101] },
      { payoutSeries: [0, 0, 10] }, { totalPayouts: [5] }, { cascades: [1, { totalPayout: 3 }, [2, { totalPayout: 1 }]] }, 'x', 7, []
    ]),
    reset: pick([undefined, false, true])
  }),
  'Symbol Frequency Tracker': () => ({ numberOfSymbols: pick([undefined, 10, int(1, 12), 0, 3.5, '6', -1, null]), reels: anyGrid(6, 5, 12), reset: pick([undefined, false, true]) }),
  'Spin Result': () => ({
    reels: anyGrid(5, 4, 11), stopPosList: pick([undefined, [], [1, 2, 3], null]), spinWinnings: pick([undefined, 0, 50, 150000, '20', null, -4]),
    betAmount: BET(), totalBets: pick([undefined, 0, 1000, '300']), totalWinnings: pick([undefined, 0, 950, '40']), hits: pick([undefined, 0, 3, '2']),
    spinCount: pick([undefined, 0, 10, '4']), currentFreeSpinsWon: pick([undefined, 0, 3, '1']), totalFreeSpinsWon: pick([undefined, 0, 6]),
    currentFreeSpins: pick([undefined, 0, 2, '5']), freeSpinsSymbolCount: pick([undefined, 0, 3, '2', null]),
    currentFreeSpinsLines: pick([undefined, [], [{ symbols: [10], positions: [[1, 2]] }, { symbols: [], positions: [] }], null]),
    winningLinesDetails: pick([undefined, [], [{ line: 1, symbols: [3, 3, 3], positions: [[0, 0]], payout: 20 }], null]),
    jackpotWinnings: pick([undefined, 0, 5000, '100']), winningJackpot: pick([undefined, false, true]),
    jackpotWinningPositions: pick([undefined, [], [[0, 0], [1, 1]], [[9, 9]], 'x']), enableSimulation: pick([undefined, false, true]),
    hitFrequencyDataSeries: maybe(0.1, () => [10, 20]), RTPDataSeries: maybe(0.1, () => [95])
  }),
  'Spin Calculate': () => ({
    betAmount: BET(), capital: pick([undefined, 0, 1000, -50, '20']), totalBets: pick([undefined, 0, 500, '100']), spinWinnings: pick([undefined, 0, 0, 40, 1500, '30', -5]),
    totalWinnings: pick([undefined, 0, 900, '12']), currentFreeSpins: pick([undefined, 0, 0, 3, '1', -1]), totalWinningsFromFreeSpins: pick([undefined, 0, 70]),
    spinCount: pick([undefined, 0, 9, '3']), hits: pick([undefined, 0, 2]), jackpotWinnings: pick([undefined, 0, 2500, '10']),
    winningJackpot: pick([undefined, false, true, 'true', 0]), cascadingReelsEnabled: pick([undefined, false, true, 'false', 1])
  }),
  'Weighted Reels': () => {
    const cols = int(1, 7), rows = int(1, 6), len = int(1, 30);
    const dyn = chance(0.4);
    return {
      reelStrips: chance(0.9) ? strips(cols, len, 11) : pick([[], null, [[1, 2], [3]], 'x']),
      Seeds: chance(0.9) ? seedsArray(pick([cols, cols * rows, cols * rows + 3, cols - 1, 0, 100])) : pick([null, [0.25, 3], 'x', [-1, 5]]),
      rowSize: pick([undefined, 3, rows, rows, 0, '4', 2.5, null]),
      symbolWeights: dyn ? anyWeights() : maybe(0.3, () => anyWeights()),
      freeSpinSymbol: maybe(0.3, () => int(1, 11)), blockedReels: maybe(0.3, blocked),
      stopPosList: maybe(0.2, () => Array.from({ length: cols }, () => int(0, len - 1 + (chance(0.1) ? 2 : 0)))),
      isDynamic: dyn ? pick([true, true, 'true', 1]) : pick([undefined, false, 0, '']),
      freeSpinTrigger: maybe(0.35, () => true)
    };
  },
  'Reel Ways Check Wins': () => ({
    numberOfSymbols: pick([undefined, 8, int(1, 11), 0, -3, '6', 2.5]), wildSymbol: SYMBOL(9)(), freeSpinsSymbol: SYMBOL(10)(),
    reels: chance(0.9) ? grid(int(1, 5), int(1, 3), 10) : pick([[], null, 'x', [[1], 'x']]), minConsecutiveSymbols: COUNT(3)()
  }),
  'Init Free Spins': () => ({ reelStrips: chance(0.9) ? strips(int(1, 6), int(1, 20), 11) : pick([[], null, 'x']), freeSpinsSymbol: SYMBOL(10)(), blockedReels: blocked() }),
  'Reel Ways Calculate Winnings': () => ({ winningLines: waysLines(), betAmount: BET(), wildSymbol: SYMBOL(9)(), paytable: anyPaytable() })
};

/**
 * Formulas per formula node — every one in FORMULAS, at a few parameter settings. The ones that used
 * to diverge between mathjs (editor) and the RGS rewrite are in there: ^ as power, min / max, %, mod
 * of a negative, round of a negative half, nthRoot of a negative, implicit multiplication, x ** 2,
 * trunc, a non-finite result.
 */
const FORMULA_CASES: Record<string, () => AnyRec[]> = {
  'Get Paytable': () => FORMULAS.flatMap((payoutFormula) => [{ payoutFormula }, { payoutFormula, numberOfSymbols: 6, columnSize: 6, minConsecutiveSymbols: 2 }]),
  'Generate Symbol Weights': () => FORMULAS.flatMap((weightFormula) => [{ weightFormula }, { weightFormula, numberOfSymbols: 12 }]),
  'Calculate Free Spins States': () => FORMULAS.flatMap((freeSpinsRewardFormula) => [0, 2, 3, 5].map((scatters) => ({
    freeSpinsRewardFormula, blockedReels: '', freeSpinsSymbol: 10,
    engineReels: Array.from({ length: 6 }, (_, c) => [c < scatters ? 10 : 1, 2, 3])
  })))
};

/** Generate Reel Strips must be REPORTED unsupported, with its reason, not compiled. */
function generateReelStripsRefused(): string | null {
  const comp = {
    name: '/#__maths__/Game parity GRS', id: 'c-grs',
    graph: {
      roots: [
        { id: 'grs', typename: 'Generate Reel Strips', label: 'grs', parameters: { seed: 12345 }, dynamicports: [] },
        { id: 'wr', typename: 'Weighted Reels', label: 'wr', parameters: {}, dynamicports: [] }
      ],
      connections: [{ fromId: 'grs', fromProperty: 'reelStrips', toId: 'wr', toProperty: 'reelStrips' }]
    }
  };
  const { unsupportedNodes, script } = quietly(() => new CloudFunctionConverter(comp as any).generateRgsScript());
  const grs = unsupportedNodes.find((u: AnyRec) => u.typename === 'Generate Reel Strips');
  if (!grs) return 'compiled as supported';
  if (!/external web service/.test(String((grs as AnyRec).reason))) return `reported without its reason: ${JSON.stringify(grs)}`;
  if (/engine-typescript|generateReelStripsFromSeed/.test(script)) return 'a strip template still reaches the script';
  return null;
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const casesPerNode = Number(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a)) || 300);
  const onlyAt = process.argv.indexOf('--only');
  const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null;
  const sandbox = await import(XRGS_SANDBOX);
  const compileScript: (s: string) => Evaluate = sandbox.compileScript;

  let divergentNodes = 0;
  let totalCases = 0;
  const types = SlotGameNodeRegistry.getAllSlotGameNodeTypes().filter((t) => !only || t === only);
  for (const nodeType of types) {
    const outputs = SlotGameNodeRegistry.getSlotGameNodeConfig(nodeType)!.outputPorts;
    let baked = false;
    const run = (inputs: AnyRec) => ({ editor: runEditor(nodeType, inputs, outputs), rgs: runRgs(nodeType, inputs, outputs, compileScript, baked) });
    const diverges = (inputs: AnyRec) => { const r = run(inputs); return differ(r.editor, r.rgs) !== null; };

    const cases: Array<[string, AnyRec, boolean]> = [['all parameters unset (defaults)', {}, false]];
    rs = 20261004 + nodeType.length * 7919;
    for (let i = 0; i < casesPerNode; i++) cases.push([`random #${i + 1}`, GEN[nodeType](), false]);
    (FORMULA_CASES[nodeType] ? FORMULA_CASES[nodeType]() : []).forEach((c, i) => cases.push([`formula #${i + 1} ${JSON.stringify(c.payoutFormula ?? c.weightFormula ?? c.freeSpinsRewardFormula)}`, c, false]));
    // a few cases again with the inputs baked in as parameters (JSON-safe values only)
    const jsonSafe = (c: AnyRec) => Object.values(c).every((v) => v === undefined || (v !== null && !Number.isNaN(v) && canon(v) === canon(JSON.parse(JSON.stringify(v)))));
    cases.slice(1).filter(([, c]) => jsonSafe(c)).slice(0, 12).forEach(([label, c]) => cases.push([`${label} as parameters`, c, true]));

    const found: string[] = [];
    const seen = new Set<string>();
    let refusedBoth = 0;
    for (const [label, inputs, asParameters] of cases) {
      totalCases++;
      baked = asParameters;
      const r = run(inputs);
      const d = differ(r.editor, r.rgs);
      if (d === null) { if (r.editor.error !== undefined) refusedBoth++; continue; }
      const small = shrink(inputs, diverges);
      const rs2 = run(small);
      const why = differ(rs2.editor, rs2.rgs) || d;
      const key = why.replace(/[-\d.e+]+/g, '#').slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(`  ${label}; repro ${canon(small).slice(0, 400)}\n   ${why}`);
    }
    if (found.length) {
      divergentNodes++;
      console.log(`DIVERGES  ${nodeType} — ${found.length} distinct divergence(s) over ${cases.length} cases:\n${found.slice(0, 12).join('\n')}${found.length > 12 ? `\n  … ${found.length - 12} more` : ''}`);
    } else {
      const formulas = FORMULA_CASES[nodeType] ? FORMULA_CASES[nodeType]().length : 0;
      const asParameters = cases.filter((c) => c[2]).length;
      console.log(`ok        ${nodeType} — ${cases.length} cases equal (defaults, ${casesPerNode} random${formulas ? `, ${formulas} formula` : ''}, ${asParameters} as parameters; ${refusedBoth} refused alike)`);
    }
  }
  const grs = generateReelStripsRefused();
  if (grs) { divergentNodes++; console.log(`DIVERGES  Generate Reel Strips: ${grs}`); }
  else console.log('ok        Generate Reel Strips — reported unsupported by the compiler, with its reason (the editor fetches its strips from a web service)');
  console.log(`\n${types.length + 1 - divergentNodes}/${types.length + 1} slot-game node types play the same maths in the editor and the RGS, or are refused by the compiler (${totalCases} cases)`);
  process.exit(divergentNodes === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
