/**
 * Slot Feature Node Converter
 * ---------------------------
 * Compiles the "Slot Features" nodes (Cluster Pays, Progressive Meter, Hold And Win Grid, …) into
 * sandbox-safe functions for the RGS `evaluate(ctx)` script.
 *
 * Unlike the older converters, the maths is NOT re-typed here. Each generated function destructures
 * its inputs (graph wires first, side-panel parameters second, the defaults below last) and calls
 * the SAME core function the editor node runs — `slot-feature-cores.js`, embedded once per script by
 * corePrelude() — so the preview and the server cannot drift. The registry below is therefore the
 * single description of each node's ports; the client nodes in
 * private/xgenia-pro-nodes/src/slot-games/features/ mirror it port for port.
 *
 * Conventions the generated functions obey (matching slot-game-node-converter):
 *   * one `inputs` object keyed by the node's input-port names; `inputs.state` for stateful nodes
 *     (fed from ctx.state.__nodes by supabase-converter's STATE_CHANNEL_NODE_TYPES contract);
 *   * returns an object keyed by the RAW output-port names, plus `Done: true` (signal outputs are
 *     booleans server-side) and `updatedState` for stateful nodes;
 *   * signal INPUTS (`reset`, `step`, `start`, …) are read as booleans — "did this fire this round";
 *   * `Seeds` is the ISAAC array; the cores fail closed without it, exactly like Weighted Reels.
 */

import { Node } from './types';
import { CORES_SOURCE } from './slot-feature-cores';

export interface SlotFeatureNodeSpec {
  /** Function name inside slot-feature-cores.js */
  core: string;
  /** Carries state across rounds through ctx.state.__nodes (bounded objects only). */
  stateful: boolean;
  /** Input port names, in order. Signal inputs are listed too (default false). */
  inputs: string[];
  defaults: Record<string, unknown>;
  /** Output port names (raw). `Done` is added by the generator. */
  outputs: string[];
  /** Input port -> core argument rename (e.g. Seeds -> seeds). */
  rename?: Record<string, string>;
  /** Extra core arguments computed from the destructured inputs (JS expressions). */
  derived?: Record<string, string>;
  /** The core reads the live jackpot pools (ctx.jackpots) — the compiler injects `_jackpots`. */
  needsJackpots?: boolean;
  /** Which input ports are signals on the client (documentation for the client nodes). */
  signalInputs?: string[];
}

const SIGNAL_FALSE = false;

