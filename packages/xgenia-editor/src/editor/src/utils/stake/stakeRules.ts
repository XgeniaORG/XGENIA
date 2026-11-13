/**
 * Stake's rules, in one place (2026-11-11) — what a game may be on Stake Engine, and what XGENIA offers instead
 * when a studio asks for something Stake does not allow.
 *
 * WHY. The same rules were written four times — the limits check (stakeMathsFormat STAKE_LIMITS), the readiness
 * linter (stakeReadiness: jackpot pools, gamble, state between bets, social words), the Stake page's review list,
 * and the AI's own guidance — and they had started to drift. Worse, all four acted AFTER the game was built: the
 * AI planned a gamble feature or a meter across bets, built it, and only the readiness check said no.
 *
 * Now this file is the boundary a Stake game lives inside (design doc "XGENIA for Stake — product design",
 * "Destinations as a boundary"), read by three layers:
 *   1. PLAN  — checkStakePlan(): the AI states the game it means to build (features in the studio's words,
 *              modes with their prices, target payout, top win) and gets back, per item, allowed or refused,
 *              with the reason and the closest allowed option — before anything is built. (bridge stake.plan)
 *   2. BUILD — stakeBlockedNode(): the parts that cannot work on Stake. The AI's tool gate refuses to place them
 *              on a Stake game (bridge stake.rules hands the list to the agent), with the alternative.
 *   3. SHIP  — the readiness check and the limits check read the same lists and numbers here.
 *
 * Source: Stake Engine's documentation (RGS, Math SDK, approval guidelines) as researched for XGENIA on
 * 2026-11-09. When Stake changes a rule, change it here and bump STAKE_RULES.version; every layer follows.
 *
 * Pure (no editor imports): tests/deploy/stakeRules.test.ts runs it.
 */

export interface StakeFeatureRule {
  id: string;
  /** What it is, in a studio's words. */
  name: string;
  allowed: boolean;
  /** Words a studio uses for it (matched case-insensitively against a free-text request). */
  words: RegExp;
  /** Allowed: the condition Stake attaches. Not allowed: why, in one line the AI can say to the studio. */
  note: string;
  /** Not allowed: the closest thing that works on Stake. */
  alternative?: string;
  /** Node types that implement it; for a feature Stake does not allow, these may not be placed on a Stake game. */
  nodeTypes?: string[];
}

