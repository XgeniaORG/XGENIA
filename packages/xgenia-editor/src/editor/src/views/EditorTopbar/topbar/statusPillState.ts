// Pure. No editor imports.

export type Surface = 'viewport' | 'browser';
export type PublishPhase = 'idle' | 'publishing' | 'live' | 'failed';

export interface PillInputs {
  route: string;
  surface: Surface;
  browser: { active: boolean; url: string };
  warnings: number;
  ai: { active: boolean; label: string };
  publish: { phase: PublishPhase; label?: string; url?: string; changedAt?: number; error?: string };
  typing: string | null;
  now: number;
}

export type PillState =
  | { kind: 'typing'; text: string; warnings: number }
  | { kind: 'publishing'; label: string; warnings: number }
  | { kind: 'live'; url: string; warnings: number }
  | { kind: 'failed'; label: string; warnings: number }
  | { kind: 'ai'; label: string; warnings: number }
  | { kind: 'browsing'; url: string; warnings: number }
  | { kind: 'idle'; route: string; surface: Surface; browserActive: boolean; warnings: number };

export const LIVE_HOLD_MS = 4000;
export const FAILED_HOLD_MS = 6000;
const MAX_FAIL_LABEL = 60;

/** Longest URL the fixed-width pill can show before it stops being readable. */
const MAX_URL = 48;

export function hostOf(url: string): string {
  let out: string;
  try {
    // `host` is empty for schemes with no authority — about:blank, file:, mailto:,
    // and the very common "localhost:3000" typed without a scheme. Falling back to
    // the raw input is right there: an empty pill reading "Browsing " is worse than
    // showing what was actually asked for. AiBrowserManager navigates a fresh webview
    // to about:blank before the real URL, so this is on the normal path, not an edge.
    out = new URL(url).host.replace(/^www\./, '') || url;
  } catch {
    out = url;
  }
  return out.length > MAX_URL ? out.slice(0, MAX_URL - 1) + '…' : out;
}

/**
 * Truncate on whole characters, not UTF-16 code units, so a cut never splits a
 * surrogate pair into a lone surrogate (which renders as U+FFFD). Publish errors
 * routinely carry emoji and non-Latin paths from CLI output.
 */
function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

export function derivePillState(i: PillInputs): PillState {
  const warnings = i.warnings;
  if (i.typing !== null) return { kind: 'typing', text: i.typing, warnings };

  const p = i.publish;
  if (p.phase === 'publishing') return { kind: 'publishing', label: p.label || 'Publishing…', warnings };
  if (p.phase === 'live' && p.url && p.changedAt !== undefined && i.now - p.changedAt < LIVE_HOLD_MS) {
    return { kind: 'live', url: p.url, warnings };
  }
  // A missing or non-finite changedAt holds the failure rather than hiding it.
  // `changedAt` is optional, and silently dropping a publish failure to 'idle' fails
  // in the wrong direction — the user would see nothing at all go wrong.
  if (p.phase === 'failed') {
    const fresh = !Number.isFinite(p.changedAt as number) || i.now - (p.changedAt as number) < FAILED_HOLD_MS;
    if (fresh) {
      return { kind: 'failed', label: truncateChars(p.error || 'Publish failed', MAX_FAIL_LABEL), warnings };
    }
  }

  if (i.ai.active) return { kind: 'ai', label: i.ai.label || 'AI working', warnings };

  if (i.browser.active && i.surface === 'browser') return { kind: 'browsing', url: hostOf(i.browser.url), warnings };

  return { kind: 'idle', route: i.route, surface: i.surface, browserActive: i.browser.active, warnings };
}
