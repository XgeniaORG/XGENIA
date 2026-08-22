/**
 * Slot Game Node Converter - Handles all slot game-related node conversions
 *
 * This module provides a clean, maintainable, and scalable architecture for
 * converting XGENIA slot game nodes to Supabase Edge Function code.
 */

import { Node } from './types';
import { EVALUATE_FORMULA_JS } from './formula-eval-emit';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Slot game node configuration
 */
export interface SlotGameNodeConfig {
  nodeType: string;
  inputPorts: string[];
  outputPorts: string[];
  defaultValues: Record<string, any>;
  calculationMethod: string;
  isStateful?: boolean;
  stateKeys?: string[];
  supportsDynamicPorts?: boolean;
  /** Alternate input keys (e.g. RequestBody style) for cloud function compatibility */
  inputAliases?: Record<string, string[]>;
}

/**
 * Slot game node calculation result
 */
export interface SlotGameNodeResult {
  functionDefinition: string;
  inputMapping: string;
  outputMapping: string;
  calculationLogic: string;
}

// ============================================================================
// SLOT GAME NODE REGISTRY
// ============================================================================

/**
 * Registry of all supported slot game nodes
 */
export class SlotGameNodeRegistry {
  private static readonly SLOT_GAME_NODES: Map<string, SlotGameNodeConfig> = new Map([
    // Core Game Logic - Simple Nodes
    [
      'Check Jackpot',
      {
        nodeType: 'Check Jackpot',
        inputPorts: ['reels', 'winningSymbol'],
        outputPorts: ['isWin', 'jackpotWinningPositions', 'winningSymbol'],
        // Editor port default (check-jackpot.js winningSymbol input port): 1.
        defaultValues: { winningSymbol: 1 },
        calculationMethod: 'checkJackpot',
        isStateful: false
      }
    ],
    [
      'Calculate Winnings',
      {
        nodeType: 'Calculate Winnings',
        inputPorts: ['winningLines', 'betAmount', 'wildSymbol', 'paytable', 'paylines'],
        outputPorts: ['spinWinnings', 'winningLinesDetails'],
        defaultValues: {
          wildSymbol: 9,
          // 2026-07-03: aligned to the editor node's default (calculate-winnings.js: 100).
          // 250 here skewed RGS RTP vs the editor preview when betAmount was unwired.
          betAmount: 100,
          winningLines: [],
          paylines: [],
          paytable: {}
        },
        calculationMethod: 'calculateWinnings',
        isStateful: false
      }
    ],
    [
      'Check Wins',
      {
        nodeType: 'Check Wins',
        inputPorts: ['wildSymbol', 'freeSpinsSymbol', 'minConsecutiveSymbols', 'reels', 'customPaylines'],
        outputPorts: ['winningLines', 'paylines'],
        defaultValues: { wildSymbol: 9, freeSpinsSymbol: 10, minConsecutiveSymbols: 3 },
        calculationMethod: 'checkWins',
        isStateful: false
      }
    ],
    [
      'Get Paytable',
      {
        nodeType: 'Get Paytable',
        inputPorts: ['numberOfSymbols', 'columnSize', 'minConsecutiveSymbols', 'payoutFormula'],
        outputPorts: ['paytable'],
        defaultValues: {
          numberOfSymbols: 10,
          columnSize: 5,
          minConsecutiveSymbols: 3,
          payoutFormula: '2.25 + 0.75 * x'
        },
        calculationMethod: 'getPaytable',
        isStateful: false,
        supportsDynamicPorts: true
      }
    ],

    // Data Generation Nodes
    [
      'Generate Symbol Weights',
      {
        nodeType: 'Generate Symbol Weights',
        inputPorts: ['numberOfSymbols', 'weightFormula'],
        outputPorts: ['normalizedBaseWeights'],
        defaultValues: { numberOfSymbols: 10, weightFormula: 'exp(-x / 15)' },
        calculationMethod: 'generateSymbolWeights',
        isStateful: false,
        supportsDynamicPorts: true
      }
    ],
    [
      'Reel Strips Generator',
      {
        nodeType: 'Reel Strips Generator',
        inputPorts: ['symbolWeights', 'randomSeeds', 'columnSize'],
        outputPorts: ['reelStrips'],
        defaultValues: { columnSize: 5 },
        calculationMethod: 'generateReelStrips',
        isStateful: false
      }
    ],
    [
      'Generate Reel Strips',
      {
        nodeType: 'Generate Reel Strips',
        inputPorts: ['seed', 'rows', 'columns', 'weightFormula'],
        outputPorts: ['slotRows', 'slotColumns', 'reelStrips'],
        defaultValues: { seed: 0, rows: 3, columns: 5, weightFormula: 'exp(-x / 15)' },
        calculationMethod: 'generateReelStripsFromSeed',
        isStateful: false
      }
    ],
    [
      'Calculate Free Spins States',
      {
        nodeType: 'Calculate Free Spins States',
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
        defaultValues: {
          engineReels: [],
          currentFreeSpins: 0,
          betAmount: 0,
          capital: 0,
          totalBets: 0,
          totalFreeSpinsWon: 0,
          blockedReels: '0,4',
          freeSpinsSymbol: 10,
          freeSpinsRewardFormula: 'x <= 1 ? 0 : (x * (x + 1)) / 2'
        },
        calculationMethod: 'calculateFreeSpinsStates',
        isStateful: false
      }
    ],

    // Analysis Tools - Stateful Nodes
    [
      'Volatility Estimator',
      {
        nodeType: 'Volatility Estimator',
        inputPorts: ['spinResults', 'reset'],
        outputPorts: ['volatilityResult', 'standardDeviation', 'mean', 'variance', 'amplitude'],
        defaultValues: { reset: false },
        calculationMethod: 'calculateVolatility',
        isStateful: true,
        stateKeys: ['cumulativeValues']
      }
    ],
    [
      'Symbol Frequency Tracker',
      {
        nodeType: 'Symbol Frequency Tracker',
        inputPorts: ['numberOfSymbols', 'reels', 'reset'],
        outputPorts: ['symbolCountResults', 'symbolFrequencyResults'],
        defaultValues: { numberOfSymbols: 10, reset: false },
        calculationMethod: 'trackSymbolFrequency',
        isStateful: true,
        stateKeys: ['symbolCountResults', 'symbolFrequencyResults']
      }
    ],

    // Complex Nodes - Future Implementation
    [
      'Spin Result',
      {
        nodeType: 'Spin Result',
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
          'enableSimulation'
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
        defaultValues: {
          reels: [],
          stopPosList: [],
          spinWinnings: 0,
          betAmount: 0,
          totalBets: 0,
          totalWinnings: 0,
          hits: 0,
          spinCount: 0,
          currentFreeSpinsWon: 0,
          totalFreeSpinsWon: 0,
          currentFreeSpins: 0,
          currentFreeSpinsLines: [],
          winningLinesDetails: [],
          freeSpinsSymbolCount: 0,
          jackpotWinnings: 0,
          winningJackpot: false,
          jackpotWinningPositions: [],
          enableSimulation: false
        },
        calculationMethod: 'aggregateSpinResult',
        isStateful: true,
        stateKeys: ['hitFrequencyDataSeries', 'RTPDataSeries']
      }
    ],
    [
      'Spin Calculate',
      {
        nodeType: 'Spin Calculate',
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
        outputPorts: ['capital', 'totalBets', 'totalWinnings', 'totalWinningsFromFreeSpins', 'spinCount', 'hits'],
        defaultValues: {
          // 2026-07-03: aligned to the editor node's default (spin-calculate.js: 100).
          // 0 here made totalBets 0 for unwired games → RGS RTP guard returned 0 forever.
          betAmount: 100,
          capital: 0,
          totalBets: 0,
          spinWinnings: 0,
          totalWinnings: 0,
          currentFreeSpins: 0,
          totalWinningsFromFreeSpins: 0,
          spinCount: 0,
          hits: 0,
          jackpotWinnings: 0,
          winningJackpot: false,
          cascadingReelsEnabled: false
        },
        calculationMethod: 'spinCalculate',
        isStateful: false
      }
    ],
    [
      'Weighted Reels',
      {
        nodeType: 'Weighted Reels',
        inputPorts: [
          'reelStrips',
          'Seeds',
          'rowSize',
          'symbolWeights',
          'freeSpinSymbol',
          'blockedReels',
          'stopPosList',
          'isDynamic',
          'Do'
        ],
        outputPorts: ['reels', 'stopPosList'],
        defaultValues: {
          reelStrips: [],
          Seeds: [],
          rowSize: 3,
          symbolWeights: [],
          freeSpinSymbol: null,
          blockedReels: '0,4',
          stopPosList: [],
          isDynamic: false,
          Do: true
        },
        calculationMethod: 'generateWeightedReels',
        isStateful: false,
        inputAliases: {
          reelStrips: ['Reel_Strips'],
          rowSize: ['Row_Size'],
          symbolWeights: ['Symbol_Weights'],
          freeSpinSymbol: ['Free_Spin_Symbol'],
          blockedReels: ['Blocked_Reels'],
          stopPosList: ['Stop_Positions_List'],
          isDynamic: ['Is_Dynamic'],
        }
      }
    ],
    [
      'Reel Ways Check Wins',
      {
        nodeType: 'Reel Ways Check Wins',
        inputPorts: ['numberOfSymbols', 'wildSymbol', 'freeSpinsSymbol', 'reels', 'minConsecutiveSymbols', 'Do'],
        outputPorts: ['winningLines'],
        defaultValues: {
          numberOfSymbols: 8,
          wildSymbol: 9,
          freeSpinsSymbol: 10,
          reels: [],
          minConsecutiveSymbols: 3,
          Do: true
        },
        calculationMethod: 'checkReelWaysWins',
        isStateful: false,
        inputAliases: {
          numberOfSymbols: ['Number_of_Symbols'],
          wildSymbol: ['Wild_Symbol'],
          freeSpinsSymbol: ['Free_Spins_Symbol'],
          reels: ['Reels'],
          minConsecutiveSymbols: ['Min_Consecutive_Symbols'],
          Do: ['Do']
        }
      }
    ],
    [
      'Init Free Spins',
      {
        nodeType: 'Init Free Spins',
        inputPorts: ['reelStrips', 'freeSpinsSymbol', 'blockedReels', 'Do'],
        outputPorts: ['reelStrips'],
        defaultValues: {
          reelStrips: [],
          freeSpinsSymbol: 10,
          blockedReels: '0,4',
          Do: true
        },
        calculationMethod: 'initializeFreeSpins',
        isStateful: false,
        inputAliases: {
          reelStrips: ['Reel_Strips'],
          freeSpinsSymbol: ['Free_Spins_Symbol'],
          blockedReels: ['Blocked_Reels'],
          Do: ['Do']
        }
      }
    ],
    [
      'Reel Ways Calculate Winnings',
      {
        nodeType: 'Reel Ways Calculate Winnings',
        inputPorts: ['winningLines', 'betAmount', 'wildSymbol', 'paytable', 'Do'],
        outputPorts: ['spinWinnings', 'winningLinesDetails'],
        defaultValues: {
          winningLines: [],
          betAmount: 100,
          wildSymbol: 9,
          paytable: {},
          Do: true
        },
        calculationMethod: 'calculateReelWaysWinnings',
        isStateful: false,
        inputAliases: {
          winningLines: ['Winning_Lines'],
          betAmount: ['Bet_Amount'],
          wildSymbol: ['Wild_Symbol'],
          paytable: ['Paytable'],
          Do: ['Do']
        }
      }
    ]
  ]);

