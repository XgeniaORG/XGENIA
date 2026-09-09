/**
 * Slot Features parity test — editor core vs. compiled RGS script in the REAL XRGS sandbox.
 *
 * For every node type in SlotFeatureNodeRegistry:
 *   1. build a one-node maths component (request trigger -> node.Do) with side-panel parameters,
 *   2. compile it with CloudFunctionConverter.generateRgsScript(),
 *   3. check the editor's blocked-construct mirror (utils/rgs/validateRgsScript.ts) finds nothing,
 *   4. compile + execute the script with XRGS `compileScript` (supabase/functions/_shared/script-sandbox.ts,
 *      imported straight from the sibling XRGS checkout — it is a pure module),
 *   5. assert the returned `data` equals a direct call of the same core with the same arguments,
 *      threading `state` for a second round on stateful nodes.
 *
 * Usage: cd packages/xgenia-runtime && npx tsx src/api/test-slot-feature-parity.ts [--write-fixture <file>]
 * `--write-fixture` also writes the generated scripts as a TS module for XRGS tests/unit to import.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CloudFunctionConverter } from './supabase-converter';
import { SlotFeatureNodeRegistry } from './slot-feature-node-converter';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cores = require('./slot-feature-cores');

const HERE = path.dirname(__filename);
const XRGS_SANDBOX = process.env.XRGS_SANDBOX || path.resolve(HERE, '../../../../../XRGS/supabase/functions/_shared/script-sandbox.ts');
const EDITOR_VALIDATOR = path.resolve(HERE, '../../../xgenia-editor/src/editor/src/utils/rgs/validateRgsScript.ts');

type AnyRec = Record<string, any>;

const SEEDS = [123456789012, 987654321098, 55555555, 4242424242];
const REELS = [
  [1, 1, 7],
  [1, 1, 3],
  [2, 1, 4],
  [2, 5, 4],
  [7, 5, 7]
];
const PAYTABLE = { 1: { 3: 5, 4: 10, 5: 50 }, 2: { 3: 4 }, 3: { 3: 3 }, 4: { 3: 2 }, 5: { 3: 1 }, 7: { 3: 20 } };

/** Side-panel parameters per node type; also the arguments the direct core call is derived from. */
const PARAMS: Record<string, AnyRec> = {
  'Cluster Pays': { reels: REELS, minClusterSize: 3, wildSymbol: 0, paytable: { 1: { 3: 2, 5: 10 }, 2: { 3: 1 } }, betAmount: 100, adjacency: 'orthogonal' },
  'Progressive Meter': { increment: 40, target: 100, startValue: 0, resetOnFill: true, carryOverflow: true, addOnDo: true },
  'Multiplier Ladder': { ladder: [1, 2, 3, 5], startIndex: 0, stepBy: 1, stepOnDo: true },
  'Symbol Value Grid': { reels: REELS, valueSymbol: 7, values: [1, 2, 5], weights: [5, 3, 1], betAmount: 100, Seeds: SEEDS },
  'Coin Collector': { reels: REELS, valueGrid: [[0, 0, 200], [0, 0, 0], [0, 0, 0], [0, 0, 0], [100, 0, 500]], collectorSymbol: 5, requireCollector: true },
  'Jackpot Tiers': { reels: REELS, jackpotSymbol: 7, tiers: [{ name: 'Mini', count: 2, multiplier: 10 }, { name: 'Major', count: 3, multiplier: 100 }], betAmount: 100 },
  'RGS Jackpot Pools': { poolName: 'Crystal Bonus', shouldClaim: true, claimOnlyIfClaimable: true },
  'Bet Mode': { betAmount: 100, mode: 'bonus buy', anteMultiplier: 1.25, bonusBuyMultiplier: 100, direction: 'base-to-cost' },
  'Variant Selector': { variants: { low: { reelStrips: [[1, 2]], paytableScale: 0.9, rtp: 0.92 }, high: { reelStrips: [[3, 4]], rtp: 0.96 } }, key: 'high', fallbackKey: 'low' },
  'Sticky Symbols': { reels: REELS, stickySymbol: 7, duration: 2, captureOnDo: true, tick: true },
  'Expand Symbols': { reels: REELS, symbol: 5, mode: 'column', minCount: 1 },
  'Locked Reels': { reels: REELS, lockSymbol: 7, respins: 2, resetOnNewLock: true },
  'Hold And Win Grid': { reels: REELS, coinSymbol: 7, blankSymbol: 0, symbolWeights: [5, 4, 3, 2, 1, 1, 2], respins: 2, coinValues: [1, 2], betAmount: 100, Seeds: SEEDS, start: true },
  'Symbol Upgrade': { reels: REELS, fromSymbol: 1, toSymbol: 7, duration: 2, activateOnDo: true },
  'Feature Trigger': { chance: 0.5, Seeds: SEEDS },
  'Directional Cascade': { reels: REELS, winningLinesDetails: [{ positions: [[0, 0], [1, 0], [0, 1]], payout: 5 }], symbolWeights: [5, 4, 3, 2, 1, 1, 2], direction: 'down', Seeds: SEEDS },
  'Wheel Spin': { segments: ['x2', 'x5', 'x10', 'Jackpot'], weights: [50, 30, 15, 5], prizes: [2, 5, 10, 100], Seeds: SEEDS },
  'Pick Bonus': { prizes: [10, 20, 30, 40], endMarkers: 1, endValue: 'END', picks: 0, pickIndex: 1, Seeds: SEEDS, start: true },
  'Paytable Modifier': { paytable: PAYTABLE, scale: 1.5, symbolOverrides: { 7: 2 }, mode: 'scale', roundTo: 4 },
  'Chapter Branch': { chapters: { intro: { next: ['forest', 'cave'] }, forest: { next: { fight: 'boss' } }, cave: {}, boss: {} }, choice: 'forest', startKey: 'intro' },
  'Paytable Rows': { paytable: PAYTABLE, symbolNames: ['Cherry', 'Lemon', 'Bar', 'Bell', 'Seven', 'Wild', 'Coin'], betAmount: 100, paylinesCount: 20 }
};