export class SlotFeatureNodeRegistry {
  private static readonly NODES: Map<string, SlotFeatureNodeSpec> = new Map<string, SlotFeatureNodeSpec>([
    [
      'Cluster Pays',
      {
        core: 'evaluateClusterPays',
        stateful: false,
        inputs: ['reels', 'minClusterSize', 'wildSymbol', 'paytable', 'betAmount', 'adjacency', 'wildsCountTowardSize'],
        defaults: { reels: [], minClusterSize: 5, wildSymbol: 0, paytable: {}, betAmount: 100, adjacency: 'orthogonal', wildsCountTowardSize: true },
        outputs: ['clusters', 'winningLinesDetails', 'clusterWinnings', 'clusterCount', 'hasWin', 'largestCluster']
      }
    ],
    [
      'Progressive Meter',
      {
        core: 'applyProgressiveMeter',
        stateful: true,
        inputs: ['increment', 'target', 'startValue', 'resetOnFill', 'carryOverflow', 'setValue', 'add', 'addOnDo', 'reset'],
        defaults: { increment: 1, target: 100, startValue: 0, resetOnFill: true, carryOverflow: true, setValue: null, add: SIGNAL_FALSE, addOnDo: true, reset: SIGNAL_FALSE },
        outputs: ['value', 'progress', 'filled', 'fillCount', 'remaining'],
        derived: { add: '(add === true) || (addOnDo !== false)' },
        signalInputs: ['add', 'reset']
      }
    ],
    [
      'Multiplier Ladder',
      {
        core: 'stepMultiplierLadder',
        stateful: true,
        inputs: ['ladder', 'startIndex', 'stepBy', 'step', 'stepOnDo', 'reset'],
        defaults: { ladder: [1, 2, 3, 5], startIndex: 0, stepBy: 1, step: SIGNAL_FALSE, stepOnDo: false, reset: SIGNAL_FALSE },
        outputs: ['multiplier', 'index', 'atMax', 'changed', 'ladder'],
        derived: { step: '(step === true) || (stepOnDo === true)' },
        signalInputs: ['step', 'reset']
      }
    ],
    [
      'Symbol Value Grid',
      {
        core: 'buildSymbolValueGrid',
        stateful: false,
        inputs: ['reels', 'valueSymbol', 'values', 'weights', 'betAmount', 'valuesAreBetMultiples', 'Seeds'],
        defaults: { reels: [], valueSymbol: 0, values: [1, 2, 5, 10], weights: [], betAmount: 100, valuesAreBetMultiples: true, Seeds: [] },
        outputs: ['valueGrid', 'coinPositions', 'coinCount', 'totalValue'],
        rename: { Seeds: 'seeds' }
      }
    ],
    [
      'Coin Collector',
      {
        core: 'collectCoins',
        stateful: false,
        inputs: ['reels', 'valueGrid', 'collectorSymbol', 'requireCollector', 'multiplyByCollectors'],
        defaults: { reels: [], valueGrid: [], collectorSymbol: 0, requireCollector: true, multiplyByCollectors: false },
        outputs: ['collected', 'totalOnGrid', 'coinPositions', 'coinCount', 'collectorPositions', 'collectorCount', 'hasCollector', 'paid']
      }
    ],
    [
      'Jackpot Tiers',
      {
        core: 'evaluateJackpotTiers',
        stateful: false,
        inputs: ['reels', 'jackpotSymbol', 'tiers', 'betAmount'],
        defaults: {
          reels: [],
          jackpotSymbol: 0,
          tiers: [
            { name: 'Mini', count: 3, multiplier: 20 },
            { name: 'Minor', count: 4, multiplier: 100 },
            { name: 'Major', count: 5, multiplier: 1000 }
          ],
          betAmount: 100
        },
        outputs: ['symbolCount', 'positions', 'tierIndex', 'tierName', 'multiplier', 'award', 'hasTier']
      }
    ],
    [
      'RGS Jackpot Pools',
      {
        core: 'resolveJackpotPools',
        stateful: false,
        // `pools` is injected by the compiler from ctx.jackpots (display fields only); the client
        // node's mockPools / fetched pools never reach the server.
        inputs: ['poolName', 'shouldClaim', 'claimOnlyIfClaimable'],
        defaults: { poolName: '', shouldClaim: false, claimOnlyIfClaimable: true },
        outputs: ['pools', 'poolNames', 'poolCount', 'poolValues', 'poolValue', 'poolFound', 'claimable', 'claims', 'claimed', 'totalPoolValue'],
        derived: { pools: 'inputs._jackpots' },
        needsJackpots: true
      }
    ],
    [
      'Bet Mode',
      {
        core: 'computeBetMode',
        stateful: false,
        inputs: ['betAmount', 'mode', 'anteMultiplier', 'bonusBuyMultiplier', 'customMultipliers', 'direction'],
        defaults: { betAmount: 100, mode: 'base', anteMultiplier: 1.25, bonusBuyMultiplier: 100, customMultipliers: {}, direction: 'base-to-cost' },
        outputs: ['mode', 'modeKnown', 'multiplier', 'cost', 'baseBet', 'stakeForPaytable', 'isBase', 'isAnte', 'isBonusBuy', 'forceFeature']
      }
    ],
    [
      'Variant Selector',
      {
        core: 'selectVariant',
        stateful: false,
        inputs: ['variants', 'key', 'fallbackKey'],
        defaults: { variants: {}, key: '', fallbackKey: '' },
        outputs: ['variant', 'selectedKey', 'found', 'keys', 'reelStrips', 'symbolWeights', 'paytable', 'paytableScale', 'rtp']
      }
    ],
    [
      'Sticky Symbols',
      {
        core: 'applyStickySymbols',
        stateful: true,
        inputs: ['reels', 'stickySymbol', 'replaceWith', 'duration', 'capture', 'captureOnDo', 'tick', 'reset'],
        defaults: { reels: [], stickySymbol: 0, replaceWith: null, duration: 0, capture: SIGNAL_FALSE, captureOnDo: true, tick: true, reset: SIGNAL_FALSE },
        outputs: ['reels', 'stickyPositions', 'stickyCount', 'changed'],
        derived: { capture: '(capture === true) || (captureOnDo !== false)' },
        signalInputs: ['capture', 'reset']
      }
    ],
    [
      'Expand Symbols',
      {
        core: 'expandSymbols',
        stateful: false,
        inputs: ['reels', 'symbol', 'mode', 'replaceWith', 'minCount'],
        defaults: { reels: [], symbol: 0, mode: 'column', replaceWith: null, minCount: 1 },
        outputs: ['reels', 'spans', 'anchors', 'expandedCount', 'changed']
      }
    ],
    [
      'Locked Reels',
      {
        core: 'applyLockedReels',
        stateful: true,
        inputs: ['reels', 'lockSymbol', 'lockColumns', 'respins', 'resetOnNewLock', 'start', 'reset'],
        defaults: { reels: [], lockSymbol: 0, lockColumns: [], respins: 3, resetOnNewLock: true, start: SIGNAL_FALSE, reset: SIGNAL_FALSE },
        outputs: ['reels', 'lockedColumns', 'freeColumns', 'lockedCount', 'newLocks', 'respinsLeft', 'roundOver', 'active'],
        signalInputs: ['start', 'reset']
      }
    ],
    [
      'Hold And Win Grid',
      {
        core: 'holdAndWin',
        stateful: true,
        inputs: ['reels', 'coinSymbol', 'blankSymbol', 'symbolWeights', 'respins', 'resetOnNewCoin', 'coinValues', 'coinValueWeights', 'betAmount', 'valuesAreBetMultiples', 'valueGrid', 'Seeds', 'start', 'respin', 'reset'],
        defaults: { reels: [], coinSymbol: 0, blankSymbol: 0, symbolWeights: [], respins: 3, resetOnNewCoin: true, coinValues: [1, 2, 5], coinValueWeights: [], betAmount: 100, valuesAreBetMultiples: true, valueGrid: [], Seeds: [], start: SIGNAL_FALSE, respin: SIGNAL_FALSE, reset: SIGNAL_FALSE },
        outputs: ['grid', 'valueGrid', 'lockedCells', 'lockedCount', 'newCoins', 'respinsLeft', 'isComplete', 'active', 'totalValue', 'isFull'],
        rename: { Seeds: 'seeds' },
        signalInputs: ['start', 'respin', 'reset']
      }
    ],
    [
      'Symbol Upgrade',
      {
        core: 'applySymbolUpgrade',
        stateful: true,
        inputs: ['reels', 'fromSymbol', 'toSymbol', 'duration', 'activate', 'activateOnDo', 'reset'],
        defaults: { reels: [], fromSymbol: 0, toSymbol: 0, duration: 0, activate: SIGNAL_FALSE, activateOnDo: false, reset: SIGNAL_FALSE },
        outputs: ['reels', 'active', 'remaining', 'upgradedCount', 'changed'],
        derived: { activate: '(activate === true) || (activateOnDo === true)' },
        signalInputs: ['activate', 'reset']
      }
    ],
    [
      'Feature Trigger',
      {
        core: 'rollFeatureTrigger',
        stateful: false,
        inputs: ['chance', 'Seeds'],
        defaults: { chance: 0.05, Seeds: [] },
        outputs: ['triggered', 'roll', 'chance'],
        rename: { Seeds: 'seeds' }
      }
    ],
    [
      'Directional Cascade',
      {
        core: 'cascadeDirectional',
        stateful: false,
        inputs: ['reels', 'winningLinesDetails', 'symbolWeights', 'direction', 'Seeds'],
        defaults: { reels: [], winningLinesDetails: [], symbolWeights: [], direction: 'down', Seeds: [] },
        outputs: ['reels', 'removedPositions', 'removedCount', 'hadRemoval', 'direction'],
        rename: { Seeds: 'seeds' }
      }
    ],
    [
      'Wheel Spin',
      {
        core: 'spinWheel',
        stateful: false,
        inputs: ['segments', 'weights', 'prizes', 'Seeds'],
        defaults: { segments: [], weights: [], prizes: [], Seeds: [] },
        outputs: ['segmentIndex', 'prize', 'prizeValue', 'label', 'angle', 'sweep', 'segmentCount', 'segments'],
        rename: { Seeds: 'seeds' }
      }
    ],
    [
      'Pick Bonus',
      {
        core: 'pickBonus',
        stateful: true,
        inputs: ['prizes', 'endMarkers', 'endValue', 'picks', 'pickIndex', 'Seeds', 'start', 'pick', 'reset'],
        defaults: { prizes: [], endMarkers: 1, endValue: 'END', picks: 0, pickIndex: -1, Seeds: [], start: SIGNAL_FALSE, pick: SIGNAL_FALSE, reset: SIGNAL_FALSE },
        outputs: ['revealed', 'total', 'remaining', 'ended', 'active', 'lastPrize', 'lastIsEnd', 'revealedNow', 'poolSize', 'picksMade', 'hiddenCount'],
        rename: { Seeds: 'seeds' },
        signalInputs: ['start', 'pick', 'reset']
      }
    ],
    [
      'Paytable Modifier',
      {
        core: 'modifyPaytable',
        stateful: false,
        inputs: ['paytable', 'scale', 'symbolOverrides', 'mode', 'roundTo'],
        defaults: { paytable: {}, scale: 1, symbolOverrides: {}, mode: 'scale', roundTo: 4 },
        outputs: ['paytable', 'changed', 'scale']
      }
    ],
    [
      'Chapter Branch',
      {
        core: 'chapterBranch',
        stateful: true,
        inputs: ['chapters', 'choice', 'startKey', 'advance', 'reset'],
        defaults: { chapters: {}, choice: '', startKey: '', advance: SIGNAL_FALSE, reset: SIGNAL_FALSE },
        outputs: ['chapter', 'currentKey', 'nextKeys', 'isEnd', 'changed', 'chapterIndex'],
        signalInputs: ['advance', 'reset']
      }
    ],
    [
      'Paytable Rows',
      {
        core: 'paytableRows',
        stateful: false,
        inputs: ['paytable', 'symbolNames', 'betAmount', 'paylinesCount'],
        defaults: { paytable: {}, symbolNames: [], betAmount: 100, paylinesCount: 20 },
        outputs: ['rows', 'flatRows', 'symbolCount', 'betPerLine']
      }
    ]
  ]);