/** Ordered: features Stake refuses are matched before the allowed ones they resemble ("progressive jackpot" before "jackpot"). */
const FEATURES: StakeFeatureRule[] = [
  {
    id: 'progressive_jackpot',
    name: 'Progressive or pooled jackpot',
    allowed: false,
    words: /\b(progressive|pooled?|network|community|must.?drop|shared)\b.{0,20}\bjackpots?\b|\bjackpot pools?\b/i,
    note: 'Stake does not allow jackpots that pool money across bets or players: every bet must stand on its own.',
    alternative: 'Fixed jackpot tiers (for example Mini 50×, Major 500×, Grand 5,000×) paid by the maths, inside the 1,000,000× cap.',
    nodeTypes: ['RGS Jackpot Pools']
  },
  {
    id: 'gamble',
    name: 'Gamble or double-up',
    allowed: false,
    words: /\b(gamble|double.?up|risk (game|ladder)|card guess|guess the (colou?r|card))\b/i,
    note: "Stake does not allow gamble features: a round's result is fixed when the bet is placed, and the player cannot change it afterwards.",
    alternative: 'A pick-to-reveal bonus after big wins (the prize is fixed in the book), or a higher-volatility bet mode.'
  },
  {
    id: 'cash_out',
    name: 'Cash out part-way',
    allowed: false,
    words: /\b(cash.?out|collect early|take (the )?win early|partial (cash|pay))\b/i,
    note: 'Stake cannot stop a round part-way: the whole round is decided when the bet is placed.',
    alternative: 'Let the player choose how far to go before the bet, each choice its own mode (as Mines-style Stake games do).'
  },
  {
    id: 'state_across_bets',
    name: 'Progress that carries from one bet to the next',
    allowed: false,
    // Bets and sessions, not spins: "a multiplier that grows over spins" inside a bonus is fine.
    words: /\b(across|over|between) (many |multiple |several )?(bets|sessions|paid (spins|rounds))\b|\b(persistent|carries over|saved progress|level up|unlock(s|ed)? over time)\b/i,
    note: 'Stake starts every round fresh: nothing may build up from one paid bet to the next.',
    alternative: 'A meter or collection that fills within one bonus and resets when it ends.'
  },
  {
    id: 'skill',
    name: 'Skill-based outcome',
    allowed: false,
    words: /\b(skill|aim|timing|reaction|arcade|shoot(ing)?)\b.{0,20}\b(win|outcome|pay|prize|bonus)\b|\bskill.?based\b/i,
    note: 'On Stake the book decides what a round pays; nothing the player does may change it.',
    alternative: 'An interactive bonus whose choices are reveals: the player picks, the prize was already fixed.'
  },
  {
    id: 'free_spins',
    name: 'Free spins',
    allowed: true,
    words: /\b(free ?spins?|free ?games?|bonus rounds?|re-?triggers?)\b/i,
    note: 'One paid bet buys the whole bonus: Stake plays every free spin from the same book. Count them with Calculate Free Spins States (or in_feature + feature_rounds_remaining).'
  },
  {
    id: 'bonus_buy',
    name: 'Bonus buy',
    allowed: true,
    words: /\b(bonus buy|buy (the |a )?(bonus|feature)|feature buy|buy feature)\b/i,
    note: 'A separate mode costing up to 50,000× the bet, payout 96.0–96.7% and within 0.5% of base; every bought round opens the bonus.'
  },
  {
    id: 'ante',
    name: 'Ante or enhanced bet',
    allowed: true,
    words: /\b(ante|enhanced|boosted|double chance|bonus hunt|extra bet)\b/i,
    note: 'A separate mode with its own price; payout 96.0–96.7% and within 0.5% of base.'
  },
  {
    id: 'pick_bonus',
    name: 'Pick-a-prize bonus',
    allowed: true,
    words: /\b(pick|choose|chests?|reveal|mystery)\b/i,
    note: 'As a reveal: the prizes are fixed when the bet is placed, picks are automatic after a timeout and in autoplay, and the rules must not suggest skill.'
  },
  {
    id: 'hold_and_win',
    name: 'Hold and win, respins',
    allowed: true,
    words: /\b(hold (and|&|n) (win|spin)|respins?|locked? (symbols|reels)|coin (collect|lock))\b/i,
    note: 'Within one paid round; nothing may stay locked into the next bet.'
  },
  {
    id: 'fixed_jackpots',
    name: 'Fixed jackpot tiers',
    allowed: true,
    words: /\bjackpots?\b|\b(mini|minor|major|grand|mega)\b.{0,10}\b(prize|tier)s?\b/i,
    note: 'Fixed prizes paid by the maths (Jackpot Tiers), inside the 1,000,000× cap; no pools.'
  },
  {
    id: 'multipliers',
    name: 'Multipliers',
    allowed: true,
    words: /\bmultipliers?\b/i,
    note: 'Inside the 1,000,000× cap; a multiplier that grows during a bonus resets when the bonus ends.'
  },
  {
    id: 'wilds',
    name: 'Wilds',
    allowed: true,
    words: /\b(wilds?|expanding|sticky|walking)\b/i,
    note: 'Sticky wilds stay within one bonus.'
  },
  {
    id: 'cascades',
    name: 'Cascades, tumbles, cluster pays',
    allowed: true,
    words: /\b(cascad\w*|tumbl\w*|avalanche|cluster\w*|ways|megaways|lines?|paylines?)\b/i,
    note: 'Every tumble of a round is in its book.'
  }
];

/** Node types that call XGENIA's own servers: a Stake build only talks to Stake, so these do nothing there. */
const XRGS_ONLY_NODES = ['RGS Leaderboard', 'RGS Translations', 'Jurisdiction Rules', 'Session Limits', 'Telemetry Event', 'Cloud Function', 'REST2'];

/** Node types that keep state between rounds: fine inside one bonus, wrong if it carries from bet to bet. */
const STATEFUL_NODES = ['Counter', 'Progressive Meter', 'Multiplier Ladder', 'Sticky Symbols', 'Locked Reels', 'Hold And Win Grid', 'Symbol Upgrade', 'Pick Bonus', 'Chapter Branch'];