  /**
   * Check if a node type is a slot game node
   */
  public static isSlotGameNode(nodeType: string): boolean {
    return this.SLOT_GAME_NODES.has(nodeType);
  }

  /**
   * Get slot game node configuration
   */
  public static getSlotGameNodeConfig(nodeType: string): SlotGameNodeConfig | undefined {
    return this.SLOT_GAME_NODES.get(nodeType);
  }

  /**
   * Get all supported slot game node types
   */
  public static getAllSlotGameNodeTypes(): string[] {
    return Array.from(this.SLOT_GAME_NODES.keys());
  }

  /**
   * Check if a slot game node is stateful
   */
  public static isStatefulSlotGameNode(nodeType: string): boolean {
    const config = this.SLOT_GAME_NODES.get(nodeType);
    return config?.isStateful || false;
  }
}

// ============================================================================
// CALCULATION LOGIC GENERATORS
// ============================================================================

/**
 * Generates calculation logic for different slot game node types
 */
export class SlotGameCalculationGenerator {
  /**
   * Generate calculation logic for a slot game node
   */
  public static generateCalculationLogic(nodeType: string): string {
    const generatorMap: Record<string, () => string> = {
      'Check Jackpot': () => this.generateCheckJackpotLogic(),
      'Calculate Winnings': () => this.generateCalculateWinningsLogic(),
      'Check Wins': () => this.generateCheckWinsLogic(),
      'Get Paytable': () => this.generateGetPaytableLogic(),
      'Generate Symbol Weights': () => this.generateSymbolWeightsLogic(),
      'Reel Strips Generator': () => this.generateReelStripsLogic(),
      'Generate Reel Strips': () => this.generateReelStripsFromSeedLogic(),
      'Calculate Free Spins States': () => this.generateCalculateFreeSpinsStatesLogic(),
      'Volatility Estimator': () => this.generateVolatilityEstimatorLogic(),
      'Symbol Frequency Tracker': () => this.generateSymbolFrequencyTrackerLogic(),
      'Spin Result': () => this.generateSpinResultLogic(),
      'Spin Calculate': () => this.generateSpinCalculateLogic(),
      'Init Free Spins': () => this.generateInitFreeSpinsLogic(),
      'Weighted Reels': () => this.generateWeightedReelsLogic(),
      'Reel Ways Check Wins': () => this.generateReelWaysCheckWinsLogic(),
      'Reel Ways Calculate Winnings': () => this.generateReelWaysCalculateWinningsLogic()
    };

    const generator = generatorMap[nodeType];
    if (!generator) {
      throw new Error(`Unknown slot game node type: ${nodeType}`);
    }

    return generator();
  }

  // ============================================================================
  // CORE GAME LOGIC
  // ============================================================================

