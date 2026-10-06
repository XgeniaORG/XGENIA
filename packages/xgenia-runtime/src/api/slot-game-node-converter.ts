/**
 * Slot Game Node Converter — compiles the core slot nodes (Weighted Reels, Check Wins, Calculate
 * Winnings, Get Paytable, …) into the RGS `evaluate(ctx)` script and the cloud function.
 *
 * (2026-10-04) The maths is NOT re-typed here any more. Each node used to be a hand-kept template
 * string re-implementing the editor node (private xgenia-pro-nodes/src/slot-games/*.js), and the two
 * drifted — measured on the same inputs, 15 of 16 node types disagreed (see slot-game-cores.js for the
 * list): the RGS paid a different game from the one the editor previewed. Now every generated function
 * hands its raw inputs (graph wires first, side-panel parameters second — supabase-converter's input
 * mapping — and nothing else: the core owns every default and coercion) to the SAME core function the
 * editor node calls, slot-game-cores.js, embedded once per script by corePrelude() together with the
 * one formula evaluator (formula-eval-core.js). src/api/test-slot-game-parity.ts holds editor and RGS
 * equal in the real XRGS sandbox.
 *
 * Conventions the generated functions obey (the Slot Features converter's):
 *   * one `inputs` object keyed by input-port names; `betAmount` is the round's stake (the compiler
 *     maps it to ctx.bet for every slot node), `inputs.state` for the stateful analysis nodes;
 *   * returns an object keyed by the raw output-port names (+ `updatedState` when stateful);
 *   * a signal input that matters to the maths (Weighted Reels freeSpinTrigger) is read as a boolean —
 *     "did it fire this round";
 *   * a refusal throws, and the compiler names the node in the round's error.
 *
 * History worth keeping: the Weighted Reels template once fell back to Math.random() (rgsRandom after
 * sanitizing) when Seeds was short, and read an undeclared `seeds`, so every dynamic round threw; the
 * Calculate Winnings template parsed its unwired winningLines default with JSON.parse([]) and threw on
 * every round; the free-spins reward formula went through eval(), which the sanitizer replaced with 0.
 * Each was a copy that nothing compared with the editor node.
 */

import { Node } from './types';
import { CORES_SOURCE, FORMULA_SOURCE } from './slot-game-cores';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SlotGameNodeConfig {
  nodeType: string;
  /** Function name in slot-game-cores.js. */
  core: string;
  /** Input ports the core reads (signal ports excluded unless the maths reads them as a boolean). */
  inputPorts: string[];
  /** Output ports (raw names) the generated function returns. */
  outputPorts: string[];
  /** `(state, args)` core whose result carries `updatedState`. */
  isStateful?: boolean;
  /** Reads per-symbol override ports straight from the inputs (symbolPayout<N>, …). */
  supportsDynamicPorts?: boolean;
  /** Alternate input keys (RequestBody style) for cloud function compatibility. */
  inputAliases?: Record<string, string[]>;
  /** Extra core arguments computed from `__args` (JS expressions). */
  derived?: Record<string, string>;
  /** The core reports a missing input as `{ failure, message }` instead of throwing. */
  reportsFailure?: boolean;
  /** Listed so the editor's maths gate sees it, but refused by the RGS compiler — and why. */
  rgsUnsupported?: string;
}

// ============================================================================
// SLOT GAME NODE REGISTRY
// ============================================================================