/** A second-round parameter override for stateful nodes (the action to take on round 2). */
const ROUND2: Record<string, AnyRec> = {
  'Hold And Win Grid': { start: false, respin: true },
  'Pick Bonus': { start: false, pick: true, pickIndex: 2 },
  'Chapter Branch': { advance: true }
};

const JACKPOTS = [
  { id: 'p1', name: 'Crystal Bonus', pool_type: 'local', current_value: 123456, claimable: true },
  { id: 'p2', name: 'Mega', pool_type: 'shared', current_value: 9999999, claimable: false }
];

function lcgFloats(seed: number, n: number): number[] {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    out.push((s - 1) / 2147483646);
  }
  return out;
}

function buildComponent(nodeType: string, params: AnyRec, wired: string[]) {
  // Signal inputs (start/pick/advance/...) and per-round values are WIRED from the request node,
  // as a real graph does (gateway port -> node input), so the script reads them from ctx.config
  // each round instead of a value baked in at compile time.
  const baked: AnyRec = { ...params };
  for (const w of wired) delete baked[w];
  return {
    name: '/#__maths__/Parity ' + nodeType,
    id: 'c-' + nodeType,
    graph: {
      roots: [
        {
          id: 'req',
          typename: 'xgenia.cloud.request',
          parameters: {},
          dynamicports: [
            { name: 'pm-isSpin', displayName: 'isSpin', plug: 'output', group: 'Outputs' },
            ...wired.map((w) => ({ name: 'pm-' + w, displayName: w, plug: 'output', group: 'Outputs' }))
          ]
        },
        { id: 'n1', typename: nodeType, label: nodeType, parameters: baked, dynamicports: [] }
      ],
      connections: [
        { fromId: 'req', fromProperty: 'pm-isSpin', toId: 'n1', toProperty: 'Do' },
        ...wired.map((w) => ({ fromId: 'req', fromProperty: 'pm-' + w, toId: 'n1', toProperty: w }))
      ]
    }
  };
}

/** Mirror of the generated wrapper: registry defaults, rename and derived expressions. */
function coreArgsFor(nodeType: string, params: AnyRec, ctxJackpots: AnyRec[]): AnyRec {
  const spec = SlotFeatureNodeRegistry.getSpec(nodeType)!;
  const values: AnyRec = {};
  for (const port of spec.inputs) values[port] = params[port] !== undefined ? params[port] : spec.defaults[port];
  const args: AnyRec = {};
  for (const port of spec.inputs) {
    const argName = spec.rename?.[port] ?? port;
    if (spec.derived && Object.prototype.hasOwnProperty.call(spec.derived, argName)) continue;
    args[argName] = values[port];
  }
  if (spec.derived) {
    const idents = spec.inputs.map((p) => p.replace(/[^a-zA-Z0-9_$]/g, '_'));
    for (const [argName, expr] of Object.entries(spec.derived)) {
      if (expr === 'inputs._jackpots') { args[argName] = ctxJackpots; continue; }
      // eslint-disable-next-line no-new-func
      args[argName] = new Function(...idents, `return (${expr});`)(...spec.inputs.map((p) => values[p]));
    }
  }
  return args;
}

