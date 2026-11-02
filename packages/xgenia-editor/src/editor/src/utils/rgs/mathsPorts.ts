// Which output of a compiled maths component holds the round's win, and what
// XGENIA RGS said about a deploy — pure functions, kept out of
// deployMathsComponents.ts so they can be tested without the editor runtime
// (tests/rgs/winPortAndPlatformWarnings.test.ts).

export const WIN_PORT_PRECEDENCE = ['win', 'winAmount', 'spinWinnings', 'totalPayout', 'totalWinnings'];

function topLevelWinPort(example: Record<string, any>): string | null {
  const keys = Object.keys(example || {});
  for (const candidate of WIN_PORT_PRECEDENCE) {
    const hit = keys.find((k) => k === candidate) || keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * The output that holds the round's win: a top-level port by the names above,
 * or — when there is none — the same names one level down, as a dotted path
 * ("finalResult.totalWinnings").
 *
 * A graph often returns one object output with the win inside it ("Feed Zeus"
 * returns `finalResult` with the win at `finalResult.totalWinnings`). Reading
 * only the top level left such a game with no win mapping: its rounds paid 0
 * and were not recorded, and the fix was a dialog asking the studio to set it
 * "on the platform". XGENIA RGS reads a dotted win port the same way on every
 * path (play, simulation, certification), so naming it here is enough.
 */
export function winPortFor(responseExample: Record<string, any>): string | null {
  const top = topLevelWinPort(responseExample);
  if (top) return top;
  for (const [key, value] of Object.entries(responseExample || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const inner = topLevelWinPort(value as Record<string, any>);
    if (inner && typeof (value as any)[inner] === 'number') return `${key}.${inner}`;
  }
  return null;
}

/**
 * The platform's notes on one deploy, in words a game studio can act on.
 * Exported for tests/rgs/platformWarnings.test.ts.
 */
export function platformWarningsFor(label: string, rewrites: any, rng: any): string[] {
  const out: string[] = [];
  if (Array.isArray(rewrites)) {
    for (const rw of rewrites) {
      if (!rw) continue;
      out.push(
        `${label}: XGENIA RGS replaced ${rw.from} with ${rw.to} (${rw.count ?? 1}×)` +
          (rw.reason ? ` — ${rw.reason}` : '') +
          '.'
      );
    }
  }
  if (rng && rng.verdict === 'not_responsive') {
    out.push(
      `${label}: its result does not change with the random numbers it is given` +
        (rng.reason ? ` (${rng.reason})` : '') +
        '. That is fine for a calculator or paytable lookup, but a game outcome built this way cannot be certified.'
    );
  }
  return out;
}