  private static generateCheckJackpotLogic(): string {
    return `
      // Validate inputs
      if (!Array.isArray(reels) || reels.length === 0) {
        throw new Error('Reels must be a non-empty array');
      }
      
      const reelsCount = reels.length;
      let matchingColumns = 0;
      const positions = [];
      
      for (let col = 0; col < reels.length; col++) {
        const reel = reels[col];
        let colHasSymbol = false;
        for (let row = 0; row < reel.length; row++) {
          if (reel[row] === winningSymbol) {
            positions.push([row, col]);
            colHasSymbol = true;
          }
        }
        if (colHasSymbol) matchingColumns += 1;
      }
      
      const isWin = matchingColumns === reelsCount;
      const jackpotWinningPositions = positions;`;
  }

  private static generateCalculateWinningsLogic(): string {
    return `
      // Validate inputs
      if (!Array.isArray(winningLines)) {
        throw new Error('Winning lines must be an array');
      }

      // Match editor node (calculate-winnings.js betAmount setter): clamp to [1, 1000000], default 100, never throw
      const _betAmount = Math.min(Math.max(Number(betAmount) || 100, 1), 1000000);

      if (!paytable || typeof paytable !== 'object') {
        throw new Error('Paytable must be a valid object');
      }

      if (!Array.isArray(paylines) || paylines.length === 0) {
        throw new Error('Paylines must be a non-empty array');
      }

      const _wildSymbol = Number(wildSymbol) || 9;

      let currentSpinWinnings = 0;
      const winningLinesDetails = [];

      for (const winLine of winningLines) {
        const linePayout = checkPayline(winLine, _betAmount, _wildSymbol, paytable, paylines);

        if (linePayout > 0) {
          currentSpinWinnings += linePayout;
          winningLinesDetails.push({
            line: winLine[0],
            symbols: winLine[1],
            positions: calculateSymbolsPosition(winLine, paylines),
            payout: linePayout
          });
        }
      }

      // Helper function to check payline payout
      function checkPayline(winLine, betAmount, wildSymbol, paytable, paylines) {
        const payoutMultiplier = winLine[1].length;
        const betAmountPerLine = betAmount / paylines.length;

        let payoutSymbol = null;
        for (const symbol of winLine[1]) {
          if (symbol !== wildSymbol) {
            payoutSymbol = symbol;
            break;
          }
        }

        if (payoutSymbol in paytable && payoutMultiplier in paytable[payoutSymbol]) {
          return Math.round(betAmountPerLine * paytable[payoutSymbol][payoutMultiplier]);
        }

        return 0;
      }

      // Helper function to calculate symbol positions
      function calculateSymbolsPosition(winLine, paylines) {
        const lineIndex = winLine[0] - 1;
        const sequenceLength = winLine[1].length;
        const positions = [];
        const lineToCheck = paylines[lineIndex];

        for (let i = 0; i < sequenceLength; i++) {
          const [col, row] = lineToCheck[i];
          positions.push([row, col]);
        }

        return positions;
      }

      const spinWinnings = currentSpinWinnings;`;
  }

  private static generateCheckWinsLogic(): string {
    return `
      // Validate inputs
      if (!Array.isArray(reels) || reels.length === 0) {
        throw new Error('Reels must be a non-empty array');
      }

      const winningLines = [];
      const numRows = reels[0].length;
      const numCols = reels.length;

      // Default paylines if none provided.
      // 2026-07-03 (editor↔RGS divergence, user-approved alignment): the editor's
      // Check Wins node defaults to TWENTY paylines (check-wins.js); this compiled
      // default stopped at the first 5, so any payline slot with no customPaylines
      // measured a materially LOWER RTP on the RGS than in the editor preview.
      // This is the editor's exact 20-line list, verbatim.
      let paylines = customPaylines || [
        [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
        [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
        [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]],
        [[0, 0], [1, 1], [2, 2], [3, 1], [4, 0]],
        [[0, 2], [1, 1], [2, 0], [3, 1], [4, 2]],
        [[0, 0], [1, 0], [2, 1], [3, 2], [4, 2]],
        [[0, 2], [1, 2], [2, 1], [3, 0], [4, 0]],
        [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]],
        [[0, 2], [1, 1], [2, 2], [3, 1], [4, 2]],
        [[0, 1], [1, 0], [2, 0], [3, 0], [4, 1]],
        [[0, 1], [1, 2], [2, 2], [3, 2], [4, 1]],
        [[0, 1], [1, 0], [2, 1], [3, 2], [4, 1]],
        [[0, 1], [1, 2], [2, 1], [3, 0], [4, 1]],
        [[0, 0], [1, 1], [2, 1], [3, 1], [4, 0]],
        [[0, 2], [1, 1], [2, 1], [3, 1], [4, 2]],
        [[0, 0], [1, 0], [2, 2], [3, 2], [4, 0]],
        [[0, 2], [1, 2], [2, 0], [3, 0], [4, 2]],
        [[0, 0], [1, 2], [2, 0], [3, 2], [4, 0]],
        [[0, 2], [1, 0], [2, 2], [3, 0], [4, 2]],
        [[0, 1], [1, 2], [2, 0], [3, 2], [4, 1]]
      ];

      for (const [lineIndex, lineValue] of paylines.entries()) {
        const line = [];

        for (const [idx, pos] of lineValue.entries()) {
          if (Array.isArray(pos)) {
            const [col, row] = pos;
            if (row >= numRows || col >= numCols) continue;
            const symbol = reels[col][row];
            line.push(symbol);
          }
        }

        // Skip lines where a free spins symbol interferes before a valid run can form
        // (matches editor Check Wins node check-wins.js). console.info dropped to avoid
        // nested template-literal escaping; logging does not affect RTP.
        if (line.includes(wildSymbol) && line.includes(freeSpinsSymbol)) {
          const freeSpinsIndex = line.indexOf(freeSpinsSymbol);
          const winPossible = line
            .slice(0, Math.min(freeSpinsIndex, minConsecutiveSymbols))
            .some((sym, i) => sym === wildSymbol || (sym === line[0] && line[0] !== freeSpinsSymbol));
          if (!winPossible) {
            continue;
          }
        }

        // Skip lines with all wild symbols or all free spins symbols
        if (line.every(symbol => symbol === wildSymbol) || 
            line.every(symbol => symbol === freeSpinsSymbol)) {
          continue;
        }

        let firstNonWildSymbol = null;
        let isWin = true;
        let longestWinLine = [];

        for (let i = 0; i < line.length; i++) {
          const symbol = line[i];
          if (symbol !== wildSymbol) {
            if (firstNonWildSymbol === null) {
              firstNonWildSymbol = symbol;
            } else if (symbol !== firstNonWildSymbol) {
              isWin = false;
              break;
            }
          }
          if (isWin && i >= minConsecutiveSymbols - 1) {
            longestWinLine = line.slice(0, i + 1);
          }
        }

        if (longestWinLine.length > 0) {
          winningLines.push([lineIndex + 1, longestWinLine]);
        }
      }`;
  }