export class SlotGameNodeRegistry {
  private static readonly SLOT_GAME_NODES: Map<string, SlotGameNodeConfig> = new Map([
    [
      'Check Jackpot',
      {
        nodeType: 'Check Jackpot',
        core: 'checkJackpot',
        inputPorts: ['reels', 'winningSymbol'],
        outputPorts: ['isWin', 'jackpotWinningPositions', 'winningSymbol']
      }
    ],
    [
      'Calculate Winnings',
      {
        nodeType: 'Calculate Winnings',
        core: 'calculateWinnings',
        inputPorts: ['winningLines', 'betAmount', 'wildSymbol', 'paytable', 'paylines'],
        outputPorts: ['spinWinnings', 'winningLinesDetails']
      }
    ],
    [
      'Check Wins',
      {
        nodeType: 'Check Wins',
        core: 'checkWins',
        inputPorts: ['wildSymbol', 'freeSpinsSymbol', 'minConsecutiveSymbols', 'reels', 'customPaylines'],
        outputPorts: ['winningLines', 'paylines']
      }
    ],
    [
      'Get Paytable',
      {
        nodeType: 'Get Paytable',
        core: 'getPaytable',
        inputPorts: ['numberOfSymbols', 'columnSize', 'minConsecutiveSymbols', 'payoutFormula'],
        outputPorts: ['paytable'],
        supportsDynamicPorts: true
      }
    ],
    [
      'Generate Symbol Weights',
      {
        nodeType: 'Generate Symbol Weights',
        core: 'generateSymbolWeights',
        inputPorts: ['numberOfSymbols', 'weightFormula'],
        outputPorts: ['normalizedBaseWeights'],
        supportsDynamicPorts: true
      }
    ],
    [
      'Reel Strips Generator',
      {
        nodeType: 'Reel Strips Generator',
        core: 'reelStripsGenerator',
        inputPorts: ['symbolWeights', 'randomSeeds', 'columnSize'],
        outputPorts: ['reelStrips'],
        reportsFailure: true
      }
    ],
    [
      'Generate Reel Strips',
      {
        nodeType: 'Generate Reel Strips',
        core: '',
        inputPorts: ['seed', 'rows', 'columns', 'weightFormula'],
        outputPorts: ['slotRows', 'slotColumns', 'reelStrips'],
        // (2026-10-04) The editor node fetches its strips over HTTP from an external service
        // (engine-typescript.vercel.app); the template that stood here invented its own strips from
        // the same seed — for seed 12345 / 5 x 3 the service returns 29-symbol strips, the template
        // made 19-symbol ones. A compiled maths cannot reach that service, so the node is refused
        // (reported by CloudFunctionConverter.getUnsupportedNodes(), which the deploy path refuses)
        // instead of paying a game nobody previewed. Reel Strips Generator is the seeded, shared one.
        rgsUnsupported:
          'Generate Reel Strips takes its strips from an external web service in the editor, which the RGS cannot reach or reproduce; use Reel Strips Generator (ISAAC-seeded, the same maths in the editor and the RGS) or fixed reelStrips.'
      }
    ],
    [
      'Calculate Free Spins States',
      {
        nodeType: 'Calculate Free Spins States',
        core: 'calculateFreeSpinsStates',
        inputPorts: [
          'engineReels',
          'currentFreeSpins',
          'betAmount',
          'capital',
          'totalBets',
          'totalFreeSpinsWon',
          'blockedReels',
          'freeSpinsSymbol',
          'freeSpinsRewardFormula'
        ],
        outputPorts: [
          'capital',
          'totalBets',
          'currentFreeSpins',
          'freeSpinsSymbolCount',
          'currentFreeSpinsWon',
          'totalFreeSpinsWon',
          'currentFreeSpinsLines'
        ],
        supportsDynamicPorts: true
      }
    ],
    [
      'Volatility Estimator',
      {
        nodeType: 'Volatility Estimator',
        core: 'volatilityEstimator',
        inputPorts: ['spinResults', 'reset'],
        outputPorts: ['volatilityResult', 'standardDeviation', 'mean', 'variance', 'amplitude'],
        isStateful: true
      }
    ],
    [
      'Symbol Frequency Tracker',
      {
        nodeType: 'Symbol Frequency Tracker',
        core: 'symbolFrequencyTracker',
        inputPorts: ['numberOfSymbols', 'reels', 'reset'],
        outputPorts: ['symbolCountResults', 'symbolFrequencyResults'],
        isStateful: true
      }
    ],
    [
      'Spin Result',
      {
        nodeType: 'Spin Result',
        core: 'spinResult',
        inputPorts: [
          'reels',
          'stopPosList',
          'spinWinnings',
          'betAmount',
          'totalBets',
          'totalWinnings',
          'hits',
          'spinCount',
          'currentFreeSpinsWon',
          'totalFreeSpinsWon',
          'currentFreeSpins',
          'currentFreeSpinsLines',
          'winningLinesDetails',
          'freeSpinsSymbolCount',
          'jackpotWinnings',
          'winningJackpot',
          'jackpotWinningPositions',
          'enableSimulation',
          'hitFrequencyDataSeries',
          'RTPDataSeries'
        ],
        outputPorts: [
          'finalResult',
          'stopPosList',
          'isBigWin',
          'totalBets',
          'totalWinnings',
          'hitFrequency',
          'RTP',
          'currentFreeSpinsWon',
          'totalFreeSpinsWon',
          'currentFreeSpins',
          'currentFreeSpinsLines',
          'spinResults',
          'hitFrequencyDataSeries',
          'RTPDataSeries'
        ],
        isStateful: true
      }
    ],
    [
      'Spin Calculate',
      {
        nodeType: 'Spin Calculate',
        core: 'spinCalculate',
        inputPorts: [
          'betAmount',
          'capital',
          'totalBets',
          'spinWinnings',
          'totalWinnings',
          'currentFreeSpins',
          'totalWinningsFromFreeSpins',
          'spinCount',
          'hits',
          'jackpotWinnings',
          'winningJackpot',
          'cascadingReelsEnabled'
        ],
        outputPorts: ['capital', 'totalBets', 'totalWinnings', 'totalWinningsFromFreeSpins', 'spinCount', 'hits']
      }
    ],
    [
      'Weighted Reels',
      {
        nodeType: 'Weighted Reels',
        core: 'weightedReels',
        inputPorts: ['reelStrips', 'Seeds', 'rowSize', 'symbolWeights', 'freeSpinSymbol', 'blockedReels', 'stopPosList', 'isDynamic', 'freeSpinTrigger'],
        outputPorts: ['reels', 'stopPosList'],
        // The Free Spin Trigger signal, read as "fired this round": the editor's two free-spin paths
        // (the free-spin symbol forced onto the reels) run on the RGS too — they had no counterpart.
        derived: { freeSpin: '__args.freeSpinTrigger === true' },
        inputAliases: {
          reelStrips: ['Reel_Strips'],
          rowSize: ['Row_Size'],
          symbolWeights: ['Symbol_Weights'],
          freeSpinSymbol: ['Free_Spin_Symbol'],
          blockedReels: ['Blocked_Reels'],
          stopPosList: ['Stop_Positions_List'],
          isDynamic: ['Is_Dynamic']
        }
      }
    ],
    [
      'Reel Ways Check Wins',
      {
        nodeType: 'Reel Ways Check Wins',
        core: 'checkReelWaysWins',
        inputPorts: ['numberOfSymbols', 'wildSymbol', 'freeSpinsSymbol', 'reels', 'minConsecutiveSymbols'],
        outputPorts: ['winningLines'],
        inputAliases: {
          numberOfSymbols: ['Number_of_Symbols'],
          wildSymbol: ['Wild_Symbol'],
          freeSpinsSymbol: ['Free_Spins_Symbol'],
          reels: ['Reels'],
          minConsecutiveSymbols: ['Min_Consecutive_Symbols']
        }
      }
    ],
    [
      'Init Free Spins',
      {
        nodeType: 'Init Free Spins',
        core: 'initFreeSpins',
        inputPorts: ['reelStrips', 'freeSpinsSymbol', 'blockedReels'],
        outputPorts: ['reelStrips'],
        inputAliases: {
          reelStrips: ['Reel_Strips'],
          freeSpinsSymbol: ['Free_Spins_Symbol'],
          blockedReels: ['Blocked_Reels']
        }
      }
    ],
    [
      'Reel Ways Calculate Winnings',
      {
        nodeType: 'Reel Ways Calculate Winnings',
        core: 'calculateReelWaysWinnings',
        inputPorts: ['winningLines', 'betAmount', 'wildSymbol', 'paytable'],
        outputPorts: ['spinWinnings', 'winningLinesDetails'],
        inputAliases: {
          winningLines: ['Winning_Lines'],
          betAmount: ['Bet_Amount'],
          wildSymbol: ['Wild_Symbol'],
          paytable: ['Paytable']
        }
      }
    ]
  ]);

