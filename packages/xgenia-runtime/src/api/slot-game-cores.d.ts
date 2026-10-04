/**
 * Type surface for slot-game-cores.js (a plain JS module; see its docblock). Every core is
 * `(args) => result` or, for the stateful analysis cores, `(state, args) => result` where
 * `result.updatedState` is what to keep for the next round.
 */
export type SlotGameCore = (...args: any[]) => any;

/** The full function text the compiler embeds: `const __sgc = (<CORES_SOURCE>)((<FORMULA_SOURCE>)());` */
export const CORES_SOURCE: string;
/** formula-eval-core.js defineFormulaEvaluator, the cores' only dependency. */
export const FORMULA_SOURCE: string;
/** Names of every function returned by defineSlotGameCores(). */
export const coreNames: string[];
export function defineSlotGameCores(formulas: { evaluateFormula(formula: string, x: number): number }): Record<string, SlotGameCore>;

export const checkJackpotArgs: SlotGameCore;
export const checkJackpot: SlotGameCore;
export const checkWinsArgs: SlotGameCore;
export const checkWins: SlotGameCore;
export const calculateWinningsArgs: SlotGameCore;
export const calculateWinnings: SlotGameCore;
export const paylineValueUnrounded: SlotGameCore;
export const getPaytableArgs: SlotGameCore;
export const getPaytable: SlotGameCore;
export const generateSymbolWeightsArgs: SlotGameCore;
export const generateSymbolWeights: SlotGameCore;
export const reelStripsGenerator: SlotGameCore;
export const weightedReelsArgs: SlotGameCore;
export const weightedReels: SlotGameCore;
export const spinCalculate: SlotGameCore;
export const spinResult: SlotGameCore;
export const calculateFreeSpinsStates: SlotGameCore;
export const initFreeSpins: SlotGameCore;
export const checkReelWaysWinsArgs: SlotGameCore;
export const checkReelWaysWins: SlotGameCore;
export const calculateReelWaysWinningsArgs: SlotGameCore;
export const calculateReelWaysWinnings: SlotGameCore;
export const volatilityEstimator: SlotGameCore;
export const symbolFrequencyTracker: SlotGameCore;
export const evaluateFormula: (formula: string, x: number) => number;