  public static isSlotFeatureNode(nodeType: string): boolean {
    return this.NODES.has(String(nodeType || '').trim());
  }
  public static getSpec(nodeType: string): SlotFeatureNodeSpec | undefined {
    return this.NODES.get(String(nodeType || '').trim());
  }
  public static getAllTypes(): string[] {
    return Array.from(this.NODES.keys());
  }
  public static getStatefulTypes(): string[] {
    return Array.from(this.NODES.entries()).filter(([, s]) => s.stateful).map(([name]) => name);
  }
}

export class SlotFeatureNodeConverter {
  public isSlotFeatureNode(nodeType: string): boolean {
    return SlotFeatureNodeRegistry.isSlotFeatureNode(nodeType);
  }

  public hasAnySlotFeatureNode(nodeTypes: string[]): boolean {
    return nodeTypes.some((t) => SlotFeatureNodeRegistry.isSlotFeatureNode(t));
  }

  public needsJackpots(nodeType: string): boolean {
    return SlotFeatureNodeRegistry.getSpec(nodeType)?.needsJackpots === true;
  }

  /**
   * The shared cores, emitted ONCE per script before the node functions.
   * `CORES_SOURCE` is the text of defineSlotFeatureCores() from slot-feature-cores.js; calling it
   * yields the same functions the editor nodes use. Self-contained by construction (the function
   * references nothing outside itself), so a minified editor bundle still embeds a consistent text.
   */
  public static corePrelude(): string {
    return [
      '// --- Slot Features shared cores (embedded verbatim from slot-feature-cores.js) ---',
      `const __sfc = (${CORES_SOURCE})();`,
      ''
    ].join('\n');
  }

