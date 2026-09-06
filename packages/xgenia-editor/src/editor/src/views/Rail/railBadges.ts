// Composes the rail's badge and tooltip-suffix signals for one item. Pure — no editor
// imports — so this file and its tests load under plain `tsx --test`.
//
// Three tasks each wanted to set badge={{...}} directly on a RailButton call site: the AI
// touched a panel's domain (an amber "unseen" dot), the uncommitted file count on Version
// control, and whether a turn is running (a ring on the chat item). Taken literally, the
// third overwrites the first two and every badge but the last one written goes dark. This
// module is the one place that composition happens, so a future fourth badge kind has to
// go through badgeFor() too instead of adding one more badge={{...}} literal somewhere
// that quietly clobbers these — that is exactly what railBadges.test.ts locks down.
//
// Inputs are plain data (an item id, a presence entry, a git count, an AI snapshot), not
// the live SidebarItem/model objects Rail.tsx holds — so a test can construct them
// directly without touching React or any editor model.

export interface RailBadge {
  count?: number;
  unseen?: boolean;
  ring?: boolean;
}

export interface PresenceEntry {
  unseen: number;
  lastAt: number;
}

export interface AiActivityInput {
  active: boolean;
  label: string;
}

export interface BadgeInput {
  itemId: string;
  presenceEntry: PresenceEntry | undefined;
  gitCount: number | null;
  ai: AiActivityInput;
  /**
   * This item is the one that shows AI activity (the chat) — mirrors the
   * `showsAiActivity` flag on the panel's own `SidebarItem` registration. NOT an id
   * comparison: the chat panel's id is `'ChatPanel'` (iframe, the shipping
   * configuration) or `'chat-panel'` (the open-source shell fallback), decided at
   * runtime by router.setup.ts — a literal id here would silently miss whichever one
   * isn't currently loaded, which is exactly how the ring and elapsed-time tooltip went
   * dark in the shipping build.
   */
  showsAiActivity?: boolean;
}

export function badgeFor(input: BadgeInput): RailBadge {
  const badge: RailBadge = {};
  const isVersionControl = input.itemId === 'versioncontrol';
  // Version control's badge is a live count, not a "did you miss something" dot — an
  // unseen dot on top of a count would just be noise. RailPresence.noteCommand already
  // refuses to record 'versioncontrol' as a family, so in the running app `presenceEntry`
  // is never populated for it — but this excludes it again here too, so this pure
  // function keeps that guarantee even if some future caller hands it a stray entry.
  if (!isVersionControl && (input.presenceEntry?.unseen ?? 0) > 0) badge.unseen = true;
  if (isVersionControl) badge.count = input.gitCount ?? undefined;
  if (input.showsAiActivity) badge.ring = input.ai.active;
  return badge;
}

/** Static (non-ticking) tooltip suffix for every item except the chat panel, whose
 *  elapsed-time text is handled by ChatRailButton in Rail.tsx so a per-second tick never
 *  has to re-render the rest of the rail — this function never returns that text; the
 *  chat item only ever gets a suffix here if it happens to carry a presence entry. */
export function tooltipSuffixFor(input: Omit<BadgeInput, 'ai'>): string | undefined {
  if (input.itemId === 'versioncontrol') {
    return input.gitCount ? `· ${input.gitCount} uncommitted file${input.gitCount === 1 ? '' : 's'}` : undefined;
  }
  return input.presenceEntry?.unseen ? `· ${input.presenceEntry.unseen} new since you looked` : undefined;
}
