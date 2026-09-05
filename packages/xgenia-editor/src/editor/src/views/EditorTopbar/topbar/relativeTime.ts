// relativeTime.ts — pure.
//
// Returns a bare age, never a sentence, so callers can compose it. Two shapes exist:
// "now" (already absolute) and everything else (a duration you may suffix with " ago").
// `isAbsolute` tells a caller which it got, so nobody has to string-match "now" —
// the earlier "yesterday" return broke exactly that, producing "published yesterday ago".
export function formatAgo(deltaMs: number): string {
  // Math.max(0, NaN) is NaN, so a non-finite delta would fall through every branch
  // below and render as "NaNw" in the UI. A corrupt persisted timestamp is the real
  // path here: Date.now() - "2026-09-01" is NaN.
  if (!Number.isFinite(deltaMs)) return 'now';

  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 7)}w`;
  // Beyond a year the exact figure stops meaning anything, and an unbounded number
  // renders in exponential notation ("1.65e+21w") from a corrupt stored timestamp.
  const y = Math.floor(d / 365);
  return y > 99 ? '99y+' : `${y}y`;
}

/** True when formatAgo's output is already a complete phrase and must NOT take " ago". */
export function isAbsoluteAge(formatted: string): boolean {
  return formatted === 'now';
}

/** The phrase a tooltip wants: "just now", "5m ago", "3d ago". */
export function formatAgePhrase(deltaMs: number): string {
  const ago = formatAgo(deltaMs);
  return isAbsoluteAge(ago) ? 'just now' : `${ago} ago`;
}
