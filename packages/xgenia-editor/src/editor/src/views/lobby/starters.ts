// Starter games for "Describe it". A description that names a known kind of game (a slot, a crash
// game, plinko) creates the new game from a small, already-playable starter of that kind, so the
// first version runs in seconds and the AI makes it the user's own from there. Anything else starts
// empty, as before. The list is served next to the AI panel, so new starters need no editor release.

export const STARTERS_BASE = 'https://xgenia-ai-app-xgenia.vercel.app/starters/';
const MANIFEST_URL = STARTERS_BASE + 'manifest.json';

export interface StarterEntry {
  type: string;
  name: string;
  /** Zip file name, relative to STARTERS_BASE. Versioned: templates are cached by URL. */
  file: string;
  keywords: string[];
}

/** How many of a starter's keywords the description contains, as whole words or phrases. */
function score(description: string, keywords: string[]): number {
  const text = ` ${description.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return keywords.reduce((n, k) => {
    const phrase = k.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return phrase && text.includes(` ${phrase} `) ? n + 1 : n;
  }, 0);
}

/** The starter a description asks for, or null (no keyword, or two kinds tie). */
export function pickStarter(description: string, starters: StarterEntry[]): StarterEntry | null {
  const ranked = starters
    .map((s) => ({ s, n: score(description || '', s.keywords || []) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].n === ranked[1].n) return null;
  return ranked[0].s;
}

/** The first chat message for a game made from a starter (the AI's starter route keys on it). */
export function starterSeed(type: string, description: string): string {
  return `Make this ${type} game mine: ${description.trim()}`;
}

export function starterUrl(starter: StarterEntry): string {
  return STARTERS_BASE + starter.file;
}

/** The starter list, or [] when it cannot be had quickly (offline: the game starts empty). */
export async function fetchStarters(fetchImpl: typeof fetch = fetch, timeoutMs = 4000): Promise<StarterEntry[]> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const res = await fetchImpl(MANIFEST_URL, { cache: 'no-store', signal: ctrl?.signal } as RequestInit);
    if (!res.ok) return [];
    const json: any = await res.json();
    const list = Array.isArray(json?.starters) ? json.starters : [];
    return list.filter(
      (s: any) => s && typeof s.type === 'string' && typeof s.file === 'string' && /^[\w.-]+\.zip$/.test(s.file) && Array.isArray(s.keywords)
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
