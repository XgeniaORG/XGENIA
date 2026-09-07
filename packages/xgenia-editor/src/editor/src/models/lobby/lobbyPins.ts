/**
 * lobbyPins.ts — which games sit at the top of the lobby.
 *
 * A pin is the only piece of lobby state the user authors by hand, so it is the one that has to
 * survive a bad read. The reducer below is pure and total: it takes whatever came out of
 * settings — an array, a string, null, an object someone hand-edited — and returns a clean list
 * of ids. Nothing here throws, because a corrupt pin list must never keep the projects screen
 * from rendering.
 */

/** Ceiling on pins. Beyond this the Pinned group stops being a shortlist and becomes the list. */
export const MAX_PINS = 24;

/**
 * Coerce whatever storage handed back into a list of unique, non-empty ids.
 *
 * `EditorSettings.get` reads a JSON file written by earlier versions of the app and, in
 * WEB_MODE, by localStorage. Both can hold anything.
 */
export function normalisePins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PINS) break;
  }

  return out;
}

/**
 * Toggle one id.
 *
 * A new pin goes to the front. That is not cosmetic: the Pinned group renders in recency order,
 * but the stored order is what survives if pinning ever grows a manual arrangement, and "the one
 * I just pinned" is the sane default position.
 *
 * Returns the same array reference when nothing changed, so callers can skip a settings write.
 */
export function togglePin(pins: string[], id: string): string[] {
  if (!id) return pins;

  if (pins.includes(id)) return pins.filter((p) => p !== id);
  if (pins.length >= MAX_PINS) return pins;

  return [id, ...pins];
}

/** Pin every id that is not already pinned, respecting the ceiling. Used by the selection bar. */
export function pinAll(pins: string[], ids: string[]): string[] {
  const additions = ids.filter((id) => id && !pins.includes(id));
  if (!additions.length) return pins;

  return [...additions, ...pins].slice(0, MAX_PINS);
}

/** Drop every id. Used by the selection bar, and by removal so a pin cannot outlive its game. */
export function unpinAll(pins: string[], ids: string[]): string[] {
  const drop = new Set(ids);
  const out = pins.filter((p) => !drop.has(p));
  return out.length === pins.length ? pins : out;
}

/**
 * Drop pins whose project no longer exists.
 *
 * Removing a project from the list does not currently touch settings, so without this a profile
 * accumulates pins pointing at nothing, and eventually the ceiling is full of ghosts.
 */
export function prunePins(pins: string[], existingIds: Iterable<string>): string[] {
  const alive = new Set(existingIds);
  const out = pins.filter((p) => alive.has(p));
  return out.length === pins.length ? pins : out;
}