  /** A slot game node the compiler turns into server-side code. */
  public static isSlotGameNode(nodeType: string): boolean {
    const config = this.SLOT_GAME_NODES.get(nodeType);
    return !!config && !config.rgsUnsupported;
  }

  /** Why a listed slot node is refused by the RGS compiler (undefined when it compiles). */
  public static rgsUnsupportedReason(nodeType: string): string | undefined {
    return this.SLOT_GAME_NODES.get(nodeType)?.rgsUnsupported;
  }

  public static getSlotGameNodeConfig(nodeType: string): SlotGameNodeConfig | undefined {
    const config = this.SLOT_GAME_NODES.get(nodeType);
    return config && !config.rgsUnsupported ? config : undefined;
  }

  /** Every slot game node type the compiler turns into server-side code. */
  public static getAllSlotGameNodeTypes(): string[] {
    return Array.from(this.SLOT_GAME_NODES.keys()).filter((t) => this.isSlotGameNode(t));
  }

  public static isStatefulSlotGameNode(nodeType: string): boolean {
    return this.getSlotGameNodeConfig(nodeType)?.isStateful === true;
  }
}

// ============================================================================
// MAIN SLOT GAME NODE CONVERTER
// ============================================================================

export class SlotGameNodeConverter {
  public isSlotGameNode(nodeType: string): boolean {
    return SlotGameNodeRegistry.isSlotGameNode(nodeType);
  }