  /**
   * Reel Ways Check Wins - finds all winning ways (symbol + position combinations)
   * using cartesian product of symbol/position matches across reels. Excludes free spins symbol.
   */
  private static generateReelWaysCheckWinsLogic(): string {
    return `
      // Helper: cartesian product of arrays
      function cartesianProduct(arrays) {
        return arrays.reduce((a, b) => a.flatMap((d) => b.map((e) => [...d, e])), [[]]);
      }

      // Validate inputs
      if (!Array.isArray(reels) || reels.length === 0) {
        throw new Error('Reels array is required and cannot be empty');
      }
      if (!reels.every((reel) => Array.isArray(reel))) {
        throw new Error('All reels must be arrays');
      }

      const _numSymbols = Math.max(1, Number(numberOfSymbols) || 8);
      const _wild = Number(wildSymbol) || 9;
      const _freeSpin = Number(freeSpinsSymbol) || 10;
      const _minConsec = Math.max(1, Number(minConsecutiveSymbols) || 3);

      const winningLines = [];
      let symbolSet = new Set(Array.from({ length: _numSymbols }, (_, i) => i + 1));
      const symbolSetList = [];
      symbolSet.delete(_freeSpin);

      for (let i = 0; i < reels.length; i++) {
        const reel = reels[i];
        if (!reel.includes(_wild)) {
          if (i >= _minConsec) {
            symbolSetList.push([new Set([...symbolSet].filter((x) => !reel.includes(x))), i]);
          }
          symbolSet = new Set([...symbolSet].filter((x) => reel.includes(x)));
        }
      }
      symbolSetList.push([symbolSet, reels.length]);

      for (const [symbols, comboLength] of symbolSetList) {
        for (const symbol of symbols) {
          const winningSymbols = [];
          const winningPositions = [];

          for (let i = 0; i < comboLength; i++) {
            const newSymbols = [];
            const newPositions = [];
            for (let j = 0; j < reels[i].length; j++) {
              if (reels[i][j] === symbol || reels[i][j] === _wild) {
                newSymbols.push(reels[i][j]);
                newPositions.push([j, i]);
              }
            }
            winningSymbols.push(newSymbols);
            winningPositions.push(newPositions);
          }

          const symbolCombos = cartesianProduct(winningSymbols);
          const positionCombos = cartesianProduct(winningPositions);
          for (let k = 0; k < symbolCombos.length; k++) {
            winningLines.push([symbolCombos[k], positionCombos[k]]);
          }
        }
      }`;
  }

  /**
   * Reel Ways Calculate Winnings - computes payouts from winning lines
   * using paytable[symbol][comboLength]. Per-line bet multiplier.
   */
  private static generateReelWaysCalculateWinningsLogic(): string {
    return `
      function checkPayline(winningLine, betAmt, pt, wild) {
        const symbols = winningLine[0];
        if (!Array.isArray(symbols) || symbols.length === 0) return 0;
        const comboLen = symbols.length;
        for (const s of symbols) {
          if (s !== wild && pt[s] && pt[s][comboLen] !== undefined) {
            return Math.round(betAmt * pt[s][comboLen]);
          }
        }
        return 0;
      }

      if (!Array.isArray(winningLines)) {
        throw new Error('Winning lines must be an array');
      }
      const _bet = Number(betAmount) || 100;
      if (_bet <= 0) {
        throw new Error('Bet amount must be a positive number');
      }
      if (!paytable || typeof paytable !== 'object') {
        throw new Error('Paytable must be an object');
      }
      const _wild = Number(wildSymbol) || 9;

      let spinWinnings = 0;
      const winningLinesDetails = [];

      for (const winLine of winningLines) {
        if (!Array.isArray(winLine) || winLine.length !== 2) continue;
        if (!Array.isArray(winLine[0]) || !Array.isArray(winLine[1])) continue;

        const payout = checkPayline(winLine, _bet, paytable, _wild);
        spinWinnings += payout;
        if (payout > 0) {
          winningLinesDetails.push({
            symbols: winLine[0],
            positions: winLine[1],
            payout: payout
          });
        }
      }

      winningLinesDetails.sort((a, b) => b.payout - a.payout);`;
  }
  private static generateGetPaytableLogic(): string {
    return `
      // Math formula evaluation function (replaces mathjs)
      ${EVALUATE_FORMULA_JS}

      // Validate inputs
      if (numberOfSymbols <= 0) {
        throw new Error('Number of symbols must be greater than 0');
      }
      if (columnSize <= 0) {
        throw new Error('Column size must be greater than 0');
      }
      if (minConsecutiveSymbols <= 0) {
        throw new Error('Min consecutive symbols must be greater than 0');
      }
      if (minConsecutiveSymbols > columnSize) {
        throw new Error('Min consecutive symbols cannot be greater than column size');
      }

      // Calculate paytable according to the specified logic
      const paytable = {};

      for (let symbol = 1; symbol <= numberOfSymbols; symbol++) {
        for (
          let comboLength = minConsecutiveSymbols;
          comboLength <= columnSize;
          comboLength++
        ) {
          if (!paytable[symbol]) {
            paytable[symbol] = {};
          }

          // Check for custom per-symbol payout override (0-based index)
          const customPayoutKey = 'symbolPayout' + symbol;
          const customPayout = inputs[customPayoutKey];
          
          // Calculate payout using either custom per-symbol payout (if provided),
          // or the formula using symbol
          const basePayout = typeof customPayout === 'number' 
            ? customPayout 
            : evaluateFormula(payoutFormula, symbol);
            
          paytable[symbol][comboLength] = basePayout * comboLength;
        }
      }`;
  }

  // ============================================================================
  // DATA GENERATION
  // ============================================================================

  private static generateSymbolWeightsLogic(): string {
    return `
      // Math formula evaluation function compatible with Deno (no external libs)
      ${EVALUATE_FORMULA_JS}

      // Validate inputs
      const N = Number(numberOfSymbols);
      if (!Number.isFinite(N) || N <= 0) {
        throw new Error('Number of symbols must be a positive number');
      }
      const formula = String(weightFormula || 'exp(-x / 15)');

      // Base weights from formula using 1-based x
      const baseWeights = Array.from({ length: N }, (_, i) => {
        const x = i + 1;
        const value = evaluateFormula(formula, x);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error('Invalid weight value for x=' + x);
        }
        return value;
      });

      // Apply custom overrides if provided per symbol (dynamic ports symbolWeight1..N)
      const finalWeights = baseWeights.map((w, i) => {
        const overrideKey = 'symbolWeight' + (i + 1);
        const overrideVal = inputs[overrideKey];
        return typeof overrideVal === 'number' && Number.isFinite(overrideVal) ? overrideVal : w;
      });

      const totalWeight = finalWeights.reduce((a, b) => a + b, 0);
      if (!Number.isFinite(totalWeight) || totalWeight === 0) {
        throw new Error('Generate Symbol Weights: total weight is zero — every symbol would have 0 probability, so no reels/wins can be produced. Cause: weightFormula "' + formula + '" evaluates to 0 for all ' + N + ' symbols, OR all symbolWeight1..' + N + ' overrides are 0. Set a non-degenerate formula (e.g. "exp(-x / 15)") or non-zero custom weights.');
      }

      const normalizedBaseWeights = finalWeights.map((weight) => (weight / totalWeight) * 100);
    `;
  }

