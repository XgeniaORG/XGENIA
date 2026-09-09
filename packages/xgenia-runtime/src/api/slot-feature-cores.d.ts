/**
 * Type surface for slot-feature-cores.js (a plain JS module; see its docblock).
 * Every core is `(args) => result` or, for stateful cores, `(state, args) => result`
 * where `result.updatedState` is the bounded object to persist.
 */
export type SlotFeatureCore = (...args: any[]) => any;

/** The full function text the compiler embeds: `const __sfc = (<CORES_SOURCE>)();` */
export const CORES_SOURCE: string;
/** Names of every function returned by defineSlotFeatureCores(). */
export const coreNames: string[];
export function defineSlotFeatureCores(): Record<string, SlotFeatureCore>;

export const normaliseSeed: SlotFeatureCore;
export const requireSeeds: SlotFeatureCore;
export const lcg: SlotFeatureCore;
export const gridDims: SlotFeatureCore;
export const cloneGrid: SlotFeatureCore;
export const readPositions: SlotFeatureCore;
export const weightedBaseReel: SlotFeatureCore;
export const bracketMultiplier: SlotFeatureCore;

export const evaluateClusterPays: SlotFeatureCore;
export const applyProgressiveMeter: SlotFeatureCore;
export const stepMultiplierLadder: SlotFeatureCore;
export const buildSymbolValueGrid: SlotFeatureCore;
export const collectCoins: SlotFeatureCore;
export const evaluateJackpotTiers: SlotFeatureCore;
export const resolveJackpotPools: SlotFeatureCore;
export const computeBetMode: SlotFeatureCore;
export const selectVariant: SlotFeatureCore;
export const applyStickySymbols: SlotFeatureCore;
export const expandSymbols: SlotFeatureCore;
export const applyLockedReels: SlotFeatureCore;
export const holdAndWin: SlotFeatureCore;
export const applySymbolUpgrade: SlotFeatureCore;
export const rollFeatureTrigger: SlotFeatureCore;
export const cascadeDirectional: SlotFeatureCore;
export const spinWheel: SlotFeatureCore;
export const pickBonus: SlotFeatureCore;
export const modifyPaytable: SlotFeatureCore;
export const chapterBranch: SlotFeatureCore;
export const paytableRows: SlotFeatureCore;