async function main() {
  const writeFixture = process.argv.indexOf('--write-fixture');
  const fixturePath = writeFixture >= 0 ? process.argv[writeFixture + 1] : null;

  const sandbox = await import(XRGS_SANDBOX);
  const validator = await import(EDITOR_VALIDATOR);
  const compileScript: (s: string) => (ctx: AnyRec) => AnyRec = sandbox.compileScript;

  const fixtures: Array<{ nodeType: string; script: string; params: AnyRec; wired: string[]; round2: AnyRec | null }> = [];
  let failures = 0;
  const types = SlotFeatureNodeRegistry.getAllTypes();
  for (const nodeType of types) {
    const spec = SlotFeatureNodeRegistry.getSpec(nodeType)!;
    const params = PARAMS[nodeType];
    if (!params) { console.log(`SKIP  ${nodeType}: no parity parameters defined`); failures++; continue; }

    const wired = Array.from(new Set([...(spec.signalInputs || []), ...Object.keys(ROUND2[nodeType] || {})]));
    const converter = new CloudFunctionConverter(buildComponent(nodeType, params, wired) as any);
    const { script, unsupportedNodes } = converter.generateRgsScript();
    if (unsupportedNodes.length > 0) { console.log(`FAIL  ${nodeType}: reported unsupported ${JSON.stringify(unsupportedNodes)}`); failures++; continue; }

    const blocked = validator.findBlockedConstructs(script);
    if (blocked.length > 0) { console.log(`FAIL  ${nodeType}: editor validator flags ${JSON.stringify(blocked.slice(0, 3))}`); failures++; continue; }

    let evaluate: (ctx: AnyRec) => AnyRec;
    try { evaluate = compileScript(script); } catch (e) { console.log(`FAIL  ${nodeType}: XRGS compileScript refused: ${(e as Error).message}`); failures++; continue; }

    const rounds = ROUND2[nodeType] ? [params, { ...params, ...ROUND2[nodeType] }] : spec.stateful ? [params, params] : [params];
    let state: AnyRec = {};
    let coreState: AnyRec = {};
    let ok = true;
    for (let r = 0; r < rounds.length; r++) {
      const rp = rounds[r];
      const wiredValues: AnyRec = {};
      for (const w of wired) wiredValues[w] = rp[w] !== undefined ? rp[w] : (spec.defaults[w] !== undefined ? spec.defaults[w] : false);
      const ctx: AnyRec = { bet: 100, rng: lcgFloats(777 + r, 100), state, config: { isSpin: true, ...wiredValues }, round: r + 1, jackpots: JACKPOTS };
      let result: AnyRec;
      try { result = evaluate(ctx); } catch (e) { console.log(`FAIL  ${nodeType} round ${r + 1}: sandbox threw ${(e as Error).message}`); ok = false; break; }
      state = result.state;
      const args = coreArgsFor(nodeType, rp, JACKPOTS);
      // The compiler maps betAmount -> the round's bet (ctx.bet); mirror that.
      if (spec.inputs.includes('betAmount')) args.betAmount = 100;
      const expected = spec.stateful ? cores[spec.core](coreState, args) : cores[spec.core](args);
      if (spec.stateful) coreState = expected.updatedState;
      for (const out of spec.outputs) {
        const a = JSON.stringify(result.data[out]);
        const b = JSON.stringify(expected[out]);
        if (a !== b) { console.log(`FAIL  ${nodeType} round ${r + 1} output ${out}:\n   sandbox ${a}\n   core    ${b}`); ok = false; }
      }
      if (spec.stateful) {
        const a = JSON.stringify(result.state.__nodes && result.state.__nodes.n1);
        const b = JSON.stringify(expected.updatedState);
        if (a !== b) { console.log(`FAIL  ${nodeType} round ${r + 1} persisted state differs:\n   sandbox ${a}\n   core    ${b}`); ok = false; }
      }
      if (result.data.Done !== true) { console.log(`FAIL  ${nodeType}: Done not true`); ok = false; }
    }
    if (ok) console.log(`ok    ${nodeType}${spec.stateful ? ' (2 rounds, state threaded)' : ''} — ${script.length} bytes`);
    else failures++;
    fixtures.push({ nodeType, script, params, wired, round2: ROUND2[nodeType] || null });
  }

  if (fixturePath) {
    const body = [
      '// AUTO-GENERATED by XGENIA packages/xgenia-runtime/src/api/test-slot-feature-parity.ts --write-fixture',
      '// Compiled evaluate(ctx) scripts for every Slot Features node, as the editor deploys them.',
      '// Regenerate after changing slot-feature-cores.js or the converter. Do not edit by hand.',
      'export const SLOT_FEATURE_SCRIPTS: Array<{ nodeType: string; script: string; params: Record<string, unknown>; wired: string[]; round2: Record<string, unknown> | null }> = ' +
        JSON.stringify(fixtures, null, 2) + ';',
      ''
    ].join('\n');
    fs.writeFileSync(fixturePath, body);
    console.log(`fixture written: ${fixturePath} (${fixtures.length} scripts)`);
  }

  console.log(`\n${types.length - failures}/${types.length} node types pass parity in the real XRGS sandbox`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