  private static generateReelStripsLogic(): string {
    return `
      // Custom seeded random number generator (Linear Congruential Generator)
      function SeededRandom(seed) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
      }

      SeededRandom.prototype.next = function () {
        this.seed = (this.seed * 16807) % 2147483647;
        return this.seed;
      };

      SeededRandom.prototype.nextFloat = function () {
        return (this.next() - 1) / 2147483646;
      };

      // Fisher-Yates shuffle algorithm using seeded random
      function shuffleArray(array, seededRandom) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(seededRandom.nextFloat() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      }

      // Validate inputs
      if (!Array.isArray(symbolWeights) || symbolWeights.length === 0) {
        throw new Error('Symbol weights array is required and cannot be empty');
      }
      if (!Array.isArray(randomSeeds) || randomSeeds.length < columnSize) {
        throw new Error(\`Random seeds array must contain at least \${columnSize} elements\`);
      }

      // Generate base reel
      const baseReel = [];
      const minWeight = Math.min(...symbolWeights);
      const symbolWeightsRelativeToMin = symbolWeights.map((weight) => Math.ceil(weight / minWeight));

      for (let i = 1; i <= symbolWeights.length; i++) {
        baseReel.push(...Array(symbolWeightsRelativeToMin[i - 1]).fill(i));
      }

      // Generate reel strips using custom seeded random and shuffle
      const reelStrips = [];
      for (let i = 0; i < columnSize; i++) {
        const seededRandom = new SeededRandom(randomSeeds[i]);
        reelStrips.push(shuffleArray(baseReel, seededRandom));
      }`;
  }

  private static generateReelStripsFromSeedLogic(): string {
    return `
      // Evaluate formula helper
      ${EVALUATE_FORMULA_JS}

      // Seeded RNG (LCG)
      function SeededRandom(seed) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
      }
      SeededRandom.prototype.next = function () {
        this.seed = (this.seed * 16807) % 2147483647;
        return this.seed;
      };
      SeededRandom.prototype.nextFloat = function () {
        return (this.next() - 1) / 2147483646;
      };

      function shuffleArray(array, rnd) {
        const a = array.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(rnd.nextFloat() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }

      // Validate inputs
      const _seed = Number(seed) || 0;
      const _rows = Number(rows) || 0;
      const _columns = Number(columns) || 0;
      const _formula = String(weightFormula || 'exp(-x / 15)');
      if (_rows <= 0) throw new Error('Rows must be > 0');
      if (_columns <= 0) throw new Error('Columns must be > 0');

      // Derive symbol weights for a default alphabet of 10 symbols
      const NUM_SYMBOLS = 10;
      const baseWeights = Array.from({ length: NUM_SYMBOLS }, (_, i) => evaluateFormula(_formula, i + 1));
      const minW = Math.min(...baseWeights);
      const rel = baseWeights.map((w) => Math.max(1, Math.ceil(w / (minW || 1))));

      // Build base reel
      const baseReel = [];
      for (let s = 1; s <= NUM_SYMBOLS; s++) baseReel.push(...Array(rel[s - 1]).fill(s));

      // Generate columns using seeded shuffle
      const rnd = new SeededRandom(_seed);
      const reelStrips = [];
      for (let c = 0; c < _columns; c++) {
        reelStrips.push(shuffleArray(baseReel, rnd));
      }

      // Outputs
      const slotRows = _rows;
      const slotColumns = _columns;
    `;
  }

  // ============================================================================
  // ANALYSIS TOOLS - STATEFUL
  // ============================================================================

  private static generateVolatilityEstimatorLogic(): string {
    return `
      // Handle state
      let cumulativeValues = state.cumulativeValues || [];
      
      if (reset) {
        cumulativeValues = [];
      }
      
      // Extract values from spinResults (match editor node priority order)
      let newValues = [];
      const _spin = spinResults || {};
      if (Array.isArray(_spin)) {
        const _sumFromArray = (arr) => {
          let sum = 0;
          for (let i = 0; i < arr.length; i++) {
            const entry = arr[i];
            if (typeof entry === 'number' && Number.isFinite(entry)) sum += entry;
            else if (Array.isArray(entry)) sum += _sumFromArray(entry);
            else if (entry && typeof entry === 'object' && typeof entry.totalPayout === 'number' && Number.isFinite(entry.totalPayout)) sum += entry.totalPayout;
          }
          return sum;
        };
        const _total = _sumFromArray(_spin);
        if (Number.isFinite(_total)) newValues = [_total];
      } else if (Array.isArray(_spin.values)) {
        newValues = _spin.values.filter(v => typeof v === 'number');
      } else if (Array.isArray(_spin.RTPDataSeries)) {
        newValues = _spin.RTPDataSeries.filter(v => typeof v === 'number');
      } else if (Array.isArray(_spin.payoutSeries)) {
        newValues = _spin.payoutSeries.filter(v => typeof v === 'number');
      } else if (Array.isArray(_spin.totalPayouts)) {
        newValues = _spin.totalPayouts.filter(v => typeof v === 'number');
      } else if (Array.isArray(_spin.cascades)) {
        let _total = 0;
        const _cascades = _spin.cascades || [];
        for (let i = 0; i < _cascades.length; i++) {
          const c = _cascades[i];
          if (typeof c === 'number' && Number.isFinite(c)) _total += c;
          else if (c && typeof c === 'object' && typeof c.totalPayout === 'number' && Number.isFinite(c.totalPayout)) _total += c.totalPayout;
          else if (Array.isArray(c)) {
            for (let j = 0; j < c.length; j++) {
              const e = c[j];
              if (typeof e === 'number' && Number.isFinite(e)) _total += e;
              else if (e && typeof e === 'object' && typeof e.totalPayout === 'number' && Number.isFinite(e.totalPayout)) _total += e.totalPayout;
            }
          }
        }
        newValues = Number.isFinite(_total) ? [_total] : [];
      } else if (typeof _spin.totalPayout === 'number') {
        newValues = [_spin.totalPayout];
      }
      
      // Add new values
      cumulativeValues = [...cumulativeValues, ...newValues.filter(v => typeof v === 'number' && Number.isFinite(v))];
      
      // Calculate volatility
      const n = cumulativeValues.length;
      let mean = 0, variance = 0, standardDeviation = 0;
      
      if (n > 0) {
        mean = cumulativeValues.reduce((s, v) => s + v, 0) / n;
        if (n > 1) {
          const diffSquares = cumulativeValues.map(v => (v - mean) ** 2);
          variance = diffSquares.reduce((s, v) => s + v, 0) / (n - 1);
        }
        standardDeviation = Math.sqrt(variance);
      }
      
      const volatilityResult = mean > 0 ? (standardDeviation / mean) * 100 : (standardDeviation > 0 ? 100 : 0);
      const amplitude = n > 0 ? (Math.max(...cumulativeValues) - Math.min(...cumulativeValues)) / Math.abs(mean || 1) : 0;
      
      // Return updated state
      const updatedCumulativeValues = cumulativeValues;`;
  }

  private static generateSymbolFrequencyTrackerLogic(): string {
    return `
      // Handle state
      let symbolCountResults = state.symbolCountResults || {};
      let symbolFrequencyResults = state.symbolFrequencyResults || {};
      
      if (reset) {
        symbolCountResults = {};
        symbolFrequencyResults = {};
      }
      
      // Initialize counts from retained state
      for (let s = 1; s <= numberOfSymbols; s++) {
        const key = String(s);
        if (typeof symbolCountResults[key] !== 'number') symbolCountResults[key] = 0;
      }
      
      // Count symbols in reels
      const allSymbols = [];
      for (let i = 0; i < reels.length; i++) {
        const reel = reels[i];
        if (Array.isArray(reel)) {
          for (let j = 0; j < reel.length; j++) {
            const sym = reel[j];
            if (typeof sym === 'number') {
              allSymbols.push(sym);
            }
          }
        }
      }
      
      // Count symbols within 1..numberOfSymbols
      for (let k = 0; k < allSymbols.length; k++) {
        const value = allSymbols[k];
        if (value >= 1 && value <= numberOfSymbols) {
          const key = String(value);
          symbolCountResults[key] = (symbolCountResults[key] || 0) + 1;
        }
      }
      
      // Calculate percentages
      const totalCount = Object.values(symbolCountResults).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
      if (totalCount > 0) {
        for (let s = 1; s <= numberOfSymbols; s++) {
          const key = String(s);
          const count = symbolCountResults[key] || 0;
          symbolFrequencyResults[key] = (count / totalCount) * 100;
        }
      }`;
  }

