/**
 * Where the rounds are in a book.
 *
 * Stake has no per-round server call: one book is the whole paid event, and the frontend decides
 * where each spin starts. Two book dialects reach this harness:
 *
 *   standard  Stake's math-sdk events. A round starts at every `reveal` (one board shown). The
 *             official web-sdk calls a book a bonus only when it holds MORE THAN ONE reveal
 *             (createPrimaryMachines.ts checkIsMultipleRevealEvents) — a bonus without a reveal
 *             per spin is treated as a single-round win: end-round before the animation, no
 *             /bet/event, no resume.
 *   xrgs      What XRGS `_shared/stake-books.ts` writes today: one event per evaluate() call,
 *             `{index, type: "round"|"featureRound"|"choiceRound", winMultiplier, data}`. Only a
 *             frontend that knows this dialect (the planned Book Connector) can play it.
 *
 * Anything else is `custom`: treated as one round, and said so.
 */

export const ROUND_TYPES_XRGS = new Set(['round', 'featureRound', 'choiceRound']);

/** Book-level events that are not rounds: an XRGS book may end on a Stake `finalWin` (stake-books.ts, 2026-11-09). */
const XRGS_TRAILERS = new Set(['finalWin', 'wincap']);

export function bookDialect(events) {
  if (!Array.isArray(events)) return 'custom';
  if (events.some((e) => e && e.type === 'reveal')) return 'standard';
  const rounds = events.filter((e) => e && ROUND_TYPES_XRGS.has(e.type));
  if (rounds.length > 0 && events.every((e) => e && (ROUND_TYPES_XRGS.has(e.type) || XRGS_TRAILERS.has(e.type)))) return 'xrgs';
  return 'custom';
}

/** Array positions at which a round starts. Always contains 0 for a non-empty book. */
export function roundStarts(events) {
  const dialect = bookDialect(events);
  if (!Array.isArray(events) || events.length === 0) return [];
  if (dialect === 'standard') {
    const at = [];
    events.forEach((e, i) => {
      if (e && e.type === 'reveal') at.push(i);
    });
    // Events before the first reveal (e.g. enterBonus) belong to the first round.
    if (at[0] !== 0) at[0] = 0;
    return at;
  }
  if (dialect === 'xrgs') return events.flatMap((e, i) => (ROUND_TYPES_XRGS.has(e.type) ? [i] : []));
  return [0];
}

/**
 * What a frontend would SHOW as the round's total, in hundredths of the base bet, or null when the
 * book does not say. Standard: the `finalWin` amount, else the last `setTotalWin`. XRGS: the sum of
 * the per-round winMultipliers (that is what a frontend adding up rounds displays).
 */
export function shownTotal(events) {
  if (!Array.isArray(events)) return null;
  const dialect = bookDialect(events);
  if (dialect === 'xrgs') {
    const fw = events.find((e) => e.type === 'finalWin');
    if (fw) return Number(fw.amount);
    let sum = 0;
    for (const e of events) sum += Number(e.winMultiplier) || 0;
    return Math.round(sum * 100);
  }
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'finalWin') return Number(events[i].amount);
  }
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'setTotalWin') return Number(events[i].amount);
  }
  return null;
}

export function describeBook(book) {
  const events = Array.isArray(book?.events) ? book.events : [];
  const starts = roundStarts(events);
  return {
    dialect: bookDialect(events),
    rounds: starts.length,
    starts,
    isFeature: starts.length > 1,
    shown: shownTotal(events),
    hasFinalWin: events.some((e) => e?.type === 'finalWin'),
    hasWincap: events.some((e) => e?.type === 'wincap'),
  };
}