export const STAKE_RULES = {
  version: '2026-11-11',
  source: "Stake Engine documentation (RGS, Math SDK, approval guidelines), researched for XGENIA 2026-11-09",
  limits: {
    /** Every mode's payout, as a fraction. */
    minRtp: 0.96,
    maxRtp: 0.967,
    /** Each mode within this of the base mode's payout. */
    modeSpread: 0.005,
    /** The cheapest mode costs exactly 1× the bet. */
    baseCost: 1,
    maxCost: 50_000,
    /** Largest win, × the bet. */
    maxWin: 1_000_000,
    minBaseStd: 0.6,
    minBooks: 100_000,
    maxBooks: 1_000_000,
    /** Reviewers want the top win reachable at least this often (1 in N). */
    maxWinOdds: 20_000_000
  },
  features: FEATURES,
  /** Placing these on a Stake game is refused (layer 2). */
  blockedNodes: [
    { type: 'RGS Jackpot Pools', feature: 'progressive_jackpot' },
    ...XRGS_ONLY_NODES.filter((t) => t !== 'Cloud Function' && t !== 'REST2').map((type) => ({ type, feature: 'xrgs_only' }))
  ] as Array<{ type: string; feature: string }>,
  /** A node label naming one of these is refused too: there is no node type for gamble or cash-out. */
  blockedLabel: /\b(gamble|double.?up|cash.?out)\b/i,
  xrgsOnlyNodes: XRGS_ONLY_NODES,
  statefulNodes: STATEFUL_NODES,
  /** Words Stake.US social mode forbids in any text, and what to show instead. */
  socialWords: /\b(bet|bets|betting|buy|bought|purchase|pay|pays|paid|payout|cash|gamble|gambling|wager|stake|deposit|withdraw|money)\b/i,
  socialReplacements: { bet: 'play', buy: 'play', pay: 'win', pays: 'wins', cash: 'coins' } as Record<string, string>,
  /** What Stake's reviewers try by hand. */
  reviewItems: [
    'Spacebar places a bet',
    'A confirmation before any mode costing more than 2×',
    'Autoplay asks for confirmation',
    'A sound on/off toggle',
    'Every bet level can be selected',
    'The win counts up to the final payout',
    'Replay mode plays a past round'
  ],
  /** Review items the Stake shell adds to every Stake build (stakeShell.ts); the rest stay the game's. */
  shellProvides: ['Spacebar places a bet', 'A confirmation before any mode costing more than 2×', 'A sound on/off toggle'],
  /** The text every rules screen must carry. */
  disclaimer: 'Malfunction voids all wins and plays. A consistent internet connection is required. In the event of a disconnection, reload the game to finish any uncompleted rounds.'
};