  private static generateSpinResultLogic(): string {
    return `
      // Handle state
      let hitFrequencyDataSeries = state.hitFrequencyDataSeries || [];
      let RTPDataSeries = state.RTPDataSeries || [];
      
      // Process slot results
      const slotResults = reels.length > 0 && reels[0] ? reels[0].map((_, i) => reels.map((col) => col[i])) : [];
      
      // Create final result object
      let finalResult = {
        stopPosList: stopPosList,
        isBigWin: spinWinnings > betAmount * 1000,
        totalBets: totalBets,
        totalWinnings: totalWinnings,
        hitFrequency: spinCount > 0 ? (hits / spinCount) * 100 : 0,
        RTP: totalBets > 0 ? (totalWinnings / totalBets) * 100 : 0,
        currentFreeSpinsWon: currentFreeSpinsWon || 0,
        totalFreeSpinsWon: totalFreeSpinsWon || 0,
        currentFreeSpins: currentFreeSpins || 0,
        currentFreeSpinsLines: currentFreeSpinsLines || []
      };
      
      // If simulation is enabled, push into series arrays
      if (enableSimulation) {
        hitFrequencyDataSeries.push(finalResult.hitFrequency);
        RTPDataSeries.push(finalResult.RTP);
      }
      
      // Process free spins symbols and positions
      const symbols = [];
      const positions = [];
      let posCount = 0;
      
      for (const line of finalResult.currentFreeSpinsLines) {
        posCount++;
        if (line.symbols && line.symbols.length > 0) {
          symbols.push(line.symbols[0]);
        }
        if (line.positions && line.positions.length > 0) {
          positions.push([line.positions[0], posCount - 1]);
        }
      }
      
      // Add spin results
      let spinResults: any = {
        totalPayout: spinWinnings + (winningJackpot ? jackpotWinnings : 0),
        slotResults: slotResults,
        winningLinesDetails: JSON.parse(JSON.stringify(winningLinesDetails || [])),
        freeSpins: {
          awarded: currentFreeSpinsWon,
          count: freeSpinsSymbolCount,
          positions: positions,
          symbols: symbols
        }
      };
      
      if (winningJackpot) {
        let jackpotSymbol = null;
        if (Array.isArray(reels) && reels.length && jackpotWinningPositions.length) {
          const [row, col] = jackpotWinningPositions[0];
          if (Number.isInteger(col) && Number.isInteger(row) && 
              col >= 0 && col < reels.length && 
              Array.isArray(reels[col]) && row >= 0 && row < reels[col].length) {
            jackpotSymbol = reels[col][row];
          }
        }
        
        const symbolsJackpot = jackpotSymbol != null ? Array(reels.length).fill(jackpotSymbol) : [];
        
        spinResults['jackpotWinningDetails'] = {
          symbols: symbolsJackpot,
          positions: jackpotWinningPositions,
          payout: jackpotWinnings
        };
      }
      
      // Add spinResults to finalResult
      (finalResult as any)['spinResults'] = spinResults;
      
      // Update state for next iteration
      const updatedHitFrequencyDataSeries = hitFrequencyDataSeries;
      const updatedRTPDataSeries = RTPDataSeries;`;
  }

  private static generateSpinCalculateLogic(): string {
    return `
      // Ensure numeric inputs
      let _capital = Number(capital) || 0;
      let _totalBets = Number(totalBets) || 0;
      const _betAmount = Number(betAmount) || 0;
      const _spinWinnings = Number(spinWinnings) || 0;
      let _totalWinnings = Number(totalWinnings) || 0;
      let _currentFreeSpins = Number(currentFreeSpins) || 0;
      let _totalWinningsFromFreeSpins = Number(totalWinningsFromFreeSpins) || 0;
      let _spinCount = Number(spinCount) || 0;
      let _hits = Number(hits) || 0;
      const _jackpotWinnings = Number(jackpotWinnings) || 0;
      const _winningJackpot = Boolean(winningJackpot);

      // Determine if cascading is in progress (mirrors editor spin-calculate.js)
      const _cascadingReelsEnabled = Boolean(cascadingReelsEnabled);
      const _isCascadingInProgress = _cascadingReelsEnabled && _spinWinnings > 0;

      // Apply bet cost and update totals only when not cascading and not a free spin
      if (!_isCascadingInProgress && _currentFreeSpins === 0) {
        _capital -= _betAmount;
        _totalBets += _betAmount;
      }

      if (_spinWinnings > 0) {
        _capital += _spinWinnings;
        if (!_isCascadingInProgress) {
          _hits += 1;
        }
        _totalWinnings += _spinWinnings;
        if (_currentFreeSpins > 0) {
          _totalWinningsFromFreeSpins += _spinWinnings;
        }
      }

      // Apply jackpot winnings if flagged
      if (_winningJackpot && _jackpotWinnings > 0) {
        _capital += _jackpotWinnings;
        _totalWinnings += _jackpotWinnings;
      }

      if (!_isCascadingInProgress) {
        _spinCount += 1;
      }

      // Map results to outputs (using different variable names to avoid conflicts)
      const resultCapital = _capital;
      const resultTotalBets = _totalBets;
      const resultTotalWinnings = _totalWinnings;
      const resultTotalWinningsFromFreeSpins = _totalWinningsFromFreeSpins;
      const resultSpinCount = _spinCount;
      const resultHits = _hits;`;
  }