  /**
   * One generated function per node instance. Wires first, then side-panel parameters (both arrive
   * on `inputs`, see supabase-converter's input mapping), then the registry defaults.
   */
  public generateNodeFunctionDefinition(node: Node, functionName: string): string {
    const spec = SlotFeatureNodeRegistry.getSpec(node.typename);
    if (!spec) {
      throw new Error(`Unknown slot feature node type: ${node.typename}`);
    }
    const lines: string[] = [];
    lines.push(`// ${node.typename} — ${node.label || functionName} (core: ${spec.core}${spec.stateful ? ', stateful' : ''})`);
    lines.push(`const ${functionName} = (inputs) => {`);
    lines.push(`  inputs = inputs || {};`);
    for (const port of spec.inputs) {
      const ident = this.identifierFor(port);
      lines.push(`  const ${ident} = inputs[${JSON.stringify(port)}] !== undefined ? inputs[${JSON.stringify(port)}] : ${this.formatDefault(spec.defaults[port])};`);
    }
    if (spec.stateful) {
      lines.push(`  const state = inputs.state && typeof inputs.state === 'object' ? inputs.state : {};`);
    }
    const argEntries: string[] = [];
    for (const port of spec.inputs) {
      const argName = spec.rename?.[port] ?? port;
      if (spec.derived && Object.prototype.hasOwnProperty.call(spec.derived, argName)) continue;
      argEntries.push(`${JSON.stringify(argName)}: ${this.identifierFor(port)}`);
    }
    if (spec.derived) {
      for (const [argName, expr] of Object.entries(spec.derived)) {
        argEntries.push(`${JSON.stringify(argName)}: (${expr})`);
      }
    }
    const call = spec.stateful
      ? `__sfc.${spec.core}(state, { ${argEntries.join(', ')} })`
      : `__sfc.${spec.core}({ ${argEntries.join(', ')} })`;
    lines.push(`  const __r = ${call};`);
    const outs = spec.outputs.map((o) => `${JSON.stringify(o)}: __r[${JSON.stringify(o)}]`);
    outs.push(`Done: true`);
    if (spec.stateful) outs.push(`updatedState: __r.updatedState`);
    lines.push(`  return { ${outs.join(', ')} };`);
    lines.push(`};`);
    return lines.join('\n');
  }

  private identifierFor(port: string): string {
    const clean = port.replace(/[^a-zA-Z0-9_$]/g, '_');
    return /^[0-9]/.test(clean) ? `_${clean}` : clean;
  }

  private formatDefault(value: unknown): string {
    if (value === undefined) return 'undefined';
    return JSON.stringify(value);
  }
}
