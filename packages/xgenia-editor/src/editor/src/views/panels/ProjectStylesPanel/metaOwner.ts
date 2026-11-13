/**
 * Whether the cached project styles were read from a project other than the one now open.
 * No project open (between projects) keeps the cache; the next project re-reads it.
 */
export function metaBelongsElsewhere(owner: unknown, current: unknown): boolean {
  return !!current && current !== owner;
}