  private static generateWeightedReelsLogic(): string {
    return `
      // Inputs (reelStrips, seeds, rowSize, symbolWeights, freeSpinSymbol, blockedReels, stopPosList, isDynamic) come from input mapping
      const inputStopPosList = Array.isArray(stopPosList) ? stopPosList : [];

      // Seeded random number generator (Linear Congruential Generator)
      function SeededRandom(seed) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
      }
      SeededRandom.prototype.next = function () {
        this.seed = (this.seed * 16807) % 2147483647;
        return this.seed;
      };
      SeededRandom.prototype.nextFloat = function () {
        return (this.next() - 1) / 2147483646;
      };
      SeededRandom.prototype.integer = function (min, max) {
        return Math.floor(this.nextFloat() * (max - min + 1)) + min;
      };

      let reels = [];
      let outputStopPosList = [];

      if (isDynamic) {
        // Dynamic mode - generate matrix with weighted random symbols
        if (!Array.isArray(reelStrips) || reelStrips.length === 0) {
          throw new Error('Reel strips array is required and cannot be empty to determine column size');
        }
        if (!Array.isArray(symbolWeights) || symbolWeights.length === 0) {
          throw new Error('Symbol weights array is required and cannot be empty for dynamic mode');
        }
        if (!symbolWeights.every((w) => typeof w === 'number' && w > 0)) {
          throw new Error('All symbol weights must be positive numbers');
        }
        const columnSize = reelStrips.length;
        const baseReel = [];
        const minWeight = Math.min(...symbolWeights);
        const symbolWeightsRelativeToMin = symbolWeights.map((w) => Math.ceil(w / minWeight));
        for (let i = 1; i <= symbolWeights.length; i++) {
          baseReel.push(...Array(symbolWeightsRelativeToMin[i - 1]).fill(i));
        }
        // PROVABLY FAIR (2026-07-03, mirrors the editor's 2026-06-23 fix in
        // weighted-reels.js): seed each column's RNG from the server-provided seeds
        // so dynamic-mode outcomes are reproducible/auditable from the seed. The
        // unseeded Math.random() here made server outcomes non-reproducible — a
        // provably-fair violation the editor side had already fixed. Falls back to
        // Math.random() only when seeds aren't provided (one per column).
        const _dynSeeds = Array.isArray(seeds) ? seeds : [];
        const _haveDynSeeds = _dynSeeds.length >= columnSize;
        for (let col = 0; col < columnSize; col++) {
          const reel = [];
          const colRng = _haveDynSeeds ? new SeededRandom(_dynSeeds[col]) : null;
          for (let row = 0; row < rowSize; row++) {
            const rand = colRng ? colRng.nextFloat() : Math.random();
            const idx = Math.floor(rand * baseReel.length);
            reel.push(baseReel[idx]);
          }
          reels.push(reel);
        }
      } else {
        // Static mode
        if (!Array.isArray(reelStrips) || reelStrips.length === 0) {
          throw new Error('Reel strips array is required and cannot be empty');
        }
        if (!reelStrips.every((strip) => Array.isArray(strip))) {
          throw new Error('All reel strips must be arrays');
        }
        const reelStripLength = reelStrips[0].length;
        if (reelStripLength === 0) {
          throw new Error('Reel strips cannot be empty');
        }
        if (!reelStrips.every((strip) => strip.length === reelStripLength)) {
          throw new Error('All reel strips must have the same length');
        }
        const useInputStops =
          Array.isArray(inputStopPosList) &&
          inputStopPosList.length === reelStrips.length &&
          inputStopPosList.every((pos) => Number.isInteger(pos) && pos >= 0 && pos < reelStripLength);
        if (!useInputStops && (!Array.isArray(Seeds) || Seeds.length < reelStrips.length)) {
          throw new Error('Seeds array must contain at least ' + reelStrips.length + ' elements');
        }
        for (let idx = 0; idx < reelStrips.length; idx++) {
          const reelStrip = reelStrips[idx];
          const pointerPos = useInputStops
            ? inputStopPosList[idx]
            : new SeededRandom(Seeds[idx]).integer(0, reelStripLength - 1);
          const reel = Array.from({ length: rowSize }, (_, i) => reelStrip[(pointerPos + i) % reelStripLength]);
          outputStopPosList.push(pointerPos);
          reels.push(reel);
        }
      }
    `;
  }

  /**
   * Generate Init Free Spins logic - replaces free spins symbol with symbol 1
   * in blocked reels to prepare reel strips for free spins mode.
   */
  private static generateInitFreeSpinsLogic(): string {
    return `
      // Validate inputs
      if (!Array.isArray(reelStrips) || reelStrips.length === 0) {
        throw new Error('Reel strips array is required and cannot be empty');
      }
      if (!blockedReels || typeof blockedReels !== 'string') {
        throw new Error('Blocked reels must be a valid comma-separated string');
      }

      // Create a copy of reel strips to avoid modifying the original
      const modifiedReelStrips = reelStrips.map((reel) => [...reel]);

      // Parse blocked reels and process each one
      const blockedReelIndices = blockedReels.split(',').map((idx) => {
        const parsed = Number(idx.trim());
        if (isNaN(parsed)) {
          throw new Error('Invalid blocked reel index: "' + idx.trim() + '"');
        }
        return parsed;
      });

      const _freeSpinsSymbol = Number(freeSpinsSymbol) || 10;

      // Apply transformation: replace free spins symbol with 1 in blocked reels
      for (const reelIdx of blockedReelIndices) {
        if (reelIdx < 0 || reelIdx >= modifiedReelStrips.length) {
          continue;
        }
        const freeSpinsSymbolIdx = modifiedReelStrips[reelIdx].indexOf(_freeSpinsSymbol);
        if (freeSpinsSymbolIdx !== -1) {
          modifiedReelStrips[reelIdx][freeSpinsSymbolIdx] = 1;
        }
      }`;
  }

  private static generateCalculateFreeSpinsStatesLogic(): string {
    return `
      // Validate inputs
      if (!Array.isArray(engineReels) || engineReels.length === 0) {
        throw new Error('Engine reels array is required and cannot be empty');
      }

      if (!blockedReels || typeof blockedReels !== 'string') {
        throw new Error('Blocked reels must be a valid comma-separated string');
      }

      // Parse blocked reels
      const blockedReelIndices = blockedReels.split(',').map((idx) => {
        const parsed = Number(idx.trim());
        if (isNaN(parsed)) {
          throw new Error(\`Invalid blocked reel index: "\${idx.trim()}"\`);
        }
        return parsed;
      });

      // Get input values with proper defaults
      let _currentFreeSpins = Number(currentFreeSpins) || 0;
      const _betAmount = Number(betAmount) || 0;
      let _capital = Number(capital) || 0;
      let _totalBets = Number(totalBets) || 0;
      let _totalFreeSpinsWon = Number(totalFreeSpinsWon) || 0;
      const _freeSpinsSymbol = Number(freeSpinsSymbol) || 10;

      // Apply the main logic
      if (_currentFreeSpins > 0) {
        _capital += _betAmount;
        _totalBets -= _betAmount;
        _currentFreeSpins--;
      }

      let freeSpinsSymbolCount = 0;
      const currentFreeSpinsLines = [];

      for (let reelIdx = 0; reelIdx < engineReels.length; reelIdx++) {
        if (blockedReelIndices.includes(reelIdx)) continue;

        const reel = engineReels[reelIdx];
        if (!Array.isArray(reel)) continue;

        for (let lineIdx = 0; lineIdx < reel.length; lineIdx++) {
          const symbol = reel[lineIdx];
          if (symbol === _freeSpinsSymbol) {
            freeSpinsSymbolCount++;
            currentFreeSpinsLines.push({
              symbols: [symbol],
              positions: [[lineIdx, reelIdx]]
            });
            break; // Count only once per reel
          }
        }
      }

      // Free spins reward: per-count override wins, else evaluate the configurable
      // freeSpinsRewardFormula via the ONE shared no-eval evaluator (formula-eval-emit).
      // 2026-07-10 (trace 1783634013326): this was the FOURTH drifting copy, and it used
      // eval() — which sanitizeForSandbox replaced with 0 in the uploaded bundle, so free
      // spins rewards were silently zeroed in the certified RGS. The shared evaluator
      // supports the ternary/comparisons this formula needs and emits no eval.
      const _rewardFormula = String(freeSpinsRewardFormula || 'x <= 1 ? 0 : (x * (x + 1)) / 2');
      ${EVALUATE_FORMULA_JS}
      const _evaluateRewardFormula = (formula, x) => evaluateFormula(formula, x);

      let won = 0;
      const _rewardOverride = inputs['freeSpinsRewardCount' + freeSpinsSymbolCount];
      const _rewardOverrideNum = Number(_rewardOverride);
      if (_rewardOverride !== undefined && _rewardOverride !== null && _rewardOverride !== '' && Number.isFinite(_rewardOverrideNum)) {
        won = _rewardOverrideNum;
      } else {
        won = _evaluateRewardFormula(_rewardFormula, freeSpinsSymbolCount);
      }

      const currentFreeSpinsWon = won;
      _totalFreeSpinsWon += won;
      _currentFreeSpins += won;

      // Map results to outputs
      const resultCapital = _capital;
      const resultTotalBets = _totalBets;
      const resultCurrentFreeSpins = _currentFreeSpins;
      const resultFreeSpinsSymbolCount = freeSpinsSymbolCount;
      const resultCurrentFreeSpinsWon = currentFreeSpinsWon;
      const resultTotalFreeSpinsWon = _totalFreeSpinsWon;
      const resultCurrentFreeSpinsLines = currentFreeSpinsLines;`;
  }
}