  public isStatefulSlotGameNode(nodeType: string): boolean {
    return SlotGameNodeRegistry.isStatefulSlotGameNode(nodeType);
  }

  public hasAnySlotGameNode(nodeTypes: string[]): boolean {
    return nodeTypes.some((t) => SlotGameNodeRegistry.isSlotGameNode(t));
  }

  /**
   * The shared cores, emitted ONCE per script before the node functions: slot-game-cores.js called
   * with formula-eval-core.js, the same two function bodies the editor nodes run. Self-contained by
   * construction (neither references anything outside itself).
   */
  public static corePrelude(): string {
    return [
      '// --- Slot game shared cores (embedded verbatim from slot-game-cores.js and formula-eval-core.js) ---',
      `const __sgc = (${CORES_SOURCE})((${FORMULA_SOURCE})());`,
      ''
    ].join('\n');
  }

  /**
   * One generated function per node instance: copy the raw inputs, resolve the RequestBody-style
   * aliases, call the core, return its outputs by raw port name.
   */
  public generateSlotGameNodeFunctionDefinition(node: Node, functionName: string): string {
    const config = SlotGameNodeRegistry.getSlotGameNodeConfig(node.typename);
    if (!config) {
      throw new Error(`Slot game node configuration not found for type: ${node.typename}`);
    }
    const lines: string[] = [];
    lines.push(`// ${node.typename} — ${node.label || functionName} (slot-game core: ${config.core}${config.isStateful ? ', stateful' : ''})`);
    lines.push(`const ${functionName} = (inputs: Record<string, any>) => {`);
    lines.push(`  const __args = Object.assign({}, inputs || {});`);
    for (const [port, aliases] of Object.entries(config.inputAliases || {})) {
      for (const alias of aliases) {
        if (alias === port) continue;
        lines.push(`  if (__args[${JSON.stringify(port)}] == null && __args[${JSON.stringify(alias)}] != null) __args[${JSON.stringify(port)}] = __args[${JSON.stringify(alias)}];`);
      }
    }
    for (const [arg, expr] of Object.entries(config.derived || {})) {
      lines.push(`  __args[${JSON.stringify(arg)}] = (${expr});`);
    }
    const call = config.isStateful
      ? `__sgc.${config.core}((inputs && inputs.state) || {}, __args)`
      : `__sgc.${config.core}(__args)`;
    lines.push(`  const __r = ${call};`);
    if (config.reportsFailure) lines.push(`  if (__r.failure) throw new Error(__r.message);`);
    const outs = config.outputPorts.map((o) => `${JSON.stringify(o)}: __r[${JSON.stringify(o)}]`);
    // (2026-10-05) The editor node fires Done when it has run, and graphs wire it onward (Spin
    // Result.Done → Component Outputs.SpinDone). The function had no Done, so a Component Output fed
    // by it read undefined on every round. A refusal throws above, so reaching here IS the Done the
    // editor sends (the Slot Features functions already return it).
    outs.push(`"Done": true`);
    if (config.isStateful) outs.push(`updatedState: __r.updatedState`);
    lines.push(`  return { ${outs.join(', ')} };`);
    lines.push(`};`);
    return lines.join('\n    ');
  }
}