/** "CashOutButton" / "cash_out-step" → "Cash Out Button" / "cash out step", so word rules match node labels. */
export function labelWords(label: string | null | undefined): string {
  return String(label || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim();
}

const XRGS_ONLY_WHY = 'It calls XGENIA\'s own servers; a Stake build only talks to Stake, so it does nothing there.';

/** Why a node may not be placed on a Stake game, with the alternative — or null when it may. */
export function stakeBlockedNode(type: string, label?: string | null): { code: string; why: string; alternative: string } | null {
  const hit = STAKE_RULES.blockedNodes.find((b) => b.type === type);
  if (hit) {
    if (hit.feature === 'xrgs_only') return { code: 'NOT_ON_STAKE', why: `${type}: ${XRGS_ONLY_WHY}`, alternative: 'Leave it out of a Stake game.' };
    const f = FEATURES.find((x) => x.id === hit.feature)!;
    return { code: 'NOT_ON_STAKE', why: f.note, alternative: f.alternative || '' };
  }
  // Labels are usually CamelCase ("CashOutButton"): split them into words before matching.
  const l = labelWords(label);
  if (l && STAKE_RULES.blockedLabel.test(l)) {
    const f = FEATURES.find((x) => x.id !== 'progressive_jackpot' && !x.allowed && x.words.test(l)) || FEATURES.find((x) => x.id === 'gamble')!;
    return { code: 'NOT_ON_STAKE', why: f.note, alternative: f.alternative || '' };
  }
  return null;
}

// ── Layer 1: the plan ──────────────────────────────────────────────────────────────────────────

export interface StakePlan {
  /** Features in the studio's words or by id: "free spins with multipliers", "gamble", "bonus_buy". */
  features?: string[];
  /** Modes with their price × the bet; the base game is the 1× mode. */
  modes?: Array<{ name: string; cost: number }>;
  /** Target payout, as a percentage (96.3) or a fraction (0.963). */
  rtp?: number;
  /** Largest win, × the bet. */
  maxWin?: number;
  /** 'levels' (Stake's bet levels) or 'free' (an amount the player types). */
  bet?: 'levels' | 'free';
}

export interface StakePlanItem {
  item: string;
  allowed: boolean;
  feature?: string;
  /** Allowed: the condition. Refused: why, in a line for the studio. */
  note: string;
  /** Refused: the closest allowed option to offer instead. */
  alternative?: string;
}

export interface StakePlanResult {
  ok: boolean;
  items: StakePlanItem[];
  /** Asked-for features this rule set does not know: neither allowed nor refused here; build them inside the rules. */
  unknown: string[];
  version: string;
}

const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;

export function checkStakePlan(plan: StakePlan | null | undefined): StakePlanResult {
  const L = STAKE_RULES.limits;
  const items: StakePlanItem[] = [];
  const unknown: string[] = [];

  for (const raw of plan?.features || []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const byId = FEATURES.find((f) => f.id === text.toLowerCase());
    // Every rule the request names, refused ones first: "free spins with a gamble" is one allowed and one refused.
    const hits = byId ? [byId] : FEATURES.filter((f) => f.words.test(text));
    // "fixed jackpots" is not a hit when the same words already matched a refused jackpot rule.
    const refused = hits.filter((f) => !f.allowed);
    const allowed = hits.filter((f) => f.allowed && !(f.id === 'fixed_jackpots' && refused.some((r) => r.id === 'progressive_jackpot')));
    if (!refused.length && !allowed.length) {
      unknown.push(text);
      continue;
    }
    for (const f of [...refused, ...allowed]) {
      items.push({ item: text, feature: f.id, allowed: f.allowed, note: f.note, ...(f.allowed ? {} : { alternative: f.alternative }) });
    }
  }

  const modes = plan?.modes || [];
  if (modes.length) {
    const cheapest = Math.min(...modes.map((m) => Number(m.cost)));
    if (cheapest !== L.baseCost) {
      items.push({ item: `cheapest mode costs ${cheapest}×`, allowed: false, note: 'Stake needs one mode at exactly 1× the bet: the base game.', alternative: 'Price the base game at 1×.' });
    }
    for (const m of modes) {
      if (!(Number(m.cost) > 0) || Number(m.cost) > L.maxCost) {
        items.push({ item: `mode ${m.name} at ${m.cost}×`, allowed: false, note: `A mode's price must be above 0 and at most ${L.maxCost.toLocaleString('en-US')}× the bet.`, alternative: `Price ${m.name} at ${L.maxCost.toLocaleString('en-US')}× or less.` });
      }
      if (!/^[a-z0-9_]+$/.test(String(m.name || ''))) {
        items.push({ item: `mode name "${m.name}"`, allowed: false, note: 'Stake mode names are lower-case letters, digits and underscores; the game asks for them by name.', alternative: `Call it "${String(m.name || 'mode').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'mode'}".` });
      }
    }
  }

  if (plan?.rtp != null && Number.isFinite(Number(plan.rtp))) {
    const r = Number(plan.rtp) > 1 ? Number(plan.rtp) / 100 : Number(plan.rtp);
    if (r < L.minRtp || r > L.maxRtp) {
      const nearest = Math.min(L.maxRtp, Math.max(L.minRtp, r));
      items.push({ item: `payout ${pctOf(r)}`, allowed: false, note: `Every Stake mode pays back ${pctOf(L.minRtp)}–${pctOf(L.maxRtp)}, each within ${pctOf(L.modeSpread)} of the base game.`, alternative: `Aim for ${pctOf(nearest === r ? 0.9635 : nearest)}; 96.35% sits in the middle of the band.` });
    } else {
      items.push({ item: `payout ${pctOf(r)}`, allowed: true, note: `Inside Stake's ${pctOf(L.minRtp)}–${pctOf(L.maxRtp)}; every mode must land there, within ${pctOf(L.modeSpread)} of base.` });
    }
  }

  if (plan?.maxWin != null && Number.isFinite(Number(plan.maxWin))) {
    const w = Number(plan.maxWin);
    items.push(
      w > L.maxWin
        ? { item: `top win ${w.toLocaleString('en-US')}×`, allowed: false, note: `Stake caps a win at ${L.maxWin.toLocaleString('en-US')}× the bet.`, alternative: `Cap it at ${L.maxWin.toLocaleString('en-US')}× or below, and make sure the maths actually reaches the cap (1 in ${L.maxWinOdds.toLocaleString('en-US')} or more often).` }
        : { item: `top win ${w.toLocaleString('en-US')}×`, allowed: true, note: `Within Stake's ${L.maxWin.toLocaleString('en-US')}× cap.` }
    );
  }

  if (plan?.bet === 'free') {
    items.push({ item: 'player types the bet amount', allowed: false, note: "Stake sets the bet levels; any other amount is refused.", alternative: "A bet selector built from Stake's bet levels (the Book Connector's stakeBetLevels output)." });
  }

  return { ok: !items.some((i) => !i.allowed), items, unknown, version: STAKE_RULES.version };
}

/** What the AI needs to stay inside the boundary: limits, features with notes and alternatives, blocked parts. */
export function stakeRulesForAgent() {
  return {
    version: STAKE_RULES.version,
    source: STAKE_RULES.source,
    limits: STAKE_RULES.limits,
    features: FEATURES.map((f) => ({ id: f.id, name: f.name, allowed: f.allowed, note: f.note, wordsPattern: f.words.source, ...(f.alternative ? { alternative: f.alternative } : {}) })),
    blockedNodeTypes: STAKE_RULES.blockedNodes.map((b) => b.type),
    /** Per blocked type: why, and what to do instead (stakeBlockedNode). */
    blockedNodes: STAKE_RULES.blockedNodes.map((b) => ({ type: b.type, ...stakeBlockedNode(b.type)! })),
    blockedLabelPattern: STAKE_RULES.blockedLabel.source,
    reviewItems: STAKE_RULES.reviewItems,
    socialReplacements: STAKE_RULES.socialReplacements
  };
}