// ============================================================================
// MAIN SLOT GAME NODE CONVERTER
// ============================================================================

/**
 * Slot Game Node Converter - Main class for converting slot game nodes to Supabase Edge Function code
 */
export class SlotGameNodeConverter {
  /**
   * Check if a node type is a slot game node
   */
  public isSlotGameNode(nodeType: string): boolean {
    return SlotGameNodeRegistry.isSlotGameNode(nodeType);
  }

  /**
   * Check if a slot game node is stateful
   */
  public isStatefulSlotGameNode(nodeType: string): boolean {
    return SlotGameNodeRegistry.isStatefulSlotGameNode(nodeType);
  }

  /**
   * Generate function definition for a slot game node
   */
  public generateSlotGameNodeFunctionDefinition(node: Node, functionName: string): string {
    const nodeType = node.typename;
    const config = SlotGameNodeRegistry.getSlotGameNodeConfig(nodeType);

    if (!config) {
      throw new Error(`Slot game node configuration not found for type: ${nodeType}`);
    }

    // Merge default values with node parameters
    const mergedDefaults = { ...config.defaultValues, ...node.parameters };

    // Generate input parameter mapping
    const inputMapping = this.generateInputMapping(
      config.inputPorts,
      mergedDefaults,
      config.isStateful,
      config.supportsDynamicPorts,
      config.inputAliases
    );

    // Generate the core calculation logic
    const calculationLogic = SlotGameCalculationGenerator.generateCalculationLogic(nodeType);

    // Generate output mapping
    const outputMapping = this.generateOutputMapping(config.outputPorts, config.isStateful, config.stateKeys, nodeType);

    return `
    const ${functionName} = (inputs: Record<string, any>) => {
      // Input parameter mapping
      ${inputMapping}
      
      // Core calculation logic
      ${calculationLogic}
      
      // Return results
      return { ${outputMapping} };
    };`;
  }

  /**
   * Generate input parameter mapping
   */
  private generateInputMapping(
    inputPorts: string[],
    defaultValues: Record<string, any>,
    isStateful: boolean,
    supportsDynamicPorts: boolean = false,
    inputAliases?: Record<string, string[]>
  ): string {
    const mappings = inputPorts.map((port) => {
      const sanitizedPort = this.sanitizeParameterName(port);
      const defaultValue = this.formatDefaultValue(defaultValues[port]);
      const aliases = inputAliases?.[port];

      // Special handling for array inputs that might come as JSON strings
      if (port === 'winningLines' || port === 'paylines') {
        const fallback = `JSON.parse(${defaultValue})`;
        if (aliases?.length) {
          const checks = [sanitizedPort, ...aliases].map((a) => `inputs.${a}`).join(' ?? ');
          return `const ${port} = (${checks}) !== undefined ? (${checks}) : ${fallback};`;
        }
        return `const ${port} = inputs.${sanitizedPort} !== undefined ? inputs.${sanitizedPort} : ${fallback};`;
      }

      if (aliases?.length) {
        const checks = [sanitizedPort, ...aliases].map((a) => `inputs.${a}`).join(' ?? ');
        return `const ${port} = (${checks}) ?? ${defaultValue};`;
      }
      return `const ${port} = inputs.${sanitizedPort} !== undefined ? inputs.${sanitizedPort} : ${defaultValue};`;
    });

    // Add state parameter for stateful nodes
    if (isStateful) {
      mappings.push(`const state = inputs.state || {};`);
    }

    // For nodes that support dynamic ports, add a comment explaining that dynamic inputs are handled directly
    if (supportsDynamicPorts) {
      mappings.push(
        `// Note: Dynamic ports (like symbolPayout1, symbolPayout2, etc.) are accessed directly from inputs object`
      );
    }

    // Add request body parameter for slot game nodes
    mappings.push(`const requestBody = inputs.requestBody || {};`);

    return mappings.join('\n      ');
  }

  /**
   * Generate output parameter mapping
   */
  private generateOutputMapping(
    outputPorts: string[],
    isStateful: boolean,
    stateKeys?: string[],
    nodeType?: string
  ): string {
    const mappings = outputPorts.map((port) => {
      const sanitizedPort = this.sanitizeParameterName(port);
      // Special handling for Spin Calculate to avoid variable name conflicts
      if (nodeType === 'Spin Calculate') {
        return `${sanitizedPort}: result${port.charAt(0).toUpperCase() + port.slice(1)}`;
      }
      // Special handling for Calculate Free Spins States to avoid variable name conflicts
      if (nodeType === 'Calculate Free Spins States') {
        return `${sanitizedPort}: result${port.charAt(0).toUpperCase() + port.slice(1)}`;
      }
      // Special handling for Spin Result to use finalResult properties
      if (nodeType === 'Spin Result') {
        if (port === 'finalResult') {
          return `${sanitizedPort}: finalResult`;
        } else if (
          [
            'stopPosList',
            'isBigWin',
            'totalBets',
            'totalWinnings',
            'hitFrequency',
            'RTP',
            'currentFreeSpinsWon',
            'totalFreeSpinsWon',
            'currentFreeSpins',
            'currentFreeSpinsLines'
          ].includes(port)
        ) {
          return `${sanitizedPort}: finalResult.${port}`;
        } else if (port === 'spinResults') {
          return `${sanitizedPort}: finalResult['spinResults']`;
        } else if (['hitFrequencyDataSeries', 'RTPDataSeries'].includes(port)) {
          return `${sanitizedPort}: updated${port.charAt(0).toUpperCase() + port.slice(1)}`;
        }
      }
      // Special handling for Weighted Reels - avoid shadowing input stopPosList
      if (nodeType === 'Weighted Reels' && port === 'stopPosList') {
        return `${sanitizedPort}: outputStopPosList`;
      }
      // Special handling for Init Free Spins - output is modifiedReelStrips
      if (nodeType === 'Init Free Spins' && port === 'reelStrips') {
        return `${sanitizedPort}: modifiedReelStrips`;
      }
      return `${sanitizedPort}: ${port}`;
    });

    // Add state output for stateful nodes
    if (isStateful && stateKeys) {
      const stateOutput = stateKeys
        .map((key) => `${key}: updated${key.charAt(0).toUpperCase() + key.slice(1)}`)
        .join(', ');
      mappings.push(`updatedState: { ${stateOutput} }`);
    }

    return mappings.join(', ');
  }

  /**
   * Format default value for JavaScript
   */
  private formatDefaultValue(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Sanitize parameter name for JavaScript
   */
  private sanitizeParameterName(name: string): string {
    return name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  }
}
