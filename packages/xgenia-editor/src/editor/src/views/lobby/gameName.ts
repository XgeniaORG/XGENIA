// The name a new game gets from its description, before the user types one. It names the game's
// folder and its tile, so it should read like a title: "Candy Slot", not "A candy slot" or "I want a".

const LEADING = /^(?:(?:please|hey|hi)\s+)?(?:(?:i\s+(?:want|would like|need)|let'?s|can you|could you)\s+(?:to\s+)?)?(?:(?:make|build|create|design|do)\s+(?:me\s+)?)?(?:(?:a|an|the|my|some)\s+)?/i;
const STOP = new Set(['with', 'that', 'where', 'which', 'and', 'for', 'in', 'on', 'featuring', 'using', 'like', 'about', 'of', 'from', 'to', 'who', 'when', 'but']);
const MAX_WORDS = 3;

const titleCase = (w: string) => (/[A-Z]/.test(w.slice(1)) || /\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();

export function gameNameFrom(description: string): string {
  const raw = (description || '').replace(/\s+/g, ' ').trim();
  // "Candy Rush, a candy slot…" / "Candy Rush: …" / "Candy Rush - …": the user named it.
  const named = /^([^,.:;!?–—-]{2,40}?)\s*(?:,|:|\s[-–—]\s)/.exec(raw);
  const title = named ? clean(named[1]) : '';
  if (title && title.split(' ').length <= 4 && !LEADING.exec(title)?.[0]) return title.split(' ').map(titleCase).join(' ');
  const text = clean(raw);
  if (!text) return 'Untitled';
  const words = text.replace(LEADING, '').split(/[\s,.;:!?]+/).filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    if (kept.length && STOP.has(w.toLowerCase())) break;
    kept.push(w);
    if (kept.length === MAX_WORDS) break;
  }
  return kept.length ? kept.map(titleCase).join(' ') : 'Untitled';
}
